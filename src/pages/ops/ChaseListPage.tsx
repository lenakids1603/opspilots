import React, { useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, RefreshCw, Download, ChevronDown, ChevronRight,
  PartyPopper, ImageIcon, Copy, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ops/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDateTimeCN, todayCN } from "@/lib/datetime";

type PoDetail = { po_id: string; delivery_date: string | null; overdue_days: number; qty: number };
type Urgency = "overdue" | "due24" | "due48" | "due72" | "later";
type SupplierRow = {
  supplier_id: string;
  supplier_name: string;
  sku: string;
  style_no: string;
  total_qty: number;
  overdue_qty: number;
  due24_qty: number;
  due48_qty: number;
  due72_qty: number;
  later_qty: number;
  po_count: number;
  max_overdue_days: number;
  po_details: PoDetail[];
  product_name: string | null;
  image_url: string | null;
};
type PendingReviewCount = {
  pending_review_orders: number;
  pending_review_items: number;
  pending_review_qty: number;
};
type PurchaseRow = {
  sku: string; style_no: string; supplier_name: string;
  pending_qty: number; intransit_qty: number; missing_date_qty: number;
  late_order_qty: number; urge_supplier_qty: number; closed_short_qty: number;
  raw_gap: number; return_in_transit: number; resale_rate: number;
  return_offset: number; final_gap: number; earliest_pay_time: string | null;
};
type UrgencyRow = { urgency: Urgency; qty: number; order_count: number; supplier_count: number };
type ClosedShortPoDetail = { po_id: string; delivery_date: string | null; short_qty: number };
type ClosedShortRow = {
  sku: string; style_no: string; supplier_name: string;
  short_qty: number; order_count: number; po_count: number;
  oldest_pay_time: string | null; po_details: ClosedShortPoDetail[];
};
type SkuImageRow = { sku: string; image_url: string | null };
type TimelineRow = {
  deadline_date: string;
  style_no: string;
  product_name: string | null;
  image_url: string | null;
  qty: number;
  urgency: Urgency;
};

const fmtNum = (n: number | null | undefined) =>
  n == null ? "-" : Number(n).toLocaleString("zh-CN");

