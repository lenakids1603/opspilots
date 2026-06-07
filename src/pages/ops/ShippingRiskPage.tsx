import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ops/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { AlertTriangle, RefreshCcw, Search } from "lucide-react";
import { formatDateTimeCN } from "@/lib/datetime";

const PAGE_SIZE = 50;

type RiskRow = {
  id: string;
  o_id: string | null;
  so_id: string | null;
  shop_id: string | null;
  shop_name: string | null;
  platform: string | null;
  order_status: string | null;
  pay_time: string | null;
  latest_ship_time: string | null;
  remaining_hours: number | null;
  is_timeout: boolean | null;
  risk_level: string | null;
  sku_code: string | null;
  sku_name: string | null;
  style_no: string | null;
  color: string | null;
  size: string | null;
  qty: number | null;
  supplier_name: string | null;
  last_checked_at: string | null;
};

type Filters = {
  shop: string;
  styleNo: string;
  skuCode: string;
  supplier: string;
  riskLevel: string; // all|low|medium|high|timeout|unknown
  timeoutOnly: string; // all|yes|no
  fromDate: string;
  toDate: string;
};

const defaultFilters = (): Filters => ({
  shop: "", styleNo: "", skuCode: "", supplier: "",
  riskLevel: "all", timeoutOnly: "all",
  fromDate: "", toDate: "",
});

