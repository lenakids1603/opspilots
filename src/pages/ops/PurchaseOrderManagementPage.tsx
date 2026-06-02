import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ops/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Search, Inbox, ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

const fmtMoney = (n: number | null | undefined) => "¥" + (Number(n ?? 0)).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
import { formatDateCN, formatDateTimeCN, beijingDayRangeToUTC, beijingYMD } from "@/lib/datetime";
const fmtDate = (d?: string | null) => formatDateCN(d);
const fmtDateTime = (d?: string | null) => formatDateTimeCN(d);

const WAREHOUSE_STATUS_LABEL: Record<string, string> = {
  not_received: "未入库",
  partial: "部分入库",
  received: "已入库",
};
const WAREHOUSE_STATUS_TONE: Record<string, string> = {
  not_received: "bg-slate-100 text-slate-700",
  partial: "bg-amber-100 text-amber-700",
  received: "bg-emerald-100 text-emerald-700",
};

type Filters = {
  startDate: string;
  endDate: string;
  supplier: string;
  poNo: string;
  styleNo: string;
  skuNo: string;
  productName: string;
  status: string;
  warehouseStatus: string;
};

const EMPTY_FILTERS: Filters = {
  startDate: "",
  endDate: "",
  supplier: "",
  poNo: "",
  styleNo: "",
  skuNo: "",
  productName: "",
  status: "all",
  warehouseStatus: "all",
};

const DELETED_STATUSES = "(Delete,delete,Deleted,deleted,已删除)";

function applyPoFilters(q: any, f: Filters) {
  // 北京时区日期 → UTC ISO 区间，避免 new Date("YYYY-MM-DD") 按 UTC 解析丢掉北京当日凌晨 0-8 点。
  if (f.startDate) { const r = beijingDayRangeToUTC(f.startDate); if (r) q = q.gte("po_date", r.gte); }
  if (f.endDate)   { const r = beijingDayRangeToUTC(f.endDate);   if (r) q = q.lte("po_date", r.lte); }
  if (f.supplier) q = q.ilike("supplier_name", `%${f.supplier}%`);
  if (f.poNo) q = q.ilike("external_po_id", `%${f.poNo}%`);
  if (f.status !== "all") q = q.eq("status", f.status);
  if (f.warehouseStatus !== "all") q = q.eq("warehouse_status", f.warehouseStatus);
  // 默认排除聚水潭已删除采购单
  q = q.not("status", "in", DELETED_STATUSES);
  return q;
}

type SortDir = "asc" | "desc";
type PoSortKey =
  | "external_po_id" | "supplier_name" | "po_date" | "status"
  | "total_purchase_qty" | "total_received_qty" | "total_unreceived_qty"
  | "total_amount" | "updated_at" | "warehouse_status";

type StyleSortKey =
  | "latest_po_date" | "style_no" | "product_name" | "suppliers"
  | "po_count" | "sku_count" | "purchase_qty" | "received_qty"
  | "unreceived_qty" | "amount" | "warehouse_status";

