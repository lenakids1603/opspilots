import { useMemo, useRef, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Search, Download, ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  formatDateTimeCN, beijingDayRangeToUTC, todayCN, beijingYMD,
} from "@/lib/datetime";
import { zhStatus } from "@/lib/statusLabel";
import OutboundByStyleTab from "@/components/ops/OutboundByStyleTab";

const PAGE_SIZE = 20;
const fmtInt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 });
const fmtWeight = (n: number | null | undefined) =>
  n == null ? "-" : Number(n).toLocaleString("zh-CN", { maximumFractionDigits: 3 });

type Filters = {
  startDate: string;
  endDate: string;
  shop: string;
  warehouse: string;
  logistics: string;
  ioId: string;
  oId: string;
  trackingNumber: string;
  sku: string;
  status: string;
  hasItems: string;
  abnormal: string;
};

type PackageRow = {
  id: string;
  package_unique_key: string;
  io_id: string;
  so_id: string | null;
  o_id: string | null;
  shop_id: string | null;
  shop_name: string | null;
  wh_id: string | null;
  warehouse_name: string | null;
  send_date: string | null;
  logistics_company: string | null;
  tracking_number: string | null;
  weight: number | null;
  shipping_method: string | null;
  status: string | null;
  modified_at_jst: string | null;
  synced_at: string;
  item_qty?: number;
  item_count?: number;
};

type PackageItemRow = {
  id: string;
  item_unique_key: string;
  package_id: string;
  package_unique_key: string;
  io_id: string;
  so_id: string | null;
  o_id: string | null;
  sku_id: string | null;
  sku_code: string | null;
  style_no: string | null;
  product_name: string | null;
  qty: number;
  synced_at: string;
};

