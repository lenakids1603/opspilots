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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, RefreshCcw, Search, Eye } from "lucide-react";
import { formatDateTimeCN, beijingRangeToUTC } from "@/lib/datetime";
import { ShippingRiskStatsCards } from "@/components/ops/ShippingRiskStatsCards";
import { ShippingRiskDetailDrawer } from "@/components/ops/ShippingRiskDetailDrawer";
import {
  matchPurchasesForSkus, derivePurchaseStatus, PURCHASE_STATUS_LABEL,
  aggregatedSupplierNames, isAgreementOverdue, earliestDeliveryDate,
  matchKey, SkuMatchResult, PurchaseStatus,
} from "@/lib/purchaseMatch";

const PAGE_SIZE = 50;

type RiskRow = {
  id: string;
  o_id: string | null;
  so_id: string | null;
  shop_id: string | null;
  shop_name: string | null;
  platform: string | null;
  order_status: string | null;
  order_created_at: string | null;
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
  riskLevel: string; // all|timeout|within24|within48|low|medium|high|unknown
  fromDate: string;
  toDate: string;
  purchaseStatus: string; // all | po_pending_receipt | po_partial_received | po_completed_but_unshipped | no_po
  poFound: string; // all | yes | no
};

const defaultFilters = (): Filters => ({
  shop: "", styleNo: "", skuCode: "", supplier: "",
  riskLevel: "all",
  fromDate: "", toDate: "",
  purchaseStatus: "all", poFound: "all",
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

function rowBgClass(r: RiskRow): string {
  if (r.is_timeout) return "bg-rose-50/60";
  const h = r.remaining_hours;
  if (h != null && h <= 24) return "bg-orange-50/60";
  if (h != null && h <= 48) return "bg-amber-50/40";
  return "";
}

export default function ShippingRiskPage() {
  const [filters, setFilters] = useState<Filters>(defaultFilters());
  const [page, setPage] = useState(0);
  const [detailOid, setDetailOid] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["shipping_risk_orders", filters, page],
    queryFn: async () => {
      let q = (supabase as any)
        .from("shipping_risk_orders")
        .select(
          "id,o_id,so_id,shop_id,shop_name,platform,order_status,order_created_at,pay_time,latest_ship_time,remaining_hours,is_timeout,risk_level,sku_code,sku_name,style_no,color,size,qty,supplier_name,last_checked_at",
          { count: "exact" }
        )
        .order("remaining_hours", { ascending: true, nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (filters.shop) q = q.ilike("shop_name", `%${filters.shop}%`);
      if (filters.styleNo) q = q.ilike("style_no", `%${filters.styleNo}%`);
      if (filters.skuCode) q = q.ilike("sku_code", `%${filters.skuCode}%`);
      if (filters.supplier) q = q.ilike("supplier_name", `%${filters.supplier}%`);

      if (filters.riskLevel === "timeout") q = q.eq("is_timeout", true);
      else if (filters.riskLevel === "within24") q = q.eq("is_timeout", false).gte("remaining_hours", 0).lte("remaining_hours", 24);
      else if (filters.riskLevel === "within48") q = q.eq("is_timeout", false).gt("remaining_hours", 24).lte("remaining_hours", 48);
      else if (["low", "medium", "high", "unknown"].includes(filters.riskLevel)) q = q.eq("risk_level", filters.riskLevel);

      const range = beijingRangeToUTC(filters.fromDate || null, filters.toDate || null);
      if (range.gte) q = q.gte("order_created_at", range.gte);
      if (range.lte) q = q.lte("order_created_at", range.lte);

      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as RiskRow[], total: count ?? 0 };
    },
    retry: false,
  });

  const rows = query.data?.rows ?? [];

  // 批量匹配采购单
  const matchQuery = useQuery({
    queryKey: ["shipping_risk_match", rows.map(r => `${r.sku_code}__${r.style_no}`).join("|")],
    enabled: rows.length > 0,
    queryFn: () => matchPurchasesForSkus(rows.map(r => ({ sku: r.sku_code, style: r.style_no }))),
    retry: false,
  });

  const matchMap: Map<string, SkuMatchResult> = matchQuery.data ?? new Map();

  // 前端二次筛选：采购状态 / 是否找到采购单
  const visibleRows = useMemo(() => {
    return rows.filter(r => {
      const m = matchMap.get(matchKey({ sku: r.sku_code, style: r.style_no }));
      const status: PurchaseStatus = m ? derivePurchaseStatus(m) : "unknown";
      if (filters.purchaseStatus !== "all" && status !== filters.purchaseStatus) return false;
      if (filters.poFound === "yes" && (!m || m.matches.length === 0)) return false;
      if (filters.poFound === "no" && m && m.matches.length > 0) return false;
      return true;
    });
  }, [rows, matchMap, filters.purchaseStatus, filters.poFound]);

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
        title="发货超时预警"
        description="数据源：shipping_risk_orders（轻量风险订单表，由聚水潭近期同步沉淀，只读）。供应商与采购状态来自 purchase_orders / purchase_order_items 实时匹配。"
        actions={
          <Button size="sm" variant="outline" onClick={() => { query.refetch(); matchQuery.refetch(); }} disabled={query.isFetching}>
            <RefreshCcw className={"w-3.5 h-3.5 mr-1 " + (query.isFetching ? "animate-spin" : "")} />
            刷新
          </Button>
        }
      />

      <div className="mx-6 mb-3 rounded-md border border-amber-300 bg-amber-50/60 px-4 py-2.5 text-xs text-amber-800 flex items-start gap-2">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          本页面只读，不触发同步、不调用回填。订单变为已发货 / 已取消后会被同步任务自动从该表移除。采购单匹配按 SKU → 款号 → 商品档案默认供应商 顺序回退，仍无匹配时显示「待匹配」。
        </span>
      </div>

      <div className="px-6">
        <ShippingRiskStatsCards
          shop={filters.shop} styleNo={filters.styleNo}
          skuCode={filters.skuCode} supplier={filters.supplier}
        />

        <Card className="p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">店铺</label>
              <Input value={filters.shop} onChange={e => setFilters(f => ({ ...f, shop: e.target.value }))} placeholder="店铺名包含" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">供应商</label>
              <Input value={filters.supplier} onChange={e => setFilters(f => ({ ...f, supplier: e.target.value }))} placeholder="供应商名包含" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">SKU</label>
              <Input value={filters.skuCode} onChange={e => setFilters(f => ({ ...f, skuCode: e.target.value }))} placeholder="SKU code" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">款号</label>
              <Input value={filters.styleNo} onChange={e => setFilters(f => ({ ...f, styleNo: e.target.value }))} placeholder="款号" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">风险等级</label>
              <Select value={filters.riskLevel} onValueChange={v => setFilters(f => ({ ...f, riskLevel: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="timeout">已超时</SelectItem>
                  <SelectItem value="within24">24h 内</SelectItem>
                  <SelectItem value="within48">48h 内</SelectItem>
                  <SelectItem value="high">高</SelectItem>
                  <SelectItem value="medium">中</SelectItem>
                  <SelectItem value="low">低</SelectItem>
                  <SelectItem value="unknown">未知</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">采购状态</label>
              <Select value={filters.purchaseStatus} onValueChange={v => setFilters(f => ({ ...f, purchaseStatus: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="po_pending_receipt">已下采购单，待入库</SelectItem>
                  <SelectItem value="po_partial_received">部分入库</SelectItem>
                  <SelectItem value="po_completed_but_unshipped">采购单已完成但订单仍未发货</SelectItem>
                  <SelectItem value="no_po">未找到采购单</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">是否找到采购单</label>
              <Select value={filters.poFound} onValueChange={v => setFilters(f => ({ ...f, poFound: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="yes">已找到</SelectItem>
                  <SelectItem value="no">未找到</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">下单 起</label>
                <Input type="date" value={filters.fromDate} onChange={e => setFilters(f => ({ ...f, fromDate: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">下单 止</label>
                <Input type="date" value={filters.toDate} onChange={e => setFilters(f => ({ ...f, toDate: e.target.value }))} />
              </div>
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
              共 {query.data?.total ?? 0} 条 · 当前页前端过滤后 {visibleRows.length} 条
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <TooltipProvider delayDuration={200}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>风险</TableHead>
                <TableHead className="text-right">剩余</TableHead>
                <TableHead>店铺</TableHead>
                <TableHead>订单号</TableHead>
                <TableHead>下单时间</TableHead>
                <TableHead>付款时间</TableHead>
                <TableHead>商品 / SKU / 款号</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead>供应商</TableHead>
                <TableHead>采购状态</TableHead>
                <TableHead>协议到货</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading && (
                <TableRow><TableCell colSpan={12} className="text-center py-10 text-muted-foreground">加载中…</TableCell></TableRow>
              )}
              {!query.isLoading && tableUnavailable && (
                <TableRow><TableCell colSpan={12} className="text-center py-10 text-muted-foreground">
                  风险订单表暂不可用。请稍后刷新或联系运维确认同步状态。
                </TableCell></TableRow>
              )}
              {!query.isLoading && !tableUnavailable && visibleRows.length === 0 && (
                <TableRow><TableCell colSpan={12} className="text-center py-10 text-muted-foreground">
                  暂无符合条件的未发货风险订单
                </TableCell></TableRow>
              )}
              {!query.isLoading && visibleRows.map(r => {
                const badge = RISK_BADGE[r.risk_level ?? "unknown"] ?? RISK_BADGE.unknown;
                const m = matchMap.get(matchKey({ sku: r.sku_code, style: r.style_no }));
                const status: PurchaseStatus = m ? derivePurchaseStatus(m) : "unknown";
                const sups = m ? aggregatedSupplierNames(m) : (r.supplier_name ? [r.supplier_name] : []);
                const overdue = m ? isAgreementOverdue(m) : false;
                const deliveryDate = m ? earliestDeliveryDate(m) : null;
                return (
                  <TableRow key={r.id} className={rowBgClass(r)}>
                    <TableCell><Badge variant="outline" className={badge.cls}>{badge.label}</Badge></TableCell>
                    <TableCell className={"text-right text-xs tabular-nums " + (r.is_timeout ? "text-rose-600 font-semibold" : "")}>{fmtHours(r.remaining_hours)}</TableCell>
                    <TableCell className="text-xs">{r.shop_name ?? r.shop_id ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.o_id ?? r.so_id ?? "-"}</TableCell>
                    <TableCell className="text-xs">{formatDateTimeCN(r.order_created_at ?? r.pay_time)}</TableCell>
                    <TableCell className="text-xs">{formatDateTimeCN(r.pay_time)}</TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium truncate max-w-[260px]" title={r.sku_name ?? ""}>{r.sku_name ?? "-"}</div>
                      <div className="font-mono text-muted-foreground">
                        {r.sku_code ?? "-"} · {r.style_no ?? "-"} · {r.color ?? "-"}/{r.size ?? "-"}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs">{r.qty ?? 0}</TableCell>
                    <TableCell className="text-xs">
                      {matchQuery.isLoading ? (
                        <span className="text-muted-foreground">…</span>
                      ) : sups.length === 0 ? (
                        <span className="text-muted-foreground">待匹配</span>
                      ) : sups.length === 1 ? (
                        <span>{sups[0]}</span>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help">{sups[0]} <span className="text-muted-foreground">+{sups.length - 1}</span></span>
                          </TooltipTrigger>
                          <TooltipContent>{sups.join("、")}</TooltipContent>
                        </Tooltip>
                      )}
                      {m?.matchedBy === "product_default" && (
                        <Badge variant="secondary" className="ml-1 text-[10px]">档案默认</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex flex-wrap gap-1 items-center">
                        <Badge variant="outline">{PURCHASE_STATUS_LABEL[status]}</Badge>
                        {overdue && <Badge variant="destructive" className="text-[10px]">协议日期已超</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {deliveryDate ? formatDateTimeCN(deliveryDate, { withSeconds: false }) : "-"}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setDetailOid(r.o_id)}>
                        <Eye className="w-3.5 h-3.5 mr-1" />详情
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </TooltipProvider>

          {!tableUnavailable && (query.data?.rows.length ?? 0) > 0 && (
            <div className="flex items-center justify-end gap-2 p-3 border-t">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>上一页</Button>
              <span className="text-xs text-muted-foreground">{page + 1} / {totalPages}</span>
              <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</Button>
            </div>
          )}
        </Card>
      </div>

      <ShippingRiskDetailDrawer oId={detailOid} onClose={() => setDetailOid(null)} />
    </div>
  );
}
