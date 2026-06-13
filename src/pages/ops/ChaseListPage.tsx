import React, { useMemo, useState } from "react";
import { useQueries, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, RefreshCw, Download, ChevronDown, ChevronRight,
  PartyPopper, ImageIcon, Ban, Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ops/PageHeader";
import ChaseListVisual, { exportCsv as exportSupplierCsv, type SupplierGroup, type UnmatchedRow } from "@/components/ops/ChaseListVisual";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
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
  is_quantui: boolean; quantui_supplier: string | null; quantui_remark: string | null;
};
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
  snapshot_at: string | null;
};
// 7 天待发货全景（ops_chase_demand_overview）：每个供应状态一行。
// in_transit 已按安全缓冲（p_buffer_days，默认 3 天）拆为 in_transit_tight/in_transit_safe
type OverviewCategory =
  | "in_transit_safe" | "in_transit_tight"
  | "gap" | "late_order" | "closed_short" | "urge_supplier";
type OverviewRow = {
  category: string;
  qty_7d: number;
  orders_7d: number;
  qty_overdue: number;
  orders_overdue: number;
};
// 六状态分解：category → 中文标签 + 点击跳转页签（「无采购单」按需求跳「采购缺口」）；
// warn=橙色告警强调（「在路上·吃紧」是会伪装成安全的隐藏风险），tip=悬停说明
const OVERVIEW_CATEGORIES: { key: OverviewCategory; label: string; tab: string; warn?: boolean; tip?: string }[] = [
  { key: "in_transit_safe", label: "在路上·宽裕", tab: "purchase" },
  { key: "in_transit_tight", label: "在路上·吃紧", tab: "purchase", warn: true,
    tip: "交期距发货截止≤3天，供应商稍有延误就会错过平台发货，需提前盯" },
  { key: "gap", label: "无采购单", tab: "purchase" },
  { key: "late_order", label: "会迟到", tab: "purchase" },
  { key: "closed_short", label: "厂家少交", tab: "closed" },
  { key: "urge_supplier", label: "催供应商", tab: "supplier" },
];

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

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// 调 chase-export 函数取带图 xlsx；非 2xx 时尽量取出函数返回的中文错误
async function invokeChaseExport(body: { mode: "supplier"; supplier_id: string } | { mode: "closed" }): Promise<Blob> {
  const { data, error } = await supabase.functions.invoke("chase-export", { body });
  if (error) {
    let msg = (error as Error).message ?? "未知错误";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try { msg = ((await ctx.json()) as { error?: string }).error ?? msg; } catch { /* 保留原消息 */ }
    }
    throw new Error(msg);
  }
  if (!(data instanceof Blob)) throw new Error("响应格式异常");
  return data;
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

