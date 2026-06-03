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
import { Search, Download, FileJson, ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
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

type Filters = {
  startDate: string;
  endDate: string;
  shop: string;
  soId: string;
  jstOId: string;
  status: string;
  hasShipped: string; // all | yes | no
};

function defaultFilters(): Filters {
  const end = todayCN();
  const d = new Date(`${end}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() - 6);
  const start = beijingYMD(d);
  return {
    startDate: start, endDate: end,
    shop: "", soId: "", jstOId: "",
    status: "all", hasShipped: "all",
  };
}

function applyFilters(q: any, f: Filters) {
  if (f.startDate) { const r = beijingDayRangeToUTC(f.startDate); if (r) q = q.gte("modified_time", r.gte); }
  if (f.endDate)   { const r = beijingDayRangeToUTC(f.endDate);   if (r) q = q.lte("modified_time", r.lte); }
  if (f.shop)   q = q.ilike("shop_name", `%${f.shop}%`);
  if (f.soId)   q = q.ilike("so_id", `%${f.soId}%`);
  if (f.jstOId) q = q.ilike("jst_o_id", `%${f.jstOId}%`);
  if (f.status !== "all") q = q.eq("status", f.status);
  if (f.hasShipped === "yes") q = q.not("io_id", "is", null);
  if (f.hasShipped === "no")  q = q.is("io_id", null);
  return q;
}

function useStats() {
  return useQuery({
    queryKey: ["sales_orders_stats", todayCN()],
    queryFn: async () => {
      const today = todayCN();
      const monthStart = today.slice(0, 8) + "01";
      const todayR = beijingDayRangeToUTC(today)!;
      const monthR = beijingDayRangeToUTC(monthStart)!;

      const [todayRes, monthRes, unshippedRes] = await Promise.all([
        supabase.from("jst_sales_orders")
          .select("paid_amount", { count: "exact" })
          .gte("modified_time", todayR.gte).lte("modified_time", todayR.lte).limit(1000),
        supabase.from("jst_sales_orders")
          .select("paid_amount", { count: "exact" })
          .gte("modified_time", monthR.gte).limit(5000),
        supabase.from("jst_sales_orders")
          .select("id", { count: "exact", head: true })
          .is("io_id", null),
      ]);

      const todayAmt = (todayRes.data ?? []).reduce((s, r: any) => s + Number(r.paid_amount ?? 0), 0);
      const monthAmt = (monthRes.data ?? []).reduce((s, r: any) => s + Number(r.paid_amount ?? 0), 0);

      return {
        todayOrders: todayRes.count ?? 0,
        todayAmt,
        monthOrders: monthRes.count ?? 0,
        monthAmt,
        unshipped: unshippedRes.count ?? 0,
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
    queryKey: ["sales_orders_list", filters, page, sortKey, sortDir],
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
          .select("sales_order_id").in("sales_order_id", ids);
        (items ?? []).forEach((it: any) => {
          countMap.set(it.sales_order_id, (countMap.get(it.sales_order_id) ?? 0) + 1);
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

const TYPE_ORDER: { code: string; name: string }[] = [
  { code: "unpaid_cancelled", name: "未付款取消" },
  { code: "paid_cancelled_before_ship", name: "付款后未发货退款" },
  { code: "returned_after_ship", name: "发货后退货" },
  { code: "paid_pending_ship", name: "已付款待发货" },
  { code: "shipped", name: "已发货" },
  { code: "unknown", name: "待识别" },
];

function useTypeStats(filters: Filters) {
  return useQuery({
    queryKey: ["sales_orders_type_stats", filters],
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

function Stat({ label, value, error }: { label: string; value: any; error?: any }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"text-2xl font-semibold mt-1 " + (error ? "text-rose-600 text-base font-normal" : "")}>
        {error ? "读取失败" : value}
      </div>
    </CardContent></Card>
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

  const statsQ = useStats();
  const typeStatsQ = useTypeStats(filters);
  const listQ = useOrderList(filters, page, sortKey, sortDir);
  const itemsQ = useOrderItems(detailRow?.id ?? null);

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
      const headers = ["线上订单号", "聚水潭单号", "店铺", "状态", "订单类型", "支付时间", "约定发货时间", "实付金额", "商品件数", "出库单号", "物流单号", "物流公司"];
      const lines = [headers.join(",")];
      for (const r of rows) {
        lines.push([
          r.so_id ?? "", r.jst_o_id ?? "", r.shop_name ?? "", r.status ?? "", r.internal_order_type_name ?? "",
          formatDateTimeCN(r.pay_time), formatDateTimeCN(r.plan_delivery_date),
          Number(r.paid_amount ?? 0).toFixed(2), r.item_count, r.io_id ?? "", r.l_id ?? "", r.logistics_company ?? "",
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
        description="展示从聚水潭同步过来的销售订单数据，按修改时间筛选；订单同步在「聚水潭同步」页面发起。"
      />

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-4">
        <Stat label="今日订单数" value={fmtInt(s?.todayOrders)} error={err} />
        <Stat label="今日实付金额" value={fmtMoney(s?.todayAmt)} error={err} />
        <Stat label="本月订单数" value={fmtInt(s?.monthOrders)} error={err} />
        <Stat label="本月实付金额" value={fmtMoney(s?.monthAmt)} error={err} />
        <Stat label="未发货订单（无出库单）" value={fmtInt(s?.unshipped)} error={err} />
      </div>

      {/* 筛选 */}
      <Card className="mb-3"><CardContent className="p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
          <div><label className="text-xs text-muted-foreground">起始修改日期</label>
            <Input type="date" value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">截止修改日期</label>
            <Input type="date" value={draft.endDate} onChange={e => setDraft({ ...draft, endDate: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">店铺</label>
            <Input value={draft.shop} onChange={e => setDraft({ ...draft, shop: e.target.value })} placeholder="店铺名称" /></div>
          <div><label className="text-xs text-muted-foreground">线上订单号 so_id</label>
            <Input value={draft.soId} onChange={e => setDraft({ ...draft, soId: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">聚水潭单号 jst_o_id</label>
            <Input value={draft.jstOId} onChange={e => setDraft({ ...draft, jstOId: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">订单状态</label>
            <Select value={draft.status} onValueChange={v => setDraft({ ...draft, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="WaitConfirm">待确认</SelectItem>
                <SelectItem value="Confirmed">已确认</SelectItem>
                <SelectItem value="WaitSend">待发货</SelectItem>
                <SelectItem value="Sent">已发货</SelectItem>
                <SelectItem value="Cancelled">已取消</SelectItem>
              </SelectContent></Select></div>
          <div><label className="text-xs text-muted-foreground">是否已出库</label>
            <Select value={draft.hasShipped} onValueChange={v => setDraft({ ...draft, hasShipped: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="yes">已出库</SelectItem>
                <SelectItem value="no">未出库</SelectItem>
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
          说明：同步任务按 <span className="font-medium text-foreground">聚水潭修改时间 (modified)</span> 拉取，列表筛选默认也按修改时间。若数据未出现，请扩大日期范围或到「聚水潭同步」页面重新拉取。
        </div>
      </CardContent></Card>

      {/* 内部分类统计（按当前筛选） */}
      <Card className="mb-3"><CardContent className="p-3">
        <div className="text-xs text-muted-foreground mb-2">内部订单分类（按当前筛选范围）</div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-2">
          {TYPE_ORDER.map((t) => (
            <div key={t.code} className="border rounded p-2">
              <div className="text-xs text-muted-foreground">{t.name}</div>
              <div className="text-lg font-semibold tabular-nums">
                {typeStatsQ.isLoading ? "…" : fmtInt(typeStatsQ.data?.[t.code] ?? 0)}
              </div>
            </div>
          ))}
          <div className="border rounded p-2 border-dashed">
            <div className="text-xs text-muted-foreground">未分类（待回刷）</div>
            <div className="text-lg font-semibold tabular-nums">
              {typeStatsQ.isLoading ? "…" : fmtInt(typeStatsQ.data?.["_null"] ?? 0)}
            </div>
          </div>
        </div>
      </CardContent></Card>

      {/* 列表 */}
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead sortKey="so_id" currentKey={sortKey} dir={sortDir} onSort={onSort}>线上订单号</SortHead>
              <SortHead sortKey="jst_o_id" currentKey={sortKey} dir={sortDir} onSort={onSort}>聚水潭单号</SortHead>
              <SortHead sortKey="shop_name" currentKey={sortKey} dir={sortDir} onSort={onSort}>店铺</SortHead>
              <SortHead sortKey="status" currentKey={sortKey} dir={sortDir} onSort={onSort}>状态</SortHead>
              <SortHead sortKey="internal_order_type" currentKey={sortKey} dir={sortDir} onSort={onSort}>订单类型</SortHead>
              <SortHead sortKey="pay_time" currentKey={sortKey} dir={sortDir} onSort={onSort}>支付时间</SortHead>
              <SortHead sortKey="plan_delivery_date" currentKey={sortKey} dir={sortDir} onSort={onSort}>剩余发货时间</SortHead>
              <SortHead sortKey="paid_amount" currentKey={sortKey} dir={sortDir} onSort={onSort} align="right">实付金额</SortHead>
              <TableHead className="text-right">商品件数</TableHead>
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
                <TableCell className="font-mono text-xs">{r.jst_o_id}</TableCell>
                <TableCell className="text-xs">{r.shop_name || r.shop_id || "-"}</TableCell>
                <TableCell><Badge variant="outline">{zhStatus(r.status)}</Badge></TableCell>
                <TableCell><Badge variant="secondary">{r.internal_order_type_name || "待识别"}</Badge></TableCell>
                <TableCell className="text-xs whitespace-nowrap">{formatDateTimeCN(r.pay_time, { withSeconds: false })}</TableCell>
                <TableCell><RemainingShipTime planDeliveryDate={r.plan_delivery_date} shipped={!!r.io_id || !!r.io_date} /></TableCell>
                <TableCell className="text-right tabular-nums">{r.paid_amount > 0 ? fmtMoney(r.paid_amount) : "-"}</TableCell>
                <TableCell className="text-right">{fmtInt(r.item_count)}</TableCell>
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
            <SheetTitle>订单详情 · {detailRow?.so_id ?? detailRow?.jst_o_id}</SheetTitle>
            <SheetDescription>聚水潭订单基础信息与商品明细</SheetDescription>
          </SheetHeader>
          {detailRow && (
            <div className="space-y-5 mt-4">
              <section>
                <h3 className="font-medium mb-2">A. 基础信息</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">线上订单号：</span>{detailRow.so_id ?? "-"}</div>
                  <div><span className="text-muted-foreground">聚水潭单号：</span>{detailRow.jst_o_id}</div>
                  <div><span className="text-muted-foreground">店铺：</span>{detailRow.shop_name || detailRow.shop_id || "-"}</div>
                  <div><span className="text-muted-foreground">状态：</span>{zhStatus(detailRow.status)}</div>
                  <div><span className="text-muted-foreground">内部分类：</span>{detailRow.internal_order_type_name || "待识别"}</div>
                  <div><span className="text-muted-foreground">订单类型：</span>{detailRow.order_type || "-"}</div>
                  <div><span className="text-muted-foreground">实付金额：</span>{fmtMoney(detailRow.paid_amount)}</div>
                  <div><span className="text-muted-foreground">应付金额：</span>{fmtMoney(detailRow.pay_amount)}</div>
                  <div><span className="text-muted-foreground">创建时间：</span>{formatDateTimeCN(detailRow.created_time)}</div>
                  <div><span className="text-muted-foreground">修改时间：</span>{formatDateTimeCN(detailRow.modified_time)}</div>
                  <div><span className="text-muted-foreground">支付时间：</span>{formatDateTimeCN(detailRow.pay_time)}</div>
                  <div><span className="text-muted-foreground">约定发货时间：</span>{formatDateTimeCN(detailRow.plan_delivery_date)}</div>
                  <div><span className="text-muted-foreground">出库单号：</span>{detailRow.io_id ?? "-"}</div>
                  <div><span className="text-muted-foreground">出库时间：</span>{formatDateTimeCN(detailRow.io_date)}</div>
                  <div><span className="text-muted-foreground">物流公司：</span>{detailRow.logistics_company || "-"}</div>
                  <div><span className="text-muted-foreground">物流单号：</span>{detailRow.l_id ?? "-"}</div>
                </div>
              </section>

              <section>
                <h3 className="font-medium mb-2">B. 商品明细</h3>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>SKU</TableHead><TableHead>商品名</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                    <TableHead className="text-right">单价</TableHead>
                    <TableHead className="text-right">金额</TableHead>
                    <TableHead>退款状态</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {itemsQ.isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">加载中...</TableCell></TableRow>}
                    {!itemsQ.isLoading && (itemsQ.data ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-rose-600 py-6">该订单暂无明细</TableCell></TableRow>}
                    {(itemsQ.data ?? []).map((it: any) => (
                      <TableRow key={it.id}>
                        <TableCell className="font-mono text-xs">{it.sku_id || it.sku_code || "-"}</TableCell>
                        <TableCell className="text-xs">{it.product_name || "-"}{it.sku_name ? <span className="text-muted-foreground"> · {it.sku_name}</span> : null}</TableCell>
                        <TableCell className="text-right">{fmtInt(it.qty)}</TableCell>
                        <TableCell className="text-right">{Number(it.sale_price) > 0 ? fmtMoney(it.sale_price) : "-"}</TableCell>
                        <TableCell className="text-right">{Number(it.amount) > 0 ? fmtMoney(it.amount) : "-"}</TableCell>
                        <TableCell className="text-xs">{it.refund_status || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
