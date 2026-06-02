import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ShoppingCart, Warehouse, AlertTriangle, PackageX, Search, Eye, Loader2, Inbox,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { formatDateCN, formatDateTimeCN, beijingYMD, beijingDayRangeToUTC } from "@/lib/datetime";

// ============ Helpers ============
const fmtInt = (n?: number | null) => Number(n ?? 0).toLocaleString("zh-CN");
const fmtMoney = (n?: number | null) =>
  "¥" + Number(n ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type RangeKey = "today" | "month" | "30d" | "year" | "custom";

function computeRange(key: RangeKey, customStart?: string, customEnd?: string): { startYmd: string; endYmd: string } {
  const todayYmd = beijingYMD(new Date());
  const today = new Date(todayYmd + "T00:00:00+08:00");
  const y = today.getFullYear();
  const m = today.getMonth();
  const fmt = (d: Date) => beijingYMD(d);
  if (key === "today") return { startYmd: todayYmd, endYmd: todayYmd };
  if (key === "month") return { startYmd: fmt(new Date(y, m, 1)), endYmd: todayYmd };
  if (key === "30d") {
    const s = new Date(today); s.setDate(s.getDate() - 29);
    return { startYmd: fmt(s), endYmd: todayYmd };
  }
  if (key === "year") return { startYmd: fmt(new Date(y, 0, 1)), endYmd: todayYmd };
  return { startYmd: customStart ?? todayYmd, endYmd: customEnd ?? todayYmd };
}

function ymdToUTCRange(startYmd: string, endYmd: string) {
  const s = beijingDayRangeToUTC(startYmd);
  const e = beijingDayRangeToUTC(endYmd);
  return { gte: s?.gte ?? null, lte: e?.lte ?? null };
}

// ============ Queries ============
const EXCLUDED_STATUSES = ["Delete", "delete", "deleted"];
const EXCLUDED_IN = `(${EXCLUDED_STATUSES.join(",")})`;

function usePurchaseStats(startYmd: string, endYmd: string) {
  return useQuery({
    queryKey: ["dash_purchase_stats", startYmd, endYmd],
    queryFn: async () => {
      const { gte, lte } = ymdToUTCRange(startYmd, endYmd);
      let q = supabase.from("purchase_orders")
        .select("total_purchase_qty,total_amount,status", { count: "exact" })
        .not("status", "in", EXCLUDED_IN)
        .limit(10000);
      if (gte) q = q.gte("po_date", gte);
      if (lte) q = q.lte("po_date", lte);
      const { data, error } = await q;
      if (error) throw error;
      let qty = 0, amt = 0;
      for (const r of data ?? []) {
        qty += Number((r as any).total_purchase_qty ?? 0);
        amt += Number((r as any).total_amount ?? 0);
      }
      return { qty, amt, orderCount: data?.length ?? 0 };
    },
    staleTime: 60_000,
  });
}

function useInboundStats(startYmd: string, endYmd: string) {
  return useQuery({
    queryKey: ["dash_inbound_stats", startYmd, endYmd],
    queryFn: async () => {
      const { gte, lte } = ymdToUTCRange(startYmd, endYmd);
      // 拉入库主表 id 集合 → 拉明细
      let rq = supabase.from("purchase_receipts").select("id").limit(10000);
      if (gte) rq = rq.gte("io_date", gte);
      if (lte) rq = rq.lte("io_date", lte);
      const { data: receipts, error: rErr } = await rq;
      if (rErr) throw rErr;
      const ids = (receipts ?? []).map((r: any) => r.id);
      if (ids.length === 0) return { qty: 0, amt: 0 };
      let qty = 0, amt = 0;
      for (let i = 0; i < ids.length; i += 500) {
        const slice = ids.slice(i, i + 500);
        const { data, error } = await supabase
          .from("purchase_receipt_items")
          .select("received_qty,cost_amount")
          .in("receipt_id", slice);
        if (error) throw error;
        for (const it of data ?? []) {
          qty += Number((it as any).received_qty ?? 0);
          amt += Number((it as any).cost_amount ?? 0);
        }
      }
      return { qty, amt };
    },
    staleTime: 60_000,
  });
}

function useOverdueStats() {
  // 全局：当前未完全入库且协议到货日期 < 今天
  return useQuery({
    queryKey: ["dash_overdue_stats"],
    queryFn: async () => {
      const todayYmd = beijingYMD(new Date());
      const todayUtc = beijingDayRangeToUTC(todayYmd)!.gte;
      const { data, error } = await supabase
        .from("purchase_order_items")
        .select("unreceived_qty,unit_price,delivery_date,purchase_orders!inner(status)")
        .gt("unreceived_qty", 0)
        .not("delivery_date", "is", null)
        .lt("delivery_date", todayUtc)
        .not("purchase_orders.status", "in", EXCLUDED_IN)
        .limit(5000);
      if (error) throw error;
      let qty = 0, amt = 0;
      for (const r of data ?? []) {
        const u = Number((r as any).unreceived_qty ?? 0);
        qty += u;
        amt += u * Number((r as any).unit_price ?? 0);
      }
      return { qty, amt };
    },
    staleTime: 60_000,
  });
}

interface TimelineItem {
  delivery_ymd: string;
  style_no: string;
  product_name: string;
  unreceived_qty: number;
}
function useTimeline(dayBefore: number, dayAfter: number) {
  return useQuery({
    queryKey: ["dash_timeline", dayBefore, dayAfter],
    queryFn: async (): Promise<TimelineItem[]> => {
      const todayYmd = beijingYMD(new Date());
      const today = new Date(todayYmd + "T00:00:00+08:00");
      const start = new Date(today); start.setDate(start.getDate() - dayBefore);
      const end = new Date(today); end.setDate(end.getDate() + dayAfter);
      const gte = beijingDayRangeToUTC(beijingYMD(start))!.gte;
      const lte = beijingDayRangeToUTC(beijingYMD(end))!.lte;
      const { data, error } = await supabase
        .from("purchase_order_items")
        .select("style_no,product_name,unreceived_qty,delivery_date,purchase_orders!inner(status)")
        .gt("unreceived_qty", 0)
        .gte("delivery_date", gte).lte("delivery_date", lte)
        .not("purchase_orders.status", "in", EXCLUDED_IN)
        .limit(5000);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        delivery_ymd: beijingYMD(r.delivery_date),
        style_no: r.style_no || "(无款号)",
        product_name: r.product_name ?? "",
        unreceived_qty: Number(r.unreceived_qty ?? 0),
      }));
    },
    staleTime: 60_000,
  });
}

