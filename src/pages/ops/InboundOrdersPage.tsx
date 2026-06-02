import { useMemo, useState } from "react";
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
import { Search, Download, Activity, FileJson } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  formatDateCN, formatDateTimeCN, beijingDayRangeToUTC, todayCN, beijingYMD,
} from "@/lib/datetime";
import { InboundSyncJobPanel } from "@/components/ops/InboundSyncJobPanel";

const PAGE_SIZE = 20;
const fmtMoney = (n: number | null | undefined) =>
  "¥" + Number(n ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const fmtInt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 });

type Filters = {
  startDate: string;
  endDate: string;
  supplier: string;
  warehouse: string;
  ioNo: string;
  poNo: string;
  sku: string;
  status: string;
  hasPo: string; // all | yes | no
  hasItems: string; // all | yes | no
  abnormal: string; // all | yes | no
};

function defaultFilters(): Filters {
  const end = todayCN();
  const startDate = new Date(`${end}T00:00:00+08:00`);
  startDate.setUTCDate(startDate.getUTCDate() - 6);
  const start = beijingYMD(startDate);
  return {
    startDate: start, endDate: end, supplier: "", warehouse: "", ioNo: "", poNo: "", sku: "",
    status: "all", hasPo: "all", hasItems: "all", abnormal: "all",
  };
}

function applyFilters(q: any, f: Filters) {
  if (f.startDate) { const r = beijingDayRangeToUTC(f.startDate); if (r) q = q.gte("io_date", r.gte); }
  if (f.endDate)   { const r = beijingDayRangeToUTC(f.endDate);   if (r) q = q.lte("io_date", r.lte); }
  if (f.supplier) q = q.ilike("supplier_name", `%${f.supplier}%`);
  if (f.warehouse) q = q.ilike("warehouse_name", `%${f.warehouse}%`);
  if (f.ioNo) q = q.ilike("external_io_id", `%${f.ioNo}%`);
  if (f.poNo) q = q.ilike("external_po_id", `%${f.poNo}%`);
  if (f.status !== "all") q = q.eq("status", f.status);
  if (f.hasPo === "yes") q = q.not("purchase_order_id", "is", null);
  if (f.hasPo === "no") q = q.is("purchase_order_id", null);
  return q;
}

function useStats() {
  return useQuery({
    queryKey: ["inbound_stats", todayCN()],
    queryFn: async () => {
      const today = todayCN();
      const todayR = beijingDayRangeToUTC(today)!;
      const monthStart = today.slice(0, 8) + "01";
      const monthR = beijingDayRangeToUTC(monthStart)!;

      const [{ data: tRec, error: tErr }, { data: mItems, error: mErr }, { count: pendingC, error: pErr }] = await Promise.all([
        supabase.from("purchase_receipts")
          .select("id, external_io_id, purchase_order_id")
          .gte("io_date", todayR.gte).lte("io_date", todayR.lte),
        supabase.from("purchase_receipt_items")
          .select("received_qty, cost_amount, receipt_id, purchase_receipts!inner(io_date)")
          .gte("purchase_receipts.io_date", monthR.gte),
        supabase.from("purchase_receipts").select("id", { count: "exact", head: true }).is("purchase_order_id", null),
      ]);
      if (tErr || mErr || pErr) throw (tErr ?? mErr ?? pErr);

      const todayRows = tRec ?? [];
      const todayIoIds = new Set(todayRows.map((r: any) => r.external_io_id));
      const monthAll = mItems ?? [];
      const todayItems = monthAll.filter((r: any) => {
        const ymd = beijingYMD(r.purchase_receipts?.io_date);
        return ymd === today;
      });
      const todayQty = todayItems.reduce((s, r: any) => s + Number(r.received_qty ?? 0), 0);
      const todayAmt = todayItems.reduce((s, r: any) => s + Number(r.cost_amount ?? 0), 0);
      const monthQty = monthAll.reduce((s, r: any) => s + Number(r.received_qty ?? 0), 0);
      const monthAmt = monthAll.reduce((s, r: any) => s + Number(r.cost_amount ?? 0), 0);

      // 异常 = 本月主表中 没有任何明细的入库单
      const monthReceiptIdsWithItems = new Set(monthAll.map((r: any) => r.receipt_id));
      const { data: monthRecs } = await supabase.from("purchase_receipts")
        .select("id").gte("io_date", monthR.gte).limit(2000);
      const abnormal = (monthRecs ?? []).filter((r: any) => !monthReceiptIdsWithItems.has(r.id)).length;

      return {
        todayOrders: todayIoIds.size,
        todayQty, todayAmt, monthQty, monthAmt,
        pending: pendingC ?? 0,
        abnormal,
      };
    },
    retry: 1,
  });
}