const RISK_BADGE: Record<string, { label: string; cls: string }> = {
  timeout: { label: "已超时", cls: "bg-rose-100 text-rose-700 border-rose-200" },
  high: { label: "高风险", cls: "bg-orange-100 text-orange-700 border-orange-200" },
  medium: { label: "中风险", cls: "bg-amber-100 text-amber-700 border-amber-200" },
  low: { label: "低风险", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  unknown: { label: "未知", cls: "bg-muted text-muted-foreground border-border" },
};

function fmtHours(h: number | null) {
  if (h == null) return "-";
  const n = Number(h);
  if (Number.isNaN(n)) return "-";
  if (n < 0) return `已超 ${Math.abs(n).toFixed(1)}h`;
  return `${n.toFixed(1)}h`;
}

export default function ShippingRiskPage() {
  const [filters, setFilters] = useState<Filters>(defaultFilters());
  const [page, setPage] = useState(0);

  const query = useQuery({
    queryKey: ["shipping_risk_orders", filters, page],
    queryFn: async () => {
      let q = (supabase as any)
        .from("shipping_risk_orders")
        .select(
          "id,o_id,so_id,shop_id,shop_name,platform,order_status,pay_time,latest_ship_time,remaining_hours,is_timeout,risk_level,sku_code,sku_name,style_no,color,size,qty,supplier_name,last_checked_at",
          { count: "exact" }
        )
        .order("latest_ship_time", { ascending: true, nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (filters.shop) q = q.ilike("shop_name", `%${filters.shop}%`);
      if (filters.styleNo) q = q.ilike("style_no", `%${filters.styleNo}%`);
      if (filters.skuCode) q = q.ilike("sku_code", `%${filters.skuCode}%`);
      if (filters.supplier) q = q.ilike("supplier_name", `%${filters.supplier}%`);
      if (filters.riskLevel !== "all") q = q.eq("risk_level", filters.riskLevel);
      if (filters.timeoutOnly === "yes") q = q.eq("is_timeout", true);
      if (filters.timeoutOnly === "no") q = q.eq("is_timeout", false);
      if (filters.fromDate) q = q.gte("latest_ship_time", `${filters.fromDate}T00:00:00+08:00`);
      if (filters.toDate) q = q.lte("latest_ship_time", `${filters.toDate}T23:59:59+08:00`);

      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as RiskRow[], total: count ?? 0 };
    },
    retry: false,
  });

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE_SIZE)),
    [query.data?.total]
  );

  const tableUnavailable =
    !!query.error &&
    /relation .* does not exist|permission denied|not found/i.test(String((query.error as any)?.message ?? ""));

  return (
    <div>
      <PageHeader
        breadcrumb={["运维系统", "未发货风险"]}
        title="未发货 / 超时风险"
        description="数据源：shipping_risk_orders（轻量风险订单表，由聚水潭近期同步沉淀，只读）"
        actions={
          <Button size="sm" variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCcw className={"w-3.5 h-3.5 mr-1 " + (query.isFetching ? "animate-spin" : "")} />
            刷新
          </Button>
        }
      />

      <div className="mx-6 mb-3 rounded-md border border-amber-300 bg-amber-50/60 px-4 py-2.5 text-xs text-amber-800 flex items-start gap-2">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          本页面只读 shipping_risk_orders，不触发同步、不调用回填。订单变为已发货 / 已取消后会被同步任务自动从该表移除。完整订单明细仍以聚水潭为准。
        </span>
      </div>

      <div className="px-6">
        <Card className="p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">店铺</label>
              <Input value={filters.shop} onChange={e => setFilters(f => ({ ...f, shop: e.target.value }))} placeholder="店铺名包含" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">款号</label>
              <Input value={filters.styleNo} onChange={e => setFilters(f => ({ ...f, styleNo: e.target.value }))} placeholder="款号" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">SKU</label>
              <Input value={filters.skuCode} onChange={e => setFilters(f => ({ ...f, skuCode: e.target.value }))} placeholder="SKU code" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">供应商</label>
              <Input value={filters.supplier} onChange={e => setFilters(f => ({ ...f, supplier: e.target.value }))} placeholder="供应商名包含" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">风险等级</label>
              <Select value={filters.riskLevel} onValueChange={v => setFilters(f => ({ ...f, riskLevel: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="timeout">已超时</SelectItem>
                  <SelectItem value="high">高</SelectItem>
                  <SelectItem value="medium">中</SelectItem>
                  <SelectItem value="low">低</SelectItem>
                  <SelectItem value="unknown">未知</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">是否超时</label>
              <Select value={filters.timeoutOnly} onValueChange={v => setFilters(f => ({ ...f, timeoutOnly: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="yes">仅超时</SelectItem>
                  <SelectItem value="no">仅未超时</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">最晚发货时间 起</label>
              <Input type="date" value={filters.fromDate} onChange={e => setFilters(f => ({ ...f, fromDate: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">最晚发货时间 止</label>
              <Input type="date" value={filters.toDate} onChange={e => setFilters(f => ({ ...f, toDate: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={() => { setPage(0); query.refetch(); }}>
              <Search className="w-3.5 h-3.5 mr-1" />查询
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setFilters(defaultFilters()); setPage(0); }}>
              重置
            </Button>
            <div className="ml-auto text-xs text-muted-foreground self-center">
              共 {query.data?.total ?? 0} 条
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>店铺</TableHead>
                <TableHead>订单号</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>款号</TableHead>
                <TableHead>颜色</TableHead>
                <TableHead>尺码</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead>付款时间</TableHead>
                <TableHead>最晚发货</TableHead>
                <TableHead className="text-right">剩余</TableHead>
                <TableHead>超时</TableHead>
                <TableHead>风险</TableHead>
                <TableHead>供应商</TableHead>
                <TableHead>最后检查</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading && (
                <TableRow><TableCell colSpan={14} className="text-center py-10 text-muted-foreground">加载中…</TableCell></TableRow>
              )}
              {!query.isLoading && tableUnavailable && (
                <TableRow><TableCell colSpan={14} className="text-center py-10 text-muted-foreground">
                  风险订单表暂不可用。请稍后刷新或联系运维确认同步状态。
                </TableCell></TableRow>
              )}
              {!query.isLoading && !tableUnavailable && (query.data?.rows.length ?? 0) === 0 && (
                <TableRow><TableCell colSpan={14} className="text-center py-10 text-muted-foreground">
                  暂无未发货风险订单
                </TableCell></TableRow>
              )}
              {!query.isLoading && (query.data?.rows ?? []).map(r => {
                const badge = RISK_BADGE[r.risk_level ?? "unknown"] ?? RISK_BADGE.unknown;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{r.shop_name ?? r.shop_id ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.o_id ?? r.so_id ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.sku_code ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.style_no ?? "-"}</TableCell>
                    <TableCell className="text-xs">{r.color ?? "-"}</TableCell>
                    <TableCell className="text-xs">{r.size ?? "-"}</TableCell>
                    <TableCell className="text-right text-xs">{r.qty ?? 0}</TableCell>
                    <TableCell className="text-xs">{formatDateTimeCN(r.pay_time)}</TableCell>
                    <TableCell className="text-xs">{formatDateTimeCN(r.latest_ship_time)}</TableCell>
                    <TableCell className={"text-right text-xs " + (r.is_timeout ? "text-rose-600 font-semibold" : "")}>{fmtHours(r.remaining_hours)}</TableCell>
                    <TableCell>{r.is_timeout ? <Badge variant="destructive">是</Badge> : <Badge variant="secondary">否</Badge>}</TableCell>
                    <TableCell><Badge variant="outline" className={badge.cls}>{badge.label}</Badge></TableCell>
                    <TableCell className="text-xs">{r.supplier_name ?? "-"}</TableCell>
                    <TableCell className="text-xs">{formatDateTimeCN(r.last_checked_at)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {!tableUnavailable && (query.data?.rows.length ?? 0) > 0 && (
            <div className="flex items-center justify-end gap-2 p-3 border-t">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>上一页</Button>
              <span className="text-xs text-muted-foreground">{page + 1} / {totalPages}</span>
              <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