export default function ChaseListPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("supplier");
  // 五档筛选提升到页面：页头红色「已过发货截止」点击可强制为「已逾期」，且切页签不丢筛选
  const [tierFilter, setTierFilter] = useState<Set<Urgency>>(() => new Set<Urgency>(["overdue", "due24"]));
  const [showSC, setShowSC] = useState(false);
  const [openClosed, setOpenClosed] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<{ url: string; sku: string } | null>(null);
  const onPreview = (url: string, sku: string) => setPreview({ url, sku });

  const qc = useQueryClient();
  const [markTarget, setMarkTarget] = useState<{ styleNo: string; name: string } | null>(null);
  const [markRemark, setMarkRemark] = useState("");
  const [unmarkTarget, setUnmarkTarget] = useState<PurchaseRow | null>(null);

  // 劝退「标记」入口在【按供应商催货 → 供应商未匹配】(运营在那里对"有急单却无供应商"的款
  // 拿主意)：按 style_no 标记整款。写 ops_chase_style_flags（admin/ops 经 RLS 放行；该页
  // RPC 已限内部，按钮无需另判角色）。original_supplier_name 留空交 BEFORE INSERT 触发器从
  // 主档回填（未匹配款多半本就无供应商，回填为空属正常）。写后只失效 chase 系列查询重拉，
  // 无需调 refresh_risk_meta（催货/未匹配清单后端已自动排除劝退款）。
  const markMutation = useMutation({
    mutationFn: async ({ styleNo, remark }: { styleNo: string; remark: string }) => {
      const { error } = await supabase.from("ops_chase_style_flags").insert({
        flag: "quantui",
        style_no: styleNo,
        remark: remark.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("已标记为劝退款");
      setMarkTarget(null);
      setMarkRemark("");
      qc.invalidateQueries({ queryKey: ["chase"] });
    },
    onError: (e) => toast.error(`标记劝退失败：${(e as Error).message}`),
  });

  const unmarkMutation = useMutation({
    mutationFn: async (row: PurchaseRow) => {
      // 与标记对称：按款号标记的按款号删，按 SKU 标记的按 SKU 删
      let q = supabase.from("ops_chase_style_flags").delete().eq("flag", "quantui");
      if (row.style_no?.trim()) q = q.eq("style_no", row.style_no.trim()).is("sku", null);
      else q = q.eq("sku", row.sku).is("style_no", null);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("已取消劝退");
      setUnmarkTarget(null);
      qc.invalidateQueries({ queryKey: ["chase"] });
    },
    onError: (e) => toast.error(`取消劝退失败：${(e as Error).message}`),
  });

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
      { queryKey: ["chase", "closed_short_list"], staleTime: 60_000,
        queryFn: async () => {
          const { data, error } = await supabase.rpc("ops_chase_closed_short_list" as never);
          if (error) throw error;
          return (data ?? []) as ClosedShortRow[];
        } },
      // 时间轴曾因现场计算超时整条开天窗:失败自动重试一次;
      // react-query 在刷新失败时本就保留上次成功数据,页面据此继续展示
      { queryKey: ["chase", "deadline_timeline"], staleTime: 60_000,
        retry: 1, retryDelay: 1500,
        queryFn: async () => {
          const { data, error } = await supabase.rpc("ops_chase_deadline_timeline" as never);
          if (error) throw error;
          return (data ?? []) as TimelineRow[];
        } },
      { queryKey: ["chase", "unmatched_list"], staleTime: 60_000,
        queryFn: async () => {
          const { data, error } = await supabase.rpc("ops_chase_unmatched_list" as never);
          if (error) throw error;
          return (data ?? []) as UnmatchedRow[];
        } },
      // 7 天待发货全景：头部主数字 / 红色逾期数 / 五状态分解的唯一数据源（实时求和，不写死）
      { queryKey: ["chase", "demand_overview"], staleTime: 60_000,
        queryFn: async () => {
          const { data, error } = await supabase.rpc("ops_chase_demand_overview" as never);
          if (error) throw error;
          return (data ?? []) as OverviewRow[];
        } },
    ],
  });
  const [supplierQ, questionQ, purchaseQ, closedQ, timelineQ, unmatchedQ, overviewQ] = queries;
  const loading = queries.some(q => q.isLoading);
  // 硬失败 = 出错且没有任何可展示数据;刷新失败但留有上次成功数据的算软失败,
  // 继续展示旧数据并提示,不让整页/整条时间轴开天窗
  const hardError = queries.find(q => q.error && q.data == null)?.error as { code?: string; message?: string } | undefined;
  const softFailed = queries.some(q => q.error && q.data != null);
  const isForbidden = hardError?.code === "42501" || /42501|权限|permission/i.test(hardError?.message ?? "");

  const supplierRows = (supplierQ.data ?? []) as SupplierRow[];
  const questionCount = (questionQ.data ?? { pending_review_orders: 0, pending_review_items: 0, pending_review_qty: 0 }) as PendingReviewCount;
  const purchaseRows = (purchaseQ.data ?? []) as PurchaseRow[];
  const closedRows = (closedQ.data ?? []) as ClosedShortRow[];
  const timelineRowsRaw = (timelineQ.data ?? []) as TimelineRow[];
  const unmatchedRows = (unmatchedQ.data ?? []) as UnmatchedRow[];
  const overviewRows = (overviewQ.data ?? []) as OverviewRow[];

  // 头部全景：7 天内待发货 = Σqty_7d；已过发货截止 = Σqty_overdue（均实时求和，不写死）
  const overview = useMemo(() => {
    const byCat = new Map<string, OverviewRow>();
    for (const r of overviewRows) byCat.set(r.category, r);
    const totalQty7d = overviewRows.reduce((s, r) => s + Number(r.qty_7d || 0), 0);
    const totalOverdue = overviewRows.reduce((s, r) => s + Number(r.qty_overdue || 0), 0);
    return { byCat, totalQty7d, totalOverdue };
  }, [overviewRows]);

  const summary = useMemo(() => {
    const totalQty = supplierRows.reduce((s, r) => s + Number(r.total_qty || 0), 0);
    const supplierIds = new Set(supplierRows.map(r => r.supplier_id));
    return { totalQty, supplierCount: supplierIds.size };
  }, [supplierRows]);

  const visiblePurchase = useMemo(
    () => showSC ? purchaseRows : purchaseRows.filter(r => (r.sku || "").toUpperCase() !== "SC"),
    [purchaseRows, showSC],
  );

  // 劝退款单独分组：真实缺口仅 is_quantui=false，不与劝退款混算
  const realPurchase = useMemo(() => visiblePurchase.filter(r => !r.is_quantui), [visiblePurchase]);
  const quantuiPurchase = useMemo(() => visiblePurchase.filter(r => r.is_quantui), [visiblePurchase]);

  const purchaseTabSkus = useMemo(() => visiblePurchase.map(r => r.sku), [visiblePurchase]);
  const closedTabSkus = useMemo(() => closedRows.map(r => r.sku), [closedRows]);

  const purchaseImgQ = useSkuImages(purchaseTabSkus, tab === "purchase");
  const closedImgQ = useSkuImages(closedTabSkus, tab === "closed");

  // 按供应商催货：服务端带图 xlsx，失败回退本地 CSV
  const exportSupplier = async (g: SupplierGroup) => {
    try {
      const blob = await invokeChaseExport({ mode: "supplier", supplier_id: g.id });
      downloadBlob(blob, `催货单_${g.name}_${todayCN()}.xlsx`);
    } catch (e) {
      toast.error(`带图催货单生成失败：${(e as Error).message}，已回退本地 CSV`);
      exportSupplierCsv(g, todayCN());
    }
  };

  const exportClosedCsv = () => {
    const headers = ["SKU", "款号", "供应商", "少交件数", "影响订单数", "影响采购单数", "最早付款"];
    const rows = closedRows.map(r => [
      r.sku, r.style_no || "", r.supplier_name || "",
      Number(r.short_qty || 0), Number(r.order_count || 0), Number(r.po_count || 0),
      fmtMMDDHM(r.oldest_pay_time),
    ]);
    downloadCSV(`厂家已结单缺口_${todayCN()}.csv`, headers, rows);
  };

  // 厂家已结单：与按供应商催货共用 chase-export，失败回退本地 CSV
  const [closedExporting, setClosedExporting] = useState(false);
  const exportClosed = async () => {
    setClosedExporting(true);
    try {
      const blob = await invokeChaseExport({ mode: "closed" });
      downloadBlob(blob, `厂家已结单缺口_${todayCN()}.xlsx`);
    } catch (e) {
      toast.error(`带图导出生成失败：${(e as Error).message}，已回退本地 CSV`);
      exportClosedCsv();
    } finally {
      setClosedExporting(false);
    }
  };

  const refresh = () => queries.forEach(q => q.refetch());

  return (
    <div className="p-6">
      <PageHeader
        breadcrumb={["运维系统", "催货清单"]}
        title="催货清单"
        description="平台发货截止时间驱动的行动清单：只统计发货截止在【已逾期～未来 7 天】内的待发货需求；7 天以外的订单不进入本页（它们的问题由「采购缺口」页签负责）。"
        actions={
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={cn(loading && "animate-spin")} /> 刷新
          </Button>
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
      {!isForbidden && hardError && (
        <Card className="border-destructive/40 bg-destructive/5 mb-4">
          <CardContent className="py-4 text-sm text-destructive">
            数据加载失败：{hardError.message ?? "未知错误"}
          </CardContent>
        </Card>
      )}
      {!isForbidden && !hardError && softFailed && (
        <Card className="border-amber-300 bg-amber-50/60 mb-4">
          <CardContent className="py-3 text-xs text-amber-800 flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-600 shrink-0" />
            部分数据刷新失败，正在展示上次成功的结果；点击右上角「刷新」重试。
          </CardContent>
        </Card>
      )}

      {/* ======== 7 天待发货全景（头部主数字 + 逾期红线 + 五状态分解） ======== */}
      {!isForbidden && !hardError && (
        <Card className="mb-4">
          <CardContent className="py-4">
            {overviewQ.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <>
                <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">7 天内待发货</div>
                    <div className="text-3xl font-semibold tabular-nums leading-none">
                      {fmtNum(overview.totalQty7d)}
                      <span className="ml-1 text-base font-normal text-muted-foreground">件</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setTab("supplier"); setTierFilter(new Set<Urgency>(["overdue"])); }}
                    className="text-left group"
                    title="切到「立即催供应商」并筛出已逾期项"
                  >
                    <div className="text-xs text-destructive/80 mb-1">已过发货截止</div>
                    <div className="text-3xl font-semibold tabular-nums leading-none text-destructive group-hover:underline underline-offset-4">
                      {fmtNum(overview.totalOverdue)}
                      <span className="ml-1 text-base font-normal">件</span>
                    </div>
                  </button>
                </div>
                <div className="mt-3 pt-3 border-t flex flex-wrap items-center gap-y-1 text-sm text-muted-foreground">
                  {OVERVIEW_CATEGORIES.map((c, i) => {
                    const row = overview.byCat.get(c.key);
                    const qty = Number(row?.qty_7d || 0);
                    const overdue = Number(row?.qty_overdue || 0);
                    return (
                      <span key={c.key} className="inline-flex items-baseline">
                        {i > 0 && <span className="mx-1.5 text-muted-foreground/40">·</span>}
                        <button type="button"
                          className={cn("hover:text-foreground", c.warn && "text-orange-600 hover:text-orange-700 font-medium")}
                          onClick={() => setTab(c.tab)} title={c.tip ?? `查看${c.label}`}>
                          {c.label} <span className={cn("tabular-nums", !c.warn && "text-foreground")}>{fmtNum(qty)}</span>
                        </button>
                        {overdue > 0 && (
                          <span className="ml-1 text-xs text-destructive">逾期{fmtNum(overdue)}</span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="supplier">按供应商催货</TabsTrigger>
          <TabsTrigger value="purchase">采购缺口</TabsTrigger>
          <TabsTrigger value="closed">厂家已结单</TabsTrigger>
        </TabsList>

        <TabsContent value="supplier" className="mt-4">
          <div className="text-xs text-muted-foreground mb-2 flex items-center gap-3 flex-wrap">
            <span>
              口径：发货截止在【已逾期～未来 7 天】内、已匹配到在产采购单的需求（可催）＋「供应商未匹配」兜底桶（平台副本款）；
              无采购单的缺货新款、下单过迟与已结单少交分别见「采购缺口」「厂家已结单」
            </span>
            <span className="shrink-0">
              立即催供应商 {fmtNum(summary.totalQty)} 件 · {fmtNum(summary.supplierCount)} 家供应商
              {" · "}
              <button type="button" className="underline underline-offset-2 hover:text-foreground"
                onClick={() => navigate("/operations/sales-orders?order_status=Question")}>
                待审核 {fmtNum(questionCount.pending_review_orders)} 单
              </button>
            </span>
          </div>
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-40 w-full" />
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-32 w-full" />)}
            </div>
          ) : (
            <ChaseListVisual timeline={timelineRowsRaw} suppliers={supplierRows} unmatched={unmatchedRows}
              snapshotAt={timelineRowsRaw[0]?.snapshot_at ?? null} onExport={exportSupplier}
              selected={tierFilter} onSelectedChange={setTierFilter}
              onMarkUnmatched={(input) => { setMarkRemark(""); setMarkTarget(input); }} />
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
            <>
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
                      {realPurchase.length === 0 ? (
                        <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">暂无数据</td></tr>
                      ) : realPurchase.map((r, i) => (
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

              {quantuiPurchase.length > 0 && (
                <Card className="mt-4">
                  <div className="px-4 py-2 border-b bg-muted/30 text-xs text-muted-foreground flex items-center gap-2">
                    <Ban className="size-3.5 shrink-0" />
                    <span>
                      劝退款（共 {fmtNum(quantuiPurchase.length)} 个 SKU）：已停止向供应商催货、不计入上方缺口；展示标记时记录的原供应商与备注
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[860px]">
                      <thead className="bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className="text-left px-4 py-2 font-medium w-14">图</th>
                          <th className="text-left px-4 py-2 font-medium">SKU</th>
                          <th className="text-left px-4 py-2 font-medium">款号</th>
                          <th className="text-left px-4 py-2 font-medium">原供应商</th>
                          <th className="text-left px-4 py-2 font-medium">备注</th>
                          <th className="text-right px-4 py-2 font-medium w-24">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quantuiPurchase.map((r, i) => (
                          <tr key={i} className="border-t text-muted-foreground">
                            <td className="px-4 py-2">
                              <SkuThumb sku={r.sku} imageUrl={purchaseImgQ.data?.[r.sku]} onPreview={onPreview} />
                            </td>
                            <td className="px-4 py-2 font-mono">{r.sku}</td>
                            <td className="px-4 py-2">{r.style_no || "-"}</td>
                            <td className="px-4 py-2">{r.quantui_supplier || "-"}</td>
                            <td className="px-4 py-2 max-w-[280px] truncate" title={r.quantui_remark || undefined}>{r.quantui_remark || "-"}</td>
                            <td className="px-4 py-2 text-right">
                              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground"
                                onClick={() => setUnmarkTarget(r)}>
                                <Undo2 className="mr-1 size-3.5" /> 取消劝退
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="closed" className="mt-4">
          <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
            <div className="text-xs text-muted-foreground">
              供应商已结单交付完毕，此处缺口不会再到货，需决策补单或退款
            </div>
            <Button variant="outline" size="sm" onClick={exportClosed} disabled={loading || closedRows.length === 0 || closedExporting}>
              <Download className="mr-1" /> {closedExporting ? "生成中…" : "导出 Excel"}
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

      {/* 标记劝退（入口在「供应商未匹配」）：按 style_no 标记整款，可填可选备注；
          original_supplier_name 交 BEFORE INSERT 触发器回填（未匹配款多半为空，属正常） */}
      <Dialog open={!!markTarget} onOpenChange={(o) => { if (!o) { setMarkTarget(null); setMarkRemark(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>标记为劝退款</DialogTitle>
            <DialogDescription>
              标记后该款将从「供应商未匹配」「按供应商催货」清单移除，并在「采购缺口」页单独归入「劝退款」记录、不计入缺口合计。
            </DialogDescription>
          </DialogHeader>
          {markTarget && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md bg-muted/40 p-3 space-y-1">
                <div><span className="text-muted-foreground">款号：</span><span className="font-mono">{markTarget.styleNo}</span></div>
                {markTarget.name && markTarget.name !== markTarget.styleNo && (
                  <div><span className="text-muted-foreground">款名：</span>{markTarget.name}</div>
                )}
                <div className="text-xs text-muted-foreground pt-1">
                  按款号标记，同款全部 SKU 一并劝退
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quantui-remark">备注（可选）</Label>
                <Textarea id="quantui-remark" rows={3} value={markRemark}
                  onChange={(e) => setMarkRemark(e.target.value)}
                  placeholder="如：新款无供应商、不值得开发、改版下架…" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMarkTarget(null); setMarkRemark(""); }}
              disabled={markMutation.isPending}>取消</Button>
            <Button onClick={() => markTarget && markMutation.mutate({ styleNo: markTarget.styleNo, remark: markRemark })}
              disabled={markMutation.isPending}>
              {markMutation.isPending ? "标记中…" : "确认劝退"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 取消劝退：删除对应标记行，下次刷新恢复进催货/缺口 */}
      <AlertDialog open={!!unmarkTarget} onOpenChange={(o) => { if (!o) setUnmarkTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>取消劝退？</AlertDialogTitle>
            <AlertDialogDescription>
              SKU {unmarkTarget?.sku} 取消劝退后将恢复进入催货与采购缺口统计。
              {unmarkTarget?.style_no?.trim() ? "（按款号取消，同款全部 SKU 一并恢复）" : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unmarkMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (unmarkTarget) unmarkMutation.mutate(unmarkTarget); }}
              disabled={unmarkMutation.isPending}>
              {unmarkMutation.isPending ? "处理中…" : "确认取消劝退"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