function useInboundList(filters: Filters, page: number) {
  return useQuery({
    queryKey: ["inbound_list", filters, page],
    queryFn: async () => {
      let needItemIds: string[] | null = null;
      if (filters.sku) {
        const { data: it, error } = await supabase
          .from("purchase_receipt_items")
          .select("receipt_id").ilike("sku_no", `%${filters.sku}%`).limit(2000);
        if (error) throw error;
        needItemIds = Array.from(new Set((it ?? []).map((r: any) => r.receipt_id).filter(Boolean)));
        if (needItemIds.length === 0) return { rows: [], count: 0 };
      }
      let q = supabase.from("purchase_receipts").select("*", { count: "exact" });
      q = applyFilters(q, filters);
      if (needItemIds) q = q.in("id", needItemIds);
      q = q.order("io_date", { ascending: false, nullsFirst: false })
           .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      const ids = (data ?? []).map((r: any) => r.id);
      let itemAgg: Record<string, { qty: number; amt: number; count: number }> = {};
      if (ids.length) {
        const { data: items } = await supabase.from("purchase_receipt_items")
          .select("receipt_id, received_qty, cost_amount").in("receipt_id", ids);
        for (const it of items ?? []) {
          const k = (it as any).receipt_id as string;
          const cur = itemAgg[k] ?? { qty: 0, amt: 0, count: 0 };
          cur.qty += Number((it as any).received_qty ?? 0);
          cur.amt += Number((it as any).cost_amount ?? 0);
          cur.count += 1;
          itemAgg[k] = cur;
        }
      }
      let rows = (data ?? []).map((r: any) => ({
        ...r,
        item_qty: itemAgg[r.id]?.qty ?? 0,
        item_amt: itemAgg[r.id]?.amt ?? 0,
        item_count: itemAgg[r.id]?.count ?? 0,
      }));
      if (filters.hasItems === "yes") rows = rows.filter((r: any) => r.item_count > 0);
      if (filters.hasItems === "no") rows = rows.filter((r: any) => r.item_count === 0);
      if (filters.abnormal === "yes") rows = rows.filter((r: any) => r.item_count === 0);
      if (filters.abnormal === "no") rows = rows.filter((r: any) => r.item_count > 0);
      return { rows, count: count ?? rows.length };
    },
    retry: 1,
  });
}

