import { useEffect, useMemo, useState } from "react";
import { Calendar as CalendarIcon, Search, Package, ClipboardList, ChevronDown, ChevronRight, Inbox, Loader2, ArrowUp, ArrowDown, ChevronsUpDown, ChevronLeft, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ============== Types (match edge function payload) ==============
type WarehouseStatus = "not_received" | "partial" | "received";

interface OrderRow {
  id: string;
  external_po_id: string;
  po_date: string | null;
  supplier_name: string;
  status: string;
  status_label: string;
  warehouse_status: WarehouseStatus;
  warehouse_status_label: string;
  style_count: number;
  sku_count: number;
  total_purchase_qty: number;
  total_received_qty: number;
  total_unreceived_qty: number;
  total_amount: number;
  expected_delivery_date: string | null;
  latest_receipt_at: string | null;
  remark: string;
}

interface StyleRow {
  style_no: string;
  product_name: string;
  product_image_url: string;
  purchase_order_count: number;
  total_purchase_qty: number;
  total_received_qty: number;
  total_unreceived_qty: number;
  receipt_progress: number;
  latest_po_date: string | null;
  latest_delivery_date: string | null;
  warehouse_status_summary: string;
}

interface POItem {
  id: string;
  purchase_order_id: string;
  external_po_id: string;
  style_no: string;
  sku_no: string;
  product_name: string;
  product_image_url: string;
  color: string;
  size: string;
  spec: string;
  purchase_qty: number;
  received_qty: number;
  unreceived_qty: number;
  unit_price: number;
  amount: number;
  delivery_date: string | null;
  item_remark: string;
}

interface ReceiptRow {
  id: string;
  external_io_id: string;
  io_date: string | null;
  warehouse_name: string;
  remark: string;
  purchase_receipt_items: Array<{ sku_no: string; received_qty: number; product_name: string }>;
}

interface PODetail {
  purchase_order: OrderRow & { remark: string; supplier_name: string };
  items: POItem[];
  receipts: ReceiptRow[];
}

// ============== Helpers ==============
function fmtMoney(n?: number | null) {
  if (n == null) return "-";
  return "¥" + Number(n).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(s?: string | null) {
  if (!s) return "-";
  return s.slice(0, 10);
}
function fmtDateTime(s?: string | null) {
  if (!s) return "-";
  return s.replace("T", " ").slice(0, 16);
}
function StatusBadge({ s, label }: { s: WarehouseStatus | string; label?: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    not_received: { label: "未入库", cls: "bg-rose-50 text-rose-700 ring-rose-200" },
    partial: { label: "部分入库", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
    received: { label: "已入库", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  };
  const c = cfg[s] ?? { label: label ?? s, cls: "bg-muted text-muted-foreground ring-border" };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ring-1", c.cls)}>
      {label ?? c.label}
    </span>
  );
}
function rangeToDates(range: string): { start?: string; end?: string } {
  if (range === "all") return {};
  const now = new Date();
  if (range === "7d") return { start: new Date(now.getTime() - 7 * 86400000).toISOString() };
  if (range === "30d") return { start: new Date(now.getTime() - 30 * 86400000).toISOString() };
  if (range === "month") {
    const s = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    return { start: s };
  }
  return {};
}

// ============== Page ==============
export default function SupplierPurchaseOrdersPage() {
  const { profile } = useAuth();
  const supplierName = (profile as any)?.full_name ?? (profile as any)?.username ?? "供应商账号";

  const [tab, setTab] = useState<"po" | "style">("po");
  const [dateRange, setDateRange] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState<"all" | WarehouseStatus>("all");
  const [expandedPO, setExpandedPO] = useState<string | null>(null);
  const [expandedStyle, setExpandedStyle] = useState<string | null>(null);
  const [drawerPOId, setDrawerPOId] = useState<string | null>(null);

  const [orderRows, setOrderRows] = useState<OrderRow[]>([]);
  const [styleRows, setStyleRows] = useState<StyleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const { start, end } = rangeToDates(dateRange);
    const params: Record<string, string> = { view: tab === "po" ? "order" : "style", page: "1", page_size: "2000" };
    if (start) params.start_date = start;
    if (end) params.end_date = end;
    if (keyword.trim()) params.keyword = keyword.trim();
    if (warehouseFilter !== "all") params.warehouse_status = warehouseFilter;

    supabase.functions
      .invoke("supplier-purchase-orders", { method: "GET" as any, body: undefined, headers: {}, ...({ } as any) })
      // supabase-js v2 invoke ignores GET params; call fetch directly:
      .then(() => {})
      .catch(() => {});

    // Use fetch directly for GET with query string
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/supplier-purchase-orders?${new URLSearchParams(params).toString()}`;
        const r = await fetch(url, {
          headers: { Authorization: `Bearer ${token ?? ""}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        });
        const json = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setError(json?.error ?? "加载失败");
          setOrderRows([]); setStyleRows([]);
        } else if (tab === "po") {
          setOrderRows(json.data ?? []);
        } else {
          setStyleRows(json.data ?? []);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, dateRange, keyword, warehouseFilter]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white rounded-xl border border-border p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground">采购单</h1>
            <p className="text-xs text-muted-foreground mt-1">查看我们发给您的采购订单、到货和入库进度</p>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-muted-foreground">当前账号</div>
            <div className="text-sm font-semibold text-emerald-700 mt-0.5">{supplierName}</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-border p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-[11px] text-muted-foreground flex items-center gap-1.5 mb-1.5">
              <CalendarIcon className="w-3 h-3" /> 采购日期
            </label>
            <div className="flex gap-1">
              {[{ v: "7d", l: "近7天" }, { v: "30d", l: "近30天" }, { v: "month", l: "本月" }, { v: "all", l: "全部" }].map((o) => (
                <button
                  key={o.v}
                  onClick={() => setDateRange(o.v)}
                  className={cn("flex-1 h-8 text-[12px] rounded border transition", dateRange === o.v ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-foreground border-border hover:bg-muted")}
                >
                  {o.l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground flex items-center gap-1.5 mb-1.5">
              <Search className="w-3 h-3" /> 款式 / 商品名称
            </label>
            <Input placeholder="输入款号、SKU 或商品名称" value={keyword} onChange={(e) => setKeyword(e.target.value)} className="h-8 text-[12px]" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground flex items-center gap-1.5 mb-1.5">
              <Package className="w-3 h-3" /> 入库状态
            </label>
            <div className="flex gap-1">
              {[{ v: "all", l: "全部" }, { v: "not_received", l: "未入库" }, { v: "partial", l: "部分入库" }, { v: "received", l: "已入库" }].map((o) => (
                <button
                  key={o.v}
                  onClick={() => setWarehouseFilter(o.v as any)}
                  className={cn("flex-1 h-8 text-[12px] rounded border transition", warehouseFilter === o.v ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-foreground border-border hover:bg-muted")}
                >
                  {o.l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="flex border-b border-border">
          {[{ v: "po", l: "按采购单查看", icon: ClipboardList }, { v: "style", l: "按商品款号查看", icon: Package }].map(({ v, l, icon: Icon }) => (
            <button
              key={v}
              onClick={() => { setTab(v as any); setExpandedPO(null); setExpandedStyle(null); }}
              className={cn("flex items-center gap-2 px-5 py-3 text-[13px] border-b-2 transition", tab === v ? "border-emerald-600 text-emerald-700 font-semibold bg-emerald-50/40" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              <Icon className="w-4 h-4" />
              {l}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-16 text-center text-muted-foreground"><Loader2 className="w-6 h-6 mx-auto animate-spin opacity-50" /></div>
        ) : error ? (
          <div className="py-16 text-center text-rose-600 text-[13px]">{error}</div>
        ) : tab === "po" ? (
          <POTable rows={orderRows} onDetail={(id) => setDrawerPOId(id)} />
        ) : (
          <StyleTable rows={styleRows} expanded={expandedStyle} onToggle={(s) => setExpandedStyle(expandedStyle === s ? null : s)} onDetail={(id) => setDrawerPOId(id)} keyword={keyword} warehouseFilter={warehouseFilter} dateRange={dateRange} />
        )}
      </div>

      <Sheet open={!!drawerPOId} onOpenChange={(o) => !o && setDrawerPOId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-none sm:w-[min(96vw,1400px)] p-0 flex flex-col">
          {drawerPOId && <PODetailDrawer poId={drawerPOId} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ============== Sorting + Pagination helpers ==============
type SortDir = "asc" | "desc";
function useSortAndPage<T>(rows: T[], defaultSortKey: keyof T, defaultDir: SortDir = "desc") {
  const [sortKey, setSortKey] = useState<keyof T>(defaultSortKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Reset page when rows change (filter/tab switch)
  useEffect(() => { setPage(1); }, [rows]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a: any, b: any) => {
      const va = a[sortKey]; const vb = b[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return sortDir === "asc" ? va - vb : vb - va;
      const sa = String(va); const sb = String(vb);
      return sortDir === "asc" ? sa.localeCompare(sb, "zh-CN") : sb.localeCompare(sa, "zh-CN");
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const onSort = (key: keyof T) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  return { sortKey, sortDir, onSort, page: safePage, setPage, pageSize, setPageSize, pageCount, total, pageRows };
}

function SortTh<T>({ k, currentKey, dir, onSort, children, className }: { k: keyof T; currentKey: keyof T; dir: SortDir; onSort: (k: keyof T) => void; children: React.ReactNode; className?: string }) {
  const active = k === currentKey;
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cn("px-3 py-2 font-medium whitespace-nowrap select-none", className)}>
      <button onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 hover:text-foreground transition", active ? "text-foreground" : "")}>
        <span>{children}</span>
        <Icon className="w-3 h-3 opacity-60" />
      </button>
    </th>
  );
}

function Pagination({ page, pageCount, pageSize, total, setPage, setPageSize }: { page: number; pageCount: number; pageSize: number; total: number; setPage: (n: number) => void; setPageSize: (n: number) => void }) {
  if (total === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-border bg-muted/20 text-[12px]">
      <div className="text-muted-foreground">
        共 <span className="text-foreground font-medium">{total}</span> 条，当前 {start}-{end}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">每页</span>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="h-7 px-2 rounded border border-border bg-white text-[12px]"
          >
            {[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={() => setPage(1)} disabled={page <= 1} className="h-7 w-7 inline-flex items-center justify-center rounded border border-border bg-white disabled:opacity-40 hover:bg-muted"><ChevronsLeft className="w-3.5 h-3.5" /></button>
          <button onClick={() => setPage(page - 1)} disabled={page <= 1} className="h-7 w-7 inline-flex items-center justify-center rounded border border-border bg-white disabled:opacity-40 hover:bg-muted"><ChevronLeft className="w-3.5 h-3.5" /></button>
          <span className="px-2 text-foreground">第 {page} / {pageCount} 页</span>
          <button onClick={() => setPage(page + 1)} disabled={page >= pageCount} className="h-7 w-7 inline-flex items-center justify-center rounded border border-border bg-white disabled:opacity-40 hover:bg-muted"><ChevronRight className="w-3.5 h-3.5" /></button>
          <button onClick={() => setPage(pageCount)} disabled={page >= pageCount} className="h-7 w-7 inline-flex items-center justify-center rounded border border-border bg-white disabled:opacity-40 hover:bg-muted"><ChevronsRight className="w-3.5 h-3.5" /></button>
        </div>
      </div>
    </div>
  );
}

// ============== PO Table ==============
function POTable({ rows, onDetail }: { rows: OrderRow[]; expanded?: string | null; onToggle?: (id: string) => void; onDetail: (id: string) => void }) {
  const { sortKey, sortDir, onSort, page, setPage, pageSize, setPageSize, pageCount, total, pageRows } = useSortAndPage<OrderRow>(rows, "po_date", "desc");
  if (rows.length === 0) return <EmptyState />;
  // Auto-hide columns where ALL values are empty (but 0 is valid)
  const hasExpected = rows.some((r) => !!r.expected_delivery_date);
  const hasLatest = rows.some((r) => !!r.latest_receipt_at);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/40 text-muted-foreground text-left">
            <tr>
              <SortTh<OrderRow> k="external_po_id" currentKey={sortKey} dir={sortDir} onSort={onSort}>采购单号</SortTh>
              <SortTh<OrderRow> k="po_date" currentKey={sortKey} dir={sortDir} onSort={onSort}>采购日期</SortTh>
              <SortTh<OrderRow> k="warehouse_status" currentKey={sortKey} dir={sortDir} onSort={onSort}>入库状态</SortTh>
              <SortTh<OrderRow> k="style_count" currentKey={sortKey} dir={sortDir} onSort={onSort} className="text-right">款数</SortTh>
              <SortTh<OrderRow> k="sku_count" currentKey={sortKey} dir={sortDir} onSort={onSort} className="text-right">SKU 数</SortTh>
              <SortTh<OrderRow> k="total_purchase_qty" currentKey={sortKey} dir={sortDir} onSort={onSort} className="text-right">采购数量</SortTh>
              <SortTh<OrderRow> k="total_received_qty" currentKey={sortKey} dir={sortDir} onSort={onSort} className="text-right">已入库</SortTh>
              <SortTh<OrderRow> k="total_unreceived_qty" currentKey={sortKey} dir={sortDir} onSort={onSort} className="text-right">未入库</SortTh>
              <SortTh<OrderRow> k="total_amount" currentKey={sortKey} dir={sortDir} onSort={onSort} className="text-right">采购金额</SortTh>
              {hasExpected && <SortTh<OrderRow> k="expected_delivery_date" currentKey={sortKey} dir={sortDir} onSort={onSort}>预计交期</SortTh>}
              {hasLatest && <SortTh<OrderRow> k="latest_receipt_at" currentKey={sortKey} dir={sortDir} onSort={onSort}>最近入库</SortTh>}
              <Th className="min-w-[160px]">入仓进度</Th>
              <SortTh<OrderRow> k="expected_delivery_date" currentKey={sortKey} dir={sortDir} onSort={onSort}>协议到货日期</SortTh>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((po) => {
              const purchased = Number(po.total_purchase_qty) || 0;
              const received = Number(po.total_received_qty) || 0;
              const progress = purchased > 0 ? Math.min(100, Math.round((received / purchased) * 100)) : 0;
              const barTone = progress >= 100 ? "bg-emerald-500" : progress > 0 ? "bg-amber-500" : "bg-rose-400";
              return (
                <tr
                  key={po.id}
                  className="border-t border-border hover:bg-muted/40 cursor-pointer"
                  onClick={() => onDetail(po.id)}
                >
                  <Td className="text-sky-700 font-medium">{po.external_po_id}</Td>
                  <Td>{fmtDate(po.po_date)}</Td>
                  <Td><StatusBadge s={po.warehouse_status} label={po.warehouse_status_label} /></Td>
                  <Td className="text-right">{po.style_count}</Td>
                  <Td className="text-right">{po.sku_count}</Td>
                  <Td className="text-right tabular-nums">{po.total_purchase_qty}</Td>
                  <Td className="text-right tabular-nums text-emerald-700">{po.total_received_qty}</Td>
                  <Td className="text-right tabular-nums text-rose-600">{po.total_unreceived_qty}</Td>
                  <Td className="text-right tabular-nums">{fmtMoney(po.total_amount)}</Td>
                  {hasExpected && <Td>{fmtDate(po.expected_delivery_date)}</Td>}
                  {hasLatest && <Td>{fmtDateTime(po.latest_receipt_at)}</Td>}
                  <Td>
                    <div className="flex items-center gap-2 min-w-[150px]">
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div className={cn("h-full transition-all", barTone)} style={{ width: `${progress}%` }} />
                      </div>
                      <span className="tabular-nums w-10 text-right text-[11px] text-muted-foreground">{progress}%</span>
                    </div>
                  </Td>
                  <Td>{fmtDate(po.expected_delivery_date)}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={pageCount} pageSize={pageSize} total={total} setPage={setPage} setPageSize={setPageSize} />
    </>
  );
}

// ============== Style Table ==============
function StyleTable({ rows, expanded, onToggle, onDetail, keyword, warehouseFilter, dateRange }: {
  rows: StyleRow[]; expanded: string | null; onToggle: (s: string) => void; onDetail: (id: string) => void;
  keyword: string; warehouseFilter: string; dateRange: string;
}) {
  const { sortKey, sortDir, onSort, page, setPage, pageSize, setPageSize, pageCount, total, pageRows } = useSortAndPage<StyleRow>(rows, "latest_po_date", "desc");
  if (rows.length === 0) return <EmptyState />;
  const hasImage = rows.some((r) => !!r.product_image_url);
  const hasDelivery = rows.some((r) => !!r.latest_delivery_date);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/40 text-muted-foreground text-left">
            <tr>
              <th className="w-8"></th>
              {hasImage && <Th>图片</Th>}
              <SortTh<StyleRow> k="style_no" currentKey={sortKey} dir={sortDir} onSort={onSort}>商品款号</SortTh>
              <SortTh<StyleRow> k="product_name" currentKey={sortKey} dir={sortDir} onSort={onSort}>商品名称</SortTh>
              <SortTh<StyleRow> k="purchase_order_count" currentKey={sortKey} dir={sortDir} onSort={onSort} className="text-right">涉及采购单</SortTh>
              <SortTh<StyleRow> k="total_purchase_qty" currentKey={sortKey} dir={sortDir} onSort={onSort} className="text-right">累计采购</SortTh>
              <SortTh<StyleRow> k="total_received_qty" currentKey={sortKey} dir={sortDir} onSort={onSort} className="text-right">累计已入库</SortTh>
              <SortTh<StyleRow> k="total_unreceived_qty" currentKey={sortKey} dir={sortDir} onSort={onSort} className="text-right">累计未入库</SortTh>
              <SortTh<StyleRow> k="receipt_progress" currentKey={sortKey} dir={sortDir} onSort={onSort} className="text-right">入库进度</SortTh>
              <SortTh<StyleRow> k="latest_po_date" currentKey={sortKey} dir={sortDir} onSort={onSort}>最近采购日期</SortTh>
              {hasDelivery && <SortTh<StyleRow> k="latest_delivery_date" currentKey={sortKey} dir={sortDir} onSort={onSort}>最近预计交期</SortTh>}
              <Th>入库汇总</Th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((s) => {
              const isOpen = expanded === s.style_no;
              const progress = Math.round((s.receipt_progress || 0) * 100);
              return (
                <FragmentRow key={s.style_no}>
                  <tr className="border-t border-border hover:bg-muted/30 cursor-pointer" onClick={() => onToggle(s.style_no)}>
                    <td className="px-2 text-muted-foreground">
                      {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </td>
                    {hasImage && (
                      <Td>{s.product_image_url ? <img src={s.product_image_url} alt="" className="w-10 h-10 rounded object-cover" /> : <div className="w-10 h-10 rounded bg-muted" />}</Td>
                    )}
                    <Td className="text-sky-700 font-medium">{s.style_no}</Td>
                    <Td>{s.product_name}</Td>
                    <Td className="text-right">{s.purchase_order_count}</Td>
                    <Td className="text-right tabular-nums">{s.total_purchase_qty}</Td>
                    <Td className="text-right tabular-nums text-emerald-700">{s.total_received_qty}</Td>
                    <Td className="text-right tabular-nums text-rose-600">{s.total_unreceived_qty}</Td>
                    <Td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${progress}%` }} />
                        </div>
                        <span className="tabular-nums w-9 text-right">{progress}%</span>
                      </div>
                    </Td>
                    <Td>{fmtDate(s.latest_po_date)}</Td>
                    {hasDelivery && <Td>{fmtDate(s.latest_delivery_date)}</Td>}
                    <Td><span className="text-[11px] text-muted-foreground">{s.warehouse_status_summary}</span></Td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-muted/20">
                      <td></td>
                      <td colSpan={11} className="p-3">
                        <StylePOSubTable styleNo={s.style_no} onDetail={onDetail} keyword={keyword} warehouseFilter={warehouseFilter} dateRange={dateRange} />
                      </td>
                    </tr>
                  )}
                </FragmentRow>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={pageCount} pageSize={pageSize} total={total} setPage={setPage} setPageSize={setPageSize} />
    </>
  );
}


// 展开后按 SKU 聚合显示（不再按采购单显示）
function StylePOSubTable({ styleNo, dateRange, warehouseFilter }: { styleNo: string; onDetail: (id: string) => void; keyword: string; warehouseFilter: string; dateRange: string }) {
  const [skus, setSkus] = useState<Array<{
    sku_no: string; color: string; size: string; spec: string;
    purchase_qty: number; received_qty: number; unreceived_qty: number;
    amount: number; po_count: number;
  }> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    (async () => {
      try {
        // 1. 先用列表接口取到该款号下属的采购单 id
        const { start } = rangeToDates(dateRange);
        const params: Record<string, string> = { view: "order", keyword: styleNo, page: "1", page_size: "200" };
        if (start) params.start_date = start;
        if (warehouseFilter !== "all") params.warehouse_status = warehouseFilter;
        const { data: { session } } = await supabase.auth.getSession();
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/supplier-purchase-orders?${new URLSearchParams(params).toString()}`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } });
        const json = await r.json();
        const poIds: string[] = (json.data ?? []).map((p: any) => p.id);
        if (poIds.length === 0) { if (!cancel) { setSkus([]); setLoading(false); } return; }

        // 2. 拉这些采购单下属于该款号的所有商品行
        const { data: items } = await supabase
          .from("purchase_order_items")
          .select("sku_no, color, size, spec, purchase_qty, received_qty, unreceived_qty, unit_price, style_no, purchase_order_id")
          .in("purchase_order_id", poIds)
          .eq("style_no", styleNo);

        // 3. 按 sku_no 聚合
        const map = new Map<string, any>();
        for (const it of (items ?? []) as any[]) {
          const key = it.sku_no || `${it.color}|${it.size || it.spec}`;
          const prev = map.get(key) ?? {
            sku_no: it.sku_no ?? "", color: it.color ?? "", size: it.size ?? "", spec: it.spec ?? "",
            purchase_qty: 0, received_qty: 0, unreceived_qty: 0, amount: 0, po_set: new Set<string>(),
          };
          prev.purchase_qty += Number(it.purchase_qty || 0);
          prev.received_qty += Number(it.received_qty || 0);
          prev.unreceived_qty += Number(it.unreceived_qty || 0);
          prev.amount += Number(it.purchase_qty || 0) * Number(it.unit_price || 0);
          prev.po_set.add(it.purchase_order_id);
          map.set(key, prev);
        }
        const arr = Array.from(map.values()).map((v) => ({
          sku_no: v.sku_no, color: v.color, size: v.size, spec: v.spec,
          purchase_qty: v.purchase_qty, received_qty: v.received_qty, unreceived_qty: v.unreceived_qty,
          amount: v.amount, po_count: v.po_set.size,
        })).sort((a, b) => (a.sku_no || "").localeCompare(b.sku_no || ""));

        if (!cancel) { setSkus(arr); setLoading(false); }
      } catch {
        if (!cancel) { setSkus([]); setLoading(false); }
      }
    })();
    return () => { cancel = true; };
  }, [styleNo, dateRange, warehouseFilter]);

  if (loading) return <div className="py-6 text-center text-muted-foreground"><Loader2 className="w-4 h-4 mx-auto animate-spin opacity-50" /></div>;
  if (!skus || skus.length === 0) return <div className="py-6 text-center text-muted-foreground text-[12px]">该款号下暂无 SKU 数据</div>;

  const hasColor = skus.some((s) => !!s.color);
  const hasSize = skus.some((s) => !!(s.size || s.spec));
  const hasAmount = skus.some((s) => Number(s.amount) > 0);

  return (
    <div className="rounded-lg bg-white border border-border overflow-hidden">
      <table className="w-full text-[12px]">
        <thead className="bg-muted/30 text-muted-foreground">
          <tr>
            <Th>SKU</Th>
            {hasColor && <Th>颜色</Th>}
            {hasSize && <Th>尺码 / 规格</Th>}
            <Th className="text-right">涉及采购单</Th>
            <Th className="text-right">累计采购</Th>
            <Th className="text-right">累计已入库</Th>
            <Th className="text-right">累计未入库</Th>
            <Th className="text-right">入库进度</Th>
            {hasAmount && <Th className="text-right">累计金额</Th>}
          </tr>
        </thead>
        <tbody>
          {skus.map((s) => {
            const progress = s.purchase_qty > 0 ? Math.round((s.received_qty / s.purchase_qty) * 100) : 0;
            return (
              <tr key={s.sku_no || `${s.color}-${s.size}`} className="border-t border-border hover:bg-muted/30">
                <Td className="font-mono text-[11px]">{s.sku_no || "-"}</Td>
                {hasColor && <Td>{s.color || "-"}</Td>}
                {hasSize && <Td>{s.size || s.spec || "-"}</Td>}
                <Td className="text-right tabular-nums">{s.po_count}</Td>
                <Td className="text-right tabular-nums">{s.purchase_qty}</Td>
                <Td className="text-right tabular-nums text-emerald-700">{s.received_qty}</Td>
                <Td className="text-right tabular-nums text-rose-600">{s.unreceived_qty}</Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="tabular-nums w-9 text-right">{progress}%</span>
                  </div>
                </Td>
                {hasAmount && <Td className="text-right tabular-nums">{fmtMoney(s.amount)}</Td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============== Inline items (PO expand) ==============
function InlineItems({ poId }: { poId: string }) {
  const [items, setItems] = useState<POItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancel = false;
    (async () => {
      // 走带图片解析的视图,自动按 SKU → 商品档案找图
      const { data, error } = await supabase
        .from("v_purchase_order_items_with_image" as any)
        .select("*")
        .eq("purchase_order_id", poId);
      if (!cancel) {
        if (!error && data) {
          const mapped = (data as any[]).map((d) => ({
            ...d,
            product_image_url: d.resolved_image_url || d.product_image_url || "",
          }));
          setItems(mapped as any);
        }
        setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [poId]);
  if (loading) return <div className="py-4 text-center text-muted-foreground text-[12px]"><Loader2 className="w-4 h-4 inline animate-spin opacity-50" /></div>;
  if (!items || items.length === 0) return <div className="py-4 text-center text-muted-foreground text-[12px]">暂无商品明细</div>;
  return <ItemsTable items={items} />;
}


function ItemsTable({ items }: { items: POItem[] }) {
  const hasImage = items.some((i) => !!i.product_image_url);
  const hasColor = items.some((i) => !!i.color);
  const hasSize = items.some((i) => !!(i.size || i.spec));
  const hasSku = items.some((i) => !!i.sku_no);
  const hasRemark = items.some((i) => !!i.item_remark);
  const hasPrice = items.some((i) => Number(i.unit_price) !== 0);
  const hasAmount = items.some((i) => Number(i.amount) !== 0);

  return (
    <div className="rounded-lg bg-white border border-border overflow-hidden">
      <table className="w-full text-[12px]">
        <thead className="bg-muted/30 text-muted-foreground">
          <tr>
            {hasImage && <Th>图片</Th>}
            <Th>款号</Th>
            <Th>商品名称</Th>
            {hasSku && <Th>SKU</Th>}
            {hasColor && <Th>颜色</Th>}
            {hasSize && <Th>尺码 / 规格</Th>}
            <Th className="text-right">采购数量</Th>
            <Th className="text-right">已入库</Th>
            <Th className="text-right">未入库</Th>
            {hasPrice && <Th className="text-right">单价</Th>}
            {hasAmount && <Th className="text-right">金额</Th>}
            {hasRemark && <Th>备注</Th>}
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-t border-border">
              {hasImage && (
                <Td>{i.product_image_url ? <img src={i.product_image_url} alt="" className="w-10 h-10 rounded object-cover" /> : <div className="w-10 h-10 rounded bg-muted" />}</Td>
              )}
              <Td className="text-sky-700">{i.style_no}</Td>
              <Td>{i.product_name}</Td>
              {hasSku && <Td className="font-mono text-[11px]">{i.sku_no || "-"}</Td>}
              {hasColor && <Td>{i.color || "-"}</Td>}
              {hasSize && <Td>{i.size || i.spec || "-"}</Td>}
              <Td className="text-right tabular-nums">{i.purchase_qty}</Td>
              <Td className="text-right tabular-nums text-emerald-700">{i.received_qty}</Td>
              <Td className="text-right tabular-nums text-rose-600">{i.unreceived_qty}</Td>
              {hasPrice && <Td className="text-right tabular-nums">{fmtMoney(i.unit_price)}</Td>}
              {hasAmount && <Td className="text-right tabular-nums">{fmtMoney(i.amount)}</Td>}
              {hasRemark && <Td className="text-muted-foreground">{i.item_remark || "-"}</Td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============== Drawer ==============
function PODetailDrawer({ poId }: { poId: string }) {
  const [data, setData] = useState<PODetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/supplier-purchase-order-detail?id=${poId}`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } });
        const json = await r.json();
        if (cancel) return;
        if (!r.ok) setErr(json?.error ?? "加载失败"); else setData(json);
      } catch (e: any) {
        if (!cancel) setErr(e.message);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [poId]);

  if (loading) return <div className="p-10 text-center text-muted-foreground"><Loader2 className="w-6 h-6 mx-auto animate-spin opacity-50" /></div>;
  if (err || !data) return <div className="p-10 text-center text-rose-600 text-[13px]">{err ?? "加载失败"}</div>;
  const po = data.purchase_order;
  const status = (po.warehouse_status as WarehouseStatus) ?? "not_received";
  const Field = ({ k, v }: { k: string; v: React.ReactNode }) => {
    if (v === null || v === undefined || v === "" || v === "-") return null;
    return (
      <div className="flex justify-between py-2 border-b border-border/60 text-[12px]">
        <span className="text-muted-foreground">{k}</span>
        <span className="text-foreground font-medium">{v}</span>
      </div>
    );
  };

  return (
    <>
      <div className="px-6 py-5 border-b border-border bg-gradient-to-b from-emerald-50 to-white">
        <div className="flex items-center gap-3 mb-2">
          <div className="text-lg font-semibold text-foreground">{po.external_po_id}</div>
          <StatusBadge s={status} />
        </div>
        <div className="text-[12px] text-muted-foreground">采购日期 {fmtDate(po.po_date)}</div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          <Tile label="采购总数量" value={po.total_purchase_qty} />
          <Tile label="已入库" value={po.total_received_qty} tone="emerald" />
          <Tile label="未入库" value={po.total_unreceived_qty} tone="rose" />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Section title="基本信息">
            <Field k="采购单号" v={po.external_po_id} />
            <Field k="供应商" v={po.supplier_name} />
            <Field k="采购日期" v={fmtDate(po.po_date)} />
            <Field k="采购状态" v={po.status_label || po.status} />
            <Field k="入库状态" v={<StatusBadge s={status} label={po.warehouse_status_label} />} />
            <Field k="协议到货日期" v={fmtDate(po.expected_delivery_date)} />
            <Field k="采购总数量" v={po.total_purchase_qty} />
            <Field k="已入库数量" v={po.total_received_qty} />
            <Field k="未入库数量" v={po.total_unreceived_qty} />
            <Field k="采购总金额" v={po.total_amount ? fmtMoney(po.total_amount) : null} />
            <Field k="备注" v={po.remark} />
          </Section>
          <Section title="商品图片">
            <ProductImages items={data.items} />
          </Section>
        </div>

        <Section title="商品明细">
          {data.items.length === 0 ? <div className="text-center py-6 text-muted-foreground text-[12px]">暂无商品明细</div> : <ItemsTable items={data.items} />}
        </Section>

        <Section title="入库记录">
          {data.receipts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-[12px]">暂无入库记录</div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <Th>入库单号</Th>
                    <Th>入库时间</Th>
                    <Th className="text-right">入库数量</Th>
                    <Th>仓库</Th>
                    <Th>备注</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.receipts.map((r) => {
                    const qty = (r.purchase_receipt_items ?? []).reduce((s, x) => s + Number(x.received_qty || 0), 0);
                    return (
                      <tr key={r.id} className="border-t border-border">
                        <Td className="font-mono text-[11px]">{r.external_io_id}</Td>
                        <Td>{fmtDateTime(r.io_date)}</Td>
                        <Td className="text-right tabular-nums text-emerald-700">{qty}</Td>
                        <Td>{r.warehouse_name || "-"}</Td>
                        <Td className="text-muted-foreground">{r.remark || "-"}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}

// ============== Atoms ==============
function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2 text-left font-medium whitespace-nowrap", className)}>{children}</th>;
}
function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2 whitespace-nowrap", className)}>{children}</td>;
}
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[13px] font-semibold text-foreground mb-2">{title}</div>
      <div>{children}</div>
    </div>
  );
}
function Tile({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "rose" }) {
  const cls = tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-600" : "text-foreground";
  return (
    <div className="bg-white rounded-lg border border-border p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums mt-0.5", cls)}>{value}</div>
    </div>
  );
}

function ProductImages({ items }: { items: POItem[] }) {
  // 按款号去重，优先取有图的
  const map = new Map<string, { style_no: string; url: string; name: string }>();
  for (const it of items) {
    const key = it.style_no || it.sku_no || it.product_name;
    if (!key) continue;
    const prev = map.get(key);
    if (!prev || (!prev.url && it.product_image_url)) {
      map.set(key, { style_no: it.style_no || "", url: it.product_image_url || "", name: it.product_name || "" });
    }
  }
  const list = Array.from(map.values());
  if (list.length === 0) return <div className="text-center py-6 text-muted-foreground text-[12px]">暂无图片</div>;
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
      {list.map((p) => (
        <div key={p.style_no + p.name} className="space-y-1">
          {p.url ? (
            <a href={p.url} target="_blank" rel="noreferrer">
              <img src={p.url} alt={p.name} className="w-full aspect-square rounded-lg object-cover border border-border hover:opacity-90 transition" />
            </a>
          ) : (
            <div className="w-full aspect-square rounded-lg bg-muted flex items-center justify-center text-muted-foreground text-[11px]">无图</div>
          )}
          <div className="text-[11px] text-sky-700 font-medium truncate">{p.style_no || "-"}</div>
          <div className="text-[11px] text-muted-foreground truncate" title={p.name}>{p.name}</div>
        </div>
      ))}
    </div>
  );
}
function EmptyState() {
  return (
    <div className="py-16 text-center text-muted-foreground">
      <Inbox className="w-10 h-10 mx-auto mb-2 opacity-40" />
      <div className="text-[13px]">没有找到符合条件的采购单，请调整筛选条件</div>
    </div>
  );
}