interface PendingRow {
  id: string;
  style_no: string;
  sku_no: string;
  product_name: string;
  product_image_url: string | null;
  purchase_qty: number;
  received_qty: number;
  unreceived_qty: number;
  amount: number;
  unit_price: number;
  delivery_date: string | null;
  external_po_id: string;
  supplier_name: string;
  po_status: string;
  po_date: string | null;
}
function usePendingItems(startYmd: string, endYmd: string, dayFilterYmd?: string) {
  return useQuery({
    queryKey: ["dash_pending", startYmd, endYmd, dayFilterYmd],
    queryFn: async (): Promise<PendingRow[]> => {
      const { gte, lte } = ymdToUTCRange(startYmd, endYmd);
      let q = supabase.from("purchase_order_items")
        .select(`
          id,style_no,sku_no,product_name,product_image_url,
          purchase_qty,received_qty,unreceived_qty,amount,unit_price,delivery_date,external_po_id,
          purchase_orders!inner(supplier_name,status,po_date)
        `)
        .gt("unreceived_qty", 0)
        .not("purchase_orders.status", "in", EXCLUDED_IN)
        .limit(5000);
      if (gte) q = q.gte("purchase_orders.po_date", gte);
      if (lte) q = q.lte("purchase_orders.po_date", lte);
      if (dayFilterYmd) {
        const d = beijingDayRangeToUTC(dayFilterYmd);
        if (d) q = q.gte("delivery_date", d.gte).lte("delivery_date", d.lte);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        style_no: r.style_no ?? "",
        sku_no: r.sku_no ?? "",
        product_name: r.product_name ?? "",
        product_image_url: r.product_image_url ?? null,
        purchase_qty: Number(r.purchase_qty ?? 0),
        received_qty: Number(r.received_qty ?? 0),
        unreceived_qty: Number(r.unreceived_qty ?? 0),
        amount: Number(r.amount ?? 0),
        unit_price: Number(r.unit_price ?? 0),
        delivery_date: r.delivery_date,
        external_po_id: r.external_po_id ?? "",
        supplier_name: r.purchase_orders?.supplier_name ?? "",
        po_status: r.purchase_orders?.status ?? "",
        po_date: r.purchase_orders?.po_date ?? null,
      }));
    },
    staleTime: 30_000,
  });
}