function defaultFilters(): Filters {
  const end = todayCN();
  const d = new Date(`${end}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() - 6);
  return {
    startDate: beijingYMD(d),
    endDate: end,
    shop: "",
    warehouse: "",
    logistics: "",
    ioId: "",
    oId: "",
    trackingNumber: "",
    sku: "",
    status: "all",
    hasItems: "all",
    abnormal: "all",
  };
}

function isActiveStatus(status: string | null | undefined) {
  return !/delete|cancel/i.test(String(status ?? ""));
}

// Supabase query builders are structurally typed; keep this helper narrow to
// the filter methods it uses so eslint does not require a broad any.
type FilterQuery<T> = T & {
  gte: (column: string, value: string) => FilterQuery<T>;
  lte: (column: string, value: string) => FilterQuery<T>;
  ilike: (column: string, value: string) => FilterQuery<T>;
  eq: (column: string, value: string) => FilterQuery<T>;
};

function applyFilters<T>(q: FilterQuery<T>, f: Filters): FilterQuery<T> {
  if (f.startDate) {
    const range = beijingDayRangeToUTC(f.startDate);
    if (range) q = q.gte("send_date", range.gte);
  }
  if (f.endDate) {
    const range = beijingDayRangeToUTC(f.endDate);
    if (range) q = q.lte("send_date", range.lte);
  }
  if (f.shop) q = q.ilike("shop_name", `%${f.shop}%`);
  if (f.warehouse) q = q.ilike("warehouse_name", `%${f.warehouse}%`);
  if (f.logistics) q = q.ilike("logistics_company", `%${f.logistics}%`);
  if (f.ioId) q = q.ilike("io_id", `%${f.ioId}%`);
  if (f.oId) q = q.ilike("o_id", `%${f.oId}%`);
  if (f.trackingNumber) q = q.ilike("tracking_number", `%${f.trackingNumber}%`);
  if (f.status !== "all") q = q.eq("status", f.status);
  return q;
}

async function aggregateItems(packageIds: string[]) {
  const agg: Record<string, { qty: number; count: number }> = {};
  for (let i = 0; i < packageIds.length; i += 800) {
    const slice = packageIds.slice(i, i + 800);
    const { data, error } = await (supabase as any)
      .from("warehouse_shipping_package_items")
      .select("package_id, qty")
      .in("package_id", slice);
    if (error) throw error;
    for (const item of data ?? []) {
      const key = item.package_id;
      const cur = agg[key] ?? { qty: 0, count: 0 };
      cur.qty += Number(item.qty ?? 0);
      cur.count += 1;
      agg[key] = cur;
    }
  }
  return agg;
}

function useStats() {
  return useQuery({
    queryKey: ["warehouse_shipping_stats", todayCN()],
    queryFn: async () => {
      const today = todayCN();
      const todayRange = beijingDayRangeToUTC(today)!;
      const monthRange = beijingDayRangeToUTC(today.slice(0, 8) + "01")!;

      const [todayPackagesRes, monthPackagesRes] = await Promise.all([
        (supabase as any)
          .from("warehouse_shipping_packages")
          .select("id,o_id,status", { count: "exact" })
          .gte("send_date", todayRange.gte)
          .lte("send_date", todayRange.lte)
          .limit(5000),
        (supabase as any)
          .from("warehouse_shipping_packages")
          .select("id,o_id,status", { count: "exact" })
          .gte("send_date", monthRange.gte)
          .limit(20000),
      ]);
      if (todayPackagesRes.error) throw todayPackagesRes.error;
      if (monthPackagesRes.error) throw monthPackagesRes.error;

      const todayPackages = (todayPackagesRes.data ?? []).filter((p) => isActiveStatus(p.status));
      const monthPackages = (monthPackagesRes.data ?? []).filter((p) => isActiveStatus(p.status));
      const todayAgg = await aggregateItems(todayPackages.map((p) => p.id));
      const monthAgg = await aggregateItems(monthPackages.map((p) => p.id));
      const todayQty = Object.values(todayAgg).reduce((sum, row) => sum + row.qty, 0);
      const monthQty = Object.values(monthAgg).reduce((sum, row) => sum + row.qty, 0);
      const todayOrders = new Set(todayPackages.map((p) => p.o_id || p.id)).size;
      const abnormal = monthPackages.filter((p) => !monthAgg[p.id]?.count).length;

      return {
        todayPackages: todayPackages.length,
        todayOrders,
        todayQty,
        monthPackages: monthPackages.length,
        monthQty,
        abnormal,
      };
    },
    retry: 1,
  });
}

type SortDir = "asc" | "desc";
type SortKey =
  | "send_date"
  | "package_unique_key"
  | "o_id"
  | "shop_name"
  | "warehouse_name"
  | "logistics_company"
  | "tracking_number"
  | "status"
  | "item_qty"
  | "item_count";
const ITEM_SORT_KEYS = new Set<SortKey>(["item_qty", "item_count"]);

function useOutboundList(filters: Filters, page: number, sortKey: SortKey, sortDir: SortDir) {
  return useQuery({
    queryKey: ["warehouse_shipping_packages", filters, page, sortKey, sortDir],
    queryFn: async () => {
      let packageIdsFromSku: string[] | null = null;
      if (filters.sku) {
        const safeSku = filters.sku.replace(/[,()]/g, "");
        const { data, error } = await (supabase as any)
          .from("warehouse_shipping_package_items")
          .select("package_id")
          .or(`sku_id.ilike.%${safeSku}%,sku_code.ilike.%${safeSku}%,style_no.ilike.%${safeSku}%,product_name.ilike.%${safeSku}%`)
          .limit(5000);
        if (error) throw error;
        packageIdsFromSku = Array.from(new Set((data ?? []).map((row) => row.package_id).filter(Boolean)));
        if (!packageIdsFromSku.length) return { rows: [] as PackageRow[], count: 0 };
      }

      const isItemSort = ITEM_SORT_KEYS.has(sortKey);
      const attachAgg = async (rows: PackageRow[]) => {
        const agg = await aggregateItems(rows.map((row) => row.id));
        return rows
          .map((row) => ({
            ...row,
            item_qty: agg[row.id]?.qty ?? 0,
            item_count: agg[row.id]?.count ?? 0,
          }))
          .filter((row) => {
            if (filters.hasItems === "yes" && !row.item_count) return false;
            if (filters.hasItems === "no" && row.item_count) return false;
            if (filters.abnormal === "yes" && row.item_count) return false;
            if (filters.abnormal === "no" && !row.item_count) return false;
            return true;
          });
      };

      if (!isItemSort) {
        let q = (supabase as any).from("warehouse_shipping_packages").select("*", { count: "exact" });
        q = applyFilters(q, filters);
        if (packageIdsFromSku) q = q.in("id", packageIdsFromSku);
        q = q.order(sortKey, { ascending: sortDir === "asc", nullsFirst: false });
        if (sortKey !== "package_unique_key") q = q.order("package_unique_key", { ascending: false, nullsFirst: false });
        q = q.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
        const { data, error, count } = await q;
        if (error) throw error;
        const rows = await attachAgg((data ?? []) as PackageRow[]);
        return { rows, count: count ?? rows.length };
      }

      let qAll = (supabase as any).from("warehouse_shipping_packages").select("*").limit(5000);
      qAll = applyFilters(qAll, filters);
      if (packageIdsFromSku) qAll = qAll.in("id", packageIdsFromSku);
      const { data, error } = await qAll;
      if (error) throw error;
      const rows = await attachAgg((data ?? []) as PackageRow[]);
      rows.sort((a, b) => {
        const va = Number(a[sortKey] ?? 0);
        const vb = Number(b[sortKey] ?? 0);
        if (va === vb) return String(b.package_unique_key ?? "").localeCompare(String(a.package_unique_key ?? ""));
        return sortDir === "asc" ? va - vb : vb - va;
      });
      const start = page * PAGE_SIZE;
      return { rows: rows.slice(start, start + PAGE_SIZE), count: rows.length };
    },
    retry: 1,
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
          active ? "text-foreground font-semibold" : "text-muted-foreground",
        )}
      >
        <span>{children}</span>
        <Icon className={cn("w-3 h-3", active ? "opacity-90" : "opacity-50")} />
      </button>
    </TableHead>
  );
}

function usePackageItems(packageId: string | null) {
  return useQuery({
    queryKey: ["warehouse_shipping_package_items", packageId],
    enabled: !!packageId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("warehouse_shipping_package_items")
        .select("*")
        .eq("package_id", packageId!)
        .order("sku_id", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as PackageItemRow[];
    },
  });
}

function Stat({ label, value, error }: { label: string; value: React.ReactNode; error?: unknown }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={"text-2xl font-semibold mt-1 " + (error ? "text-rose-600 text-base font-normal" : "")}>
          {error ? "读取失败" : value}
        </div>
      </CardContent>
    </Card>
  );
}

export default function OutboundOrdersPage() {
  const [filters, setFilters] = useState<Filters>(defaultFilters());
  const [draft, setDraft] = useState<Filters>(defaultFilters());
  const [page, setPage] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<PackageRow | null>(null);
  const [tab, setTab] = useState<"byPackage" | "byStyle">("byPackage");
  const styleExportRef = useRef<(() => void) | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("send_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const statsQ = useStats();
  const listQ = useOutboundList(filters, page, sortKey, sortDir);
  const itemsQ = usePackageItems(detailId);

  const onSearch = () => { setPage(0); setFilters(draft); };
  const onReset = () => {
    const next = defaultFilters();
    setDraft(next);
    setFilters(next);
    setPage(0);
    setSortKey("send_date");
    setSortDir("desc");
  };

  const onSort = (key: SortKey) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("desc");
      setPage(0);
      return;
    }
    if (sortDir === "desc") {
      setSortDir("asc");
      setPage(0);
      return;
    }
    setSortKey("send_date");
    setSortDir("desc");
    setPage(0);
  };

  const applyQuickRange = (kind: "today" | "7d" | "month" | "all") => {
    const end = todayCN();
    let start = "";
    let endDate = end;
    if (kind === "today") start = end;
    else if (kind === "7d") {
      const d = new Date(`${end}T00:00:00+08:00`);
      d.setUTCDate(d.getUTCDate() - 6);
      start = beijingYMD(d);
    } else if (kind === "month") start = end.slice(0, 8) + "01";
    else endDate = "";
    const next = { ...draft, startDate: start, endDate };
    setDraft(next);
    setFilters(next);
    setPage(0);
  };

  const onExportByPackage = () => {
    const rows = listQ.data?.rows ?? [];
    if (!rows.length) return toast({ title: "无包裹数据可导出" });
    const headers = ["包裹号", "订单号", "店铺", "仓库", "状态", "快递公司", "快递单号", "重量", "发货方式", "SKU件数", "明细行数", "发货日期"];
    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push([
        row.io_id,
        row.o_id ?? "",
        row.shop_name ?? "",
        row.warehouse_name ?? row.wh_id ?? "",
        row.status ?? "",
        row.logistics_company ?? "",
        row.tracking_number ?? "",
        row.weight ?? "",
        row.shipping_method ?? "",
        row.item_qty ?? 0,
        row.item_count ?? 0,
        formatDateTimeCN(row.send_date),
      ].map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `仓库发货包裹_${todayCN()}.csv`;
    a.click();
  };

  const onExportByStyle = () => {
    if (styleExportRef.current) styleExportRef.current();
    else toast({ title: "按款式数据尚未加载" });
  };

  const stats = statsQ.data;
  const totalPages = Math.max(1, Math.ceil((listQ.data?.count ?? 0) / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        breadcrumb={["仓库系统", "出库信息"]}
        title="仓库发货统计"
        description="轻量展示聚水潭出库 API 的实际发货包裹、物流和 SKU 数量；销售主数据以订单 API 为准。"
      />

      <div className="mb-3 rounded-md border border-sky-300 bg-sky-50/60 px-4 py-2.5 text-xs text-sky-800">
        新出库同步只写轻量包裹表和包裹 SKU 明细，不保存 raw JSON，不再继续写旧出库重型表。
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <Stat label="今日发货包裹" value={fmtInt(stats?.todayPackages)} error={statsQ.error} />
        <Stat label="今日发货订单" value={fmtInt(stats?.todayOrders)} error={statsQ.error} />
        <Stat label="今日 SKU 件数" value={fmtInt(stats?.todayQty)} error={statsQ.error} />
        <Stat label="本月发货包裹" value={fmtInt(stats?.monthPackages)} error={statsQ.error} />
        <Stat label="本月 SKU 件数" value={fmtInt(stats?.monthQty)} error={statsQ.error} />
        <Stat label="无明细包裹" value={fmtInt(stats?.abnormal)} error={statsQ.error} />
      </div>

      <Card className="mb-3">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">开始发货日期</label>
              <Input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">结束发货日期</label>
              <Input type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">店铺</label>
              <Input value={draft.shop} onChange={(e) => setDraft({ ...draft, shop: e.target.value })} placeholder="店铺名称" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">仓库</label>
              <Input value={draft.warehouse} onChange={(e) => setDraft({ ...draft, warehouse: e.target.value })} placeholder="仓库名称" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">快递公司</label>
              <Input value={draft.logistics} onChange={(e) => setDraft({ ...draft, logistics: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">包裹号</label>
              <Input value={draft.ioId} onChange={(e) => setDraft({ ...draft, ioId: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">订单号</label>
              <Input value={draft.oId} onChange={(e) => setDraft({ ...draft, oId: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">快递单号</label>
              <Input value={draft.trackingNumber} onChange={(e) => setDraft({ ...draft, trackingNumber: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">SKU / 款号</label>
              <Input value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">包裹状态</label>
              <Select value={draft.status} onValueChange={(value) => setDraft({ ...draft, status: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="Confirmed">已确认</SelectItem>
                  <SelectItem value="Delete">已删除</SelectItem>
                  <SelectItem value="Cancelled">已取消</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">是否有明细</label>
              <Select value={draft.hasItems} onValueChange={(value) => setDraft({ ...draft, hasItems: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="yes">有明细</SelectItem>
                  <SelectItem value="no">无明细</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">是否异常</label>
              <Select value={draft.abnormal} onValueChange={(value) => setDraft({ ...draft, abnormal: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="yes">异常</SelectItem>
                  <SelectItem value="no">正常</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1 items-center">
            <Button size="sm" onClick={onSearch}><Search className="w-4 h-4 mr-1" />查询</Button>
            <Button size="sm" variant="outline" onClick={onReset}>重置</Button>
            <div className="h-5 w-px bg-border mx-1" />
            <span className="text-xs text-muted-foreground">快捷范围：</span>
            <Button size="sm" variant="outline" onClick={() => applyQuickRange("today")}>今天</Button>
            <Button size="sm" variant="outline" onClick={() => applyQuickRange("7d")}>最近 7 天</Button>
            <Button size="sm" variant="outline" onClick={() => applyQuickRange("month")}>本月</Button>
            <Button size="sm" variant="outline" onClick={() => applyQuickRange("all")}>全部</Button>
            <div className="flex-1" />
            <Button size="sm" variant="outline" onClick={onExportByStyle}><Download className="w-4 h-4 mr-1" />按款式导出</Button>
            <Button size="sm" variant="outline" onClick={onExportByPackage}><Download className="w-4 h-4 mr-1" />按包裹导出</Button>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(value) => { setTab(value as "byPackage" | "byStyle"); setPage(0); }}>
        <TabsList>
          <TabsTrigger value="byPackage">按包裹查看</TabsTrigger>
          <TabsTrigger value="byStyle">按款式统计</TabsTrigger>
        </TabsList>

        <TabsContent value="byPackage">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead sortKey="package_unique_key" currentKey={sortKey} dir={sortDir} onSort={onSort}>包裹号</SortHead>
                    <SortHead sortKey="o_id" currentKey={sortKey} dir={sortDir} onSort={onSort}>订单号</SortHead>
                    <SortHead sortKey="shop_name" currentKey={sortKey} dir={sortDir} onSort={onSort}>店铺</SortHead>
                    <SortHead sortKey="warehouse_name" currentKey={sortKey} dir={sortDir} onSort={onSort}>仓库</SortHead>
                    <TableHead>快递公司</TableHead>
                    <SortHead sortKey="tracking_number" currentKey={sortKey} dir={sortDir} onSort={onSort}>快递单号</SortHead>
                    <TableHead className="text-right">重量</TableHead>
                    <TableHead>发货方式</TableHead>
                    <SortHead sortKey="item_qty" currentKey={sortKey} dir={sortDir} onSort={onSort} align="right">SKU 件数</SortHead>
                    <SortHead sortKey="item_count" currentKey={sortKey} dir={sortDir} onSort={onSort} align="right">明细行数</SortHead>
                    <SortHead sortKey="send_date" currentKey={sortKey} dir={sortDir} onSort={onSort}>发货日期</SortHead>
                    <SortHead sortKey="status" currentKey={sortKey} dir={sortDir} onSort={onSort}>状态</SortHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listQ.isLoading && <TableRow><TableCell colSpan={13} className="text-center py-12 text-muted-foreground">加载中...</TableCell></TableRow>}
                  {listQ.error && <TableRow><TableCell colSpan={13} className="text-center py-12 text-rose-600">读取失败：{(listQ.error as Error).message}</TableCell></TableRow>}
                  {!listQ.isLoading && !listQ.error && (listQ.data?.rows.length ?? 0) === 0 && (
                    <TableRow><TableCell colSpan={13} className="text-center py-12 text-muted-foreground">
                      暂无发货包裹数据。请先在 dev/staging 应用轻量表 migration，并运行最近 2 小时测试同步。
                    </TableCell></TableRow>
                  )}
                  {(listQ.data?.rows ?? []).map((row) => {
                    const abnormal = !row.item_count;
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-xs">{row.io_id}</TableCell>
                        <TableCell className="font-mono text-xs">{row.o_id ?? "-"}</TableCell>
                        <TableCell className="text-xs">{row.shop_name || "-"}</TableCell>
                        <TableCell className="text-xs">{row.warehouse_name || row.wh_id || "-"}</TableCell>
                        <TableCell className="text-xs">{row.logistics_company || "-"}</TableCell>
                        <TableCell className="font-mono text-xs">{row.tracking_number || "-"}</TableCell>
                        <TableCell className="text-right">{fmtWeight(row.weight)}</TableCell>
                        <TableCell className="text-xs">{row.shipping_method || "-"}</TableCell>
                        <TableCell className="text-right">{fmtInt(row.item_qty)}</TableCell>
                        <TableCell className="text-right">{fmtInt(row.item_count)}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{formatDateTimeCN(row.send_date, { withSeconds: false })}</TableCell>
                        <TableCell><Badge variant="outline">{zhStatus(row.status)}</Badge></TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => { setDetailId(row.id); setDetailRow(row); }}>详情</Button>
                            {abnormal && <Badge className="bg-rose-100 text-rose-700 text-[10px] px-1.5 py-0">无明细</Badge>}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {(listQ.data?.count ?? 0) > PAGE_SIZE && (
                <div className="flex items-center justify-between p-3 border-t">
                  <div className="text-xs text-muted-foreground">共 {listQ.data?.count} 条 · 第 {page + 1} / {totalPages} 页</div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>上一页</Button>
                    <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage((value) => value + 1)}>下一页</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="byStyle">
          <OutboundByStyleTab filters={filters} exportRef={styleExportRef} />
        </TabsContent>
      </Tabs>

      <Sheet open={!!detailId} onOpenChange={(open) => { if (!open) { setDetailId(null); setDetailRow(null); } }}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>发货包裹详情 · {detailRow?.io_id}</SheetTitle>
            <SheetDescription>轻量包裹信息与 SKU 明细</SheetDescription>
          </SheetHeader>
          {detailRow && (
            <div className="space-y-5 mt-4">
              <section>
                <h3 className="font-medium mb-2">基础信息</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">包裹号：</span>{detailRow.io_id}</div>
                  <div><span className="text-muted-foreground">订单号：</span>{detailRow.o_id ?? "-"}</div>
                  <div><span className="text-muted-foreground">店铺：</span>{detailRow.shop_name || "-"}</div>
                  <div><span className="text-muted-foreground">仓库：</span>{detailRow.warehouse_name || detailRow.wh_id || "-"}</div>
                  <div><span className="text-muted-foreground">状态：</span>{zhStatus(detailRow.status)}</div>
                  <div><span className="text-muted-foreground">快递公司：</span>{detailRow.logistics_company || "-"}</div>
                  <div><span className="text-muted-foreground">快递单号：</span>{detailRow.tracking_number || "-"}</div>
                  <div><span className="text-muted-foreground">重量：</span>{fmtWeight(detailRow.weight)}</div>
                  <div><span className="text-muted-foreground">发货方式：</span>{detailRow.shipping_method || "-"}</div>
                  <div><span className="text-muted-foreground">发货日期：</span>{formatDateTimeCN(detailRow.send_date)}</div>
                  <div><span className="text-muted-foreground">JST 修改时间：</span>{formatDateTimeCN(detailRow.modified_at_jst)}</div>
                  <div><span className="text-muted-foreground">同步时间：</span>{formatDateTimeCN(detailRow.synced_at)}</div>
                </div>
              </section>

              <section>
                <h3 className="font-medium mb-2">SKU 明细</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>款号</TableHead>
                      <TableHead>商品名称</TableHead>
                      <TableHead className="text-right">数量</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itemsQ.isLoading && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">加载中...</TableCell></TableRow>}
                    {!itemsQ.isLoading && (itemsQ.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-rose-600 py-6">该包裹暂无 SKU 明细</TableCell></TableRow>
                    )}
                    {(itemsQ.data ?? []).map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-xs">{item.sku_code || item.sku_id || "-"}</TableCell>
                        <TableCell className="font-mono text-xs">{item.style_no || "-"}</TableCell>
                        <TableCell className="text-xs">{item.product_name || "-"}</TableCell>
                        <TableCell className="text-right">{fmtInt(item.qty)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