function SortHead<K extends string>({
  k, currentKey, dir, onSort, children, align,
}: {
  k: K; currentKey: K; dir: SortDir;
  onSort: (k: K) => void; children: React.ReactNode; align?: "left" | "right";
}) {
  const active = k === currentKey;
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        type="button"
        onClick={() => onSort(k)}
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

function usePurchaseStats(filters: Filters) {
  return useQuery({
    queryKey: ["po_stats", filters],
    queryFn: async () => {
      let q = supabase.from("purchase_orders").select(
        "id, total_purchase_qty, total_received_qty, total_unreceived_qty, total_amount, warehouse_status",
        { count: "exact" }
      );
      q = applyPoFilters(q, filters);
      const { data, count, error } = await q.limit(5000);
      if (error) throw error;
      const rows = data ?? [];
      return {
        poCount: count ?? rows.length,
        totalQty: rows.reduce((s, r: any) => s + Number(r.total_purchase_qty ?? 0), 0),
        receivedQty: rows.reduce((s, r: any) => s + Number(r.total_received_qty ?? 0), 0),
        unreceivedQty: rows.reduce((s, r: any) => s + Number(r.total_unreceived_qty ?? 0), 0),
        amount: rows.reduce((s, r: any) => s + Number(r.total_amount ?? 0), 0),
        abnormal: rows.filter((r: any) => r.warehouse_status === "partial").length,
      };
    },
  });
}

function usePurchaseOrders(filters: Filters, page: number, sortKey: PoSortKey, sortDir: SortDir) {
  return useQuery({
    queryKey: ["purchase_orders", filters, page, sortKey, sortDir],
    queryFn: async () => {
      let q = supabase.from("purchase_orders").select("*", { count: "exact" });
      q = applyPoFilters(q, filters);

      // 商品维度筛选(款号/SKU/商品名)需 join items
      const needsItemFilter = filters.styleNo || filters.skuNo || filters.productName;
      if (needsItemFilter) {
        let itemQ = supabase.from("purchase_order_items").select("purchase_order_id").limit(1000);
        if (filters.styleNo) itemQ = itemQ.ilike("style_no", `%${filters.styleNo}%`);
        if (filters.skuNo) itemQ = itemQ.ilike("sku_no", `%${filters.skuNo}%`);
        if (filters.productName) itemQ = itemQ.ilike("product_name", `%${filters.productName}%`);
        const { data: items, error: ie } = await itemQ;
        if (ie) throw ie;
        const ids = Array.from(new Set((items ?? []).map((i: any) => i.purchase_order_id).filter(Boolean)));
        if (ids.length === 0) return { rows: [], count: 0 };
        q = q.in("id", ids);
      }

      q = q.order(sortKey, { ascending: sortDir === "asc", nullsFirst: false });
      if (sortKey !== "external_po_id") {
        q = q.order("external_po_id", { ascending: false, nullsFirst: false });
      }
      q = q.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });
}

function usePoItems(poId: string | null) {
  return useQuery({
    queryKey: ["purchase_order_items", poId],
    enabled: !!poId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_order_items")
        .select("*")
        .eq("purchase_order_id", poId!)
        .order("sku_no");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useStyleAggregation(filters: Filters, page: number, sortKey: StyleSortKey, sortDir: SortDir) {
  return useQuery({
    queryKey: ["po_items_by_style", filters, page, sortKey, sortDir],
    queryFn: async () => {
      // 取所有项目(受筛选影响)
      let q = supabase.from("purchase_order_items").select(
        "style_no, sku_no, product_name, purchase_qty, received_qty, unreceived_qty, amount, purchase_order_id, purchase_orders!inner(supplier_name, po_date, status, warehouse_status, external_po_id)"
      ).limit(5000);
      if (filters.styleNo) q = q.ilike("style_no", `%${filters.styleNo}%`);
      if (filters.skuNo) q = q.ilike("sku_no", `%${filters.skuNo}%`);
      if (filters.productName) q = q.ilike("product_name", `%${filters.productName}%`);
      // 默认排除聚水潭已删除采购单(通过 inner join 的 purchase_orders.status)
      q = q.not("purchase_orders.status", "in", DELETED_STATUSES);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data ?? [];

      // 应用 PO 维度筛选(在前端)
      const filtered = rows.filter((r: any) => {
        const po = r.purchase_orders;
        if (!po) return false;
        // 二次防御:剔除已删除采购单
        const st = String(po.status ?? "").toLowerCase();
        if (st === "delete" || st === "deleted" || po.status === "已删除") return false;
        if (filters.supplier && !(po.supplier_name ?? "").includes(filters.supplier)) return false;
        if (filters.poNo && !(po.external_po_id ?? "").includes(filters.poNo)) return false;
        if (filters.status !== "all" && po.status !== filters.status) return false;
        if (filters.warehouseStatus !== "all" && po.warehouse_status !== filters.warehouseStatus) return false;
        // 按北京时区比较日期，避免 UTC 字符串截断错位一天。
        if (filters.startDate && po.po_date && beijingYMD(po.po_date) < filters.startDate) return false;
        if (filters.endDate && po.po_date && beijingYMD(po.po_date) > filters.endDate) return false;
        return true;
      });

      const map = new Map<string, any>();
      for (const r of filtered) {
        const key = r.style_no || "(空款号)";
        const cur = map.get(key) ?? {
          style_no: key,
          product_name: r.product_name ?? "",
          suppliers: new Set<string>(),
          po_ids: new Set<string>(),
          sku_set: new Set<string>(),
          purchase_qty: 0, received_qty: 0, unreceived_qty: 0, amount: 0,
          latest_po_ts: 0,
        };
        cur.purchase_qty += Number(r.purchase_qty ?? 0);
        cur.received_qty += Number(r.received_qty ?? 0);
        cur.unreceived_qty += Number(r.unreceived_qty ?? 0);
        cur.amount += Number(r.amount ?? 0);
        if (r.purchase_orders?.supplier_name) cur.suppliers.add(r.purchase_orders.supplier_name);
        if (r.purchase_order_id) cur.po_ids.add(r.purchase_order_id);
        if (r.sku_no) cur.sku_set.add(r.sku_no);
        const ts = r.purchase_orders?.po_date ? new Date(r.purchase_orders.po_date).getTime() : 0;
        if (ts > cur.latest_po_ts) cur.latest_po_ts = ts;
        map.set(key, cur);
      }
      const aggregated = Array.from(map.values()).map((c: any) => {
        // 入库状态聚合:全部已入库 / 部分入库 / 未入库
        let warehouse_status: "not_received" | "partial" | "received" = "not_received";
        if (c.purchase_qty > 0 && c.received_qty >= c.purchase_qty) warehouse_status = "received";
        else if (c.received_qty > 0) warehouse_status = "partial";
        return {
          style_no: c.style_no,
          product_name: c.product_name,
          suppliers: Array.from(c.suppliers).join("、"),
          po_count: c.po_ids.size,
          sku_count: c.sku_set.size,
          purchase_qty: c.purchase_qty,
          received_qty: c.received_qty,
          unreceived_qty: c.unreceived_qty,
          amount: c.amount,
          latest_po_ts: c.latest_po_ts,
          latest_po_date: c.latest_po_ts ? new Date(c.latest_po_ts).toISOString() : null,
          warehouse_status,
        };
      });

      // 排序(纯数字按数字,日期按时间戳,字符串按 localeCompare)
      const numKeys = new Set<string>(["po_count", "sku_count", "purchase_qty", "received_qty", "unreceived_qty", "amount"]);
      aggregated.sort((a: any, b: any) => {
        let va: any, vb: any;
        if (sortKey === "latest_po_date") { va = a.latest_po_ts; vb = b.latest_po_ts; }
        else { va = a[sortKey]; vb = b[sortKey]; }
        if (numKeys.has(sortKey) || sortKey === "latest_po_date") {
          const diff = (Number(va) || 0) - (Number(vb) || 0);
          if (diff !== 0) return sortDir === "asc" ? diff : -diff;
        } else {
          const cmp = String(va ?? "").localeCompare(String(vb ?? ""), "zh-CN");
          if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
        }
        // 平局:按采购件数降序
        return (b.purchase_qty || 0) - (a.purchase_qty || 0);
      });

      const total = aggregated.length;
      const paged = aggregated.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
      return { rows: paged, count: total };
    },
  });
}

function useStyleDetail(styleNo: string | null) {
  return useQuery({
    queryKey: ["style_detail", styleNo],
    enabled: !!styleNo,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_order_items")
        .select("*, purchase_orders!inner(external_po_id, supplier_name, po_date, status)")
        .eq("style_no", styleNo!)
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function PurchaseOrderManagementPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [stylePage, setStylePage] = useState(0);
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [tab, setTab] = useState("po");

  // 排序状态:两个 Tab 各自维护
  const [poSortKey, setPoSortKey] = useState<PoSortKey>("po_date");
  const [poSortDir, setPoSortDir] = useState<SortDir>("desc");
  const [styleSortKey, setStyleSortKey] = useState<StyleSortKey>("latest_po_date");
  const [styleSortDir, setStyleSortDir] = useState<SortDir>("desc");

  const statsQ = usePurchaseStats(filters);
  const ordersQ = usePurchaseOrders(filters, page, poSortKey, poSortDir);
  const styleQ = useStyleAggregation(filters, stylePage, styleSortKey, styleSortDir);

  const selectedPo = useMemo(
    () => ordersQ.data?.rows.find((r: any) => r.id === selectedPoId) ?? null,
    [ordersQ.data, selectedPoId],
  );
  const itemsQ = usePoItems(selectedPoId);
  const styleDetailQ = useStyleDetail(selectedStyle);

  const stats = statsQ.data;
  const totalPages = ordersQ.data ? Math.ceil(ordersQ.data.count / PAGE_SIZE) : 0;
  const styleTotalPages = styleQ.data ? Math.ceil(styleQ.data.count / PAGE_SIZE) : 0;

  const applyFilters = () => { setFilters(draftFilters); setPage(0); setStylePage(0); };
  const resetFilters = () => { setDraftFilters(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); setPage(0); setStylePage(0); };

  // 切换 Tab 重置该 Tab 的排序为默认
  const onTabChange = (v: string) => {
    setTab(v);
    if (v === "po") { setPoSortKey("po_date"); setPoSortDir("desc"); setPage(0); }
    else { setStyleSortKey("latest_po_date"); setStyleSortDir("desc"); setStylePage(0); }
  };

  const onPoSort = (k: PoSortKey) => {
    if (poSortKey !== k) { setPoSortKey(k); setPoSortDir("desc"); setPage(0); return; }
    if (poSortDir === "desc") { setPoSortDir("asc"); setPage(0); return; }
    setPoSortKey("po_date"); setPoSortDir("desc"); setPage(0);
  };
  const onStyleSort = (k: StyleSortKey) => {
    if (styleSortKey !== k) { setStyleSortKey(k); setStyleSortDir("desc"); setStylePage(0); return; }
    if (styleSortDir === "desc") { setStyleSortDir("asc"); setStylePage(0); return; }
    setStyleSortKey("latest_po_date"); setStyleSortDir("desc"); setStylePage(0);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={["采购系统", "采购单管理"]}
        title="采购单管理"
        description="读取真实 purchase_orders / purchase_order_items 数据,支持按采购单、款号、SKU 多维查询。"
      />

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "采购单数", value: stats?.poCount ?? 0 },
          { label: "采购总件数", value: (stats?.totalQty ?? 0).toLocaleString() },
          { label: "采购总金额", value: fmtMoney(stats?.amount) },
          { label: "已入库件数", value: (stats?.receivedQty ?? 0).toLocaleString() },
          { label: "未入库件数", value: (stats?.unreceivedQty ?? 0).toLocaleString() },
          { label: "部分入库单", value: stats?.abnormal ?? 0, tone: "amber" },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{c.label}</div>
              <div className={`text-xl font-semibold tabular-nums mt-1 ${c.tone === "amber" ? "text-amber-600" : ""}`}>{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 筛选 */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">采购起始日期</label>
              <Input type="date" value={draftFilters.startDate} onChange={(e) => setDraftFilters({ ...draftFilters, startDate: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">采购结束日期</label>
              <Input type="date" value={draftFilters.endDate} onChange={(e) => setDraftFilters({ ...draftFilters, endDate: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">供应商</label>
              <Input value={draftFilters.supplier} onChange={(e) => setDraftFilters({ ...draftFilters, supplier: e.target.value })} placeholder="供应商名" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">采购单号</label>
              <Input value={draftFilters.poNo} onChange={(e) => setDraftFilters({ ...draftFilters, poNo: e.target.value })} placeholder="聚水潭单号" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">商品款号</label>
              <Input value={draftFilters.styleNo} onChange={(e) => setDraftFilters({ ...draftFilters, styleNo: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">SKU</label>
              <Input value={draftFilters.skuNo} onChange={(e) => setDraftFilters({ ...draftFilters, skuNo: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">商品名称</label>
              <Input value={draftFilters.productName} onChange={(e) => setDraftFilters({ ...draftFilters, productName: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">采购单状态</label>
              <Select value={draftFilters.status} onValueChange={(v) => setDraftFilters({ ...draftFilters, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="Confirmed">已确认</SelectItem>
                  <SelectItem value="WaitConfirm">待确认</SelectItem>
                  <SelectItem value="Cancelled">已取消</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">入库状态</label>
              <Select value={draftFilters.warehouseStatus} onValueChange={(v) => setDraftFilters({ ...draftFilters, warehouseStatus: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="not_received">未入库</SelectItem>
                  <SelectItem value="partial">部分入库</SelectItem>
                  <SelectItem value="received">已入库</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={applyFilters} size="sm"><Search className="w-3.5 h-3.5 mr-1" />查询</Button>
            <Button variant="outline" size="sm" onClick={resetFilters}>重置</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Tabs value={tab} onValueChange={onTabChange}>
            <div className="px-4 pt-3">
              <TabsList>
                <TabsTrigger value="po">按采购单查看</TabsTrigger>
                <TabsTrigger value="style">按商品款号查看</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="po" className="m-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead<PoSortKey> k="external_po_id" currentKey={poSortKey} dir={poSortDir} onSort={onPoSort}>采购单号</SortHead>
                    <SortHead<PoSortKey> k="supplier_name" currentKey={poSortKey} dir={poSortDir} onSort={onPoSort}>供应商</SortHead>
                    <SortHead<PoSortKey> k="po_date" currentKey={poSortKey} dir={poSortDir} onSort={onPoSort}>采购日期</SortHead>
                    <SortHead<PoSortKey> k="status" currentKey={poSortKey} dir={poSortDir} onSort={onPoSort}>状态</SortHead>
                    <SortHead<PoSortKey> k="total_purchase_qty" currentKey={poSortKey} dir={poSortDir} onSort={onPoSort} align="right">采购件数</SortHead>
                    <SortHead<PoSortKey> k="total_received_qty" currentKey={poSortKey} dir={poSortDir} onSort={onPoSort} align="right">已入库</SortHead>
                    <SortHead<PoSortKey> k="total_unreceived_qty" currentKey={poSortKey} dir={poSortDir} onSort={onPoSort} align="right">未入库</SortHead>
                    <SortHead<PoSortKey> k="total_amount" currentKey={poSortKey} dir={poSortDir} onSort={onPoSort} align="right">采购金额</SortHead>
                    <SortHead<PoSortKey> k="updated_at" currentKey={poSortKey} dir={poSortDir} onSort={onPoSort}>最近同步</SortHead>
                    <SortHead<PoSortKey> k="warehouse_status" currentKey={poSortKey} dir={poSortDir} onSort={onPoSort}>入库状态</SortHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordersQ.isLoading ? (
                    <TableRow><TableCell colSpan={11} className="text-center py-10 text-muted-foreground">加载中…</TableCell></TableRow>
                  ) : (ordersQ.data?.rows.length ?? 0) === 0 ? (
                    <TableRow><TableCell colSpan={11} className="text-center py-10 text-muted-foreground">
                      <Inbox className="w-6 h-6 inline mr-2 opacity-50" />
                      暂无采购单数据,请先执行聚水潭采购同步
                    </TableCell></TableRow>
                  ) : ordersQ.data!.rows.map((po: any) => (
                    <TableRow key={po.id}>
                      <TableCell className="font-mono text-xs">{po.external_po_id}</TableCell>
                      <TableCell>{po.supplier_name ?? "—"}</TableCell>
                      <TableCell>{fmtDate(po.po_date)}</TableCell>
                      <TableCell><Badge variant="outline">{po.status_label ?? po.status ?? "—"}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">{Number(po.total_purchase_qty ?? 0)}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600">{Number(po.total_received_qty ?? 0)}</TableCell>
                      <TableCell className="text-right tabular-nums text-amber-600">{Number(po.total_unreceived_qty ?? 0)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(po.total_amount)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDateTime(po.updated_at)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={WAREHOUSE_STATUS_TONE[po.warehouse_status ?? "not_received"] ?? ""}>
                          {WAREHOUSE_STATUS_LABEL[po.warehouse_status ?? "not_received"] ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedPoId(po.id)}>查看详情</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="px-4 py-3 flex items-center justify-between text-xs text-muted-foreground border-t">
                <div>共 {ordersQ.data?.count ?? 0} 条,第 {page + 1} / {Math.max(1, totalPages)} 页</div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</Button>
                  <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>下一页</Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="style" className="m-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead<StyleSortKey> k="latest_po_date" currentKey={styleSortKey} dir={styleSortDir} onSort={onStyleSort}>最近采购日期</SortHead>
                    <SortHead<StyleSortKey> k="style_no" currentKey={styleSortKey} dir={styleSortDir} onSort={onStyleSort}>款号</SortHead>
                    <SortHead<StyleSortKey> k="product_name" currentKey={styleSortKey} dir={styleSortDir} onSort={onStyleSort}>商品名称</SortHead>
                    <SortHead<StyleSortKey> k="suppliers" currentKey={styleSortKey} dir={styleSortDir} onSort={onStyleSort}>供应商</SortHead>
                    <SortHead<StyleSortKey> k="po_count" currentKey={styleSortKey} dir={styleSortDir} onSort={onStyleSort} align="right">涉及采购单数</SortHead>
                    <SortHead<StyleSortKey> k="sku_count" currentKey={styleSortKey} dir={styleSortDir} onSort={onStyleSort} align="right">SKU 数</SortHead>
                    <SortHead<StyleSortKey> k="purchase_qty" currentKey={styleSortKey} dir={styleSortDir} onSort={onStyleSort} align="right">采购件数</SortHead>
                    <SortHead<StyleSortKey> k="received_qty" currentKey={styleSortKey} dir={styleSortDir} onSort={onStyleSort} align="right">已入库</SortHead>
                    <SortHead<StyleSortKey> k="unreceived_qty" currentKey={styleSortKey} dir={styleSortDir} onSort={onStyleSort} align="right">未入库</SortHead>
                    <SortHead<StyleSortKey> k="amount" currentKey={styleSortKey} dir={styleSortDir} onSort={onStyleSort} align="right">采购金额</SortHead>
                    <SortHead<StyleSortKey> k="warehouse_status" currentKey={styleSortKey} dir={styleSortDir} onSort={onStyleSort}>入库状态</SortHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {styleQ.isLoading ? (
                    <TableRow><TableCell colSpan={12} className="text-center py-10 text-muted-foreground">加载中…</TableCell></TableRow>
                  ) : (styleQ.data?.rows.length ?? 0) === 0 ? (
                    <TableRow><TableCell colSpan={12} className="text-center py-10 text-muted-foreground">
                      暂无采购数据,请先执行聚水潭采购同步
                    </TableCell></TableRow>
                  ) : styleQ.data!.rows.map((s: any) => (
                    <TableRow key={s.style_no}>
                      <TableCell className="text-xs">{fmtDate(s.latest_po_date)}</TableCell>
                      <TableCell className="font-mono text-xs">{s.style_no}</TableCell>
                      <TableCell>{s.product_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={s.suppliers}>{s.suppliers}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.po_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.sku_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.purchase_qty}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600">{s.received_qty}</TableCell>
                      <TableCell className="text-right tabular-nums text-amber-600">{s.unreceived_qty}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(s.amount)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={WAREHOUSE_STATUS_TONE[s.warehouse_status ?? "not_received"] ?? ""}>
                          {WAREHOUSE_STATUS_LABEL[s.warehouse_status ?? "not_received"] ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedStyle(s.style_no)}>查看详情</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="px-4 py-3 flex items-center justify-between text-xs text-muted-foreground border-t">
                <div>共 {styleQ.data?.count ?? 0} 条,第 {stylePage + 1} / {Math.max(1, styleTotalPages)} 页</div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={stylePage === 0} onClick={() => setStylePage(stylePage - 1)}>上一页</Button>
                  <Button size="sm" variant="outline" disabled={stylePage >= styleTotalPages - 1} onClick={() => setStylePage(stylePage + 1)}>下一页</Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* 采购单详情抽屉 */}
      <Sheet open={!!selectedPoId} onOpenChange={(o) => !o && setSelectedPoId(null)}>
        <SheetContent className="w-[900px] sm:max-w-[900px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>采购单详情 {selectedPo?.external_po_id}</SheetTitle>
            <SheetDescription>来源 purchase_orders / purchase_order_items</SheetDescription>
          </SheetHeader>
          {selectedPo && (
            <div className="space-y-4 mt-4 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">供应商:</span> {selectedPo.supplier_name ?? "—"}</div>
                <div><span className="text-muted-foreground">采购日期:</span> {fmtDate(selectedPo.po_date)}</div>
                <div><span className="text-muted-foreground">状态:</span> {selectedPo.status_label ?? selectedPo.status}</div>
                <div><span className="text-muted-foreground">入库状态:</span> {WAREHOUSE_STATUS_LABEL[selectedPo.warehouse_status] ?? "—"}</div>
                <div><span className="text-muted-foreground">采购件数:</span> {selectedPo.total_purchase_qty}</div>
                <div><span className="text-muted-foreground">已入库:</span> {selectedPo.total_received_qty}</div>
                <div><span className="text-muted-foreground">未入库:</span> {selectedPo.total_unreceived_qty}</div>
                <div><span className="text-muted-foreground">采购金额:</span> {fmtMoney(selectedPo.total_amount)}</div>
                <div><span className="text-muted-foreground">原始单号:</span> {selectedPo.external_po_id}</div>
                <div><span className="text-muted-foreground">最近同步:</span> {fmtDateTime(selectedPo.updated_at)}</div>
              </div>
              <div>
                <div className="text-xs font-medium mb-2">采购明细</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>图</TableHead>
                      <TableHead>款号</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>商品</TableHead>
                      <TableHead>颜色/尺码</TableHead>
                      <TableHead className="text-right">采购</TableHead>
                      <TableHead className="text-right">已入</TableHead>
                      <TableHead className="text-right">未入</TableHead>
                      <TableHead className="text-right">单价</TableHead>
                      <TableHead className="text-right">金额</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(itemsQ.data ?? []).map((it: any) => (
                      <TableRow key={it.id}>
                        <TableCell>
                          {it.product_image_url ? <img src={it.product_image_url} alt="" className="w-8 h-8 object-cover rounded" /> : <div className="w-8 h-8 bg-muted rounded" />}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{it.style_no}</TableCell>
                        <TableCell className="font-mono text-xs">{it.sku_no}</TableCell>
                        <TableCell className="text-xs max-w-[180px] truncate">{it.product_name}</TableCell>
                        <TableCell className="text-xs">{[it.color, it.size].filter(Boolean).join("/")}</TableCell>
                        <TableCell className="text-right tabular-nums">{it.purchase_qty}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-600">{it.received_qty}</TableCell>
                        <TableCell className="text-right tabular-nums text-amber-600">{it.unreceived_qty}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(it.unit_price)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(it.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* 款号详情抽屉 */}
      <Sheet open={!!selectedStyle} onOpenChange={(o) => !o && setSelectedStyle(null)}>
        <SheetContent className="w-[800px] sm:max-w-[800px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>款号 {selectedStyle} 涉及的采购单/SKU</SheetTitle>
          </SheetHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>采购单</TableHead>
                <TableHead>供应商</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>颜色/尺码</TableHead>
                <TableHead className="text-right">采购</TableHead>
                <TableHead className="text-right">已入</TableHead>
                <TableHead className="text-right">未入</TableHead>
                <TableHead className="text-right">金额</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(styleDetailQ.data ?? []).map((it: any) => (
                <TableRow key={it.id}>
                  <TableCell className="font-mono text-xs">{it.purchase_orders?.external_po_id}</TableCell>
                  <TableCell className="text-xs">{it.purchase_orders?.supplier_name}</TableCell>
                  <TableCell className="font-mono text-xs">{it.sku_no}</TableCell>
                  <TableCell className="text-xs">{[it.color, it.size].filter(Boolean).join("/")}</TableCell>
                  <TableCell className="text-right tabular-nums">{it.purchase_qty}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-600">{it.received_qty}</TableCell>
                  <TableCell className="text-right tabular-nums text-amber-600">{it.unreceived_qty}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(it.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SheetContent>
      </Sheet>
    </div>
  );
}