// ============ Subcomponents ============
function StatPanel({
  title, icon: Icon, dot, leftLabel, leftValue, leftUnit, rightLabel, rightValue, loading, error,
}: any) {
  return (
    <Card className="p-5 relative overflow-hidden">
      <div className="flex items-center gap-2 mb-4">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <h3 className="text-[13px] font-semibold">{title}</h3>
      </div>
      {loading ? (
        <div className="flex gap-8"><Skeleton className="h-8 w-24" /><Skeleton className="h-8 w-32" /></div>
      ) : error ? (
        <div className="text-xs text-rose-600">读取失败</div>
      ) : (
        <div className="flex items-end gap-8 relative z-10">
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">{leftLabel}</div>
            <div className="text-2xl font-bold tracking-tight">
              {leftValue}<span className="text-xs font-normal text-muted-foreground ml-1">{leftUnit}</span>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">{rightLabel}</div>
            <div className="text-2xl font-bold tracking-tight text-emerald-700">{rightValue}</div>
          </div>
        </div>
      )}
      <Icon className="absolute right-4 bottom-3 w-20 h-20 text-foreground/5" strokeWidth={1.2} />
    </Card>
  );
}

function MiniCard({ icon: Icon, iconTint, title, qty, amount, amountLabel, loading, error }: any) {
  return (
    <Card className="p-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconTint}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1">
        <div className="text-[12px] text-muted-foreground">{title}</div>
        {loading ? <Skeleton className="h-6 w-16 mt-1" /> : error ? <span className="text-xs text-rose-600">读取失败</span> : (
          <div className="text-xl font-bold mt-0.5">{fmtInt(qty)}<span className="text-[11px] font-normal text-muted-foreground ml-1">件</span></div>
        )}
      </div>
      <div className="text-right">
        <div className="text-[11px] text-muted-foreground">{amountLabel}</div>
        {loading ? <Skeleton className="h-5 w-20 mt-1" /> : error ? <span className="text-xs">-</span> : (
          <div className="text-base font-semibold text-rose-600">{fmtMoney(amount)}</div>
        )}
      </div>
    </Card>
  );
}

// ============ Timeline ============
type Zone = "past" | "today" | "soon" | "future";
const ZONE_STYLE: Record<Zone, { fill: string; text: string; soft: string }> = {
  past:   { fill: "bg-rose-500",    text: "text-white", soft: "text-rose-600" },
  today:  { fill: "bg-violet-600",  text: "text-white", soft: "text-violet-600" },
  soon:   { fill: "bg-amber-500",   text: "text-white", soft: "text-amber-600" },
  future: { fill: "bg-emerald-500", text: "text-white", soft: "text-emerald-600" },
};
const CHEVRON_CLIP = "polygon(10px 0, 100% 0, calc(100% - 10px) 50%, 100% 100%, 10px 100%, 0 50%)";
const MAX_STYLES = 4;

