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
import { Search, Download, FileJson, ArrowUp, ArrowDown, ChevronsUpDown, AlertTriangle } from "lucide-react";
import { RemainingShipTime } from "@/components/ops/RemainingShipTime";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  formatDateTimeCN, beijingDayRangeToUTC, todayCN, beijingYMD,
} from "@/lib/datetime";
import { zhStatus } from "@/lib/statusLabel";

const PAGE_SIZE = 20;
const fmtMoney = (n: number | null | undefined) =>
  "¥" + Number(n ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const fmtInt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 });

type TimeField = "pay_time" | "created_time" | "modified_time";

type Filters = {
  startDate: string;
  endDate: string;
  timeField: TimeField;
  shop: string;
  keyword: string;
  internalType: string; // all | <code> | _null
  hasShipped: string;   // all | yes | no
};

function defaultFilters(): Filters {
  const end = todayCN();
  const d = new Date(`${end}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() - 6);
  const start = beijingYMD(d);
  return {
    startDate: start, endDate: end,
    timeField: "modified_time",
    shop: "", keyword: "",
    internalType: "all", hasShipped: "all",
  };
}

function applyFilters(q: any, f: Filters) {
  const tf = f.timeField;
  if (f.startDate) { const r = beijingDayRangeToUTC(f.startDate); if (r) q = q.gte(tf, r.gte); }
  if (f.endDate)   { const r = beijingDayRangeToUTC(f.endDate);   if (r) q = q.lte(tf, r.lte); }
  if (f.shop)   q = q.ilike("shop_name", `%${f.shop}%`);
  if (f.keyword) {
    const k = f.keyword.replace(/[%,]/g, "");
    q = q.or(`so_id.ilike.%${k}%,jst_o_id.ilike.%${k}%,l_id.ilike.%${k}%,io_id.ilike.%${k}%,shop_name.ilike.%${k}%`);
  }
  if (f.internalType !== "all") {
    if (f.internalType === "_null") q = q.is("internal_order_type", null);
    else q = q.eq("internal_order_type", f.internalType);
  }
  if (f.hasShipped === "yes") q = q.not("io_id", "is", null);
  if (f.hasShipped === "no")  q = q.is("io_id", null);
  return q;
}

function useStats(filters: Filters) {
  return useQuery({
    queryKey: ["sales_orders_stats_v2", filters, todayCN()],
    queryFn: async () => {
      const today = todayCN();
      const todayR = beijingDayRangeToUTC(today)!;
      const nowIso = new Date().toISOString();

      const inFilter = (q: any) => applyFilters(q, filters);

      const [todayPaidCntRes, todayAmtRes, pendingRes, overdueRes, shippedRes, refundRes] = await Promise.all([
        // 今日付款订单数 (按 pay_time)
        supabase.from("jst_sales_orders")
          .select("id", { count: "exact", head: true })
          .gte("pay_time", todayR.gte).lte("pay_time", todayR.lte),
        // 今日实付金额 (按 pay_time)
        supabase.from("jst_sales_orders")
          .select("paid_amount")
          .gte("pay_time", todayR.gte).lte("pay_time", todayR.lte).limit(5000),
        // 待发货 (按当前筛选)
        inFilter(supabase.from("jst_sales_orders")
          .select("id", { count: "exact", head: true })
          .eq("internal_order_type", "paid_pending_ship")),
        // 超时未发货
        inFilter(supabase.from("jst_sales_orders")
          .select("id", { count: "exact", head: true })
          .eq("internal_order_type", "paid_pending_ship")
          .lt("plan_delivery_date", nowIso)),
        // 已发货
        inFilter(supabase.from("jst_sales_orders")
          .select("id", { count: "exact", head: true })
          .eq("internal_order_type", "shipped")),
        // 退款/退货
        inFilter(supabase.from("jst_sales_orders")
          .select("id", { count: "exact", head: true })
          .in("internal_order_type", ["paid_cancelled_before_ship", "returned_after_ship"])),
      ]);

      const todayAmt = (todayAmtRes.data ?? []).reduce((s, r: any) => s + Number(r.paid_amount ?? 0), 0);

      return {
        todayPaidOrders: todayPaidCntRes.count ?? 0,
        todayAmt,
        pendingShip: pendingRes.count ?? 0,
        overdueShip: overdueRes.count ?? 0,
        shipped: shippedRes.count ?? 0,
        refund: refundRes.count ?? 0,
      };
    },
    retry: 1,
  });
}

type SortDir = "asc" | "desc";
type SortKey =
  | "modified_time" | "created_time" | "pay_time"
  | "so_id" | "jst_o_id" | "shop_name" | "status" | "paid_amount"
  | "internal_order_type" | "plan_delivery_date";

function useOrderList(filters: Filters, page: number, sortKey: SortKey, sortDir: SortDir) {
  return useQuery({
    queryKey: ["sales_orders_list_v2", filters, page, sortKey, sortDir],
    queryFn: async () => {
      let q = supabase.from("jst_sales_orders")
        .select("id, jst_o_id, so_id, shop_id, shop_name, status, internal_order_type, internal_order_type_name, order_type, created_time, modified_time, pay_time, plan_delivery_date, paid_amount, pay_amount, io_id, io_date, l_id, lc_id, logistics_company", { count: "exact" });
      q = applyFilters(q, filters);
      q = q.order(sortKey, { ascending: sortDir === "asc", nullsFirst: false });
      if (sortKey !== "jst_o_id") {
        q = q.order("jst_o_id", { ascending: false, nullsFirst: false });
      }
      q = q.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      const ids = (data ?? []).map((r: any) => r.id);
      const countMap = new Map<string, number>();
      if (ids.length > 0) {
        const { data: items } = await supabase.from("jst_sales_order_items")
          .select("sales_order_id, qty").in("sales_order_id", ids);
        (items ?? []).forEach((it: any) => {
          countMap.set(it.sales_order_id, (countMap.get(it.sales_order_id) ?? 0) + Number(it.qty ?? 1));
        });
      }
      return {
        rows: (data ?? []).map((r: any) => ({ ...r, item_count: countMap.get(r.id) ?? 0 })),
        count: count ?? 0,
      };
    },
    retry: 1,
  });
}

// 排序：业务关注度优先
const TYPE_ORDER: { code: string; name: string; emphasis?: "high" | "warn" }[] = [
  { code: "paid_pending_ship", name: "已付款待发货", emphasis: "high" },
  { code: "shipped", name: "已发货" },
  { code: "paid_cancelled_before_ship", name: "付款后未发货退款", emphasis: "warn" },
  { code: "returned_after_ship", name: "发货后退货", emphasis: "warn" },
  { code: "unpaid_cancelled", name: "未付款取消" },
  { code: "unknown", name: "待识别" },
];

function useTypeStats(filters: Filters) {
  return useQuery({
    queryKey: ["sales_orders_type_stats_v2", filters],
    queryFn: async () => {
      const counts: Record<string, number> = {};
      await Promise.all([
        ...TYPE_ORDER.map(async (t) => {
          let q = supabase.from("jst_sales_orders")
            .select("id", { count: "exact", head: true })
            .eq("internal_order_type", t.code);
          q = applyFilters(q, filters);
          const { count } = await q;
          counts[t.code] = count ?? 0;
        }),
        (async () => {
          let q = supabase.from("jst_sales_orders")
            .select("id", { count: "exact", head: true })
            .is("internal_order_type", null);
          q = applyFilters(q, filters);
          const { count } = await q;
          counts["_null"] = count ?? 0;
        })(),
      ]);
      return counts;
    },
    retry: 1,
  });
}

function useOrderItems(orderId: string | null) {
  return useQuery({
    queryKey: ["sales_order_items", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase.from("jst_sales_order_items")
        .select("*").eq("sales_order_id", orderId!).order("item_index");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useOrderAftersale(soId: string | null | undefined, jstOId: string | null | undefined) {
  return useQuery({
    queryKey: ["sales_order_aftersale", soId, jstOId],
    enabled: !!(soId || jstOId),
    queryFn: async () => {
      const filters: string[] = [];
      if (soId) filters.push(`so_id.eq.${soId}`);
      if (jstOId) filters.push(`o_id.eq.${jstOId}`);
      const orExpr = filters.join(",");
      const [refundRes, recvRes] = await Promise.all([
        supabase.from("jst_refund_orders")
          .select("id, as_id, status, good_status, refund_amount, payment_amount, question_type, question_reason, as_date, modified_at_jst")
          .or(orExpr).limit(20),
        supabase.from("jst_aftersale_received_orders")
          .select("id, as_id, io_id, status, received_date, modified_at_jst, warehouse")
          .or(orExpr).limit(20),
      ]);
      return { refunds: refundRes.data ?? [], received: recvRes.data ?? [] };
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

function Stat({ label, value, error, accent }: { label: string; value: any; error?: any; accent?: "warn" | "danger" | "ok" }) {
  const cls =
    accent === "danger" ? "text-rose-600" :
    accent === "warn"   ? "text-amber-600" :
    accent === "ok"     ? "text-emerald-600" : "";
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-semibold mt-1 tabular-nums", cls, error && "text-rose-600 text-base font-normal")}>
        {error ? "读取失败" : value}
      </div>
    </CardContent></Card>
  );
}

// 内部类型徽章配色
function InternalTypeBadge({ code, name }: { code?: string | null; name?: string | null }) {
  const label = name || "待识别";
  const cls =
    code === "paid_pending_ship"          ? "bg-blue-100 text-blue-700 border-blue-200" :
    code === "shipped"                    ? "bg-emerald-100 text-emerald-700 border-emerald-200" :
    code === "returned_after_ship"        ? "bg-rose-100 text-rose-700 border-rose-200" :
    code === "paid_cancelled_before_ship" ? "bg-amber-100 text-amber-700 border-amber-200" :
    code === "unpaid_cancelled"           ? "bg-muted text-muted-foreground border-border" :
                                            "bg-muted text-muted-foreground border-border";
  return <Badge variant="outline" className={cn("font-normal", cls)}>{label}</Badge>;
}

// 异常小标签
function AnomalyChips({ row }: { row: any }) {
  const chips: { text: string; cls: string }[] = [];
  if (row.internal_order_type === "paid_pending_ship" && row.plan_delivery_date && new Date(row.plan_delivery_date).getTime() < Date.now()) {
    chips.push({ text: "超时", cls: "bg-rose-100 text-rose-700 border-rose-200" });
  }
  if (!row.internal_order_type) {
    chips.push({ text: "待识别", cls: "bg-muted text-muted-foreground border-border" });
  }
  const s = String(row.status ?? "").toLowerCase();
  if (s === "question" || s === "异常") {
    chips.push({ text: "状态异常", cls: "bg-amber-100 text-amber-700 border-amber-200" });
  }
  if (row.internal_order_type === "returned_after_ship") {
    chips.push({ text: "发货后退货", cls: "bg-rose-100 text-rose-700 border-rose-200" });
  }
  if (!chips.length) return null;
  return (
    <span className="inline-flex gap-1 ml-1">
      {chips.map((c, i) => (
        <span key={i} className={cn("inline-flex items-center gap-0.5 text-[10px] px-1 py-px rounded border", c.cls)}>
          <AlertTriangle className="w-2.5 h-2.5" />{c.text}
        </span>
      ))}
    </span>
  );
}

export default function SalesOrdersListPage() {
  const [filters, setFilters] = useState<Filters>(defaultFilters());
  const [draft, setDraft] = useState<Filters>(defaultFilters());
  const [page, setPage] = useState(0);
  const [detailRow, setDetailRow] = useState<any | null>(null);
  const [rawOpen, setRawOpen] = useState<any | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("modified_time");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const statsQ = useStats(filters);
  const typeStatsQ = useTypeStats(filters);
  const listQ = useOrderList(filters, page, sortKey, sortDir);
  const itemsQ = useOrderItems(detailRow?.id ?? null);
  const aftersaleQ = useOrderAftersale(detailRow?.so_id, detailRow?.jst_o_id);

  const onSearch = () => { setPage(0); setFilters(draft); };
  const onReset = () => {
    const d = defaultFilters();
    setDraft(d); setFilters(d); setPage(0);
    setSortKey("modified_time"); setSortDir("desc");
  };
  const onSort = (k: SortKey) => {
    if (sortKey !== k) { setSortKey(k); setSortDir("desc"); setPage(0); return; }
    if (sortDir === "desc") { setSortDir("asc"); setPage(0); return; }
    setSortKey("modified_time"); setSortDir("desc"); setPage(0);
  };
  const applyQuickRange = (kind: "today" | "7d" | "30d" | "month" | "all") => {
    const end = todayCN();
    let start = "", endDate = end;
    if (kind === "today") start = end;
    else if (kind === "7d")    { const d = new Date(`${end}T00:00:00+08:00`); d.setUTCDate(d.getUTCDate() - 6); start = beijingYMD(d); }
    else if (kind === "30d")   { const d = new Date(`${end}T00:00:00+08:00`); d.setUTCDate(d.getUTCDate() - 29); start = beijingYMD(d); }
    else if (kind === "month") { start = end.slice(0, 8) + "01"; }
    else { start = ""; endDate = ""; }
    const next = { ...draft, startDate: start, endDate };
    setDraft(next); setFilters(next); setPage(0);
  };

  const onExport = () => {
    const rows = listQ.data?.rows ?? [];
    if (!rows.length) return toast({ title: "无订单数据可导出" });
    const headers = ["线上订单号", "店铺", "订单类型", "支付时间", "实付金额", "商品件数", "聚水潭状态", "聚水潭单号", "出库单号", "物流单号", "物流公司"];
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push([
        r.so_id ?? "", r.shop_name ?? "", r.internal_order_type_name ?? "",
        formatDateTimeCN(r.pay_time), Number(r.paid_amount ?? 0).toFixed(2),
        r.item_count, r.status ?? "", r.jst_o_id ?? "", r.io_id ?? "", r.l_id ?? "", r.logistics_company ?? "",
      ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `订单列表_${todayCN()}.csv`;
    a.click();
  };

  const s = statsQ.data;
  const err = statsQ.error;

  return (
    <div>
      <PageHeader
        breadcrumb={["运维系统", "订单列表"]}
        title="订单列表"
        description="订单工作台：聚焦待发货、超时、退款/退货等关键运营指标。"
      />

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <Stat label="今日付款订单" value={fmtInt(s?.todayPaidOrders)} error={err} />
        <Stat label="今日实付金额" value={fmtMoney(s?.todayAmt)} error={err} />
        <Stat label="待发货订单" value={fmtInt(s?.pendingShip)} error={err} accent="warn" />
        <Stat label="超时未发货" value={fmtInt(s?.overdueShip)} error={err} accent="danger" />
        <Stat label="已发货订单" value={fmtInt(s?.shipped)} error={err} accent="ok" />
        <Stat label="退款/退货订单" value={fmtInt(s?.refund)} error={err} accent="danger" />
      </div>

      {/* 筛选 */}
      <Card className="mb-3"><CardContent className="p-3 space-y-2">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          <div><label className="text-[11px] text-muted-foreground">起始日期</label>
            <Input type="date" className="h-9" value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} /></div>
          <div><label className="text-[11px] text-muted-foreground">截止日期</label>
            <Input type="date" className="h-9" value={draft.endDate} onChange={e => setDraft({ ...draft, endDate: e.target.value })} /></div>
          <div><label className="text-[11px] text-muted-foreground">时间字段</label>
            <Select value={draft.timeField} onValueChange={v => setDraft({ ...draft, timeField: v as TimeField })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pay_time">支付时间</SelectItem>
                <SelectItem value="created_time">创建时间</SelectItem>
                <SelectItem value="modified_time">修改时间</SelectItem>
              </SelectContent></Select></div>
          <div><label className="text-[11px] text-muted-foreground">店铺</label>
            <Input className="h-9" value={draft.shop} onChange={e => setDraft({ ...draft, shop: e.target.value })} placeholder="店铺名称" /></div>
          <div><label className="text-[11px] text-muted-foreground">内部订单类型</label>
            <Select value={draft.internalType} onValueChange={v => setDraft({ ...draft, internalType: v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {TYPE_ORDER.map(t => <SelectItem key={t.code} value={t.code}>{t.name}</SelectItem>)}
                <SelectItem value="_null">未分类</SelectItem>
              </SelectContent></Select></div>
          <div><label className="text-[11px] text-muted-foreground">是否已发货</label>
            <Select value={draft.hasShipped} onValueChange={v => setDraft({ ...draft, hasShipped: v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="yes">已发货</SelectItem>
                <SelectItem value="no">未发货</SelectItem>
              </SelectContent></Select></div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex-1 min-w-[200px] max-w-md">
            <Input
              className="h-9"
              placeholder="关键词：线上单号 / 聚水潭单号 / 物流单号 / 出库单号 / 店铺"
              value={draft.keyword}
              onChange={e => setDraft({ ...draft, keyword: e.target.value })}
              onKeyDown={e => { if (e.key === "Enter") onSearch(); }}
            />
          </div>
          <Button size="sm" onClick={onSearch}><Search className="w-4 h-4 mr-1" />查询</Button>
          <Button size="sm" variant="outline" onClick={onReset}>重置</Button>
          <div className="h-5 w-px bg-border mx-1" />
          <span className="text-[11px] text-muted-foreground">快捷：</span>
          <Button size="sm" variant="outline" onClick={() => applyQuickRange("today")}>今天</Button>
          <Button size="sm" variant="outline" onClick={() => applyQuickRange("7d")}>近 7 天</Button>
          <Button size="sm" variant="outline" onClick={() => applyQuickRange("30d")}>近 30 天</Button>
          <Button size="sm" variant="outline" onClick={() => applyQuickRange("month")}>本月</Button>
          <Button size="sm" variant="outline" onClick={() => applyQuickRange("all")}>全部</Button>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={onExport}><Download className="w-4 h-4 mr-1" />导出当前页</Button>
        </div>
      </CardContent></Card>

      {/* 内部分类统计（按当前筛选） */}
      <Card className="mb-3"><CardContent className="p-3">
        <div className="text-xs text-muted-foreground mb-2">内部订单分类（按当前筛选范围）</div>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
          {TYPE_ORDER.map((t) => {
            const cnt = typeStatsQ.data?.[t.code] ?? 0;
            const isHigh = t.emphasis === "high";
            const isWarn = t.emphasis === "warn";
            return (
              <button
                key={t.code}
                type="button"
                onClick={() => { const next = { ...draft, internalType: t.code }; setDraft(next); setFilters(next); setPage(0); }}
                className={cn(
                  "border rounded p-2 text-left transition hover:bg-muted/40",
                  isHigh && "border-blue-300 bg-blue-50/60",
                  isWarn && "border-amber-300 bg-amber-50/60",
                )}
              >
                <div className={cn("text-xs", isHigh ? "text-blue-700 font-medium" : isWarn ? "text-amber-700 font-medium" : "text-muted-foreground")}>{t.name}</div>
                <div className={cn(
                  "text-lg font-semibold tabular-nums",
                  isHigh && "text-blue-700",
                  isWarn && "text-amber-700",
                )}>
                  {typeStatsQ.isLoading ? "…" : fmtInt(cnt)}
                </div>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => { const next = { ...draft, internalType: "_null" }; setDraft(next); setFilters(next); setPage(0); }}
            className="border rounded p-2 border-dashed text-left hover:bg-muted/40"
          >
            <div className="text-xs text-muted-foreground">未分类（待回刷）</div>
            <div className="text-lg font-semibold tabular-nums">
              {typeStatsQ.isLoading ? "…" : fmtInt(typeStatsQ.data?.["_null"] ?? 0)}
            </div>
          </button>
        </div>
      </CardContent></Card>

      {/* 列表 */}
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead sortKey="so_id" currentKey={sortKey} dir={sortDir} onSort={onSort}>线上订单号</SortHead>
              <SortHead sortKey="shop_name" currentKey={sortKey} dir={sortDir} onSort={onSort}>店铺</SortHead>
              <SortHead sortKey="internal_order_type" currentKey={sortKey} dir={sortDir} onSort={onSort}>订单类型</SortHead>
              <SortHead sortKey="plan_delivery_date" currentKey={sortKey} dir={sortDir} onSort={onSort}>发货时效</SortHead>
              <SortHead sortKey="pay_time" currentKey={sortKey} dir={sortDir} onSort={onSort}>支付时间</SortHead>
              <SortHead sortKey="paid_amount" currentKey={sortKey} dir={sortDir} onSort={onSort} align="right">实付金额</SortHead>
              <TableHead className="text-right">商品件数</TableHead>
              <SortHead sortKey="status" currentKey={sortKey} dir={sortDir} onSort={onSort}>聚水潭状态</SortHead>
              <SortHead sortKey="jst_o_id" currentKey={sortKey} dir={sortDir} onSort={onSort}>聚水潭单号</SortHead>
              <TableHead>出库单号</TableHead>
              <TableHead>物流单号</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQ.isLoading && <TableRow><TableCell colSpan={12} className="text-center py-12 text-muted-foreground">加载中...</TableCell></TableRow>}
            {listQ.error && <TableRow><TableCell colSpan={12} className="text-center py-12 text-rose-600">读取失败：{(listQ.error as any).message}</TableCell></TableRow>}
            {!listQ.isLoading && !listQ.error && (listQ.data?.rows.length ?? 0) === 0 && (
              <TableRow><TableCell colSpan={12} className="text-center py-12 text-muted-foreground">
                暂无订单。请到「聚水潭同步 → 订单 API」发起一次同步，或扩大日期范围。
              </TableCell></TableRow>
            )}
            {(listQ.data?.rows ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.so_id ?? "-"}</TableCell>
                <TableCell className="text-xs">{r.shop_name || r.shop_id || "-"}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <InternalTypeBadge code={r.internal_order_type} name={r.internal_order_type_name} />
                  <AnomalyChips row={r} />
                </TableCell>
                <TableCell><RemainingShipTime planDeliveryDate={r.plan_delivery_date} internalOrderType={r.internal_order_type} ioId={r.io_id} ioDate={r.io_date} lId={r.l_id} /></TableCell>
                <TableCell className="text-xs whitespace-nowrap">{formatDateTimeCN(r.pay_time, { withSeconds: false })}</TableCell>
                <TableCell className="text-right tabular-nums">{Number(r.paid_amount) > 0 ? fmtMoney(r.paid_amount) : "-"}</TableCell>
                <TableCell className="text-right tabular-nums">{Number(r.item_count) > 0 ? fmtInt(r.item_count) : "-"}</TableCell>
                <TableCell><Badge variant="outline" className="font-normal text-muted-foreground">{zhStatus(r.status)}</Badge></TableCell>
                <TableCell className="font-mono text-xs">{r.jst_o_id ?? "-"}</TableCell>
                <TableCell className="font-mono text-xs">{r.io_id ?? "-"}</TableCell>
                <TableCell className="font-mono text-xs">{r.l_id ?? "-"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setDetailRow(r)}>详情</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRawOpen(r)}><FileJson className="w-3 h-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {(listQ.data?.count ?? 0) > PAGE_SIZE && (
          <div className="flex items-center justify-between p-3 border-t">
            <div className="text-xs text-muted-foreground">共 {listQ.data?.count} 条 · 第 {page + 1} / {Math.ceil((listQ.data!.count) / PAGE_SIZE)} 页</div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</Button>
              <Button size="sm" variant="outline" disabled={(page + 1) * PAGE_SIZE >= (listQ.data?.count ?? 0)} onClick={() => setPage(p => p + 1)}>下一页</Button>
            </div>
          </div>
        )}
      </CardContent></Card>

      {/* 详情抽屉 */}
      <Sheet open={!!detailRow} onOpenChange={(o) => { if (!o) setDetailRow(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              订单详情 · <span className="font-mono text-base">{detailRow?.so_id ?? detailRow?.jst_o_id}</span>
              {detailRow && <InternalTypeBadge code={detailRow.internal_order_type} name={detailRow.internal_order_type_name} />}
            </SheetTitle>
            <SheetDescription>订单概览、发货信息、商品明细与售后关联</SheetDescription>
          </SheetHeader>
          {detailRow && (
            <div className="space-y-5 mt-4">
              {/* 1. 订单概览 */}
              <section>
                <h3 className="font-medium mb-2 text-sm">① 订单概览</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm border rounded p-3 bg-muted/30">
                  <div><span className="text-muted-foreground">线上订单号：</span><span className="font-mono">{detailRow.so_id ?? "-"}</span></div>
                  <div><span className="text-muted-foreground">聚水潭单号：</span><span className="font-mono">{detailRow.jst_o_id ?? "-"}</span></div>
                  <div><span className="text-muted-foreground">店铺：</span>{detailRow.shop_name || detailRow.shop_id || "-"}</div>
                  <div><span className="text-muted-foreground">内部订单类型：</span>{detailRow.internal_order_type_name || "待识别"}</div>
                  <div><span className="text-muted-foreground">聚水潭状态：</span>{zhStatus(detailRow.status)}</div>
                  <div><span className="text-muted-foreground">实付金额：</span><span className="tabular-nums">{fmtMoney(detailRow.paid_amount)}</span></div>
                  <div><span className="text-muted-foreground">商品件数：</span>{fmtInt(detailRow.item_count)}</div>
                  <div><span className="text-muted-foreground">支付时间：</span>{formatDateTimeCN(detailRow.pay_time)}</div>
                  <div><span className="text-muted-foreground">创建时间：</span>{formatDateTimeCN(detailRow.created_time)}</div>
                  <div><span className="text-muted-foreground">修改时间：</span>{formatDateTimeCN(detailRow.modified_time)}</div>
                </div>
              </section>

              {/* 2. 发货信息 */}
              <section>
                <h3 className="font-medium mb-2 text-sm">② 发货信息</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm border rounded p-3">
                  <div className="col-span-2"><span className="text-muted-foreground">发货时效：</span>
                    <RemainingShipTime planDeliveryDate={detailRow.plan_delivery_date} internalOrderType={detailRow.internal_order_type} ioId={detailRow.io_id} ioDate={detailRow.io_date} lId={detailRow.l_id} />
                  </div>
                  <div><span className="text-muted-foreground">是否已发货：</span>{detailRow.io_id || detailRow.io_date ? "是" : "否"}</div>
                  <div><span className="text-muted-foreground">出库单号：</span><span className="font-mono">{detailRow.io_id ?? "-"}</span></div>
                  <div><span className="text-muted-foreground">出库时间：</span>{formatDateTimeCN(detailRow.io_date)}</div>
                  <div><span className="text-muted-foreground">约定发货：</span>{formatDateTimeCN(detailRow.plan_delivery_date)}</div>
                  <div><span className="text-muted-foreground">物流公司：</span>{detailRow.logistics_company || "-"}</div>
                  <div><span className="text-muted-foreground">物流单号：</span><span className="font-mono">{detailRow.l_id ?? "-"}</span></div>
                </div>
              </section>

              {/* 3. 商品明细 */}
              <section>
                <h3 className="font-medium mb-2 text-sm">③ 商品明细</h3>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>款号 / 商品</TableHead>
                    <TableHead>规格</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                    <TableHead className="text-right">单价</TableHead>
                    <TableHead className="text-right">实付</TableHead>
                    <TableHead>退款</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {itemsQ.isLoading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">加载中...</TableCell></TableRow>}
                    {!itemsQ.isLoading && (itemsQ.data ?? []).length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">该订单暂无明细</TableCell></TableRow>}
                    {(itemsQ.data ?? []).map((it: any) => (
                      <TableRow key={it.id}>
                        <TableCell className="font-mono text-xs">{it.sku_id || it.sku_code || "-"}</TableCell>
                        <TableCell className="text-xs">
                          <div>{it.product_name || "-"}</div>
                          {it.i_id && <div className="text-muted-foreground text-[11px] font-mono">{it.i_id}</div>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{it.sku_name || it.properties_value || "-"}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(it.qty)}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(it.sale_price) > 0 ? fmtMoney(it.sale_price) : "-"}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(it.amount) > 0 ? fmtMoney(it.amount) : "-"}</TableCell>
                        <TableCell className="text-xs">{it.refund_status || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>

              {/* 4. 售后/退款关联 */}
              <section>
                <h3 className="font-medium mb-2 text-sm">④ 售后 / 退款关联</h3>
                {aftersaleQ.isLoading && <div className="text-sm text-muted-foreground">加载中...</div>}
                {!aftersaleQ.isLoading && (aftersaleQ.data?.refunds.length ?? 0) === 0 && (aftersaleQ.data?.received.length ?? 0) === 0 && (
                  <div className="text-sm text-muted-foreground border rounded p-3">暂无关联售后记录</div>
                )}
                {(aftersaleQ.data?.refunds.length ?? 0) > 0 && (
                  <div className="mb-3">
                    <div className="text-xs text-muted-foreground mb-1">退货退款单</div>
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>售后单号</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>货物状态</TableHead>
                        <TableHead className="text-right">退款金额</TableHead>
                        <TableHead>原因</TableHead>
                        <TableHead>申请时间</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {aftersaleQ.data!.refunds.map((r: any) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-mono text-xs">{r.as_id ?? "-"}</TableCell>
                            <TableCell className="text-xs">{zhStatus(r.status)}</TableCell>
                            <TableCell className="text-xs">{zhStatus(r.good_status)}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtMoney(r.refund_amount)}</TableCell>
                            <TableCell className="text-xs">{r.question_type || r.question_reason || "-"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{formatDateTimeCN(r.as_date, { withSeconds: false })}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {(aftersaleQ.data?.received.length ?? 0) > 0 && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">销售退仓</div>
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>售后单号</TableHead>
                        <TableHead>退仓单号</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>仓库</TableHead>
                        <TableHead>到仓时间</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {aftersaleQ.data!.received.map((r: any) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-mono text-xs">{r.as_id ?? "-"}</TableCell>
                            <TableCell className="font-mono text-xs">{r.io_id ?? "-"}</TableCell>
                            <TableCell className="text-xs">{zhStatus(r.status)}</TableCell>
                            <TableCell className="text-xs">{r.warehouse || "-"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{formatDateTimeCN(r.received_date, { withSeconds: false })}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* 原始 JSON 抽屉 */}
      <Sheet open={!!rawOpen} onOpenChange={(o) => { if (!o) setRawOpen(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>订单原始数据</SheetTitle>
            <SheetDescription>聚水潭返回的 raw_data（敏感字段已剥除）</SheetDescription>
          </SheetHeader>
          {rawOpen && <RawData orderId={rawOpen.id} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function RawData({ orderId }: { orderId: string }) {
  const q = useQuery({
    queryKey: ["sales_order_raw", orderId],
    queryFn: async () => {
      const { data, error } = await supabase.from("jst_sales_orders")
        .select("raw_data").eq("id", orderId).maybeSingle();
      if (error) throw error;
      return data?.raw_data ?? null;
    },
  });
  if (q.isLoading) return <div className="text-sm text-muted-foreground mt-4">加载中...</div>;
  return (
    <pre className="bg-muted p-3 rounded text-[11px] overflow-auto max-h-[70vh] mt-4">
      {JSON.stringify(q.data, null, 2)}
    </pre>
  );
}
