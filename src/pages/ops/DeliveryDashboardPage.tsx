// 货期交付看板（运营端）
// - 顶部供应商交付卡片（核心入口）
// - 汇总统计卡片
// - 连续货期时间轴（参考供应商后台样式）
// - 待交付明细表（按采购单聚合）
// - 右侧详情抽屉
// 全部数据来自 purchase_orders / purchase_order_items，按 delivery_date 过滤。

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search, Eye, Loader2, Inbox, AlertTriangle, CalendarClock, ListChecks,
  Coins, PackageCheck, FileText, Users,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import {
  formatDateCN, formatDateTimeCN, beijingYMD, beijingDayRangeToUTC,
} from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { evaluateDelivery, DELIVERY_COMPLETION_TOLERANCE_RATE } from "@/lib/deliveryTolerance";

const fmtInt = (n?: number | null) => Number(n ?? 0).toLocaleString("zh-CN");
const fmtMoney = (n?: number | null) =>
  "¥" + Number(n ?? 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

const EXCLUDED_STATUSES = ["Delete", "delete", "deleted"];
const EXCLUDED_IN = `(${EXCLUDED_STATUSES.join(",")})`;

type RangeKey = "today" | "week" | "30d" | "custom";
type StatusKey = "all" | "overdue" | "today" | "week" | "producing" | "partial" | "done";
type RiskKey = "high" | "mid" | "low" | "none";
type ItemStatus = "overdue" | "today" | "soon" | "producing" | "partial" | "done";

const STATUS_LABEL: Record<ItemStatus, { label: string; cls: string }> = {
  overdue:   { label: "已逾期",  cls: "bg-rose-50 text-rose-700 border-rose-200" },
  today:     { label: "今日交付", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  soon:      { label: "7天内交付", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  producing: { label: "生产中",   cls: "bg-sky-50 text-sky-700 border-sky-200" },
  partial:   { label: "部分入库", cls: "bg-violet-50 text-violet-700 border-violet-200" },
  done:      { label: "已完成",   cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};
const RISK_LABEL: Record<RiskKey, { label: string; cls: string }> = {
  high: { label: "高风险", cls: "bg-rose-100 text-rose-700 border-rose-200" },
  mid:  { label: "中风险", cls: "bg-amber-100 text-amber-700 border-amber-200" },
  low:  { label: "低风险", cls: "bg-sky-100 text-sky-700 border-sky-200" },
  none: { label: "无风险", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
};

interface RawItem {
  id: string;
  external_po_id: string;
  style_no: string;
  sku_no: string;
  product_name: string;
  product_image_url: string | null;
  purchase_qty: number;
  received_qty: number;
  unreceived_qty: number;       // = effective_pending_qty（已应用容差/超交/手动完结）
  raw_unreceived_qty?: number;  // 原始差异（不应用容差）
  amount: number;
  unit_price: number;
  delivery_date: string | null;
  supplier_id: string | null;
  supplier_name: string;
  po_status: string;
  po_date: string | null;
  _completion_type?: string;
  _is_completed?: boolean;
}

function useDeliveryItems() {
  return useQuery({
    queryKey: ["ops_delivery_items_v2"],
    queryFn: async (): Promise<RawItem[]> => {
      const todayYmd = beijingYMD(new Date());
      const today = new Date(todayYmd + "T00:00:00+08:00");
      const start = new Date(today); start.setDate(start.getDate() - 30);
      const end = new Date(today); end.setDate(end.getDate() + 90);
      const gte = beijingDayRangeToUTC(beijingYMD(start))!.gte;
      const lte = beijingDayRangeToUTC(beijingYMD(end))!.lte;
      const { data, error } = await supabase
        .from("purchase_order_items")
        .select(`
          id, external_po_id, style_no, sku_no, product_name, product_image_url,
          purchase_qty, received_qty, unreceived_qty, amount, unit_price, delivery_date,
          purchase_orders!inner(supplier_id, supplier_name, status, po_date)
        `)
        .gt("unreceived_qty", 0)
        .not("delivery_date", "is", null)
        .gte("delivery_date", gte)
        .lte("delivery_date", lte)
        .not("purchase_orders.status", "in", EXCLUDED_IN)
        .limit(10000);
      if (error) throw error;
      // 应用「交付容差 / 超交 / 手动完结」过滤：
      // 只保留 effective_pending_qty > 0 的明细。
      return (data ?? [])
        .map((r: any) => {
          const purchase_qty = Number(r.purchase_qty ?? 0);
          const received_qty = Number(r.received_qty ?? 0);
          const t = evaluateDelivery({
            purchase_qty,
            received_qty,
            manual_delivery_closed: (r as any).manual_delivery_closed,
          });
          return {
            id: r.id,
            external_po_id: r.external_po_id ?? "",
            style_no: r.style_no ?? "",
            sku_no: r.sku_no ?? "",
            product_name: r.product_name ?? "",
            product_image_url: r.product_image_url ?? null,
            purchase_qty,
            received_qty,
            // 用「有效待入库」替换原始 unreceived_qty，看板所有模块基于该字段统计
            unreceived_qty: t.effective_pending_qty,
            raw_unreceived_qty: Number(r.unreceived_qty ?? Math.max(purchase_qty - received_qty, 0)),
            amount: Number(r.amount ?? 0),
            unit_price: Number(r.unit_price ?? 0),
            delivery_date: r.delivery_date,
            supplier_id: r.purchase_orders?.supplier_id ?? null,
            supplier_name: r.purchase_orders?.supplier_name ?? "(未匹配供应商)",
            po_status: r.purchase_orders?.status ?? "",
            po_date: r.purchase_orders?.po_date ?? null,
            _completion_type: t.completion_type,
            _is_completed: t.is_delivery_completed,
          } as RawItem;
        })
        .filter((it: RawItem) => !it._is_completed && it.unreceived_qty > 0);
    },
    staleTime: 60_000,
  });
}

function statusOf(it: { unreceived_qty: number; received_qty: number; delivery_date: string | null }, todayYmd: string): ItemStatus {
  if (it.unreceived_qty <= 0) return "done";
  if (!it.delivery_date) return it.received_qty > 0 ? "partial" : "producing";
  const dYmd = beijingYMD(it.delivery_date);
  if (dYmd < todayYmd) return "overdue";
  if (dYmd === todayYmd) return "today";
  const diff = Math.floor(
    (new Date(dYmd + "T00:00:00+08:00").getTime()
      - new Date(todayYmd + "T00:00:00+08:00").getTime()) / 86400000
  );
  if (diff <= 7) return "soon";
  if (it.received_qty > 0) return "partial";
  return "producing";
}
function riskOf(s: ItemStatus, daysToDelivery: number | null): RiskKey {
  if (s === "overdue") return "high";
  if (s === "done") return "none";
  if (daysToDelivery == null) return "low";
  if (daysToDelivery <= 3) return "mid";
  if (daysToDelivery <= 7) return "low";
  return "none";
}

// ============ 时间轴（连续色块 + 箭头衔接） ============
type Zone = "overdue" | "today" | "near" | "normal";
const ZONE_STYLE: Record<Zone, { fill: string; soft: string }> = {
  overdue: { fill: "bg-rose-500",    soft: "text-rose-600" },
  today:   { fill: "bg-blue-600",    soft: "text-blue-600" },
  near:    { fill: "bg-amber-500",   soft: "text-amber-600" },
  normal:  { fill: "bg-cyan-500",    soft: "text-cyan-600" },
};
const CHEVRON_CLIP = "polygon(10px 0, 100% 0, calc(100% - 10px) 50%, 100% 100%, 10px 100%, 0 50%)";

function Timeline({
  items, selectedYmd, onSelect,
}: {
  items: RawItem[];
  selectedYmd: string | null;
  onSelect: (ymd: string | null) => void;
}) {
  const todayYmd = beijingYMD(new Date());
  const today = new Date(todayYmd + "T00:00:00+08:00");
  const dayBefore = 5, dayAfter = 14;

  const days = useMemo(() => {
    const out: { ymd: string; label: string; zone: Zone; isToday: boolean }[] = [];
    for (let i = -dayBefore; i <= dayAfter; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      const ymd = beijingYMD(d);
      const zone: Zone = i === 0 ? "today" : i < 0 ? "overdue" : i <= 3 ? "near" : "normal";
      out.push({ ymd, label: `${d.getMonth() + 1}/${d.getDate()}`, zone, isToday: i === 0 });
    }
    return out;
  }, [todayYmd]);

  const byDay = useMemo(() => {
    const m = new Map<string, { qty: number; received: number; styles: Map<string, number>; pos: Set<string>; suppliers: Set<string> }>();
    for (const it of items) {
      if (!it.delivery_date) continue;
      const ymd = beijingYMD(it.delivery_date);
      let cur = m.get(ymd);
      if (!cur) { cur = { qty: 0, received: 0, styles: new Map(), pos: new Set(), suppliers: new Set() }; m.set(ymd, cur); }
      cur.qty += it.unreceived_qty;
      cur.received += it.received_qty;
      const styleKey = it.style_no || it.sku_no || "(无款号)";
      cur.styles.set(styleKey, (cur.styles.get(styleKey) ?? 0) + it.unreceived_qty);
      if (it.external_po_id) cur.pos.add(it.external_po_id);
      if (it.supplier_name) cur.suppliers.add(it.supplier_name);
    }
    return m;
  }, [items]);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex items-stretch w-full">
        {days.map((d) => {
          const z = ZONE_STYLE[d.zone];
          const cell = byDay.get(d.ymd);
          const styles = cell
            ? Array.from(cell.styles.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)
            : [];
          const totalQty = cell?.qty ?? 0;
          const isSelected = selectedYmd === d.ymd;
          const stateText =
            !cell ? "" :
            cell.received === 0 ? "未入库" :
            cell.received > 0 && totalQty > 0 ? "部分入库" : "已完成";

          return (
            <div key={d.ymd} className="flex flex-col items-stretch flex-1 min-w-0">
              <div className="min-h-[64px] px-1 pb-1.5 flex flex-col justify-end items-center gap-0.5">
                {styles.map(([s]) => (
                  <div key={s} className={cn("text-[11px] font-mono font-semibold leading-tight truncate w-full text-center", z.soft)}>
                    {s}
                  </div>
                ))}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onSelect(isSelected ? null : d.ymd)}
                    className={cn(
                      "h-9 text-white flex items-center justify-center text-[12px] font-semibold tabular-nums relative",
                      z.fill,
                      (d.isToday || isSelected) && "ring-2 ring-blue-900 ring-offset-2 ring-offset-white z-10",
                    )}
                    style={{ clipPath: CHEVRON_CLIP, marginRight: -10 }}
                  >
                    {d.isToday ? "今天" : d.label}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <div className="font-semibold mb-1">{d.ymd}{d.isToday && "（今天）"}</div>
                  {cell ? (
                    <div className="space-y-0.5">
                      <div>供应商：{cell.suppliers.size}</div>
                      <div>采购单：{cell.pos.size}</div>
                      <div>款号：{cell.styles.size}</div>
                      <div>应交付：{fmtInt(cell.qty + cell.received)} 件</div>
                      <div>已入库：{fmtInt(cell.received)} 件</div>
                      <div>待入库：{fmtInt(cell.qty)} 件</div>
                      <div>状态：{d.zone === "overdue" ? "已逾期" : d.zone === "today" ? "今日交付" : d.zone === "near" ? "临近交付" : "正常"}</div>
                    </div>
                  ) : <div className="text-muted-foreground">当日无待交付</div>}
                </TooltipContent>
              </Tooltip>
              <div className="h-10 flex flex-col items-center justify-start pt-1.5">
                {totalQty > 0 ? (
                  <>
                    <div className={cn("text-[12px] font-bold tabular-nums leading-none", z.soft)}>{fmtInt(totalQty)}</div>
                    <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{stateText}</div>
                  </>
                ) : <div className="text-[10px] text-muted-foreground/40">—</div>}
              </div>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

// ============ 主页面 ============
export default function DeliveryDashboardPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>("week");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusKey>("all");
  const [keyword, setKeyword] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | "all">("all");
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null);
  const [detail, setDetail] = useState<RawItem[] | null>(null);
  const [detailTitle, setDetailTitle] = useState<string>("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data: rawItems = [], isLoading, error } = useDeliveryItems();
  const todayYmd = beijingYMD(new Date());

  const rangeBounds = useMemo(() => {
    const today = new Date(todayYmd + "T00:00:00+08:00");
    const add = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return beijingYMD(d); };
    if (rangeKey === "today") return { start: todayYmd, end: todayYmd };
    if (rangeKey === "week") return { start: todayYmd, end: add(7) };
    if (rangeKey === "30d") return { start: add(-30), end: add(30) };
    return { start: customStart || todayYmd, end: customEnd || todayYmd };
  }, [rangeKey, customStart, customEnd, todayYmd]);

  // 按筛选条件过滤
  const filteredItems = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rawItems.filter((it) => {
      if (selectedSupplierId !== "all" && it.supplier_id !== selectedSupplierId) return false;
      if (selectedYmd) {
        if (!it.delivery_date || beijingYMD(it.delivery_date) !== selectedYmd) return false;
      } else {
        const dYmd = it.delivery_date ? beijingYMD(it.delivery_date) : "";
        // 时间范围：已逾期始终保留（属于"已逾期"分桶）
        const isOverdue = dYmd && dYmd < todayYmd;
        const inRange = dYmd && dYmd >= rangeBounds.start && dYmd <= rangeBounds.end;
        if (!isOverdue && !inRange) return false;
      }
      const st = statusOf(it, todayYmd);
      if (statusFilter !== "all") {
        if (statusFilter === "week" && !(st === "today" || st === "soon")) return false;
        if (statusFilter === "today" && st !== "today") return false;
        if (statusFilter === "overdue" && st !== "overdue") return false;
        if (statusFilter === "producing" && st !== "producing") return false;
        if (statusFilter === "partial" && st !== "partial") return false;
        if (statusFilter === "done" && st !== "done") return false;
      }
      if (kw) {
        const hay = `${it.supplier_name} ${it.style_no} ${it.sku_no} ${it.product_name} ${it.external_po_id}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [rawItems, selectedSupplierId, selectedYmd, statusFilter, keyword, rangeBounds, todayYmd]);

  // 供应商卡片 —— 用原始数据（不受 supplier 选择影响），但应用时间范围/状态/关键字
  const supplierCardItems = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rawItems.filter((it) => {
      const dYmd = it.delivery_date ? beijingYMD(it.delivery_date) : "";
      const isOverdue = dYmd && dYmd < todayYmd;
      const inRange = dYmd && dYmd >= rangeBounds.start && dYmd <= rangeBounds.end;
      if (!isOverdue && !inRange) return false;
      if (kw) {
        const hay = `${it.supplier_name} ${it.style_no} ${it.sku_no} ${it.product_name} ${it.external_po_id}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [rawItems, keyword, rangeBounds, todayYmd]);

  interface SupplierCard {
    id: string;
    name: string;
    pos: Set<string>;
    pendingQty: number;
    overdueQty: number;
    weekQty: number;
    purchase: number;
    received: number;
  }
  const supplierCards = useMemo<SupplierCard[]>(() => {
    const m = new Map<string, SupplierCard>();
    for (const it of supplierCardItems) {
      const id = it.supplier_id ?? `__name__:${it.supplier_name}`;
      let c = m.get(id);
      if (!c) {
        c = { id, name: it.supplier_name, pos: new Set(), pendingQty: 0, overdueQty: 0, weekQty: 0, purchase: 0, received: 0 };
        m.set(id, c);
      }
      if (it.external_po_id) c.pos.add(it.external_po_id);
      c.pendingQty += it.unreceived_qty;
      c.purchase += it.purchase_qty;
      c.received += it.received_qty;
      const st = statusOf(it, todayYmd);
      if (st === "overdue") c.overdueQty += it.unreceived_qty;
      if (st === "today" || st === "soon") c.weekQty += it.unreceived_qty;
    }
    return Array.from(m.values()).sort((a, b) => (b.overdueQty - a.overdueQty) || (b.pendingQty - a.pendingQty));
  }, [supplierCardItems, todayYmd]);

  const supplierRisk = (c: SupplierCard): RiskKey => {
    if (c.overdueQty > 0) return "high";
    if (c.weekQty > 0) return "mid";
    if (c.pendingQty > 0) return "low";
    return "none";
  };

  // 表格：按"采购单+款号"维度聚合
  interface Row {
    key: string;
    supplier_name: string;
    supplier_id: string | null;
    style_no: string;
    product_name: string;
    product_image_url: string | null;
    sku_count: number;
    external_po_id: string;
    purchase_qty: number;
    received_qty: number;
    unreceived_qty: number;
    amount: number;
    earliest_delivery: string | null;
    status: ItemStatus;
    risk: RiskKey;
    items: RawItem[];
  }
  const rows = useMemo<Row[]>(() => {
    const groups = new Map<string, RawItem[]>();
    for (const it of filteredItems) {
      const k = `${it.external_po_id}__${it.style_no || it.sku_no || "_"}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(it);
    }
    const out: Row[] = [];
    for (const [k, arr] of groups.entries()) {
      const first = arr[0];
      const purchase_qty = arr.reduce((s, x) => s + x.purchase_qty, 0);
      const received_qty = arr.reduce((s, x) => s + x.received_qty, 0);
      const unreceived_qty = arr.reduce((s, x) => s + x.unreceived_qty, 0);
      const amount = arr.reduce((s, x) => s + (x.amount > 0 ? x.amount : x.purchase_qty * x.unit_price), 0);
      const dates = arr.map(x => x.delivery_date).filter(Boolean) as string[];
      const earliest_delivery = dates.length ? dates.sort()[0] : null;
      const repItem = { unreceived_qty, received_qty, delivery_date: earliest_delivery };
      const status = statusOf(repItem, todayYmd);
      const days = earliest_delivery
        ? Math.floor((new Date(beijingYMD(earliest_delivery) + "T00:00:00+08:00").getTime()
            - new Date(todayYmd + "T00:00:00+08:00").getTime()) / 86400000)
        : null;
      const risk = riskOf(status, days);
      out.push({
        key: k,
        supplier_name: first.supplier_name,
        supplier_id: first.supplier_id,
        style_no: first.style_no || first.sku_no || "(无款号)",
        product_name: arr.find(x => x.product_name)?.product_name ?? "",
        product_image_url: arr.find(x => x.product_image_url)?.product_image_url ?? null,
        sku_count: new Set(arr.map(x => x.sku_no).filter(Boolean)).size,
        external_po_id: first.external_po_id,
        purchase_qty, received_qty, unreceived_qty, amount,
        earliest_delivery, status, risk, items: arr,
      });
    }
    // 排序：逾期 → 交期升序 → 待入库降序
    out.sort((a, b) => {
      const ao = a.status === "overdue" ? 0 : 1;
      const bo = b.status === "overdue" ? 0 : 1;
      if (ao !== bo) return ao - bo;
      const da = a.earliest_delivery ?? "9999";
      const db = b.earliest_delivery ?? "9999";
      if (da !== db) return da < db ? -1 : 1;
      return b.unreceived_qty - a.unreceived_qty;
    });
    return out;
  }, [filteredItems, todayYmd]);

  const totals = useMemo(() => {
    let poSet = new Set<string>(), pending = 0, todayQ = 0, weekQ = 0, overdue = 0, amount = 0;
    for (const it of filteredItems) {
      if (it.external_po_id) poSet.add(it.external_po_id);
      pending += it.unreceived_qty;
      amount += it.amount > 0 ? it.amount : it.purchase_qty * it.unit_price;
      const st = statusOf(it, todayYmd);
      if (st === "overdue") overdue += it.unreceived_qty;
      if (st === "today") todayQ += it.unreceived_qty;
      if (st === "today" || st === "soon") weekQ += it.unreceived_qty;
    }
    return { poCount: poSet.size, pending, todayQ, weekQ, overdue, amount };
  }, [filteredItems, todayYmd]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  function exportCsv() {
    const headers = ["供应商", "款号", "商品", "SKU数", "采购单号", "采购数", "已入库", "待入库", "采购金额", "计划交付", "状态", "风险"];
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push([
        r.supplier_name, r.style_no, r.product_name, r.sku_count, r.external_po_id,
        r.purchase_qty, r.received_qty, r.unreceived_qty, r.amount.toFixed(2),
        r.earliest_delivery ? beijingYMD(r.earliest_delivery) : "",
        STATUS_LABEL[r.status].label, RISK_LABEL[r.risk].label,
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `delivery_dashboard_${todayYmd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const RANGE_OPTIONS: { v: RangeKey; l: string }[] = [
    { v: "today", l: "今日" }, { v: "week", l: "本周" }, { v: "30d", l: "近30天" }, { v: "custom", l: "自定义" },
  ];

  return (
    <div className="space-y-5 min-h-screen -m-6 p-6 bg-[#F5F7FB]">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A] flex items-center gap-2">
            货期交付看板 <span className="text-muted-foreground font-medium text-base">Delivery Dashboard</span>
          </h1>
          <p className="text-[12px] text-muted-foreground mt-1">
            数据更新时间：<span className="font-mono text-foreground">{formatDateTimeCN(new Date())}</span>
            <span className="mx-2">·</span>
            当前查询区间 <span className="font-mono">{rangeBounds.start} ~ {rangeBounds.end}</span>（已逾期始终展示）
            <span className="mx-2">·</span>
            <span className="text-[11px]">交付完成容差 <span className="font-mono text-foreground">{Math.round(DELIVERY_COMPLETION_TOLERANCE_RATE * 100)}%</span>（达标后不再显示）</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-[12px]">
          <span className="text-muted-foreground">时间范围：</span>
          {RANGE_OPTIONS.map(o => (
            <Button
              key={o.v}
              size="sm"
              className={cn(
                "h-7 text-[11px]",
                rangeKey === o.v
                  ? "bg-[#2563EB] hover:bg-[#1D4ED8] text-white"
                  : "bg-white text-[#0F172A] border border-slate-200 hover:bg-slate-50"
              )}
              onClick={() => { setRangeKey(o.v); setPage(1); setSelectedYmd(null); }}
            >{o.l}</Button>
          ))}
          {rangeKey === "custom" && (
            <>
              <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="h-7 w-[140px] text-[11px]" />
              <span className="text-muted-foreground">→</span>
              <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="h-7 w-[140px] text-[11px]" />
            </>
          )}
          <span className="text-muted-foreground ml-2">交付状态：</span>
          <Select value={statusFilter} onValueChange={(v: StatusKey) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="h-7 w-[120px] text-[11px] bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="overdue">已逾期</SelectItem>
              <SelectItem value="today">今日交付</SelectItem>
              <SelectItem value="week">7天内交付</SelectItem>
              <SelectItem value="producing">生产中</SelectItem>
              <SelectItem value="partial">部分入库</SelectItem>
              <SelectItem value="done">已完成</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索供应商、款号、SKU、采购单号"
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
              className="h-7 pl-8 w-[240px] text-[11px] bg-white"
            />
          </div>
        </div>
      </div>

      {/* 供应商卡片（最上方） */}
      <Card className="p-5 border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[#0F172A] flex items-center gap-2">
            <Users className="w-4 h-4 text-[#2563EB]" />
            供应商交付压力
            <span className="text-[11px] font-normal text-muted-foreground">点击卡片可联动筛选下方数据</span>
          </h3>
          <Button
            size="sm"
            className={cn(
              "h-7 text-[11px]",
              selectedSupplierId === "all"
                ? "bg-[#2563EB] hover:bg-[#1D4ED8] text-white"
                : "bg-white text-[#0F172A] border border-slate-200 hover:bg-slate-50"
            )}
            onClick={() => { setSelectedSupplierId("all"); setPage(1); }}
          >全部供应商</Button>
        </div>
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
          </div>
        ) : supplierCards.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <Inbox className="w-5 h-5 inline mr-2 opacity-60" /> 当前条件下暂无待交付供应商
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            {supplierCards.map((c) => {
              const risk = supplierRisk(c);
              const isActive = selectedSupplierId === c.id;
              const completionRate = c.purchase > 0 ? Math.round((c.received / c.purchase) * 100) : 0;
              return (
                <button
                  key={c.id}
                  onClick={() => { setSelectedSupplierId(isActive ? "all" : c.id); setPage(1); }}
                  className={cn(
                    "text-left rounded-lg border bg-white p-3 transition relative overflow-hidden",
                    isActive
                      ? "border-[#2563EB] ring-2 ring-[#2563EB]/30 shadow-md"
                      : "border-slate-200 hover:border-[#93C5FD] hover:shadow-sm",
                  )}
                >
                  {isActive && <div className="absolute top-0 left-0 right-0 h-1 bg-[#2563EB]" />}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="font-semibold text-[13px] text-[#0F172A] truncate">{c.name}</div>
                    <Badge variant="outline" className={cn("text-[10px] shrink-0", RISK_LABEL[risk].cls)}>
                      {RISK_LABEL[risk].label}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                    <div>
                      <div className="text-muted-foreground">待交付</div>
                      <div className="font-bold tabular-nums text-[15px] text-[#0F172A]">{fmtInt(c.pendingQty)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">已逾期</div>
                      <div className={cn("font-bold tabular-nums text-[15px]", c.overdueQty > 0 ? "text-rose-600" : "text-[#0F172A]")}>{fmtInt(c.overdueQty)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">7天内</div>
                      <div className={cn("font-bold tabular-nums text-[14px]", c.weekQty > 0 ? "text-amber-600" : "text-[#0F172A]")}>{fmtInt(c.weekQty)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">采购单</div>
                      <div className="font-bold tabular-nums text-[14px] text-[#0F172A]">{c.pos.size}</div>
                    </div>
                  </div>
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
                      <span>入库完成率</span>
                      <span className="tabular-nums">{completionRate}%</span>
                    </div>
                    <div className="h-1 rounded bg-slate-100 overflow-hidden">
                      <div className="h-full bg-[#2563EB]" style={{ width: `${Math.min(100, completionRate)}%` }} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* 汇总统计 */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard icon={FileText}   label="待交付采购单" value={fmtInt(totals.poCount)} unit="单"  tint="bg-blue-50 text-blue-600" />
        <StatCard icon={PackageCheck} label="待交付件数"   value={fmtInt(totals.pending)} unit="件" tint="bg-cyan-50 text-cyan-600" />
        <StatCard icon={CalendarClock} label="今日应交付" value={fmtInt(totals.todayQ)} unit="件" tint="bg-blue-50 text-blue-600" />
        <StatCard icon={ListChecks}  label="7天内需交付"  value={fmtInt(totals.weekQ)}  unit="件" tint="bg-amber-50 text-amber-600" />
        <StatCard icon={AlertTriangle} label="已逾期"     value={fmtInt(totals.overdue)} unit="件" tint="bg-rose-50 text-rose-600" valueClass="text-rose-700" />
        <StatCard icon={Coins}       label="预计采购金额" value={fmtMoney(totals.amount)} unit=""  tint="bg-slate-50 text-slate-600" />
      </div>

      {/* 货期时间轴 */}
      <Card className="p-5 border-slate-200">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <h3 className="text-sm font-semibold text-[#0F172A] flex items-center gap-2">
            <span className="w-1 h-4 bg-[#2563EB] rounded-sm" /> 货期时间轴
            <span className="text-[11px] font-normal text-muted-foreground">前 5 天 ~ 后 14 天</span>
            {selectedSupplierId !== "all" && (
              <Badge variant="outline" className="text-[10px] border-blue-200 text-blue-700">
                {supplierCards.find(s => s.id === selectedSupplierId)?.name}
              </Badge>
            )}
          </h3>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500" /> 已逾期</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-600" /> 今日</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> 临近</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-cyan-500" /> 正常</span>
            {selectedYmd && (
              <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setSelectedYmd(null)}>清除日期</Button>
            )}
          </div>
        </div>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <Timeline
            items={selectedSupplierId === "all" ? rawItems : rawItems.filter(it => it.supplier_id === selectedSupplierId)}
            selectedYmd={selectedYmd}
            onSelect={(ymd) => { setSelectedYmd(ymd); setPage(1); }}
          />
        )}
      </Card>

      {/* 待交付明细 */}
      <Card className="p-5 border-slate-200">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-[#0F172A] flex items-center gap-2">
            <span className="w-1 h-4 bg-[#2563EB] rounded" /> 待交付明细
            {selectedYmd && <Badge variant="outline" className="text-[11px] border-blue-200 text-blue-700">交付日 = {selectedYmd}</Badge>}
          </h3>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={exportCsv}>导出</Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="text-muted-foreground border-b border-slate-200 bg-slate-50/60">
              <tr className="text-left">
                <th className="py-2.5 px-2 font-normal">供应商</th>
                <th className="py-2.5 px-2 font-normal">款号 / 商品</th>
                <th className="py-2.5 px-2 font-normal text-right">SKU数</th>
                <th className="py-2.5 px-2 font-normal">采购单号</th>
                <th className="py-2.5 px-2 font-normal text-right">采购数</th>
                <th className="py-2.5 px-2 font-normal text-right">已入库</th>
                <th className="py-2.5 px-2 font-normal text-right">待入库</th>
                <th className="py-2.5 px-2 font-normal w-[120px]">入库进度</th>
                <th className="py-2.5 px-2 font-normal">计划交付</th>
                <th className="py-2.5 px-2 font-normal">距交付</th>
                <th className="py-2.5 px-2 font-normal">状态</th>
                <th className="py-2.5 px-2 font-normal">风险</th>
                <th className="py-2.5 px-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={13} className="py-10 text-center"><Loader2 className="w-5 h-5 inline animate-spin opacity-50" /></td></tr>
              ) : error ? (
                <tr><td colSpan={13} className="py-10 text-center text-rose-600">读取失败：{(error as any).message}</td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={13} className="py-12 text-center text-muted-foreground">
                  <Inbox className="w-6 h-6 inline mr-2 opacity-50" /> 当前筛选下暂无待交付记录
                </td></tr>
              ) : pageRows.map(r => {
                const rate = r.purchase_qty > 0 ? Math.round((r.received_qty / r.purchase_qty) * 100) : 0;
                const days = r.earliest_delivery
                  ? Math.floor((new Date(beijingYMD(r.earliest_delivery) + "T00:00:00+08:00").getTime()
                      - new Date(todayYmd + "T00:00:00+08:00").getTime()) / 86400000)
                  : null;
                const daysLabel = days == null ? "-" : days < 0 ? `逾期 ${-days} 天` : days === 0 ? "今日到货" : `还有 ${days} 天`;
                return (
                  <tr key={r.key} className="border-b border-slate-100 last:border-0 hover:bg-blue-50/30">
                    <td className="py-3 px-2 text-[12px] text-[#0F172A]">{r.supplier_name}</td>
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-2">
                        {r.product_image_url
                          ? <img src={r.product_image_url} alt="" className="w-8 h-8 object-cover rounded-md" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
                          : <div className="w-8 h-8 rounded-md bg-slate-100" />}
                        <div className="min-w-0">
                          <div className="font-mono text-foreground">{r.style_no}</div>
                          <div className="text-[11px] text-muted-foreground truncate max-w-[200px]">{r.product_name || "-"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-2 text-right tabular-nums">{r.sku_count}</td>
                    <td className="py-3 px-2 font-mono text-[11px]">{r.external_po_id || "-"}</td>
                    <td className="py-3 px-2 text-right tabular-nums">{fmtInt(r.purchase_qty)}</td>
                    <td className="py-3 px-2 text-right tabular-nums">{fmtInt(r.received_qty)}</td>
                    <td className={cn(
                      "py-3 px-2 text-right tabular-nums font-semibold",
                      r.status === "overdue" ? "text-rose-600" : r.status === "soon" || r.status === "today" ? "text-amber-600" : ""
                    )}>{fmtInt(r.unreceived_qty)}</td>
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded bg-slate-100 overflow-hidden">
                          <div className="h-full bg-[#2563EB]" style={{ width: `${Math.min(100, rate)}%` }} />
                        </div>
                        <span className="text-[10px] tabular-nums text-muted-foreground w-9 text-right">{rate}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-2 font-mono text-[11px] whitespace-nowrap">
                      {r.earliest_delivery ? formatDateCN(r.earliest_delivery) : "-"}
                    </td>
                    <td className={cn("py-3 px-2 text-[11px] whitespace-nowrap",
                      days != null && days < 0 ? "text-rose-600 font-semibold"
                        : days === 0 ? "text-blue-600 font-semibold"
                        : days != null && days <= 3 ? "text-amber-600" : "text-muted-foreground"
                    )}>{daysLabel}</td>
                    <td className="py-3 px-2">
                      <span className={cn("px-2 py-0.5 rounded text-[11px] border", STATUS_LABEL[r.status].cls)}>{STATUS_LABEL[r.status].label}</span>
                    </td>
                    <td className="py-3 px-2">
                      <span className={cn("px-2 py-0.5 rounded text-[11px] border", RISK_LABEL[r.risk].cls)}>{RISK_LABEL[r.risk].label}</span>
                    </td>
                    <td className="py-3 px-2 whitespace-nowrap">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-[#2563EB] hover:bg-blue-50"
                        onClick={() => { setDetail(r.items); setDetailTitle(`${r.style_no} · ${r.supplier_name}`); }}>
                        <Eye className="w-3 h-3 mr-1" />查看详情
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {rows.length > 0 && (
          <div className="flex items-center justify-between mt-4 text-[11px] text-muted-foreground">
            <span>共 {rows.length} 条，第 {safePage} / {totalPages} 页</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>上一页</Button>
              <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>下一页</Button>
            </div>
          </div>
        )}
      </Card>

      {/* 详情抽屉 */}
      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{detailTitle}</SheetTitle>
            <SheetDescription>SKU 明细 / 关联采购单</SheetDescription>
          </SheetHeader>
          {detail && (() => {
            const totalPurchase = detail.reduce((s, x) => s + x.purchase_qty, 0);
            const totalReceived = detail.reduce((s, x) => s + x.received_qty, 0);
            const totalUnreceived = detail.reduce((s, x) => s + x.unreceived_qty, 0);
            const rate = totalPurchase > 0 ? Math.round((totalReceived / totalPurchase) * 100) : 0;
            return (
              <div className="mt-4 space-y-5 text-sm">
                <div className="grid grid-cols-3 gap-3 p-3 rounded-md bg-blue-50/60">
                  <div><div className="text-[11px] text-muted-foreground">采购总数</div><div className="font-semibold tabular-nums">{fmtInt(totalPurchase)} 件</div></div>
                  <div><div className="text-[11px] text-muted-foreground">已入库</div><div className="font-semibold tabular-nums">{fmtInt(totalReceived)} 件</div></div>
                  <div><div className="text-[11px] text-muted-foreground">待入库</div><div className="font-semibold tabular-nums text-rose-600">{fmtInt(totalUnreceived)} 件</div></div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-muted-foreground">入库进度</span>
                    <span className="tabular-nums font-semibold">{rate}%</span>
                  </div>
                  <div className="h-2 rounded bg-slate-100 overflow-hidden">
                    <div className="h-full bg-[#2563EB]" style={{ width: `${Math.min(100, rate)}%` }} />
                  </div>
                </div>
                <div>
                  <h4 className="text-[13px] font-semibold mb-2">SKU 明细 ({detail.length})</h4>
                  <div className="overflow-x-auto border border-slate-200 rounded-md">
                    <table className="w-full text-[12px]">
                      <thead className="bg-slate-50 text-muted-foreground">
                        <tr className="text-left">
                          <th className="py-2 px-2 font-normal">SKU</th>
                          <th className="py-2 px-2 font-normal">规格</th>
                          <th className="py-2 px-2 font-normal text-right">采购</th>
                          <th className="py-2 px-2 font-normal text-right">已入</th>
                          <th className="py-2 px-2 font-normal text-right">待入</th>
                          <th className="py-2 px-2 font-normal">交付日</th>
                          <th className="py-2 px-2 font-normal">采购单</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.map(it => (
                          <tr key={it.id} className="border-t border-slate-100">
                            <td className="py-2 px-2 font-mono text-[11px]">{it.sku_no || "-"}</td>
                            <td className="py-2 px-2 text-[11px] text-muted-foreground">{it.product_name || "-"}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{fmtInt(it.purchase_qty)}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{fmtInt(it.received_qty)}</td>
                            <td className="py-2 px-2 text-right tabular-nums text-rose-600">{fmtInt(it.unreceived_qty)}</td>
                            <td className="py-2 px-2 font-mono text-[11px]">{it.delivery_date ? formatDateCN(it.delivery_date) : "-"}</td>
                            <td className="py-2 px-2 font-mono text-[11px]">{it.external_po_id || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground border-t border-slate-200 pt-3">
                  催交记录、运营备注模块待业务接入后开放。
                </div>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, unit, tint, valueClass }: {
  icon: any; label: string; value: string; unit?: string; tint: string; valueClass?: string;
}) {
  return (
    <Card className="p-4 border-slate-200">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <div className={cn("w-7 h-7 rounded-md flex items-center justify-center", tint)}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className={cn("text-xl font-bold tabular-nums text-[#0F172A]", valueClass)}>
        {value}{unit && <span className="text-[11px] font-normal text-muted-foreground ml-1">{unit}</span>}
      </div>
    </Card>
  );
}