const fmtMMDDHM = (input: string | null) => {
  if (!input) return "-";
  const d = new Date(input);
  if (isNaN(d.getTime())) return "-";
  const s = d.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai", hour12: false,
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  return s.replace(/\//g, "-");
};

/** YYYY-MM-DD in Asia/Shanghai */
function bjDateStr(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const day = parts.find(p => p.type === "day")?.value;
  return `${y}-${m}-${day}`;
}
function addDays(yyyyMMdd: string, n: number) {
  const [y, m, d] = yyyyMMdd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function mdLabel(yyyyMMdd: string) {
  const [, m, d] = yyyyMMdd.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** SKU 尾段：取最后一段 "-" 之后，否则尾 4 位 */
function skuTail(sku: string) {
  if (!sku) return "";
  const i = sku.lastIndexOf("-");
  if (i >= 0 && i < sku.length - 1) return sku.slice(i + 1);
  return sku.length > 4 ? sku.slice(-4) : sku;
}

/** 从 product_name 中抽取【】内的短名；若末尾重复款号则去掉。 */
function shortProductName(name: string | null | undefined, styleNo?: string) {
  const raw = (name ?? "").trim();
  if (!raw) return "";
  const m = raw.match(/【([^】]+)】/);
  let s = m ? m[1].trim() : raw;
  if (styleNo) {
    const re = new RegExp(`[\\s·-]*${styleNo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
    s = s.replace(re, "").trim();
  }
  return s;
}

const URGENCY_RANK: Record<Urgency, number> = { overdue: 5, due24: 4, due48: 3, due72: 2, later: 1 };
const URGENCY_RING: Record<Urgency, string> = {
  overdue: "ring-red-500",
  due24: "ring-purple-500",
  due48: "ring-orange-500",
  due72: "ring-orange-400",
  later: "ring-emerald-500",
};

function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [headers, ...rows].map(r => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function useSkuImages(skus: string[], enabled = true) {
  const uniq = useMemo(() => Array.from(new Set(skus.filter(Boolean))).sort(), [skus]);
  const key = uniq.join(",");
  return useQuery({
    queryKey: ["sku-images", key],
    enabled: enabled && uniq.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ops_sku_images" as never, { _skus: uniq } as never);
      if (error) throw error;
      const map: Record<string, string | null> = {};
      for (const row of (data ?? []) as SkuImageRow[]) map[row.sku] = row.image_url ?? null;
      return map;
    },
  });
}

function SkuThumb({ sku, imageUrl, onPreview, size = 40 }: {
  sku: string; imageUrl: string | null | undefined;
  onPreview: (url: string, sku: string) => void; size?: number;
}) {
  const [errored, setErrored] = useState(false);
  const showImg = !!imageUrl && !errored;
  return (
    <div
      className={cn(
        "rounded-md bg-muted overflow-hidden flex items-center justify-center shrink-0",
        showImg && "cursor-zoom-in",
      )}
      style={{ width: size, height: size }}
      onClick={() => { if (showImg) onPreview(imageUrl!, sku); }}
      title={sku}
    >
      {showImg ? (
        <img src={imageUrl!} alt={sku} referrerPolicy="no-referrer" loading="lazy"
          className="w-full h-full object-cover" onError={() => setErrored(true)} />
      ) : (
        <ImageIcon className="size-4 text-muted-foreground/60" />
      )}
    </div>
  );
}

function ProductThumb({ src, alt, size = 48, ringClass, onClick, radiusClass = "rounded-lg" }: {
  src: string | null; alt: string; size?: number; ringClass?: string;
  onClick?: () => void; radiusClass?: string;
}) {
  const [errored, setErrored] = useState(false);
  const showImg = !!src && !errored;
  return (
    <div
      className={cn(
        radiusClass,
        "bg-muted overflow-hidden flex items-center justify-center shrink-0 ring-2 ring-offset-1 ring-offset-background",
        ringClass ?? "ring-muted-foreground/30",
        onClick && "cursor-pointer hover:opacity-90",
      )}
      style={{ width: size, height: size }}
      onClick={onClick}
      title={alt}
    >
      {showImg ? (
        <img src={src!} alt={alt} referrerPolicy="no-referrer" loading="lazy"
          className="w-full h-full object-cover" onError={() => setErrored(true)} />
      ) : (
        <ImageIcon className="size-4 text-muted-foreground/60" />
      )}
    </div>
  );
}

export default function ChaseListPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("supplier");
  const [showSC, setShowSC] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showTail, setShowTail] = useState<Record<string, boolean>>({});
  const [expandedDay, setExpandedDay] = useState<Record<string, boolean>>({});
  const [selectedDay, setSelectedDay] = useState<string | null>(null); // 'overdue' | yyyy-MM-dd
  const [openClosed, setOpenClosed] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<{ url: string; sku: string } | null>(null);
  const onPreview = (url: string, sku: string) => setPreview({ url, sku });
  const styleCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const queries = useQueries({
    queries: [
      { queryKey: ["chase", "supplier_list"], staleTime: 60_000,
        queryFn: async () => {
          const { data, error } = await supabase.rpc("ops_chase_supplier_list" as never);
          if (error) throw error;
          return (data ?? []) as SupplierRow[];
        } },
      { queryKey: ["chase", "question_count"], staleTime: 60_000,
        queryFn: async () => {
          const { data, error } = await supabase.rpc("ops_chase_question_count" as never);
          if (error) throw error;
          const arr = (data ?? []) as unknown as PendingReviewCount[];
          const row = Array.isArray(arr) ? arr[0] : (arr as unknown as PendingReviewCount);
          return (row ?? { pending_review_orders: 0, pending_review_items: 0, pending_review_qty: 0 }) as PendingReviewCount;
        } },
      { queryKey: ["chase", "purchase_list"], staleTime: 60_000,
        queryFn: async () => {
          const { data, error } = await supabase.rpc("ops_chase_purchase_list" as never);
          if (error) throw error;
          return (data ?? []) as PurchaseRow[];
        } },
      { queryKey: ["chase", "urgency_summary"], staleTime: 60_000,
        queryFn: async () => {
          const { data, error } = await supabase.rpc("ops_chase_urgency_summary" as never);
          if (error) throw error;
          return (data ?? []) as UrgencyRow[];
        } },
      { queryKey: ["chase", "closed_short_list"], staleTime: 60_000,
        queryFn: async () => {
          const { data, error } = await supabase.rpc("ops_chase_closed_short_list" as never);
          if (error) throw error;
          return (data ?? []) as ClosedShortRow[];
        } },
      { queryKey: ["chase", "deadline_timeline"], staleTime: 60_000,
        queryFn: async () => {
          const { data, error } = await supabase.rpc("ops_chase_deadline_timeline" as never);
          if (error) throw error;
          return (data ?? []) as TimelineRow[];
        } },
    ],
  });
  const [supplierQ, questionQ, purchaseQ, urgencyQ, closedQ, timelineQ] = queries;
  const loading = queries.some(q => q.isLoading);
  const anyError = queries.find(q => q.error)?.error as { code?: string; message?: string } | undefined;
  const isForbidden = anyError?.code === "42501" || /42501|权限|permission/i.test(anyError?.message ?? "");

  const supplierRows = (supplierQ.data ?? []) as SupplierRow[];
  const questionCount = (questionQ.data ?? { pending_review_orders: 0, pending_review_items: 0, pending_review_qty: 0 }) as PendingReviewCount;
  const purchaseRows = (purchaseQ.data ?? []) as PurchaseRow[];
  const urgencyRows = (urgencyQ.data ?? []) as UrgencyRow[];
  const closedRows = (closedQ.data ?? []) as ClosedShortRow[];
  const timelineRowsRaw = (timelineQ.data ?? []) as TimelineRow[];

  const urgencyByKey = useMemo(() => {
    const m: Record<string, UrgencyRow> = {};
    for (const r of urgencyRows) m[r.urgency] = r;
    return m;
  }, [urgencyRows]);
  const overdueU = urgencyByKey.overdue;
  const due24U = urgencyByKey.due24;

  const summary = useMemo(() => {
    const totalQty = supplierRows.reduce((s, r) => s + Number(r.total_qty || 0), 0);
    const supplierIds = new Set(supplierRows.map(r => r.supplier_id));
    const skus = new Set(supplierRows.map(r => r.sku));
    return { totalQty, supplierCount: supplierIds.size, skuCount: skus.size };
  }, [supplierRows]);

  // ===== 时间轴预处理：同 deadline_date + product_name 合并 =====
  const today = bjDateStr(new Date());
  const futureDays = [0, 1, 2, 3, 4, 5].map(i => addDays(today, i));

  type TimelineItem = { key: string; product_name: string; style_no: string; image_url: string | null; qty: number; urgency: Urgency };
  type DayBucket = { id: string; label: string; isOverdue: boolean; isToday: boolean; items: TimelineItem[]; totalQty: number };

  const timelineBuckets = useMemo<DayBucket[]>(() => {
    // group by date -> by product_name
    type Acc = { product_name: string; style_no: string; image_url: string | null; qty: number; urgency: Urgency };
    const byDate = new Map<string, Map<string, Acc>>();
    for (const r of timelineRowsRaw) {
      const date = r.deadline_date;
      const name = (r.product_name ?? "").trim() || r.style_no || "未命名";
      let inner = byDate.get(date);
      if (!inner) { inner = new Map(); byDate.set(date, inner); }
      const cur = inner.get(name);
      if (!cur) {
        inner.set(name, { product_name: name, style_no: r.style_no, image_url: r.image_url, qty: Number(r.qty || 0), urgency: r.urgency });
      } else {
        cur.qty += Number(r.qty || 0);
        if (URGENCY_RANK[r.urgency] > URGENCY_RANK[cur.urgency]) cur.urgency = r.urgency;
        if (!cur.image_url && r.image_url) cur.image_url = r.image_url;
      }
    }
    const buckets: DayBucket[] = [];
    // overdue = all dates < today
    const overdueInner = new Map<string, Acc>();
    for (const [date, inner] of byDate) {
      if (date < today) {
        for (const [name, v] of inner) {
          const cur = overdueInner.get(name);
          if (!cur) overdueInner.set(name, { ...v });
          else {
            cur.qty += v.qty;
            if (URGENCY_RANK[v.urgency] > URGENCY_RANK[cur.urgency]) cur.urgency = v.urgency;
            if (!cur.image_url && v.image_url) cur.image_url = v.image_url;
          }
        }
      }
    }
    if (overdueInner.size > 0) {
      const items = Array.from(overdueInner.values())
        .map<TimelineItem>(v => ({ key: v.product_name, ...v }))
        .sort((a, b) => b.qty - a.qty);
      buckets.push({
        id: "overdue", label: "逾期", isOverdue: true, isToday: false,
        items, totalQty: items.reduce((s, x) => s + x.qty, 0),
      });
    }
    for (const date of futureDays) {
      const inner = byDate.get(date);
      const items = inner
        ? Array.from(inner.values()).map<TimelineItem>(v => ({ key: v.product_name, ...v })).sort((a, b) => b.qty - a.qty)
        : [];
      buckets.push({
        id: date, label: date === today ? `今天 ${mdLabel(date)}` : mdLabel(date),
        isOverdue: false, isToday: date === today,
        items, totalQty: items.reduce((s, x) => s + x.qty, 0),
      });
    }
    return buckets;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineRowsRaw, today]);

  // 选中天对应的 product_name 集合，供款卡过滤
  const selectedProductNames = useMemo(() => {
    if (!selectedDay) return null;
    const b = timelineBuckets.find(x => x.id === selectedDay);
    if (!b) return null;
    return new Set(b.items.map(it => it.product_name));
  }, [selectedDay, timelineBuckets]);

  // ===== 款式卡分组 =====
  type StyleCard = {
    style_no: string; product_name: string; image_url: string | null;
    skus: { sku: string; total_qty: number; overdue_qty: number }[];
    totalQty: number; overdueQty: number; due24Qty: number;
    maxDays: number;
  };
  type SupplierGroup = {
    supplier_id: string; supplier_name: string;
    rows: SupplierRow[];
    styles: StyleCard[];
    totalQty: number; overdueQty: number; due24Qty: number;
    styleCount: number; maxDays: number;
  };

  const grouped = useMemo<SupplierGroup[]>(() => {
    const map = new Map<string, SupplierGroup>();
    for (const r of supplierRows) {
      const g = map.get(r.supplier_id) ?? {
        supplier_id: r.supplier_id, supplier_name: r.supplier_name, rows: [],
        styles: [], totalQty: 0, overdueQty: 0, due24Qty: 0, styleCount: 0, maxDays: 0,
      };
      g.rows.push(r);
      g.totalQty += Number(r.total_qty || 0);
      g.overdueQty += Number(r.overdue_qty || 0);
      g.due24Qty += Number(r.due24_qty || 0);
      g.maxDays = Math.max(g.maxDays, Number(r.max_overdue_days || 0));
      map.set(r.supplier_id, g);
    }
    for (const g of map.values()) {
      const sm = new Map<string, StyleCard>();
      for (const r of g.rows) {
        const sk = r.style_no || r.sku;
        const s = sm.get(sk) ?? {
          style_no: r.style_no || "-", product_name: "", image_url: null,
          skus: [], totalQty: 0, overdueQty: 0, due24Qty: 0, maxDays: 0,
        };
        if (!s.product_name && r.product_name) s.product_name = r.product_name;
        if (!s.image_url && r.image_url) s.image_url = r.image_url;
        s.skus.push({ sku: r.sku, total_qty: Number(r.total_qty || 0), overdue_qty: Number(r.overdue_qty || 0) });
        s.totalQty += Number(r.total_qty || 0);
        s.overdueQty += Number(r.overdue_qty || 0);
        s.due24Qty += Number(r.due24_qty || 0);
        s.maxDays = Math.max(s.maxDays, Number(r.max_overdue_days || 0));
        sm.set(sk, s);
      }
      // sort skus by qty desc
      for (const s of sm.values()) s.skus.sort((a, b) => b.total_qty - a.total_qty);
      g.styles = Array.from(sm.values()).sort((a, b) =>
        (b.overdueQty - a.overdueQty) || (b.totalQty - a.totalQty),
      );
      g.styleCount = g.styles.length;
    }
    return Array.from(map.values()).sort((a, b) => b.totalQty - a.totalQty);
  }, [supplierRows]);

  const firstSupplierId = grouped[0]?.supplier_id;
  const isExpanded = (id: string) => expanded[id] ?? id === firstSupplierId;
  const toggle = (id: string) => setExpanded(s => ({ ...s, [id]: !isExpanded(id) }));

  const visiblePurchase = useMemo(
    () => showSC ? purchaseRows : purchaseRows.filter(r => (r.sku || "").toUpperCase() !== "SC"),
    [purchaseRows, showSC],
  );

  // SKU 缩略图：仍按已展开供应商批量取（用于大图预览 onClick 等场景）
  const supplierTabSkus = useMemo(() => {
    const set = new Set<string>();
    for (const g of grouped) if (isExpanded(g.supplier_id))
      for (const r of g.rows) set.add(r.sku);
    return Array.from(set);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouped, expanded, firstSupplierId]);
  const purchaseTabSkus = useMemo(() => visiblePurchase.map(r => r.sku), [visiblePurchase]);
  const closedTabSkus = useMemo(() => closedRows.map(r => r.sku), [closedRows]);

  const supplierImgQ = useSkuImages(supplierTabSkus, tab === "supplier");
  const purchaseImgQ = useSkuImages(purchaseTabSkus, tab === "purchase");
  const closedImgQ = useSkuImages(closedTabSkus, tab === "closed");

  const exportSupplier = (g: SupplierGroup) => {
    const headers = ["款号", "SKU", "总件数", "其中已超时", "24小时内到期", "最长超期天数", "涉及采购单号"];
    const rows = g.rows.map(r => [
      r.style_no, r.sku,
      Number(r.total_qty || 0), Number(r.overdue_qty || 0), Number(r.due24_qty || 0),
      Number(r.max_overdue_days || 0),
      (r.po_details ?? []).map(p => p.po_id).join(" / "),
    ]);
    downloadCSV(`催货单_${g.supplier_name}_${todayCN()}.csv`, headers, rows);
  };

  const exportAll = () => {
    const headers = ["供应商", "款号", "SKU", "总件数", "其中已超时", "24小时内到期", "最长超期天数", "涉及采购单号"];
    const rows: (string | number)[][] = [];
    for (const g of grouped) for (const r of g.rows) {
      rows.push([
        g.supplier_name, r.style_no, r.sku,
        Number(r.total_qty || 0), Number(r.overdue_qty || 0), Number(r.due24_qty || 0),
        Number(r.max_overdue_days || 0),
        (r.po_details ?? []).map(p => p.po_id).join(" / "),
      ]);
    }
    downloadCSV(`催货单_全部_${todayCN()}.csv`, headers, rows);
  };

  const exportClosed = () => {
    const headers = ["SKU", "款号", "供应商", "少交件数", "影响订单数", "影响采购单数", "最早付款"];
    const rows = closedRows.map(r => [
      r.sku, r.style_no || "", r.supplier_name || "",
      Number(r.short_qty || 0), Number(r.order_count || 0), Number(r.po_count || 0),
      fmtMMDDHM(r.oldest_pay_time),
    ]);
    downloadCSV(`厂家已结单缺口_${todayCN()}.csv`, headers, rows);
  };

  const refresh = () => queries.forEach(q => q.refetch());

  const copyChaseMsg = async (g: SupplierGroup, visibleStyles: StyleCard[]) => {
    const dStr = (() => {
      const [, m, d] = today.split("-");
      return `${Number(m)}/${Number(d)}`;
    })();
    const lines: string[] = [];
    lines.push(`${g.supplier_name || "供应商"} ${dStr} 催货：`);
    let total = 0;
    for (const s of visibleStyles) {
      const skuPart = s.skus.map(sk => `${skuTail(sk.sku)}×${sk.total_qty}`).join("、");
      const overdueMark = s.overdueQty > 0 ? `（超时${s.maxDays}天）` : "";
      lines.push(`【${s.style_no} ${s.product_name || ""}】${skuPart}${overdueMark}`);
      total += s.totalQty;
    }
    lines.push(`合计 ${total} 件，麻烦尽快安排,谢谢！`);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("催货消息已复制");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  const scrollToStyle = (styleNo: string) => {
    const el = styleCardRefs.current[styleNo];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary");
      setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 1800);
    }
  };

  // 时间轴段颜色：浅底深字
  const bucketBg = (b: DayBucket) =>
    b.isOverdue ? "bg-[#FCEBEB] text-[#791F1F]"
      : b.isToday ? "bg-[#EEEDFE] text-[#26215C]"
      : b.id === addDays(today, 1) ? "bg-[#FAEEDA] text-[#633806]"
      : "bg-[#E1F5EE] text-[#04342C]";

  return (
    <div className="p-6">
      <PageHeader
        breadcrumb={["运维系统", "催货清单"]}
        title="催货清单"
        description="按供应商汇总当前所有超期未发货 SKU，便于采购集中跟进。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportAll} disabled={loading || grouped.length === 0}>
              <Download className="mr-1" /> 导出全部
            </Button>
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={cn(loading && "animate-spin")} /> 刷新
            </Button>
          </>
        }
      />

      {isForbidden && (
        <Card className="border-amber-300 bg-amber-50/60 mb-4">
          <CardContent className="py-4 flex items-center gap-2 text-sm text-amber-800">
            <AlertTriangle className="text-amber-600" />
            此页面仅限内部账号访问。
          </CardContent>
        </Card>
      )}
      {!isForbidden && anyError && (
        <Card className="border-destructive/40 bg-destructive/5 mb-4">
          <CardContent className="py-4 text-sm text-destructive">
            数据加载失败：{anyError.message ?? "未知错误"}
          </CardContent>
        </Card>
      )}

      {/* 汇总卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <SummaryCard label="需催货件数" loading={loading}
          value={fmtNum(summary.totalQty)} suffix="件"
          extra={`涉及 ${fmtNum(summary.supplierCount)} 家供应商 · ${fmtNum(summary.skuCount)} 个 SKU`} />
        <SummaryCard label="已对客超时" loading={loading}
          value={fmtNum(overdueU?.qty ?? 0)} suffix="件" accent="danger"
          extra={`${fmtNum(overdueU?.order_count ?? 0)} 单`} />
        <SummaryCard label="24小时内到期" loading={loading}
          value={fmtNum(due24U?.qty ?? 0)} suffix="件" accent="warning"
          extra={`${fmtNum(due24U?.order_count ?? 0)} 单 · 今晚必催`} />
        <SummaryCard label="待审核单" loading={loading}
          value={fmtNum(questionCount.pending_review_orders)} suffix="单"
          onClick={() => navigate("/operations/sales-orders?order_status=Question")}
          extra="点击查看" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="supplier">按供应商催货</TabsTrigger>
          <TabsTrigger value="purchase">采购缺口</TabsTrigger>
          <TabsTrigger value="closed">厂家已结单</TabsTrigger>
        </TabsList>

        <TabsContent value="supplier" className="mt-4 space-y-4">
          {/* === 区块一：时间轴 === */}
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : timelineBuckets.length > 0 && (
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium">发货截止时间轴</div>
                  {selectedDay && (
                    <Button variant="ghost" size="sm" onClick={() => setSelectedDay(null)}>
                      <X className="size-3 mr-1" /> 清除筛选
                    </Button>
                  )}
                </div>
                <TooltipProvider delayDuration={150}>
                  <div className="overflow-x-auto">
                    <div className="flex items-stretch gap-1 min-w-max w-full">
                      {timelineBuckets.map((b) => {
                        const isSel = selectedDay === b.id;
                        const visibleItems = expandedDay[b.id] ? b.items : b.items.slice(0, 3);
                        const hiddenCount = b.items.length - visibleItems.length;
                        return (
                          <div key={b.id} className="flex-1 min-w-[140px] flex flex-col items-center">
                            {/* 缩略图行 */}
                            <div className="flex items-end justify-center gap-2 min-h-[56px] mb-[10px] px-1 flex-wrap">
                              {visibleItems.map((it) => (
                                <Tooltip key={it.key}>
                                  <TooltipTrigger asChild>
                                    <div className="relative">
                                      <ProductThumb
                                        src={it.image_url}
                                        alt={it.product_name}
                                        size={48}
                                        radiusClass="rounded-lg"
                                        ringClass={URGENCY_RING[it.urgency]}
                                        onClick={() => scrollToStyle(it.style_no)}
                                      />
                                      <span className="absolute -bottom-1 -right-1 bg-foreground text-background text-[10px] leading-none rounded-full px-1 py-0.5 min-w-[16px] text-center">
                                        {it.qty}
                                      </span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <div className="text-xs">
                                      <div className="font-mono">{it.style_no}</div>
                                      <div>{it.product_name}</div>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              ))}
                              {hiddenCount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedDay(s => ({ ...s, [b.id]: true }))}
                                  className="w-12 h-12 rounded-lg bg-muted text-muted-foreground text-xs font-medium flex items-center justify-center hover:bg-muted/80"
                                  aria-label="展开更多"
                                >
                                  +{hiddenCount}
                                </button>
                              )}
                            </div>
                            {/* 彩带段 */}
                            <button
                              type="button"
                              onClick={() => setSelectedDay(s => s === b.id ? null : b.id)}
                              className={cn(
                                "relative w-full flex flex-col items-center justify-center transition-opacity",
                                bucketBg(b),
                                !isSel && selectedDay && "opacity-40",
                              )}
                              style={{
                                height: 44,
                                clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%, 10px 50%)",
                              }}
                            >
                              <div className="text-[13px] font-medium leading-tight">{b.label}</div>
                              <div className="text-[11px] opacity-90">{fmtNum(b.totalQty)} 件</div>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </TooltipProvider>
              </CardContent>
            </Card>
          )}

          {/* === 区块二：按供应商分组的款式卡 === */}
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-32 w-full" />)}
            </div>
          ) : grouped.length === 0 ? (
            <Card>
              <CardContent className="py-12 flex flex-col items-center text-center gap-2 text-emerald-700">
                <PartyPopper className="size-8" />
                <div className="font-medium">当前没有需要催货的供应商 🎉</div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {grouped.map(g => {
                const open = isExpanded(g.supplier_id);
                // 当选中某天时只显示对应 product_name 的款
                const filteredStyles = selectedProductNames
                  ? g.styles.filter(s => selectedProductNames.has(s.product_name))
                  : g.styles;
                // 长尾折叠：totalQty<=2
                const main = filteredStyles.filter(s => s.totalQty > 2);
                const tail = filteredStyles.filter(s => s.totalQty <= 2);
                const tailKey = `tail|${g.supplier_id}`;
                const tailOpen = !!showTail[tailKey];
                const visibleForCopy = main.concat(tailOpen ? tail : []);
                if (filteredStyles.length === 0) return null;
                return (
                  <Card key={g.supplier_id}>
                    <div
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 cursor-pointer flex-wrap"
                      onClick={() => toggle(g.supplier_id)}
                    >
                      {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      <div className="font-medium truncate">{g.supplier_name || "未知供应商"}</div>
                      <div className="text-sm text-muted-foreground hidden sm:block">
                        催货 <span className="text-foreground font-semibold">{fmtNum(g.totalQty)}</span> 件 · {fmtNum(g.styleCount)} 款
                      </div>
                      {g.overdueQty > 0 && (
                        <span className="inline-flex items-center text-[11px] leading-none rounded-md bg-[#FCEBEB] text-[#791F1F] font-medium" style={{ padding: "2px 8px" }}>
                          已超时 {fmtNum(g.overdueQty)} 件
                        </span>
                      )}
                      {g.due24Qty > 0 && (
                        <span className="inline-flex items-center text-[11px] leading-none rounded-md bg-[#FAEEDA] text-[#633806] font-medium" style={{ padding: "2px 8px" }}>
                          24h内 {fmtNum(g.due24Qty)} 件
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => copyChaseMsg(g, visibleForCopy)}>
                          <Copy className="size-3 mr-1" /> 复制催货消息
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => exportSupplier(g)}>
                          <Download className="size-3 mr-1" /> 导出催货单
                        </Button>
                      </div>
                    </div>
                    {open && (
                      <div className="border-t p-3 space-y-3">
                        {main.length === 0 && tail.length === 0 && (
                          <div className="text-sm text-muted-foreground py-2 text-center">无匹配款式</div>
                        )}
                        {main.map(s => (
                          <StyleCardRow
                            key={s.style_no}
                            innerRef={el => { styleCardRefs.current[s.style_no] = el; }}
                            style={s}
                            onPreview={onPreview}
                          />
                        ))}
                        {tail.length > 0 && (
                          <div className="pt-1">
                            <button
                              type="button"
                              className="text-xs text-muted-foreground border-t border-dashed w-full text-left pt-2 hover:text-foreground"
                              onClick={() => setShowTail(s => ({ ...s, [tailKey]: !s[tailKey] }))}
                            >
                              {tailOpen ? "▾ 收起零头" : `▸ 另有零头 ${tail.length} 款 · 共 ${tail.reduce((x, s) => x + s.totalQty, 0)} 件`}
                            </button>
                            {tailOpen && (
                              <div className="mt-2 space-y-3">
                                {tail.map(s => (
                                  <StyleCardRow
                                    key={s.style_no}
                                    innerRef={el => { styleCardRefs.current[s.style_no] = el; }}
                                    style={s}
                                    onPreview={onPreview}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="purchase" className="mt-4">
          <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
            <div className="text-xs text-muted-foreground">
              缺口 = 未匹配待发 + 已结单少交 - 销退可复售冲抵；已结单少交=厂家已完成采购单的未交数量（不会再补交）；当天新上款采购单可能尚未同步，缺口仅供参考
            </div>
            <div className="flex items-center gap-2">
              <Switch id="show-sc" checked={showSC} onCheckedChange={setShowSC} />
              <Label htmlFor="show-sc" className="text-sm">显示赠品SC</Label>
            </div>
          </div>
          {loading ? <Skeleton className="h-64 w-full" /> : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[960px]">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium w-14">图</th>
                      <th className="text-left px-4 py-2 font-medium">SKU</th>
                      <th className="text-left px-4 py-2 font-medium">款号</th>
                      <th className="text-left px-4 py-2 font-medium">供应商</th>
                      <th className="text-right px-4 py-2 font-medium">待发</th>
                      <th className="text-right px-4 py-2 font-medium">在途</th>
                      <th className="text-right px-4 py-2 font-medium">已结单少交</th>
                      <th className="text-right px-4 py-2 font-medium">销退冲抵</th>
                      <th className="text-right px-4 py-2 font-medium">最终缺口</th>
                      <th className="text-left px-4 py-2 font-medium">最早付款</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePurchase.length === 0 ? (
                      <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">暂无数据</td></tr>
                    ) : visiblePurchase.map((r, i) => (
                      <tr key={i} className={cn("border-t", Number(r.final_gap) > 0 && "bg-red-50/60")}>
                        <td className="px-4 py-2">
                          <SkuThumb sku={r.sku} imageUrl={purchaseImgQ.data?.[r.sku]} onPreview={onPreview} />
                        </td>
                        <td className="px-4 py-2 font-mono">{r.sku}</td>
                        <td className="px-4 py-2">{r.style_no || "-"}</td>
                        <td className="px-4 py-2">{r.supplier_name || "-"}</td>
                        <td className="px-4 py-2 text-right">{fmtNum(r.pending_qty)}</td>
                        <td className="px-4 py-2 text-right">{fmtNum(r.intransit_qty)}</td>
                        <td className={cn("px-4 py-2 text-right", Number(r.closed_short_qty) > 0 && "text-amber-700")}>{fmtNum(r.closed_short_qty)}</td>
                        <td className="px-4 py-2 text-right">{fmtNum(r.return_offset)}</td>
                        <td className={cn("px-4 py-2 text-right font-semibold", Number(r.final_gap) > 0 && "text-destructive")}>
                          {fmtNum(r.final_gap)}
                        </td>
                        <td className="px-4 py-2">{fmtMMDDHM(r.earliest_pay_time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="closed" className="mt-4">
          <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
            <div className="text-xs text-muted-foreground">
              供应商已结单交付完毕，此处缺口不会再到货，需决策补单或退款
            </div>
            <Button variant="outline" size="sm" onClick={exportClosed} disabled={loading || closedRows.length === 0}>
              <Download className="mr-1" /> 导出 CSV
            </Button>
          </div>
          {loading ? <Skeleton className="h-64 w-full" /> : closedRows.length === 0 ? (
            <Card>
              <CardContent className="py-12 flex flex-col items-center text-center gap-2 text-emerald-700">
                <PartyPopper className="size-8" />
                <div className="font-medium">暂无厂家已结单的缺口 🎉</div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[900px]">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium w-8"></th>
                      <th className="text-left px-4 py-2 font-medium w-14">图</th>
                      <th className="text-left px-4 py-2 font-medium">SKU</th>
                      <th className="text-left px-4 py-2 font-medium">款号</th>
                      <th className="text-left px-4 py-2 font-medium">供应商</th>
                      <th className="text-right px-4 py-2 font-medium">少交件数</th>
                      <th className="text-right px-4 py-2 font-medium">影响订单数</th>
                      <th className="text-left px-4 py-2 font-medium">最早付款</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedRows.map((r, i) => {
                      const key = `closed|${r.sku}|${i}`;
                      const open = !!openClosed[key];
                      const hasDetails = (r.po_details?.length ?? 0) > 0;
                      return (
                        <React.Fragment key={key}>
                          <tr className="border-t hover:bg-muted/20">
                            <td className="px-4 py-2">
                              {hasDetails && (
                                <button type="button"
                                  onClick={() => setOpenClosed(s => ({ ...s, [key]: !s[key] }))}
                                  className="text-muted-foreground hover:text-foreground"
                                  aria-label="展开采购单">
                                  {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                                </button>
                              )}
                            </td>
                            <td className="px-4 py-2">
                              <SkuThumb sku={r.sku} imageUrl={closedImgQ.data?.[r.sku]} onPreview={onPreview} />
                            </td>
                            <td className="px-4 py-2 font-mono">{r.sku}</td>
                            <td className="px-4 py-2">{r.style_no || "-"}</td>
                            <td className="px-4 py-2">{r.supplier_name || "-"}</td>
                            <td className="px-4 py-2 text-right font-semibold text-destructive">{fmtNum(r.short_qty)}</td>
                            <td className="px-4 py-2 text-right">{fmtNum(r.order_count)}</td>
                            <td className="px-4 py-2">{fmtMMDDHM(r.oldest_pay_time)}</td>
                          </tr>
                          {open && hasDetails && (
                            <tr className="bg-muted/10 border-t">
                              <td></td>
                              <td colSpan={7} className="px-4 py-2">
                                <table className="text-xs w-full">
                                  <thead className="text-muted-foreground">
                                    <tr>
                                      <th className="text-left py-1 pr-4 font-normal">采购单号</th>
                                      <th className="text-left py-1 pr-4 font-normal">协议到货</th>
                                      <th className="text-right py-1 font-normal">少交数</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {r.po_details.map((p, idx) => (
                                      <tr key={idx}>
                                        <td className="py-1 pr-4 font-mono">{p.po_id}</td>
                                        <td className="py-1 pr-4">{p.delivery_date ? formatDateTimeCN(p.delivery_date, { withSeconds: false }) : "-"}</td>
                                        <td className="py-1 text-right text-destructive">{fmtNum(p.short_qty)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null); }}>
        <DialogContent className="max-w-2xl p-2">
          {preview && (
            <div className="flex flex-col items-center gap-2">
              <img src={preview.url} alt={preview.sku} referrerPolicy="no-referrer"
                className="max-h-[80vh] w-auto object-contain rounded" />
              <div className="text-xs text-muted-foreground font-mono pb-2">{preview.sku}</div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StyleCardRow({ style: s, innerRef, onPreview }: {
  style: {
    style_no: string; product_name: string; image_url: string | null;
    skus: { sku: string; total_qty: number; overdue_qty: number }[];
    totalQty: number; overdueQty: number; due24Qty: number; maxDays: number;
  };
  innerRef: (el: HTMLDivElement | null) => void;
  onPreview: (url: string, sku: string) => void;
}) {
  const [showAllSkus, setShowAllSkus] = useState(false);
  const visibleSkus = showAllSkus ? s.skus : s.skus.slice(0, 6);
  const hiddenCount = s.skus.length - visibleSkus.length;
  return (
    <div
      ref={innerRef}
      className="flex items-center gap-3 p-3 border rounded-md bg-card transition-shadow"
    >
      <ProductThumb
        src={s.image_url}
        alt={s.product_name || s.style_no}
        size={64}
        ringClass={s.overdueQty > 0 ? "ring-red-500" : s.due24Qty > 0 ? "ring-orange-500" : "ring-muted-foreground/30"}
        onClick={() => s.image_url && onPreview(s.image_url, s.style_no)}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="font-mono text-sm font-medium">{s.style_no}</span>
          {s.product_name && <span className="text-sm text-muted-foreground truncate">{s.product_name}</span>}
          {s.overdueQty > 0 && (
            <Badge variant="destructive">已超时 {s.overdueQty} 件 · 最长 {s.maxDays} 天</Badge>
          )}
          {s.overdueQty === 0 && s.due24Qty > 0 && (
            <Badge className="bg-orange-500 hover:bg-orange-500/90 text-white border-transparent">
              24h内 {s.due24Qty} 件
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {visibleSkus.map(sk => (
            <span
              key={sk.sku}
              className={cn(
                "inline-flex items-center text-xs font-mono rounded-full px-2 py-0.5 bg-muted",
                sk.overdue_qty > 0 && "border border-red-500 text-red-700 bg-red-50",
              )}
              title={sk.sku}
            >
              {skuTail(sk.sku)} × {sk.total_qty}
            </span>
          ))}
          {hiddenCount > 0 && (
            <button type="button" className="text-xs text-muted-foreground underline"
              onClick={() => setShowAllSkus(true)}>
              +{hiddenCount}
            </button>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-2xl font-bold leading-none">{s.totalQty.toLocaleString("zh-CN")}</div>
        <div className="text-[10px] text-muted-foreground mt-1">件</div>
      </div>
    </div>
  );
}

function SummaryCard({
  label, value, suffix, extra, accent, loading, onClick,
}: {
  label: string; value: string; suffix?: string; extra?: string;
  accent?: "danger" | "warning"; loading?: boolean; onClick?: () => void;
}) {
  return (
    <Card className={cn(onClick && "cursor-pointer hover:shadow-md transition-shadow")} onClick={onClick}>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground mb-1">{label}</div>
        {loading ? <Skeleton className="h-7 w-20" /> : (
          <div className="flex items-baseline gap-1">
            <span className={cn("text-2xl font-bold",
              accent === "danger" && "text-destructive",
              accent === "warning" && "text-orange-500")}>{value}</span>
            {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
          </div>
        )}
        {extra && <div className="text-xs text-muted-foreground mt-1">{extra}</div>}
      </CardContent>
    </Card>
  );
}