function Timeline({
  items, selectedYmd, onSelect, onShowAll,
}: {
  items: TimelineItem[];
  selectedYmd: string | null;
  onSelect: (ymd: string | null) => void;
  onShowAll: (ymd: string, styles: { style_no: string; qty: number }[]) => void;
}) {
  const todayYmd = beijingYMD(new Date());
  const today = new Date(todayYmd + "T00:00:00+08:00");
  const dayBefore = 5, dayAfter = 14;

  const days = useMemo(() => {
    const out: { ymd: string; label: string; zone: Zone }[] = [];
    for (let i = -dayBefore; i <= dayAfter; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      const ymd = beijingYMD(d);
      const zone: Zone = i === 0 ? "today" : i < 0 ? "past" : i <= 3 ? "soon" : "future";
      out.push({ ymd, label: `${d.getMonth() + 1}/${d.getDate()}`, zone });
    }
    return out;
  }, [todayYmd]);

  const byDay = useMemo(() => {
    const m = new Map<string, Map<string, { qty: number; product_name: string }>>();
    for (const it of items) {
      if (!m.has(it.delivery_ymd)) m.set(it.delivery_ymd, new Map());
      const styleMap = m.get(it.delivery_ymd)!;
      const cur = styleMap.get(it.style_no) ?? { qty: 0, product_name: it.product_name };
      cur.qty += it.unreceived_qty;
      styleMap.set(it.style_no, cur);
    }
    return m;
  }, [items]);

  return (
    <div className="flex items-stretch w-full">
      {days.map((d) => {
        const z = ZONE_STYLE[d.zone];
        const styleMap = byDay.get(d.ymd);
        const styles = styleMap
          ? Array.from(styleMap.entries()).map(([style_no, v]) => ({ style_no, qty: v.qty })).sort((a, b) => b.qty - a.qty)
          : [];
        const totalQty = styles.reduce((s, x) => s + x.qty, 0);
        const visible = styles.slice(0, MAX_STYLES);
        const extra = styles.length - visible.length;
        const isSelected = selectedYmd === d.ymd;
        const isToday = d.zone === "today";

        return (
          <div key={d.ymd} className="flex flex-col items-stretch flex-1 min-w-0">
            <div className="h-[88px] px-0.5 flex flex-col justify-end items-center gap-0.5">
              {visible.map((s) => (
                <div
                  key={s.style_no}
                  className={`text-[10px] font-mono tabular-nums leading-tight truncate w-full text-center ${z.soft}`}
                  title={`${s.style_no} · ${s.qty}件`}
                >
                  {s.style_no}
                </div>
              ))}
              {extra > 0 && (
                <button
                  type="button"
                  onClick={() => onShowAll(d.ymd, styles)}
                  className="text-[9px] text-muted-foreground leading-tight hover:underline"
                >
                  +{extra} 个款号
                </button>
              )}
            </div>
            <div className="h-1.5 flex justify-center">
              {styles.length > 0 && <div className={`w-px h-full ${z.fill}`} />}
            </div>
            <button
              type="button"
              onClick={() => onSelect(isSelected ? null : d.ymd)}
              className={`h-8 ${z.fill} ${z.text} flex items-center justify-center text-[11px] font-semibold tabular-nums relative ${isToday || isSelected ? "ring-2 ring-foreground ring-offset-2 ring-offset-background z-10" : ""}`}
              style={{ clipPath: CHEVRON_CLIP, marginRight: -10 }}
            >
              {isToday ? "今天" : d.label}
            </button>
            <div className="h-8 flex flex-col items-center justify-start pt-1">
              {totalQty > 0 ? (
                <>
                  <div className={`text-[11px] font-bold tabular-nums leading-none ${z.soft}`}>{fmtInt(totalQty)}</div>
                  <div className="text-[9px] text-muted-foreground leading-tight mt-0.5">未入库</div>
                </>
              ) : (
                <div className="text-[10px] text-muted-foreground/50">—</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============ Status helpers ============
type PendingStatus = "overdue" | "soon" | "producing" | "partial" | "done";
function pendingStatus(r: PendingRow, todayYmd: string): PendingStatus {
  if (r.unreceived_qty <= 0) return "done";
  if (!r.delivery_date) return r.received_qty > 0 ? "partial" : "producing";
  const dYmd = beijingYMD(r.delivery_date);
  if (dYmd < todayYmd) return "overdue";
  const diffDays = Math.floor((new Date(dYmd + "T00:00:00+08:00").getTime() - new Date(todayYmd + "T00:00:00+08:00").getTime()) / 86400000);
  if (diffDays <= 3) return "soon";
  if (r.received_qty > 0) return "partial";
  return "producing";
}
const STATUS_LABEL: Record<PendingStatus, { label: string; cls: string }> = {
  overdue:   { label: "已延期", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  soon:      { label: "即将交付", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  producing: { label: "生产中", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  partial:   { label: "部分入库", cls: "bg-violet-50 text-violet-700 border-violet-200" },
  done:      { label: "已完成", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

// ============ Main page ============
export default function SupplierDashboard() {
  const [rangeKey, setRangeKey] = useState<RangeKey>("month");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<PendingRow | null>(null);
  const [stylesPopup, setStylesPopup] = useState<{ ymd: string; list: { style_no: string; qty: number }[] } | null>(null);

  const { startYmd, endYmd } = useMemo(
    () => computeRange(rangeKey, customStart, customEnd),
    [rangeKey, customStart, customEnd]
  );

  const purchaseQ = usePurchaseStats(startYmd, endYmd);
  const inboundQ = useInboundStats(startYmd, endYmd);
  const overdueQ = useOverdueStats();
  const timelineQ = useTimeline(5, 14);
  const pendingQ = usePendingItems(startYmd, endYmd, selectedYmd ?? undefined);

  const todayYmd = beijingYMD(new Date());

  // 过滤 + 分页
  const filteredPending = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    let rows = pendingQ.data ?? [];
    if (kw) rows = rows.filter(r =>
      r.style_no.toLowerCase().includes(kw) ||
      r.sku_no.toLowerCase().includes(kw) ||
      r.product_name.toLowerCase().includes(kw) ||
      r.supplier_name.toLowerCase().includes(kw)
    );
    return rows;
  }, [pendingQ.data, keyword]);
  const totalPages = Math.max(1, Math.ceil(filteredPending.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredPending.slice((safePage - 1) * pageSize, safePage * pageSize);

  const lastUpdatedAt = new Date(); // 当次查询完成时间

  const RANGE_OPTIONS: { v: RangeKey; l: string }[] = [
    { v: "today", l: "今日" }, { v: "month", l: "本月" }, { v: "30d", l: "近30天" }, { v: "year", l: "今年" }, { v: "custom", l: "自定义" },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            工作台首页 <span className="text-muted-foreground font-medium text-base">Dashboard</span>
          </h1>
          <p className="text-[12px] text-muted-foreground mt-1">
            数据最后统计更新时间：
            <span className="font-mono text-foreground">{formatDateTimeCN(lastUpdatedAt)}</span>
            （查询区间 {startYmd} ~ {endYmd}）
          </p>
        </div>
        <div className="flex items-center gap-2 text-[12px] flex-wrap">
          <span className="text-muted-foreground">指标区间筛选：</span>
          {RANGE_OPTIONS.map((o) => (
            <Button
              key={o.v}
              size="sm"
              variant={rangeKey === o.v ? "default" : "outline"}
              className="h-7 text-[11px]"
              onClick={() => setRangeKey(o.v)}
            >{o.l}</Button>
          ))}
          {rangeKey === "custom" && (
            <>
              <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="h-7 w-[140px] text-[11px]" />
              <span className="text-muted-foreground">→</span>
              <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="h-7 w-[140px] text-[11px]" />
            </>
          )}
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatPanel
          title="采购概况" dot="bg-emerald-500" icon={ShoppingCart}
          leftLabel="采购件数" leftValue={fmtInt(purchaseQ.data?.qty)} leftUnit="件"
          rightLabel="采购金额" rightValue={fmtMoney(purchaseQ.data?.amt)}
          loading={purchaseQ.isLoading} error={purchaseQ.error}
        />
        <StatPanel
          title="入库概况" dot="bg-sky-500" icon={Warehouse}
          leftLabel="入库件数" leftValue={fmtInt(inboundQ.data?.qty)} leftUnit="件"
          rightLabel="入库金额" rightValue={fmtMoney(inboundQ.data?.amt)}
          loading={inboundQ.isLoading} error={inboundQ.error}
        />
        <div className="grid grid-rows-2 gap-3">
          <MiniCard
            icon={AlertTriangle} iconTint="bg-amber-100 text-amber-600"
            title="延期超时" qty={overdueQ.data?.qty} amount={overdueQ.data?.amt} amountLabel="未入库金额"
            loading={overdueQ.isLoading} error={overdueQ.error}
          />
          {/* TODO: 待接入采购退货 / 质检退货数据源；暂无对应同步功能，先显示 0。 */}
          <MiniCard
            icon={PackageX} iconTint="bg-rose-100 text-rose-600"
            title="质检退货（待接入）" qty={0} amount={0} amountLabel="退货金额"
            loading={false} error={null}
          />
        </div>
      </div>

      {/* Timeline */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <span className="w-1 h-4 bg-emerald-500 rounded-sm" /> 货期时间轴
            <span className="text-[11px] font-normal text-muted-foreground ml-1">前 5 天 ~ 后 14 天 · 按款号</span>
          </h3>
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500" /> 已超期</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-violet-600" /> 今日</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> 临近交期（3天内）</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> 充裕</span>
            {selectedYmd && (
              <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setSelectedYmd(null)}>清除选择</Button>
            )}
          </div>
        </div>
        {timelineQ.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : timelineQ.error ? (
          <div className="text-rose-600 text-sm">读取失败：{(timelineQ.error as any).message}</div>
        ) : (
          <Timeline
            items={timelineQ.data ?? []}
            selectedYmd={selectedYmd}
            onSelect={(ymd) => { setSelectedYmd(ymd); setPage(1); }}
            onShowAll={(ymd, list) => setStylesPopup({ ymd, list })}
          />
        )}
      </Card>

      {/* Pending table */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <span className="w-1 h-4 bg-emerald-500 rounded" /> 待交付商品明细
            {selectedYmd && (
              <Badge variant="outline" className="text-[11px]">交付日 = {selectedYmd}</Badge>
            )}
          </h3>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索款号、SKU、商品或供应商"
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
              className="h-8 pl-8 w-[260px] text-[12px]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="text-muted-foreground border-b border-border">
              <tr className="text-left">
                <th className="py-2.5 font-normal w-12"></th>
                <th className="py-2.5 font-normal">款号 / SKU / 商品</th>
                <th className="py-2.5 font-normal">供应商</th>
                <th className="py-2.5 font-normal text-right">采购数</th>
                <th className="py-2.5 font-normal text-right">已入库</th>
                <th className="py-2.5 font-normal text-right">待入库</th>
                <th className="py-2.5 font-normal text-right">采购金额</th>
                <th className="py-2.5 font-normal">交付日期</th>
                <th className="py-2.5 font-normal">交付状态</th>
                <th className="py-2.5 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {pendingQ.isLoading ? (
                <tr><td colSpan={10} className="py-10 text-center"><Loader2 className="w-5 h-5 inline animate-spin opacity-50" /></td></tr>
              ) : pendingQ.error ? (
                <tr><td colSpan={10} className="py-10 text-center text-rose-600">读取失败：{(pendingQ.error as any).message}</td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={10} className="py-12 text-center text-muted-foreground">
                  <Inbox className="w-6 h-6 inline mr-2 opacity-50" />暂无待交付明细
                </td></tr>
              ) : pageRows.map((r) => {
                const st = pendingStatus(r, todayYmd);
                const rate = r.purchase_qty > 0 ? Math.round((r.received_qty / r.purchase_qty) * 100) : 0;
                return (
                  <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                    <td className="py-3">
                      {r.product_image_url
                        ? <img src={r.product_image_url} alt="" className="w-9 h-9 object-cover rounded-md" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
                        : <div className="w-9 h-9 rounded-md bg-muted" />}
                    </td>
                    <td className="py-3">
                      <div className="font-mono text-foreground">{r.style_no || "-"} <span className="text-muted-foreground">/ {r.sku_no || "-"}</span></div>
                      <div className="text-[11px] text-muted-foreground truncate max-w-[260px]">{r.product_name || "-"}</div>
                    </td>
                    <td className="py-3 text-[11px] text-muted-foreground">{r.supplier_name || "-"}</td>
                    <td className="py-3 text-right tabular-nums">{fmtInt(r.purchase_qty)} <span className="text-muted-foreground">件</span></td>
                    <td className="py-3 text-right tabular-nums">
                      {fmtInt(r.received_qty)} <span className="text-muted-foreground">件 / {rate}%</span>
                    </td>
                    <td className={`py-3 text-right tabular-nums font-semibold ${st === "overdue" ? "text-rose-600" : st === "soon" ? "text-amber-600" : "text-foreground"}`}>
                      {fmtInt(r.unreceived_qty)} <span className="font-normal text-muted-foreground">件</span>
                    </td>
                    <td className="py-3 text-right tabular-nums font-semibold">{fmtMoney(r.amount > 0 ? r.amount : r.purchase_qty * r.unit_price)}</td>
                    <td className="py-3 font-mono whitespace-nowrap">{r.delivery_date ? formatDateCN(r.delivery_date) : <span className="text-muted-foreground">未设定</span>}</td>
                    <td className="py-3">
                      <span className={`px-2 py-0.5 rounded text-[11px] border ${STATUS_LABEL[st].cls}`}>{STATUS_LABEL[st].label}</span>
                    </td>
                    <td className="py-3">
                      <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => setDetailRow(r)}>
                        <Eye className="w-3 h-3" /> 明细
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredPending.length > 0 && (
          <div className="flex items-center justify-between mt-4 text-[11px] text-muted-foreground">
            <span>共 {filteredPending.length} 条，第 {safePage} / {totalPages} 页</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>上一页</Button>
              <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>下一页</Button>
            </div>
          </div>
        )}
      </Card>

      {/* 款号详情抽屉 */}
      <Sheet open={!!detailRow} onOpenChange={(o) => !o && setDetailRow(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{detailRow?.style_no} · {detailRow?.sku_no}</SheetTitle>
            <SheetDescription>{detailRow?.product_name}</SheetDescription>
          </SheetHeader>
          {detailRow && (
            <div className="mt-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">供应商：</span>{detailRow.supplier_name || "-"}</div>
                <div><span className="text-muted-foreground">采购单号：</span>{detailRow.external_po_id || "-"}</div>
                <div><span className="text-muted-foreground">采购日期：</span>{formatDateCN(detailRow.po_date)}</div>
                <div><span className="text-muted-foreground">协议到货：</span>{detailRow.delivery_date ? formatDateCN(detailRow.delivery_date) : "未设定"}</div>
                <div><span className="text-muted-foreground">采购数量：</span>{fmtInt(detailRow.purchase_qty)} 件</div>
                <div><span className="text-muted-foreground">已入库：</span>{fmtInt(detailRow.received_qty)} 件</div>
                <div><span className="text-muted-foreground">待入库：</span>{fmtInt(detailRow.unreceived_qty)} 件</div>
                <div><span className="text-muted-foreground">单价：</span>{fmtMoney(detailRow.unit_price)}</div>
                <div><span className="text-muted-foreground">采购金额：</span>{fmtMoney(detailRow.amount > 0 ? detailRow.amount : detailRow.purchase_qty * detailRow.unit_price)}</div>
                <div><span className="text-muted-foreground">状态：</span>{STATUS_LABEL[pendingStatus(detailRow, todayYmd)].label}</div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* 时间轴款号全量抽屉 */}
      <Sheet open={!!stylesPopup} onOpenChange={(o) => !o && setStylesPopup(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{stylesPopup?.ymd} 待入库款号</SheetTitle>
            <SheetDescription>共 {stylesPopup?.list.length ?? 0} 个款号</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-1 text-sm">
            {stylesPopup?.list.map((s) => (
              <div key={s.style_no} className="flex justify-between border-b py-1.5">
                <span className="font-mono">{s.style_no}</span>
                <span className="tabular-nums text-muted-foreground">{fmtInt(s.qty)} 件</span>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
