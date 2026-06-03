import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Search, Download, RefreshCw, ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  formatDateTimeCN, beijingDayRangeToUTC, todayCN, beijingYMD,
} from "@/lib/datetime";
import SalesReturnByStyleTab, { SrByStyleFilters } from "@/components/ops/SalesReturnByStyleTab";

const PAGE_SIZE = 20;
const fmtMoney = (n: number | null | undefined) =>
  "¥" + Number(n ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const fmtInt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 });

type Filters = SrByStyleFilters;

function defaultFilters(): Filters {
  const end = todayCN();
  const d = new Date(`${end}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() - 6);
  const start = beijingYMD(d);
  return {
    startDate: start, endDate: end, shop: "", warehouse: "", asNo: "", soNo: "",
    sku: "", status: "all", hasOriginalOrder: "all", hasItems: "all", abnormal: "all", refundNo: "",
  };
}

function applyOrderFilters(q: any, f: Filters) {
  // 业务日期：使用销退入仓时间 received_date（聚水潭 aftersale/received API 返回的入仓完成时间）
  if (f.startDate) { const r = beijingDayRangeToUTC(f.startDate); if (r) q = q.gte("received_date", r.gte); }
  if (f.endDate)   { const r = beijingDayRangeToUTC(f.endDate);   if (r) q = q.lte("received_date", r.lte); }
  if (f.shop) q = q.ilike("shop_name", `%${f.shop}%`);
  if (f.warehouse) q = q.ilike("warehouse", `%${f.warehouse}%`);
  if (f.asNo) q = q.ilike("as_id", `%${f.asNo}%`);
  if (f.soNo) q = q.ilike("so_id", `%${f.soNo}%`);
  if (f.refundNo) q = q.ilike("outer_as_id", `%${f.refundNo}%`);
  if (f.status !== "all") q = q.eq("status", f.status);
  if (f.hasOriginalOrder === "yes") q = q.not("so_id", "is", null);
  if (f.hasOriginalOrder === "no") q = q.or("so_id.is.null,so_id.eq.,so_id.eq.-1");
  return q;
}

function useStats() {
  return useQuery({
    queryKey: ["sr_stats", todayCN()],
    queryFn: async () => {
      const today = todayCN();
      const todayR = beijingDayRangeToUTC(today)!;
      const monthStart = today.slice(0, 8) + "01";
      const monthR = beijingDayRangeToUTC(monthStart)!;

      const [{ data: tOrds }, { data: monthOrds }, { count: pending }] = await Promise.all([
        supabase.from("jst_aftersale_received_orders")
          .select("as_id, status, so_id").gte("received_date", todayR.gte).lte("received_date", todayR.lte).limit(2000),
        supabase.from("jst_aftersale_received_orders")
          .select("as_id, status, so_id").gte("received_date", monthR.gte).limit(5000),
        supabase.from("jst_aftersale_received_orders")
          .select("id", { count: "exact", head: true }).neq("status", "Confirmed"),
      ]);

      const todayAsIds = (tOrds ?? []).map((r: any) => r.as_id);
      const monthAsIds = (monthOrds ?? []).map((r: any) => r.as_id);

      // 取 items 聚合
      const aggQty = async (ids: string[]) => {
        let qty = 0, amt = 0;
        for (let i = 0; i < ids.length; i += 800) {
          const slice = ids.slice(i, i + 800);
          const { data } = await supabase.from("jst_aftersale_received_items")
            .select("qty, amount").in("as_id", slice);
          for (const it of data ?? []) {
            qty += Number((it as any).qty ?? 0);
            amt += Number((it as any).amount ?? 0);
          }
        }
        return { qty, amt };
      };
      const [todayAgg, monthAgg] = await Promise.all([aggQty(todayAsIds), aggQty(monthAsIds)]);

      // 异常：本月主表中无明细 / 无原始订单 / 无状态
      let abnormal = 0;
      if (monthAsIds.length) {
        const haveItems = new Set<string>();
        for (let i = 0; i < monthAsIds.length; i += 800) {
          const slice = monthAsIds.slice(i, i + 800);
          const { data } = await supabase.from("jst_aftersale_received_items")
            .select("as_id").in("as_id", slice);
          for (const it of data ?? []) haveItems.add((it as any).as_id);
        }
        for (const o of monthOrds ?? []) {
          const r = o as any;
          const noOrig = !r.so_id || r.so_id === "" || r.so_id === "-1";
          if (!haveItems.has(r.as_id) || noOrig || !r.status) abnormal++;
        }
      }

      return {
        todayOrders: todayAsIds.length,
        todayQty: todayAgg.qty, todayAmt: todayAgg.amt,
        monthQty: monthAgg.qty, monthAmt: monthAgg.amt,
        pending: pending ?? 0, abnormal,
      };
    },
    retry: 1,
  });
}

type SortDir = "asc" | "desc";
type SortKey = "received_date" | "modified_at_jst" | "as_id" | "status" | "item_qty" | "item_amt" | "abnormal";

function useList(filters: Filters, page: number, sortKey: SortKey, sortDir: SortDir) {
  return useQuery({
    queryKey: ["sr_list", filters, page, sortKey, sortDir],
    queryFn: async () => {
      let needAsIds: string[] | null = null;
      if (filters.sku) {
        const { data } = await supabase.from("jst_aftersale_received_items")
          .select("as_id").ilike("sku_id", `%${filters.sku}%`).limit(2000);
        needAsIds = Array.from(new Set((data ?? []).map((r: any) => r.as_id).filter(Boolean)));
        if (!needAsIds.length) return { rows: [], count: 0 };
      }

      // 取主表（受 hasItems/abnormal 需要全量再算）
      const isComputedSort = sortKey === "item_qty" || sortKey === "item_amt" || sortKey === "abnormal";
      const needAggAll = isComputedSort
        || filters.hasItems !== "all" || filters.abnormal !== "all";

      let q = supabase.from("jst_aftersale_received_orders")
        .select("*", { count: "exact" });
      q = applyOrderFilters(q, filters);
      if (needAsIds) q = q.in("as_id", needAsIds);

      if (!needAggAll) {
        q = q.order(sortKey as any, { ascending: sortDir === "asc", nullsFirst: false });
        q = q.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      } else {
        q = q.limit(5000);
      }
      const { data, error, count } = await q;
      if (error) throw error;

      const asIds = (data ?? []).map((r: any) => r.as_id);
      const agg: Record<string, { qty: number; amt: number; cnt: number; skus: Set<string> }> = {};
      for (let i = 0; i < asIds.length; i += 800) {
        const slice = asIds.slice(i, i + 800);
        const { data: items } = await supabase.from("jst_aftersale_received_items")
          .select("as_id, sku_id, qty, amount").in("as_id", slice);
        for (const it of items ?? []) {
          const k = (it as any).as_id as string;
          const cur = agg[k] ?? { qty: 0, amt: 0, cnt: 0, skus: new Set<string>() };
          cur.qty += Number((it as any).qty ?? 0);
          cur.amt += Number((it as any).amount ?? 0);
          cur.cnt += 1;
          if ((it as any).sku_id) cur.skus.add((it as any).sku_id);
          agg[k] = cur;
        }
      }

      let rows = (data ?? []).map((r: any) => {
        const a = agg[r.as_id] ?? { qty: 0, amt: 0, cnt: 0, skus: new Set() };
        const noOrig = !r.so_id || r.so_id === "" || r.so_id === "-1";
        const abnormal = a.cnt === 0 || noOrig || !r.status;
        return {
          ...r, item_qty: a.qty, item_amt: a.amt, item_count: a.cnt,
          sku_count: a.skus.size, no_origin: noOrig, abnormal,
        };
      });

      if (filters.hasItems === "yes") rows = rows.filter(r => r.item_count > 0);
      if (filters.hasItems === "no") rows = rows.filter(r => r.item_count === 0);
      if (filters.abnormal === "yes") rows = rows.filter(r => r.abnormal);
      if (filters.abnormal === "no") rows = rows.filter(r => !r.abnormal);

      if (needAggAll) {
        rows.sort((a: any, b: any) => {
          if (isComputedSort) {
            const va = sortKey === "abnormal" ? (a.abnormal ? 1 : 0) : Number(a[sortKey] ?? 0);
            const vb = sortKey === "abnormal" ? (b.abnormal ? 1 : 0) : Number(b[sortKey] ?? 0);
            return sortDir === "asc" ? va - vb : vb - va;
          }
          const va = String(a[sortKey] ?? ""); const vb = String(b[sortKey] ?? "");
          return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
        });
        const total = rows.length;
        return { rows: rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE), count: total };
      }
      return { rows, count: count ?? rows.length };
    },
    retry: 1,
  });
}

function SortHead({ k, currentKey, dir, onSort, children, align }: any) {
  const active = k === currentKey;
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button type="button" onClick={() => onSort(k)}
        className={cn("inline-flex items-center gap-1 select-none hover:text-foreground transition cursor-pointer",
          active ? "text-foreground font-semibold" : "text-muted-foreground")}>
        <span>{children}</span><Icon className={cn("w-3 h-3", active ? "opacity-90" : "opacity-50")} />
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

export default function SalesReturnOrdersPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Filters>(defaultFilters());
  const [draft, setDraft] = useState<Filters>(defaultFilters());
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState<"byOrder" | "byStyle">("byStyle");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("received_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const styleExportRef = useRef<((kind: "byStyle" | "byOrder") => void) | null>(null);

  const statsQ = useStats();
  const listQ = useList(filters, page, sortKey, sortDir);

  const onSearch = () => { setPage(0); setFilters(draft); };
  const onReset = () => {
    const d = defaultFilters(); setDraft(d); setFilters(d); setPage(0);
    setSortKey("received_date"); setSortDir("desc");
  };
  const onSort = (k: SortKey) => {
    if (sortKey !== k) { setSortKey(k); setSortDir("desc"); setPage(0); return; }
    if (sortDir === "desc") { setSortDir("asc"); setPage(0); return; }
    setSortKey("received_date"); setSortDir("desc"); setPage(0);
  };

  const applyQuickRange = (kind: "today" | "7d" | "30d" | "month" | "all") => {
    const end = todayCN(); let start = ""; let endDate = end;
    if (kind === "today") start = end;
    else if (kind === "7d") { const d = new Date(`${end}T00:00:00+08:00`); d.setUTCDate(d.getUTCDate() - 6); start = beijingYMD(d); }
    else if (kind === "30d") { const d = new Date(`${end}T00:00:00+08:00`); d.setUTCDate(d.getUTCDate() - 29); start = beijingYMD(d); }
    else if (kind === "month") start = end.slice(0, 8) + "01";
    else { start = ""; endDate = ""; }
    const next = { ...draft, startDate: start, endDate: endDate };
    setDraft(next); setFilters(next); setPage(0);
  };

  const syncMut = useMutation({
    mutationFn: async () => {
      // 默认同步最近 1 天；若用户已筛选日期范围则同步该范围
      const body: any = { manual: true };
      if (filters.startDate && filters.endDate) {
        body.start_time = new Date(`${filters.startDate}T00:00:00+08:00`).toISOString();
        body.end_time = new Date(`${filters.endDate}T23:59:59+08:00`).toISOString();
      } else {
        body.days = 1;
      }
      const { data, error } = await supabase.functions.invoke("jst-sync-aftersale-received", { body });
      if (error) throw new Error(error.message);
      if (data?.ok === false) throw new Error(data?.error ?? "同步失败");
      return data;
    },
    onSuccess: () => {
      toast({ title: "已启动销售退仓同步", description: "后台运行中，稍后会自动刷新" });
      qc.invalidateQueries({ queryKey: ["sr_stats"] });
      qc.invalidateQueries({ queryKey: ["sr_list"] });
      qc.invalidateQueries({ queryKey: ["sr_by_style"] });
    },
    onError: (e: any) => toast({ title: "同步失败", description: e.message, variant: "destructive" }),
  });

  const onExportByOrder = async () => {
    const rows = listQ.data?.rows ?? [];
    if (!rows.length) return toast({ title: "无销退单数据可导出" });
    // 同时拉一遍明细
    const asIds = rows.map((r: any) => r.as_id);
    const items: any[] = [];
    for (let i = 0; i < asIds.length; i += 800) {
      const slice = asIds.slice(i, i + 800);
      const { data } = await supabase.from("jst_aftersale_received_items")
        .select("as_id, sku_id, name, qty, r_qty, amount").in("as_id", slice);
      items.push(...(data ?? []));
    }
    const XLSX = await import("xlsx");
    const ts = new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })
      .replace(/[\/: ]/g, "").slice(0, 12);
    const main = rows.map((r: any) => ({
      "销退单号": r.as_id, "原始订单号": r.so_id ?? "", "售后/退款单号": r.outer_as_id ?? "",
      "店铺": r.shop_name ?? "", "仓库": r.warehouse ?? "", "状态": r.status ?? "",
      "销退件数": r.item_qty, "销退金额": r.item_amt, "SKU 数": r.sku_count,
      "销退时间": formatDateTimeCN(r.received_date, { withSeconds: false }),
      "修改时间": formatDateTimeCN(r.modified_at_jst, { withSeconds: false }),
      "是否无原始订单": r.no_origin ? "是" : "", "是否异常": r.abnormal ? "异常" : "",
    }));
    const detail = items.map(it => ({
      "销退单号": it.as_id, "SKU": it.sku_id ?? "", "商品名称": it.name ?? "",
      "件数": Number(it.qty ?? 0), "退款数": Number(it.r_qty ?? 0), "金额": Number(it.amount ?? 0),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(main), "销退单");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "明细");
    XLSX.writeFile(wb, `销退信息_按销退单号_${ts}.xlsx`);
  };

  const onExportByStyle = () => {
    if (styleExportRef.current) styleExportRef.current("byStyle");
    else toast({ title: "按款式数据尚未加载" });
  };

  const detailRow = useMemo(
    () => (listQ.data?.rows ?? []).find((r: any) => r.id === detailId) ?? null,
    [listQ.data, detailId]
  );
  const itemsQ = useQuery({
    queryKey: ["sr_items", detailRow?.as_id ?? null],
    enabled: !!detailRow,
    queryFn: async () => {
      const { data } = await supabase.from("jst_aftersale_received_items")
        .select("*").eq("as_id", detailRow!.as_id);
      return data ?? [];
    },
  });

  const s = statsQ.data; const err = statsQ.error;

  return (
    <div>
      <PageHeader
        breadcrumb={["仓库系统", "销退信息"]}
        title="销退信息"
        description="展示从聚水潭同步过来的销售退仓数据，支持按退仓日期、店铺、商品、仓库、退仓状态等维度查看顾客退货入仓情况。"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-4">
        <Stat label="今日销退单数" value={fmtInt(s?.todayOrders)} error={err} />
        <Stat label="今日销退件数" value={fmtInt(s?.todayQty)} error={err} />
        <Stat label="今日销退金额" value={fmtMoney(s?.todayAmt)} error={err} />
        <Stat label="本月销退件数" value={fmtInt(s?.monthQty)} error={err} />
        <Stat label="本月销退金额" value={fmtMoney(s?.monthAmt)} error={err} />
        <Stat label="待处理销退单数" value={fmtInt(s?.pending)} error={err} />
        <Stat label="异常销退单数" value={fmtInt(s?.abnormal)} error={err} />
      </div>

      <Card className="mb-3"><CardContent className="p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
          <div><label className="text-xs text-muted-foreground">起始销退日期</label>
            <Input type="date" value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">截止销退日期</label>
            <Input type="date" value={draft.endDate} onChange={e => setDraft({ ...draft, endDate: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">店铺</label>
            <Input value={draft.shop} onChange={e => setDraft({ ...draft, shop: e.target.value })} placeholder="店铺名称" /></div>
          <div><label className="text-xs text-muted-foreground">仓库</label>
            <Input value={draft.warehouse} onChange={e => setDraft({ ...draft, warehouse: e.target.value })} placeholder="仓库名称" /></div>
          <div><label className="text-xs text-muted-foreground">销退单号</label>
            <Input value={draft.asNo} onChange={e => setDraft({ ...draft, asNo: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">原始订单号 / 线上单号</label>
            <Input value={draft.soNo} onChange={e => setDraft({ ...draft, soNo: e.target.value })} /></div>

          <div><label className="text-xs text-muted-foreground">SKU / 商品编码 / 款号</label>
            <Input value={draft.sku} onChange={e => setDraft({ ...draft, sku: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">销退状态</label>
            <Select value={draft.status} onValueChange={v => setDraft({ ...draft, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="Confirmed">已入仓</SelectItem>
                <SelectItem value="WaitConfirm">待确认</SelectItem>
                <SelectItem value="Cancelled">已取消</SelectItem>
              </SelectContent></Select></div>
          <div><label className="text-xs text-muted-foreground">是否无原始订单</label>
            <Select value={draft.hasOriginalOrder} onValueChange={v => setDraft({ ...draft, hasOriginalOrder: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="no">无原始订单</SelectItem>
                <SelectItem value="yes">有原始订单</SelectItem>
              </SelectContent></Select></div>
          <div><label className="text-xs text-muted-foreground">是否有明细</label>
            <Select value={draft.hasItems} onValueChange={v => setDraft({ ...draft, hasItems: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="yes">有明细</SelectItem>
                <SelectItem value="no">无明细</SelectItem>
              </SelectContent></Select></div>
          <div><label className="text-xs text-muted-foreground">是否异常</label>
            <Select value={draft.abnormal} onValueChange={v => setDraft({ ...draft, abnormal: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="yes">异常</SelectItem>
                <SelectItem value="no">正常</SelectItem>
              </SelectContent></Select></div>
          <div><label className="text-xs text-muted-foreground">退款单号 / 售后单号</label>
            <Input value={draft.refundNo} onChange={e => setDraft({ ...draft, refundNo: e.target.value })} /></div>
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
          <Button size="sm" variant="outline" onClick={onExportByStyle}><Download className="w-4 h-4 mr-1" />按款号导出</Button>
          <Button size="sm" variant="outline" onClick={onExportByOrder}><Download className="w-4 h-4 mr-1" />按销退单号导出</Button>
        </div>
        <div className="text-xs text-muted-foreground border-t pt-2">
          当前页面展示聚水潭销售退仓数据，业务日期以销退入仓时间 (received_date) 为准；接口暂未返回金额字段，金额相关列默认显示为 0。如果部分销退单缺少原始订单或商品明细，会被标记为异常。
        </div>
      </CardContent></Card>

      <Tabs value={tab} onValueChange={(v) => { setTab(v as any); setPage(0); }}>
        <TabsList>
          <TabsTrigger value="byStyle">按款式统计</TabsTrigger>
          <TabsTrigger value="byOrder">按销退单查看</TabsTrigger>
        </TabsList>

        <TabsContent value="byStyle">
          <SalesReturnByStyleTab filters={filters} exportRef={styleExportRef} />
        </TabsContent>

        <TabsContent value="byOrder">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead k="as_id" currentKey={sortKey} dir={sortDir} onSort={onSort}>销退单号</SortHead>
                  <TableHead>原始订单号</TableHead>
                  <TableHead>售后/退款单号</TableHead>
                  <TableHead>店铺</TableHead>
                  <TableHead>仓库</TableHead>
                  <SortHead k="status" currentKey={sortKey} dir={sortDir} onSort={onSort}>状态</SortHead>
                  <SortHead k="item_qty" currentKey={sortKey} dir={sortDir} onSort={onSort} align="right">销退件数</SortHead>
                  <SortHead k="item_amt" currentKey={sortKey} dir={sortDir} onSort={onSort} align="right">销退金额</SortHead>
                  <TableHead className="text-right">SKU 数</TableHead>
                  <SortHead k="received_date" currentKey={sortKey} dir={sortDir} onSort={onSort}>销退时间</SortHead>
                  <SortHead k="modified_at_jst" currentKey={sortKey} dir={sortDir} onSort={onSort}>修改时间</SortHead>
                  <SortHead k="abnormal" currentKey={sortKey} dir={sortDir} onSort={onSort}>异常</SortHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQ.isLoading && <TableRow><TableCell colSpan={13} className="text-center py-12 text-muted-foreground">加载中...</TableCell></TableRow>}
                {listQ.error && <TableRow><TableCell colSpan={13} className="text-center py-12 text-rose-600">读取失败：{(listQ.error as any).message}</TableCell></TableRow>}
                {!listQ.isLoading && !listQ.error && (listQ.data?.rows.length ?? 0) === 0 && (
                  <TableRow><TableCell colSpan={13} className="text-center py-12 text-muted-foreground">
                    当前筛选下无销退数据。请前往数据中心同步销售退仓后再查看。
                  </TableCell></TableRow>
                )}
                {(listQ.data?.rows ?? []).map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.as_id}</TableCell>
                    <TableCell className="font-mono text-xs">{r.no_origin ? <span className="text-rose-600">无</span> : r.so_id}</TableCell>
                    <TableCell className="font-mono text-xs">{r.outer_as_id ?? "-"}</TableCell>
                    <TableCell className="text-xs">{r.shop_name ?? "-"}</TableCell>
                    <TableCell className="text-xs">{r.warehouse ?? "-"}</TableCell>
                    <TableCell className="text-xs">{r.status ?? <span className="text-rose-600">空</span>}</TableCell>
                    <TableCell className="text-right">{fmtInt(r.item_qty)}</TableCell>
                    <TableCell className="text-right">{r.item_amt > 0 ? fmtMoney(r.item_amt) : "-"}</TableCell>
                    <TableCell className="text-right">{fmtInt(r.sku_count)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{formatDateTimeCN(r.received_date, { withSeconds: false })}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{formatDateTimeCN(r.modified_at_jst, { withSeconds: false })}</TableCell>
                    <TableCell>{r.abnormal ? <Badge variant="destructive">异常</Badge> : null}</TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={() => setDetailId(r.id)}>详情</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {(listQ.data?.count ?? 0) > PAGE_SIZE && (
              <div className="flex items-center justify-between p-3 border-t">
                <div className="text-xs text-muted-foreground">
                  共 {listQ.data?.count} 条 · 第 {page + 1} / {Math.ceil((listQ.data?.count ?? 0) / PAGE_SIZE)} 页
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</Button>
                  <Button size="sm" variant="outline"
                    disabled={(page + 1) * PAGE_SIZE >= (listQ.data?.count ?? 0)}
                    onClick={() => setPage(p => p + 1)}>下一页</Button>
                </div>
              </div>
            )}
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <Sheet open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>销退单详情 · {detailRow?.as_id}</SheetTitle>
            <SheetDescription>
              {detailRow?.shop_name ?? "-"} · {detailRow?.warehouse ?? "-"} · {detailRow?.status ?? "-"}
            </SheetDescription>
          </SheetHeader>
          {detailRow && (
            <div className="space-y-5 mt-4 text-sm">
              <section>
                <h3 className="font-medium mb-2">A. 基础信息</h3>
                <div className="grid grid-cols-2 gap-y-1">
                  <div><span className="text-muted-foreground">销退单号：</span>{detailRow.as_id}</div>
                  <div><span className="text-muted-foreground">外部售后号：</span>{detailRow.outer_as_id ?? "-"}</div>
                  <div><span className="text-muted-foreground">销退时间：</span>{formatDateTimeCN(detailRow.received_date)}</div>
                  <div><span className="text-muted-foreground">修改时间：</span>{formatDateTimeCN(detailRow.modified_at_jst)}</div>
                  <div><span className="text-muted-foreground">仓库：</span>{detailRow.warehouse ?? "-"}</div>
                  <div><span className="text-muted-foreground">状态：</span>{detailRow.status ?? "-"}</div>
                  <div><span className="text-muted-foreground">物流公司：</span>{detailRow.logistics_company ?? "-"}</div>
                  <div><span className="text-muted-foreground">物流单号：</span>{detailRow.l_id ?? "-"}</div>
                </div>
              </section>
              <section>
                <h3 className="font-medium mb-2">B. 原始订单 / 售后信息</h3>
                <div className="grid grid-cols-2 gap-y-1">
                  <div><span className="text-muted-foreground">原始订单号 (so_id)：</span>
                    {detailRow.no_origin ? <span className="text-rose-600">无原始订单</span> : detailRow.so_id}
                  </div>
                  <div><span className="text-muted-foreground">线上订单号 (o_id)：</span>{detailRow.o_id ?? "-"}</div>
                  <div><span className="text-muted-foreground">店铺：</span>{detailRow.shop_name ?? "-"}</div>
                  <div><span className="text-muted-foreground">店铺 ID：</span>{detailRow.shop_id ?? "-"}</div>
                </div>
              </section>
              <section>
                <h3 className="font-medium mb-2">C. 商品明细</h3>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>SKU</TableHead><TableHead>商品名称</TableHead>
                    <TableHead>规格</TableHead>
                    <TableHead className="text-right">件数</TableHead>
                    <TableHead className="text-right">退款数</TableHead>
                    <TableHead className="text-right">金额</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(itemsQ.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-rose-600 py-4">无明细（异常）</TableCell></TableRow>
                    )}
                    {(itemsQ.data ?? []).map((it: any, i: number) => (
                      <TableRow key={it.id ?? i}>
                        <TableCell className="font-mono text-xs">{it.sku_id ?? "-"}</TableCell>
                        <TableCell className="text-xs max-w-[220px] truncate" title={it.name}>{it.name}</TableCell>
                        <TableCell className="text-xs max-w-[180px] truncate" title={it.properties_value}>{it.properties_value ?? "-"}</TableCell>
                        <TableCell className="text-right">{fmtInt(it.qty)}</TableCell>
                        <TableCell className="text-right">{fmtInt(it.r_qty)}</TableCell>
                        <TableCell className="text-right">{Number(it.amount) > 0 ? fmtMoney(it.amount) : "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
              <section>
                <h3 className="font-medium mb-2">D. 异常判断</h3>
                <ul className="list-disc pl-5 text-xs space-y-1">
                  <li className={detailRow.no_origin ? "text-rose-600" : "text-muted-foreground"}>
                    无原始订单：{detailRow.no_origin ? "是" : "否"}
                  </li>
                  <li className={detailRow.item_count === 0 ? "text-rose-600" : "text-muted-foreground"}>
                    无商品明细：{detailRow.item_count === 0 ? "是" : "否"}
                  </li>
                  <li className={!detailRow.status ? "text-rose-600" : "text-muted-foreground"}>
                    状态为空：{!detailRow.status ? "是" : "否"}
                  </li>
                </ul>
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
