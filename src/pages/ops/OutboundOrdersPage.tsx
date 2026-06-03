import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ops/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Search, Download, ArrowUp, ArrowDown, ChevronsUpDown, FileJson } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  formatDateTimeCN, beijingDayRangeToUTC, todayCN, beijingYMD,
} from "@/lib/datetime";

const PAGE_SIZE = 20;
const fmtInt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 });

type Filters = {
  startDate: string;
  endDate: string;
  shop: string;
  warehouse: string;
  ioId: string;
  oId: string;
  lId: string;
  status: string;
};

function defaultFilters(): Filters {
  const end = todayCN();
  const d = new Date(`${end}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() - 6);
  return {
    startDate: beijingYMD(d), endDate: end,
    shop: "", warehouse: "", ioId: "", oId: "", lId: "", status: "all",
  };
}

function applyFilters(q: any, f: Filters) {
  if (f.startDate) { const r = beijingDayRangeToUTC(f.startDate); if (r) q = q.gte("io_date", r.gte); }
  if (f.endDate)   { const r = beijingDayRangeToUTC(f.endDate);   if (r) q = q.lte("io_date", r.lte); }
  if (f.shop) q = q.ilike("shop_name", `%${f.shop}%`);
  if (f.warehouse) q = q.ilike("warehouse", `%${f.warehouse}%`);
  if (f.ioId) q = q.ilike("io_id", `%${f.ioId}%`);
  if (f.oId) q = q.ilike("o_id", `%${f.oId}%`);
  if (f.lId) q = q.ilike("l_id", `%${f.lId}%`);
  if (f.status !== "all") q = q.eq("status", f.status);
  return q;
}

type SortDir = "asc" | "desc";
type SortKey = "io_date" | "consign_time" | "io_id" | "o_id" | "shop_name" | "warehouse" | "status" | "qty";

function useOutboundList(filters: Filters, page: number, sortKey: SortKey, sortDir: SortDir) {
  return useQuery({
    queryKey: ["outbound_orders_list", filters, page, sortKey, sortDir],
    queryFn: async () => {
      let q = supabase
        .from("jst_outbound_orders")
        .select("*", { count: "exact" });
      q = applyFilters(q, filters);
      q = q.order(sortKey, { ascending: sortDir === "asc", nullsFirst: false });
      if (sortKey !== "io_id") q = q.order("io_id", { ascending: false, nullsFirst: false });
      q = q.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
    retry: 1,
  });
}

function useOutboundItems(outboundOrderId: string | null) {
  return useQuery({
    queryKey: ["outbound_items", outboundOrderId],
    enabled: !!outboundOrderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jst_outbound_order_items")
        .select("*")
        .eq("outbound_order_id", outboundOrderId!)
        .order("id");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function SortHead({
  sortKey, currentKey, dir, onSort, children, align,
}: {
  sortKey: SortKey; currentKey: SortKey; dir: SortDir;
  onSort: (k: SortKey) => void; children: React.ReactNode; align?: "left" | "right";
}) {
  const active = sortKey === currentKey;
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 select-none hover:text-foreground transition cursor-pointer",
          active ? "text-foreground font-semibold" : "text-muted-foreground"
        )}
      >
        <span>{children}</span>
        <Icon className={cn("w-3 h-3", active ? "opacity-90" : "opacity-50")} />
      </button>
    </TableHead>
  );
}

export default function OutboundOrdersPage() {
  const [filters, setFilters] = useState<Filters>(defaultFilters());
  const [draft, setDraft] = useState<Filters>(defaultFilters());
  const [page, setPage] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<any | null>(null);
  const [rawOpen, setRawOpen] = useState<any | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("io_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const listQ = useOutboundList(filters, page, sortKey, sortDir);
  const itemsQ = useOutboundItems(detailId);

  const onSearch = () => { setPage(0); setFilters(draft); };
  const onReset = () => {
    const d = defaultFilters();
    setDraft(d); setFilters(d); setPage(0);
    setSortKey("io_date"); setSortDir("desc");
  };

  const onSort = (k: SortKey) => {
    if (sortKey !== k) { setSortKey(k); setSortDir("desc"); setPage(0); return; }
    if (sortDir === "desc") { setSortDir("asc"); setPage(0); return; }
    setSortKey("io_date"); setSortDir("desc"); setPage(0);
  };

  const applyQuickRange = (kind: "today" | "7d" | "30d" | "month" | "all") => {
    const end = todayCN();
    let start = "";
    let endDate = end;
    if (kind === "today") start = end;
    else if (kind === "7d") {
      const d = new Date(`${end}T00:00:00+08:00`); d.setUTCDate(d.getUTCDate() - 6); start = beijingYMD(d);
    } else if (kind === "30d") {
      const d = new Date(`${end}T00:00:00+08:00`); d.setUTCDate(d.getUTCDate() - 29); start = beijingYMD(d);
    } else if (kind === "month") start = end.slice(0, 8) + "01";
    else { start = ""; endDate = ""; }
    const next = { ...draft, startDate: start, endDate };
    setDraft(next); setFilters(next); setPage(0);
  };

  const onExport = () => {
    const rows = listQ.data?.rows ?? [];
    if (!rows.length) return toast({ title: "无出库单数据可导出" });
    const headers = ["出库单号", "订单号", "店铺", "仓库", "出库状态", "快递公司", "快递单号", "出库时间", "发货时间", "商品数量"];
    const lines = [headers.join(",")];
    for (const r of rows as any[]) {
      lines.push([
        r.io_id, r.o_id ?? "", r.shop_name ?? "", r.warehouse ?? "", r.status ?? "",
        r.logistics_company ?? "", r.l_id ?? "",
        formatDateTimeCN(r.io_date), formatDateTimeCN(r.consign_time),
        Number(r.qty ?? 0),
      ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `出库单列表_${todayCN()}.csv`;
    a.click();
  };

  return (
    <div>
      <PageHeader
        breadcrumb={["仓库系统", "出库信息"]}
        title="出库信息"
        description="展示从聚水潭同步过来的销售出库单数据，按出库时间、店铺、仓库等条件筛选查看。"
      />

      {/* 筛选 */}
      <Card className="mb-3"><CardContent className="p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
          <div><label className="text-xs text-muted-foreground">起始出库日期</label>
            <Input type="date" value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">截止出库日期</label>
            <Input type="date" value={draft.endDate} onChange={e => setDraft({ ...draft, endDate: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">出库单号</label>
            <Input value={draft.ioId} onChange={e => setDraft({ ...draft, ioId: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">订单号</label>
            <Input value={draft.oId} onChange={e => setDraft({ ...draft, oId: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">店铺</label>
            <Input value={draft.shop} onChange={e => setDraft({ ...draft, shop: e.target.value })} placeholder="店铺名称" /></div>
          <div><label className="text-xs text-muted-foreground">仓库</label>
            <Input value={draft.warehouse} onChange={e => setDraft({ ...draft, warehouse: e.target.value })} placeholder="仓库名称" /></div>
          <div><label className="text-xs text-muted-foreground">快递单号</label>
            <Input value={draft.lId} onChange={e => setDraft({ ...draft, lId: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">出库状态</label>
            <Select value={draft.status} onValueChange={v => setDraft({ ...draft, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="WaitConfirm">待出库</SelectItem>
                <SelectItem value="Confirmed">已出库</SelectItem>
                <SelectItem value="Cancelled">已取消</SelectItem>
              </SelectContent></Select></div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1 items-center">
          <Button size="sm" onClick={onSearch}><Search className="w-4 h-4 mr-1" />查询</Button>
          <Button size="sm" variant="outline" onClick={onReset}>重置</Button>
          <div className="h-5 w-px bg-border mx-1" />
          <span className="text-xs text-muted-foreground">快捷范围：</span>
          <Button size="sm" variant="outline" onClick={() => applyQuickRange("today")}>今天</Button>
          <Button size="sm" variant="outline" onClick={() => applyQuickRange("7d")}>最近 7 天</Button>
          <Button size="sm" variant="outline" onClick={() => applyQuickRange("30d")}>最近 30 天</Button>
          <Button size="sm" variant="outline" onClick={() => applyQuickRange("month")}>本月</Button>
          <Button size="sm" variant="outline" onClick={() => applyQuickRange("all")}>全部</Button>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={onExport}><Download className="w-4 h-4 mr-1" />导出当前页</Button>
        </div>
        <div className="text-xs text-muted-foreground border-t pt-2">
          说明：数据来源于聚水潭 <span className="font-medium text-foreground">销售出库查询接口</span>，由后台自动同步任务定时拉取。如需手动同步可前往「数据中心 / 聚水潭数据接入详情」。
        </div>
      </CardContent></Card>

      {/* 列表 */}
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead sortKey="io_id" currentKey={sortKey} dir={sortDir} onSort={onSort}>出库单号</SortHead>
              <SortHead sortKey="o_id" currentKey={sortKey} dir={sortDir} onSort={onSort}>订单号</SortHead>
              <SortHead sortKey="shop_name" currentKey={sortKey} dir={sortDir} onSort={onSort}>店铺</SortHead>
              <SortHead sortKey="warehouse" currentKey={sortKey} dir={sortDir} onSort={onSort}>仓库</SortHead>
              <SortHead sortKey="status" currentKey={sortKey} dir={sortDir} onSort={onSort}>出库状态</SortHead>
              <TableHead>快递公司</TableHead>
              <TableHead>快递单号</TableHead>
              <SortHead sortKey="io_date" currentKey={sortKey} dir={sortDir} onSort={onSort}>出库时间</SortHead>
              <SortHead sortKey="consign_time" currentKey={sortKey} dir={sortDir} onSort={onSort}>发货时间</SortHead>
              <SortHead sortKey="qty" currentKey={sortKey} dir={sortDir} onSort={onSort} align="right">商品数量</SortHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQ.isLoading && <TableRow><TableCell colSpan={11} className="text-center py-12 text-muted-foreground">加载中...</TableCell></TableRow>}
            {listQ.error && <TableRow><TableCell colSpan={11} className="text-center py-12 text-rose-600">读取失败：{(listQ.error as any).message}</TableCell></TableRow>}
            {!listQ.isLoading && !listQ.error && (listQ.data?.rows.length ?? 0) === 0 && (
              <TableRow><TableCell colSpan={11} className="text-center py-12 text-muted-foreground">
                暂无出库单。请扩大日期范围或检查「数据中心 / 聚水潭数据接入详情」中的销售出库同步任务。
              </TableCell></TableRow>
            )}
            {(listQ.data?.rows ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.io_id}</TableCell>
                <TableCell className="font-mono text-xs">{r.o_id ?? "-"}</TableCell>
                <TableCell className="text-xs">{r.shop_name || "-"}</TableCell>
                <TableCell className="text-xs">{r.warehouse || "-"}</TableCell>
                <TableCell><Badge variant="outline">{r.status || "-"}</Badge></TableCell>
                <TableCell className="text-xs">{r.logistics_company || "-"}</TableCell>
                <TableCell className="font-mono text-xs">{r.l_id || "-"}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{formatDateTimeCN(r.io_date, { withSeconds: false })}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{formatDateTimeCN(r.consign_time, { withSeconds: false })}</TableCell>
                <TableCell className="text-right">{fmtInt(r.qty)}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setDetailId(r.id); setDetailRow(r); }}>详情</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRawOpen(r)}><FileJson className="w-3 h-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between p-3 border-t">
          <div className="text-xs text-muted-foreground">
            共 {listQ.data?.count ?? 0} 条 · 第 {page + 1} / {Math.max(1, Math.ceil((listQ.data?.count ?? 0) / PAGE_SIZE))} 页
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</Button>
            <Button size="sm" variant="outline"
              disabled={(page + 1) * PAGE_SIZE >= (listQ.data?.count ?? 0)}
              onClick={() => setPage(p => p + 1)}>下一页</Button>
          </div>
        </div>
      </CardContent></Card>

      {/* 详情抽屉 */}
      <Sheet open={!!detailId} onOpenChange={(o) => { if (!o) { setDetailId(null); setDetailRow(null); } }}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>出库单详情 · {detailRow?.io_id}</SheetTitle>
            <SheetDescription>聚水潭销售出库单基础信息与商品明细</SheetDescription>
          </SheetHeader>
          {detailRow && (
            <div className="space-y-5 mt-4">
              <section>
                <h3 className="font-medium mb-2">A. 基础信息</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">出库单号：</span>{detailRow.io_id}</div>
                  <div><span className="text-muted-foreground">订单号：</span>{detailRow.o_id ?? "-"}</div>
                  <div><span className="text-muted-foreground">店铺：</span>{detailRow.shop_name || "-"}</div>
                  <div><span className="text-muted-foreground">仓库：</span>{detailRow.warehouse || "-"}</div>
                  <div><span className="text-muted-foreground">出库状态：</span>{detailRow.status || "-"}</div>
                  <div><span className="text-muted-foreground">快递公司：</span>{detailRow.logistics_company || "-"}</div>
                  <div><span className="text-muted-foreground">快递单号：</span>{detailRow.l_id || "-"}</div>
                  <div><span className="text-muted-foreground">商品总数：</span>{fmtInt(detailRow.qty)}</div>
                  <div><span className="text-muted-foreground">出库时间：</span>{formatDateTimeCN(detailRow.io_date)}</div>
                  <div><span className="text-muted-foreground">发货时间：</span>{formatDateTimeCN(detailRow.consign_time)}</div>
                  <div><span className="text-muted-foreground">JST 修改时间：</span>{formatDateTimeCN(detailRow.modified_at_jst)}</div>
                  <div><span className="text-muted-foreground">同步时间：</span>{formatDateTimeCN(detailRow.synced_at)}</div>
                </div>
              </section>

              <section>
                <h3 className="font-medium mb-2">B. 商品明细</h3>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>款号</TableHead>
                    <TableHead>商品名称</TableHead>
                    <TableHead>颜色</TableHead>
                    <TableHead>尺码</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {itemsQ.isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">加载中...</TableCell></TableRow>}
                    {!itemsQ.isLoading && (itemsQ.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-rose-600 py-6">该出库单暂无明细</TableCell></TableRow>
                    )}
                    {(itemsQ.data ?? []).map((it: any) => (
                      <TableRow key={it.id}>
                        <TableCell className="font-mono text-xs">{it.sku_id || "-"}</TableCell>
                        <TableCell className="font-mono text-xs">{it.i_id || "-"}</TableCell>
                        <TableCell className="text-xs">{it.name || "-"}</TableCell>
                        <TableCell className="text-xs">{it.color || "-"}</TableCell>
                        <TableCell className="text-xs">{it.size || "-"}</TableCell>
                        <TableCell className="text-right">{fmtInt(it.qty)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>

              <section>
                <h3 className="font-medium mb-2">C. 原始 JSON</h3>
                <pre className="bg-muted p-3 rounded text-[11px] overflow-auto max-h-80">{JSON.stringify(detailRow.raw_data, null, 2)}</pre>
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* 原始 JSON 抽屉 */}
      <Sheet open={!!rawOpen} onOpenChange={(o) => !o && setRawOpen(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>出库单原始 JSON</SheetTitle>
            <SheetDescription className="font-mono text-xs">{rawOpen?.io_id}</SheetDescription>
          </SheetHeader>
          <pre className="bg-muted p-3 rounded text-[11px] overflow-auto mt-4">
            {JSON.stringify(rawOpen?.raw_data, null, 2)}
          </pre>
        </SheetContent>
      </Sheet>
    </div>
  );
}