function useReceiptItems(receiptId: string | null) {
  return useQuery({
    queryKey: ["inbound_items", receiptId],
    enabled: !!receiptId,
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_receipt_items")
        .select("*").eq("receipt_id", receiptId!).order("sku_no");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function usePoCompare(poId: string | null, currentReceiptId: string | null) {
  return useQuery({
    queryKey: ["inbound_po_compare", poId, currentReceiptId],
    enabled: !!poId,
    queryFn: async () => {
      const [{ data: po }, { data: curItems }] = await Promise.all([
        supabase.from("purchase_orders")
          .select("total_purchase_qty, total_received_qty, total_unreceived_qty, external_po_id")
          .eq("id", poId!).maybeSingle(),
        supabase.from("purchase_receipt_items")
          .select("received_qty").eq("receipt_id", currentReceiptId!),
      ]);
      const thisTime = (curItems ?? []).reduce((s, r: any) => s + Number(r.received_qty ?? 0), 0);
      const purchase = Number(po?.total_purchase_qty ?? 0);
      const received = Number(po?.total_received_qty ?? 0);
      const unrec = Number(po?.total_unreceived_qty ?? 0);
      return {
        po, thisTime, purchase, received, unrec,
        progress: purchase > 0 ? Math.round((received / purchase) * 100) : 0,
        over: received > purchase,
        short: received < purchase && unrec > 0,
      };
    },
  });
}

function useDiagnostics() {
  return useQuery({
    queryKey: ["inbound_diag"],
    queryFn: async () => {
      const [latest, weekRecs, weekItems, lastSyncRes, missingItemsRes, noPoRes] = await Promise.all([
        supabase.from("purchase_receipts").select("io_date, jst_modified_at, updated_at")
          .order("io_date", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
        supabase.from("purchase_receipts").select("id", { count: "exact", head: true })
          .gte("io_date", new Date(Date.now() - 7 * 86400_000).toISOString()),
        supabase.from("purchase_receipt_items").select("id", { count: "exact", head: true })
          .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString()),
        supabase.from("jst_sync_logs").select("*")
          .eq("sync_type", "purchase_inbound_orders")
          .order("started_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("purchase_receipts").select("id, external_io_id")
          .gte("io_date", new Date(Date.now() - 30 * 86400_000).toISOString()).limit(500),
        supabase.from("purchase_receipts").select("id", { count: "exact", head: true })
          .is("purchase_order_id", null),
      ]);
      const recIds = (missingItemsRes.data ?? []).map((r: any) => r.id);
      let mainNoItems = 0;
      if (recIds.length) {
        const { data: itemsForRecs } = await supabase.from("purchase_receipt_items")
          .select("receipt_id").in("receipt_id", recIds);
        const haveItems = new Set((itemsForRecs ?? []).map((r: any) => r.receipt_id));
        mainNoItems = recIds.filter(id => !haveItems.has(id)).length;
      }
      return {
        latest: latest.data,
        weekRecs: weekRecs.count ?? 0,
        weekItems: weekItems.count ?? 0,
        lastSync: lastSyncRes.data,
        mainNoItems,
        noPoCount: noPoRes.count ?? 0,
      };
    },
    retry: 0,
  });
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

export default function InboundOrdersPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Filters>(defaultFilters());
  const [draft, setDraft] = useState<Filters>(defaultFilters());
  const [page, setPage] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<any | null>(null);
  const [rawOpen, setRawOpen] = useState<any | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);

  const statsQ = useStats();
  const listQ = useInboundList(filters, page);
  const itemsQ = useReceiptItems(detailId);
  const compareQ = usePoCompare(detailRow?.purchase_order_id ?? null, detailId);
  const diagQ = useQuery({
    queryKey: ["inbound_diag_wrap", diagOpen],
    enabled: diagOpen,
    queryFn: async () => null,
  });
  const diag = useDiagnostics();

  // ===== 断点续跑任务由 InboundSyncJobPanel 统一管理 =====



  const onSearch = () => { setPage(0); setFilters(draft); };
  const onReset = () => { const d = defaultFilters(); setDraft(d); setFilters(d); setPage(0); };

  const onExport = () => {
    const rows = listQ.data?.rows ?? [];
    if (!rows.length) return toast({ title: "无数据可导出" });
    const headers = ["入库日期", "入库单号", "JST入库ID", "采购单号", "供应商", "仓库", "状态", "入库件数", "入库金额", "明细行数", "JST修改时间"];
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push([
        formatDateCN(r.io_date), r.external_io_id, r.external_io_id, r.external_po_id ?? "",
        r.supplier_name ?? "", r.warehouse_name ?? "", r.status ?? "",
        r.item_qty, r.item_amt.toFixed(2), r.item_count, formatDateTimeCN(r.jst_modified_at),
      ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `入库单_${todayCN()}.csv`;
    a.click();
  };

  const s = statsQ.data;
  const err = statsQ.error;

  return (
    <div>
      <PageHeader
        breadcrumb={["仓库系统", "入库单"]}
        title="入库单"
        description="展示从聚水潭同步过来的采购入库单数据，用于查看仓库实际入库、核对采购单到货进度、核对供应商应付款。"
        actions={
          <Button size="sm" variant="outline" onClick={() => setDiagOpen(true)}>
            <Activity className="w-4 h-4 mr-1" /> 同步诊断
          </Button>
        }
      />

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-4">
        <Stat label="今日入库单数" value={fmtInt(s?.todayOrders)} error={err} />
        <Stat label="今日入库件数" value={fmtInt(s?.todayQty)} error={err} />
        <Stat label="今日入库金额" value={fmtMoney(s?.todayAmt)} error={err} />
        <Stat label="本月入库件数" value={fmtInt(s?.monthQty)} error={err} />
        <Stat label="本月入库金额" value={fmtMoney(s?.monthAmt)} error={err} />
        <Stat label="待核对（无采购单）" value={fmtInt(s?.pending)} error={err} />
        <Stat label="异常入库单（无明细）" value={fmtInt(s?.abnormal)} error={err} />
      </div>

      {/* 筛选 */}
      <Card className="mb-3"><CardContent className="p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
          <div><label className="text-xs text-muted-foreground">起始入库日期</label>
            <Input type="date" value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">截止入库日期</label>
            <Input type="date" value={draft.endDate} onChange={e => setDraft({ ...draft, endDate: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">供应商</label>
            <Input value={draft.supplier} onChange={e => setDraft({ ...draft, supplier: e.target.value })} placeholder="供应商名称" /></div>
          <div><label className="text-xs text-muted-foreground">仓库</label>
            <Input value={draft.warehouse} onChange={e => setDraft({ ...draft, warehouse: e.target.value })} placeholder="仓库名称" /></div>
          <div><label className="text-xs text-muted-foreground">入库单号</label>
            <Input value={draft.ioNo} onChange={e => setDraft({ ...draft, ioNo: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">采购单号</label>
            <Input value={draft.poNo} onChange={e => setDraft({ ...draft, poNo: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">SKU / 商品编码</label>
            <Input value={draft.sku} onChange={e => setDraft({ ...draft, sku: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground">入库状态</label>
            <Select value={draft.status} onValueChange={v => setDraft({ ...draft, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="Confirmed">已确认</SelectItem>
                <SelectItem value="WaitConfirm">待确认</SelectItem>
                <SelectItem value="Cancelled">已取消</SelectItem>
              </SelectContent></Select></div>
          <div><label className="text-xs text-muted-foreground">是否关联采购单</label>
            <Select value={draft.hasPo} onValueChange={v => setDraft({ ...draft, hasPo: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="yes">已关联</SelectItem>
                <SelectItem value="no">未关联</SelectItem>
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
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={onSearch}><Search className="w-4 h-4 mr-1" />查询</Button>
          <Button size="sm" variant="outline" onClick={onReset}>重置</Button>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={onExport}><Download className="w-4 h-4 mr-1" />导出</Button>
        </div>
      </CardContent></Card>

      {/* 入库同步任务面板（与数据中心共用同一组件） */}
      <div className="mb-3">
        <InboundSyncJobPanel
          onJobFinished={() => {
            qc.invalidateQueries({ queryKey: ["inbound_list"] });
            qc.invalidateQueries({ queryKey: ["inbound_stats"] });
            qc.invalidateQueries({ queryKey: ["inbound_diag"] });
          }}
        />
      </div>



      {/* 列表 */}
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>入库日期</TableHead>
              <TableHead>入库单号</TableHead>
              <TableHead>采购单号</TableHead>
              <TableHead>供应商</TableHead>
              <TableHead>仓库</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">入库件数</TableHead>
              <TableHead className="text-right">入库金额</TableHead>
              <TableHead className="text-right">明细行数</TableHead>
              <TableHead>JST 修改时间</TableHead>
              <TableHead>同步时间</TableHead>
              <TableHead>异常</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQ.isLoading && <TableRow><TableCell colSpan={13} className="text-center py-12 text-muted-foreground">加载中...</TableCell></TableRow>}
            {listQ.error && <TableRow><TableCell colSpan={13} className="text-center py-12 text-rose-600">读取失败：{(listQ.error as any).message}</TableCell></TableRow>}
            {!listQ.isLoading && !listQ.error && (listQ.data?.rows.length ?? 0) === 0 && (
              <TableRow><TableCell colSpan={13} className="text-center py-12 text-muted-foreground">
                暂无入库单。如聚水潭已有今日入库,请点击「同步最近 1 天」,然后打开「同步诊断」确认 API 返回数与数据库写入数。
              </TableCell></TableRow>
            )}
            {(listQ.data?.rows ?? []).map((r: any) => {
              const abnormal = r.item_count === 0;
              return (
                <TableRow key={r.id}>
                  <TableCell>{formatDateCN(r.io_date)}</TableCell>
                  <TableCell className="font-mono text-xs">{r.external_io_id}</TableCell>
                  <TableCell className="font-mono text-xs">{r.external_po_id ?? "-"}</TableCell>
                  <TableCell>{r.supplier_name || "-"}</TableCell>
                  <TableCell className="text-xs">{r.warehouse_name || "-"}</TableCell>
                  <TableCell><Badge variant="outline">{r.status || "-"}</Badge></TableCell>
                  <TableCell className="text-right">{fmtInt(r.item_qty)}</TableCell>
                  <TableCell className="text-right">{r.item_amt > 0 ? fmtMoney(r.item_amt) : "-"}</TableCell>
                  <TableCell className="text-right">{fmtInt(r.item_count)}</TableCell>
                  <TableCell className="text-xs">{formatDateTimeCN(r.jst_modified_at)}</TableCell>
                  <TableCell className="text-xs">{formatDateTimeCN(r.updated_at)}</TableCell>
                  <TableCell>{abnormal ? <Badge className="bg-rose-100 text-rose-700">无明细</Badge> : null}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setDetailId(r.id); setDetailRow(r); }}>详情</Button>
                      <Button size="sm" variant="ghost" onClick={() => setRawOpen(r)}><FileJson className="w-3 h-3" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
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
      <Sheet open={!!detailId} onOpenChange={(o) => { if (!o) { setDetailId(null); setDetailRow(null); } }}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>入库单详情 · {detailRow?.external_io_id}</SheetTitle>
            <SheetDescription>聚水潭入库单及明细，与采购单进度对比</SheetDescription>
          </SheetHeader>
          {detailRow && (
            <div className="space-y-5 mt-4">
              <section>
                <h3 className="font-medium mb-2">A. 基础信息</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">入库单号：</span>{detailRow.external_io_id}</div>
                  <div><span className="text-muted-foreground">JST 入库 ID：</span>{detailRow.external_io_id}</div>
                  <div><span className="text-muted-foreground">入库日期：</span>{formatDateTimeCN(detailRow.io_date)}</div>
                  <div><span className="text-muted-foreground">供应商：</span>{detailRow.supplier_name || "-"}</div>
                  <div><span className="text-muted-foreground">仓库：</span>{detailRow.warehouse_name || "-"}</div>
                  <div><span className="text-muted-foreground">状态：</span>{detailRow.status || "-"}</div>
                  <div><span className="text-muted-foreground">采购单号：</span>{detailRow.external_po_id ?? "-"}</div>
                  <div><span className="text-muted-foreground">JST 修改时间：</span>{formatDateTimeCN(detailRow.jst_modified_at)}</div>
                  <div><span className="text-muted-foreground">创建时间：</span>{formatDateTimeCN(detailRow.created_at)}</div>
                  <div><span className="text-muted-foreground">同步时间：</span>{formatDateTimeCN(detailRow.updated_at)}</div>
                </div>
              </section>

              <section>
                <h3 className="font-medium mb-2">B. 入库明细</h3>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>SKU</TableHead><TableHead>商品名</TableHead>
                    <TableHead className="text-right">数量</TableHead>
                    <TableHead className="text-right">单价</TableHead>
                    <TableHead className="text-right">金额</TableHead>
                    <TableHead>采购单号</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {itemsQ.isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">加载中...</TableCell></TableRow>}
                    {!itemsQ.isLoading && (itemsQ.data ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-rose-600 py-6">该入库单暂无明细 — 可能聚水潭未返回 items 字段或写入失败</TableCell></TableRow>}
                    {(itemsQ.data ?? []).map((it: any) => (
                      <TableRow key={it.id}>
                        <TableCell className="font-mono text-xs">{it.sku_no}</TableCell>
                        <TableCell className="text-xs">{it.product_name || "-"}</TableCell>
                        <TableCell className="text-right">{fmtInt(it.received_qty)}</TableCell>
                        <TableCell className="text-right">{it.cost_price > 0 ? fmtMoney(it.cost_price) : "-"}</TableCell>
                        <TableCell className="text-right">{it.cost_amount > 0 ? fmtMoney(it.cost_amount) : "-"}</TableCell>
                        <TableCell className="font-mono text-xs">{it.external_po_id ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>

              <section>
                <h3 className="font-medium mb-2">C. 与采购单对比</h3>
                {!detailRow.purchase_order_id && <div className="text-sm text-muted-foreground">该入库单未关联采购单</div>}
                {detailRow.purchase_order_id && compareQ.data && (
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-muted-foreground">采购数量：</span>{fmtInt(compareQ.data.purchase)}</div>
                    <div><span className="text-muted-foreground">累计已入库：</span>{fmtInt(compareQ.data.received)}</div>
                    <div><span className="text-muted-foreground">本次入库：</span>{fmtInt(compareQ.data.thisTime)}</div>
                    <div><span className="text-muted-foreground">未入库：</span>{fmtInt(compareQ.data.unrec)}</div>
                    <div><span className="text-muted-foreground">入库进度：</span>{compareQ.data.progress}%</div>
                    <div>{compareQ.data.over && <Badge className="bg-amber-100 text-amber-700">超收</Badge>}
                         {compareQ.data.short && <Badge className="bg-slate-100 text-slate-700 ml-1">少收</Badge>}</div>
                  </div>
                )}
              </section>

              <section>
                <h3 className="font-medium mb-2">D. 原始 JSON</h3>
                <pre className="bg-muted p-3 rounded text-[11px] overflow-auto max-h-80">{JSON.stringify(detailRow.raw, null, 2)}</pre>
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* 原始 JSON 抽屉 */}
      <Sheet open={!!rawOpen} onOpenChange={(o) => !o && setRawOpen(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader><SheetTitle>原始 JSON</SheetTitle><SheetDescription>聚水潭 API 返回的完整字段</SheetDescription></SheetHeader>
          <pre className="bg-muted p-3 rounded text-[11px] overflow-auto mt-4">{JSON.stringify(rawOpen?.raw, null, 2)}</pre>
        </SheetContent>
      </Sheet>

      {/* 同步诊断抽屉 */}
      <Sheet open={diagOpen} onOpenChange={setDiagOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader><SheetTitle>同步诊断</SheetTitle>
            <SheetDescription>排查「为什么页面没数据」</SheetDescription></SheetHeader>
          {diag.isLoading && <div className="mt-4 text-muted-foreground">加载中...</div>}
          {diag.error && <div className="mt-4 text-rose-600">读取失败：{(diag.error as any).message}</div>}
          {diag.data && (
            <div className="mt-4 space-y-4 text-sm">
              <section>
                <h3 className="font-medium mb-2">数据库当前状态</h3>
                <div className="grid grid-cols-2 gap-y-1">
                  <div className="text-muted-foreground">最新入库单 io_date</div><div>{formatDateTimeCN(diag.data.latest?.io_date) || "无数据"}</div>
                  <div className="text-muted-foreground">最新 JST 修改时间</div><div>{formatDateTimeCN(diag.data.latest?.jst_modified_at) || "-"}</div>
                  <div className="text-muted-foreground">最近 7 天主表数</div><div>{fmtInt(diag.data.weekRecs)}</div>
                  <div className="text-muted-foreground">最近 7 天明细数</div><div>{fmtInt(diag.data.weekItems)}</div>
                  <div className="text-muted-foreground">主表有但无明细</div><div className={diag.data.mainNoItems > 0 ? "text-rose-600" : ""}>{fmtInt(diag.data.mainNoItems)}</div>
                  <div className="text-muted-foreground">未关联采购单</div><div>{fmtInt(diag.data.noPoCount)}</div>
                </div>
              </section>
              <section>
                <h3 className="font-medium mb-2">最近一次入库单同步</h3>
                {!diag.data.lastSync && <div className="text-muted-foreground">尚未同步过</div>}
                {diag.data.lastSync && (
                  <div className="grid grid-cols-[140px_1fr] gap-y-1">
                    <div className="text-muted-foreground">批次 ID</div><div className="font-mono text-xs break-all">{diag.data.lastSync.id}</div>
                    <div className="text-muted-foreground">状态</div>
                    <div>
                      <Badge className={
                        diag.data.lastSync.status === "success" ? "bg-emerald-100 text-emerald-700" :
                        diag.data.lastSync.status === "running" ? "bg-blue-100 text-blue-700" :
                        "bg-rose-100 text-rose-700"
                      }>{diag.data.lastSync.status}</Badge>
                    </div>
                    <div className="text-muted-foreground">开始</div><div>{formatDateTimeCN(diag.data.lastSync.started_at)}</div>
                    <div className="text-muted-foreground">结束</div><div>{formatDateTimeCN(diag.data.lastSync.ended_at)}</div>
                    <div className="text-muted-foreground">请求范围</div><div className="text-xs">{formatDateTimeCN(diag.data.lastSync.cursor_from)} → {formatDateTimeCN(diag.data.lastSync.cursor_to)}</div>
                    <div className="text-muted-foreground">主表写入</div><div>{fmtInt(diag.data.lastSync.fetched_receipts_count ?? diag.data.lastSync.fetched_orders_count)}</div>
                    <div className="text-muted-foreground">明细写入</div><div>{fmtInt(diag.data.lastSync.fetched_items_count)}</div>
                    <div className="text-muted-foreground col-span-2 mt-2">详细 message</div>
                    <div className="col-span-2 bg-muted p-2 rounded text-xs whitespace-pre-wrap break-all">{diag.data.lastSync.message}</div>
                    {diag.data.lastSync.error_detail && <>
                      <div className="text-muted-foreground col-span-2 mt-2">错误详情</div>
                      <div className="col-span-2 bg-rose-50 text-rose-800 p-2 rounded text-xs whitespace-pre-wrap break-all">{diag.data.lastSync.error_detail}</div>
                    </>}
                  </div>
                )}
              </section>
              <section className="text-xs text-muted-foreground border-t pt-3">
                判断指引：
                <ul className="list-disc pl-5 mt-1 space-y-1">
                  <li>若 message 中 API返回=0 → 聚水潭这段时间没有入库单，或筛选窗口算错（注意北京时间）</li>
                  <li>若 API返回 &gt; 0 但主表upsert=0 → 写入失败，检查 error_detail</li>
                  <li>若主表数 &gt; 0 但页面看不到 → 列表筛选条件遮挡，请「重置」</li>
                  <li>若「主表有但无明细」&gt; 0 → 聚水潭返回的 items 数组为空或写入失败</li>
                </ul>
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
