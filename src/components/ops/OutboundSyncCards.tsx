import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, Activity, Eye } from "lucide-react";

const FUNCTION_NAME = "jst-sync-outbound-orders";
const SYNC_TYPE = "outbound_orders";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  success: { label: "正常", cls: "bg-emerald-100 text-emerald-700" },
  partial_failed: { label: "部分失败", cls: "bg-amber-100 text-amber-700" },
  running: { label: "同步中", cls: "bg-blue-100 text-blue-700" },
  failed: { label: "异常", cls: "bg-rose-100 text-rose-700" },
  none: { label: "暂未同步", cls: "bg-slate-100 text-slate-700" },
};

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "—";

const PAGE_SIZE = 20;

export function OutboundSyncCards() {
  const qc = useQueryClient();
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [page, setPage] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const countQ = useQuery({
    queryKey: ["outbound_count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("jst_outbound_orders")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 8000,
  });

  const lastLogQ = useQuery({
    queryKey: ["outbound_last_log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jst_sync_logs")
        .select("id,status,started_at,ended_at,message,error_detail,fetched_orders_count,fetched_items_count")
        .eq("sync_type", SYNC_TYPE)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: 5000,
  });

  const listQ = useQuery({
    queryKey: ["outbound_list", page, keyword],
    queryFn: async () => {
      let q = supabase
        .from("jst_outbound_orders")
        .select("id,io_id,o_id,shop_name,warehouse,status,logistics_company,l_id,io_date,consign_time,qty", { count: "exact" })
        .order("io_date", { ascending: false, nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const kw = keyword.trim();
      if (kw) q = q.or(`io_id.ilike.%${kw}%,o_id.ilike.%${kw}%,l_id.ilike.%${kw}%`);
      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: data ?? [], total: count ?? 0 };
    },
  });

  const detailQ = useQuery({
    enabled: !!detailId,
    queryKey: ["outbound_detail", detailId],
    queryFn: async () => {
      const [order, items] = await Promise.all([
        supabase.from("jst_outbound_orders").select("*").eq("id", detailId!).maybeSingle(),
        supabase.from("jst_outbound_order_items").select("*").eq("outbound_order_id", detailId!).order("id"),
      ]);
      if (order.error) throw order.error;
      if (items.error) throw items.error;
      return { order: order.data, items: items.data ?? [] };
    },
  });

  const syncMut = useMutation({
    mutationFn: async (payload: { hours?: number; days?: number; start_time?: string; end_time?: string }) => {
      const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
        body: { ...payload, manual: true },
      });
      if (error) throw new Error(error.message);
      if (data?.ok === false) throw new Error(data?.error ?? "同步失败");
      return data;
    },
    onSuccess: () => {
      toast({ title: "已启动销售出库同步", description: "后台运行中，刷新查看进度" });
      qc.invalidateQueries({ queryKey: ["outbound_count"] });
      qc.invalidateQueries({ queryKey: ["outbound_last_log"] });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["outbound_list"] }), 4000);
    },
    onError: (e: any) => {
      toast({ title: "销售出库同步失败", description: e.message, variant: "destructive" });
    },
  });

  const log = lastLogQ.data;
  const statusKey = !log ? "none" : (log.status as string);
  const meta = STATUS_LABEL[statusKey] ?? STATUS_LABEL.none;
  const totalPages = Math.max(1, Math.ceil((listQ.data?.total ?? 0) / PAGE_SIZE));

  return (
    <div className="p-5 space-y-4">
      <div className="rounded-md border border-sky-300 bg-sky-50/60 px-4 py-2.5 text-xs text-sky-800">
        聚水潭销售出库单同步（只读）：调用 <code>/open/orders/out/simple/query</code>，按修改时间窗口分页拉取出库单及商品明细，自动 upsert 主表与明细表，不会产生重复数据，也不会调用任何写入接口。
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <div className="font-medium text-sm">销售出库单</div>
            <Badge variant="secondary" className={meta.cls}>{meta.label}</Badge>
            <div className="flex-1" />
            <span className="text-xs text-muted-foreground">
              已同步 <span className="font-semibold tabular-nums text-foreground">{(countQ.data ?? 0).toLocaleString("zh-CN")}</span> 单
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <div>最近同步：<span className="text-foreground">{fmt(log?.ended_at ?? log?.started_at)}</span></div>
            <div>本次结果：<span className="text-foreground">
              {log ? `${log.fetched_orders_count ?? 0} 单 / ${log.fetched_items_count ?? 0} 明细` : "—"}
            </span></div>
          </div>

          {log?.message && (
            <div className="text-[11px] text-muted-foreground bg-muted/30 rounded px-2 py-1.5 break-all">
              {log.message}
            </div>
          )}
          {log?.error_detail && (
            <div className="text-[11px] text-rose-600 break-all">错误：{log.error_detail}</div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={syncMut.isPending}
              onClick={() => syncMut.mutate({ hours: 1 })}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1 ${syncMut.isPending ? "animate-spin" : ""}`} />
              同步最近 1 小时
            </Button>
            <Button size="sm" disabled={syncMut.isPending}
              onClick={() => syncMut.mutate({ days: 1 })}>同步最近 1 天</Button>
            <Button size="sm" variant="outline" disabled={syncMut.isPending}
              onClick={() => syncMut.mutate({ days: 7 })}>同步最近 7 天</Button>
            <Button size="sm" variant="outline" disabled={syncMut.isPending}
              onClick={() => syncMut.mutate({ days: 30 })}>同步最近 30 天</Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border">
            <span className="text-xs text-muted-foreground">自定义范围：</span>
            <Input type="datetime-local" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
              className="h-8 w-[180px] text-xs" />
            <span className="text-xs text-muted-foreground">→</span>
            <Input type="datetime-local" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
              className="h-8 w-[180px] text-xs" />
            <Button size="sm" variant="outline" disabled={syncMut.isPending || !customStart || !customEnd}
              onClick={() => syncMut.mutate({
                start_time: new Date(customStart).toISOString(),
                end_time: new Date(customEnd).toISOString(),
              })}>同步该范围</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium">出库单列表</div>
            <div className="flex-1" />
            <Input
              placeholder="搜索出库单号 / 订单号 / 快递单号"
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPage(0); }}
              className="h-8 w-[280px] text-xs"
            />
          </div>

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">出库单号</TableHead>
                  <TableHead className="whitespace-nowrap">订单号</TableHead>
                  <TableHead className="whitespace-nowrap">店铺</TableHead>
                  <TableHead className="whitespace-nowrap">仓库</TableHead>
                  <TableHead className="whitespace-nowrap">出库状态</TableHead>
                  <TableHead className="whitespace-nowrap">快递公司</TableHead>
                  <TableHead className="whitespace-nowrap">快递单号</TableHead>
                  <TableHead className="whitespace-nowrap">出库时间</TableHead>
                  <TableHead className="whitespace-nowrap">发货时间</TableHead>
                  <TableHead className="whitespace-nowrap text-right">商品数量</TableHead>
                  <TableHead className="whitespace-nowrap text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQ.isLoading && (
                  <TableRow><TableCell colSpan={11} className="text-center text-xs text-muted-foreground py-6">加载中…</TableCell></TableRow>
                )}
                {!listQ.isLoading && (listQ.data?.rows.length ?? 0) === 0 && (
                  <TableRow><TableCell colSpan={11} className="text-center text-xs text-muted-foreground py-6">暂无数据，点击上方按钮发起同步</TableCell></TableRow>
                )}
                {listQ.data?.rows.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.io_id}</TableCell>
                    <TableCell className="font-mono text-xs">{r.o_id ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.shop_name ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.warehouse ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.status ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.logistics_company ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.l_id ?? "—"}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmt(r.io_date)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmt(r.consign_time)}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{Number(r.qty ?? 0)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setDetailId(r.id)}>
                        <Eye className="w-3.5 h-3.5 mr-1" />查看详情
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div>共 {listQ.data?.total ?? 0} 条 · 第 {page + 1} / {totalPages} 页</div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}>上一页</Button>
              <Button size="sm" variant="outline" disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}>下一页</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Sheet open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>销售出库单详情</SheetTitle>
            <SheetDescription className="font-mono text-xs">
              {detailQ.data?.order?.io_id ?? ""}
            </SheetDescription>
          </SheetHeader>

          {detailQ.isLoading && <div className="py-6 text-xs text-muted-foreground">加载中…</div>}

          {detailQ.data?.order && (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div><span className="text-muted-foreground">订单号：</span>{detailQ.data.order.o_id ?? "—"}</div>
                <div><span className="text-muted-foreground">店铺：</span>{detailQ.data.order.shop_name ?? "—"}</div>
                <div><span className="text-muted-foreground">仓库：</span>{detailQ.data.order.warehouse ?? "—"}</div>
                <div><span className="text-muted-foreground">出库状态：</span>{detailQ.data.order.status ?? "—"}</div>
                <div><span className="text-muted-foreground">快递公司：</span>{detailQ.data.order.logistics_company ?? "—"}</div>
                <div><span className="text-muted-foreground">快递单号：</span><span className="font-mono">{detailQ.data.order.l_id ?? "—"}</span></div>
                <div><span className="text-muted-foreground">出库时间：</span>{fmt(detailQ.data.order.io_date)}</div>
                <div><span className="text-muted-foreground">发货时间：</span>{fmt(detailQ.data.order.consign_time)}</div>
                <div><span className="text-muted-foreground">商品总数：</span>{Number(detailQ.data.order.qty ?? 0)}</div>
                <div><span className="text-muted-foreground">同步时间：</span>{fmt(detailQ.data.order.synced_at)}</div>
              </div>

              <div>
                <div className="text-sm font-medium mb-2">商品明细（{detailQ.data.items.length}）</div>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">SKU</TableHead>
                        <TableHead className="text-xs">款号</TableHead>
                        <TableHead className="text-xs">商品名称</TableHead>
                        <TableHead className="text-xs">颜色</TableHead>
                        <TableHead className="text-xs">尺码</TableHead>
                        <TableHead className="text-xs text-right">数量</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailQ.data.items.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-4">暂无明细</TableCell></TableRow>
                      )}
                      {detailQ.data.items.map((it: any) => (
                        <TableRow key={it.id}>
                          <TableCell className="font-mono text-xs">{it.sku_id ?? "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{it.i_id ?? "—"}</TableCell>
                          <TableCell className="text-xs">{it.name ?? "—"}</TableCell>
                          <TableCell className="text-xs">{it.color ?? "—"}</TableCell>
                          <TableCell className="text-xs">{it.size ?? "—"}</TableCell>
                          <TableCell className="text-xs text-right tabular-nums">{Number(it.qty ?? 0)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default OutboundSyncCards;
