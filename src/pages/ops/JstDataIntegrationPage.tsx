import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ops/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle, RefreshCw, ChevronDown, FileText, Package, Warehouse, Truck,
  Search, Stethoscope, Store, Users, Building2, ShoppingCart, PackageCheck,
  Link2, Boxes, LineChart, Plug, Download, Filter, Clock, MoreVertical, StopCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { ShopMappingsCard } from "@/components/ops/ShopMappingsCard";
import { JstConnectionCheckCard } from "@/components/ops/JstConnectionCheckCard";
import { InboundSyncJobPanel } from "@/components/ops/InboundSyncJobPanel";
import AutoSyncOverview from "@/components/ops/AutoSyncOverview";



// ============================================================
// Types & helpers
// ============================================================
type ModuleStatus = "ok" | "warn" | "error";
const STATUS_META: Record<ModuleStatus, { label: string; cls: string }> = {
  ok:    { label: "正常", cls: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" },
  warn:  { label: "需处理", cls: "bg-amber-100 text-amber-700 hover:bg-amber-100" },
  error: { label: "异常", cls: "bg-rose-100 text-rose-700 hover:bg-rose-100" },
};
const TRIGGER_LABEL: Record<string, string> = {
  auto: "自动同步", retry: "失败重试", manual_backfill: "手动补数据", manual: "手动同步",
};
const CATEGORY_LABEL: Record<string, string> = {
  base: "基础档案", product: "商品与 SKU", purchase: "采购与入库",
  inventory: "库存", sales: "销售经营", fulfillment: "履约与售后",
};
function asStatus(s: string | null | undefined): ModuleStatus {
  return s === "ok" || s === "warn" || s === "error" ? s : "ok";
}
function StatusBadge({ value }: { value: ModuleStatus }) {
  const m = STATUS_META[value];
  return <Badge variant="secondary" className={m.cls}>{m.label}</Badge>;
}
const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false, hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
const fmtDuration = (ms?: number | null) =>
  ms == null ? "—" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
const fmtNum = (n: number | null | undefined) => (n ?? 0).toLocaleString("zh-CN");

// ============================================================
// Data hooks (unchanged business logic)
// ============================================================
function useModules() {
  return useQuery({
    queryKey: ["jst_sync_modules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("jst_sync_modules").select("*").order("priority", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}
function useMetrics() {
  return useQuery({
    queryKey: ["jst_sync_metrics"],
    queryFn: async () => {
      const { data, error } = await supabase.from("jst_sync_metrics").select("*");
      if (error) throw error;
      const map: Record<string, typeof data[number]> = {};
      (data ?? []).forEach((row) => { map[row.metric_key] = row; });
      return map;
    },
  });
}
function useErrors() {
  return useQuery({
    queryKey: ["jst_sync_errors"],
    queryFn: async () => {
      const { data, error } = await supabase.from("jst_sync_errors").select("*")
        .neq("status", "resolved").order("last_seen_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
function useRuns() {
  return useQuery({
    queryKey: ["jst_sync_runs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("jst_sync_runs").select("*")
        .order("started_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
}
function usePurchaseLogs() {
  return useQuery({
    queryKey: ["jst_sync_logs", "purchase"],
    queryFn: async () => {
      const { data, error } = await supabase.from("jst_sync_logs").select("*")
        .in("sync_type", [
          "purchase_orders",
          "purchase_inbound_orders",
          "purchase_receipts",
          "purchase_in",
          "purchase",
          "sales_orders",
          "outbound_orders",
          "refund_orders",
          "aftersale_received",
        ])
        .order("started_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 5000,
  });
}
function useShopMappingCounts() {
  return useQuery({
    queryKey: ["jst_shop_mappings", "counts"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("jst_shop_mappings").select("*");
      if (error) throw error;
      const rows = (data ?? []) as any[];
      const total = rows.length;
      const mapped = rows.filter((r) => r.mapping_status === "mapped").length;
      const unmapped = rows.filter((r) => r.mapping_status === "unmapped").length;
      const ignored = rows.filter((r) => r.mapping_status === "ignored").length;
      const noEntity = rows.filter((r) => !r.matched_business_entity_id).length;
      const noPlatform = rows.filter((r) => !r.matched_platform_id).length;
      const lastSync = rows.reduce<string | null>((m, r) => (!m || (r.last_sync_at && r.last_sync_at > m)) ? r.last_sync_at : m, null);
      const nonIgnored = total - ignored;
      const entityBound = rows.filter((r) => r.mapping_status !== "ignored" && !!r.matched_business_entity_id).length;
      const matchRate = total ? (mapped / total) * 100 : 0;
      const entityBindingRate = nonIgnored ? (entityBound / nonIgnored) * 100 : 0;
      return { total, mapped, unmapped, ignored, noEntity, noPlatform, lastSync, matchRate, entityBindingRate };
    },
  });
}
function useSupplierCounts() {
  return useQuery({
    queryKey: ["jst_suppliers_raw", "counts"],
    queryFn: async () => {
      // 聚水潭侧识别到的供应商（jst_suppliers_raw），用于检查与内部 ops_suppliers 的绑定情况
      const { data, error } = await (supabase as any)
        .from("jst_suppliers_raw")
        .select("matched_ops_supplier_id, skip_reason, last_sync_at, updated_at");
      if (error) throw error;
      const rows = (data ?? []) as any[];
      const total = rows.length;
      const ignored = rows.filter((r) => r.skip_reason && String(r.skip_reason).trim().length > 0).length;
      const active = rows.filter((r) => !(r.skip_reason && String(r.skip_reason).trim().length > 0));
      const matched = active.filter((r) => !!r.matched_ops_supplier_id).length;
      const pending = active.length - matched;
      const lastSync = rows.reduce<string | null>(
        (m, r) => {
          const t = r.last_sync_at ?? r.updated_at;
          return !m || (t && t > m) ? t : m;
        },
        null,
      );
      // 同时获取内部 ERP 档案总数，仅用于对照展示
      const { count: opsTotal } = await supabase
        .from("ops_suppliers")
        .select("id", { count: "exact", head: true });
      return { total, matched, pending, ignored, lastSync, opsTotal: opsTotal ?? 0 };
    },
  });
}

function useWarehouseCounts() {
  return useQuery({
    queryKey: ["jst_warehouses", "counts"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("jst_warehouses").select("updated_at");
      if (error) throw error;
      const rows = (data ?? []) as any[];
      const lastSync = rows.reduce<string | null>((m, r) => (!m || (r.updated_at && r.updated_at > m)) ? r.updated_at : m, null);
      return { total: rows.length, lastSync };
    },
  });
}

// ============================================================
// Small UI bits
// ============================================================
function StatusDot({ tone }: { tone: "ok" | "warn" | "error" | "running" | "muted" }) {
  const cls = {
    ok: "bg-emerald-500", warn: "bg-rose-500", error: "bg-rose-500",
    running: "bg-sky-500", muted: "bg-muted-foreground/40",
  }[tone];
  return <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${cls}`} />;
}

function OverviewCard({
  title, value, badge, badgeTone, hint, valueTone,
}: {
  title: string; value: React.ReactNode;
  badge?: string; badgeTone?: "ok" | "warn" | "error" | "running";
  hint?: React.ReactNode; valueTone?: "default" | "destructive" | "warning";
}) {
  const badgeCls = badgeTone === "warn" ? "bg-amber-100 text-amber-700"
    : badgeTone === "error" ? "bg-rose-100 text-rose-700"
    : badgeTone === "running" ? "bg-sky-100 text-sky-700"
    : "bg-emerald-100 text-emerald-700";
  const valueCls = valueTone === "destructive" ? "text-rose-600"
    : valueTone === "warning" ? "text-amber-600" : "";
  return (
    <Card>
      <CardContent className="p-4 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-medium text-foreground">{title}</div>
          {badge && <Badge variant="secondary" className={badgeCls}>{badge}</Badge>}
        </div>
        <div className={`text-2xl font-bold tabular-nums ${valueCls}`}>{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function ModuleCard({
  icon, title, statusDot, statusLabel, statusTone, rows, footer, actions,
}: {
  icon: React.ReactNode; title: string;
  statusDot: "ok" | "warn" | "error" | "running" | "muted"; statusLabel: string; statusTone: "ok" | "warn" | "error" | "muted";
  rows: { label: string; value: React.ReactNode; valueTone?: "default" | "destructive" }[];
  footer?: React.ReactNode; actions?: React.ReactNode;
}) {
  const dotColor = {
    ok: "text-emerald-600", warn: "text-rose-600", error: "text-rose-600", muted: "text-muted-foreground",
  }[statusTone];
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {icon}{title}
          </div>
          <span className={`text-xs inline-flex items-center ${dotColor}`}>
            <StatusDot tone={statusDot} />{statusLabel}
          </span>
        </div>
        <div className="space-y-1.5 text-sm">
          {rows.map((r, i) => (
            <div key={i} className="flex items-baseline justify-between">
              <span className="text-muted-foreground">{r.label}</span>
              <span className={`tabular-nums font-medium ${r.valueTone === "destructive" ? "text-rose-600" : ""}`}>{r.value}</span>
            </div>
          ))}
        </div>
        {actions && <div className="flex gap-2 pt-1">{actions}</div>}
        {footer && <div className="text-xs text-rose-600 pt-1">{footer}</div>}
      </CardContent>
    </Card>
  );
}

function PlaceholderTab({ title, hint, items }: { title: string; hint: string; items?: string[] }) {
  return (
    <div className="p-5 space-y-4">
      <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center">
        <div className="text-sm font-medium mb-1">{title}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      {items && items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((name) => (
            <Card key={name}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="text-sm">{name}</div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" disabled>暂未接入</Button>
                  <Button size="sm" variant="ghost" disabled>日志</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Custom time-range trigger for sales-orders sync
// ============================================================
function CustomSalesOrderRange({ onStarted }: { onStarted?: () => void }) {
  const { toast } = useToast();
  const nowLocal = () => {
    const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  };
  const [start, setStart] = useState(() => {
    const d = new Date(Date.now() - 24 * 3600_000 - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  });
  const [end, setEnd] = useState(nowLocal());
  const [pending, setPending] = useState(false);

  const startCustom = async (opts?: { days30?: boolean }) => {
    setPending(true);
    try {
      const body: any = { action: "start_sales_job", requested_range: opts?.days30 ? "30d" : "custom" };
      if (opts?.days30) {
        body.days = 30;
      } else {
        if (!start || !end) throw new Error("请填写起止时间");
        body.start_time = new Date(start).toISOString();
        body.end_time = new Date(end).toISOString();
      }
      const { data, error } = await supabase.functions.invoke("jst-sync-sales-orders", { body });
      if (error) throw new Error(error.message);
      if (data?.ok === false) throw new Error(data?.error ?? "启动失败");
      toast({ title: "已创建销售订单同步任务", description: opts?.days30 ? "最近 30 天" : `${start} → ${end}` });
      onStarted?.();
    } catch (e: any) {
      toast({ title: "启动失败", description: e.message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-3">
      <div className="text-xs text-muted-foreground">指定起止时间（按订单 modified 时间），跨度过大将自动分窗口断点续跑。</div>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">开始时间</label>
          <Input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} className="h-8 w-[200px]" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">结束时间</label>
          <Input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} className="h-8 w-[200px]" />
        </div>
        <Button size="sm" disabled={pending} onClick={() => startCustom()}>按指定时间段同步</Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => startCustom({ days30: true })}>同步最近 30 天</Button>
      </div>
    </div>
  );
}

// ============================================================
// Main page
// ============================================================
export default function JstDataIntegrationPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const modulesQ = useModules();
  const metricsQ = useMetrics();
  const errorsQ = useErrors();
  const runsQ = useRuns();
  const purchaseLogsQ = usePurchaseLogs();
  const mappingQ = useShopMappingCounts();
  const supplierQ = useSupplierCounts();
  const warehouseQ = useWarehouseCounts();

  const [keyword, setKeyword] = useState("");
  const [triggerFilter, setTriggerFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [detailLog, setDetailLog] = useState<any | null>(null);
  const [shopMappingsOpen, setShopMappingsOpen] = useState(false);

  // 真实接入 module
  const REAL_BASE_KEYS = new Set(["base_archive", "shop", "supplier", "warehouse"]);
  const isRealModuleKey = (k: string) => REAL_BASE_KEYS.has(k) || k === "sales_refund";

  type TriggerInput =
    | { kind: "base_archive"; scope?: string[]; trigger_type: string; label: string }
    | { kind: "sales_refund"; days: number; trigger_type: string; label: string };

  const triggerRun = useMutation({
    mutationFn: async (input: TriggerInput) => {
      if (!user) throw new Error("未登录");
      const body: Record<string, unknown> = { trigger_type: input.trigger_type };
      if (input.kind === "base_archive") {
        body.module_key = "base_archive";
        if (input.scope) body.scope = input.scope;
      } else {
        body.module_key = "sales_refund";
        body.days = input.days;
      }
      const { data, error } = await supabase.functions.invoke("jst-sync-dispatch", { body });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return { summary: data?.message ?? data?.summary ?? "已完成", label: input.label };
    },
    onSuccess: (d) => {
      toast({ title: "同步完成", description: `${d.label} — ${d.summary}` });
      qc.invalidateQueries({ queryKey: ["jst_sync_runs"] });
      qc.invalidateQueries({ queryKey: ["jst_sync_modules"] });
      qc.invalidateQueries({ queryKey: ["jst_sync_metrics"] });
      qc.invalidateQueries({ queryKey: ["jst_sync_errors"] });
      qc.invalidateQueries({ queryKey: ["jst_shop_mappings", "counts"] });
      qc.invalidateQueries({ queryKey: ["ops_suppliers", "counts"] });
      qc.invalidateQueries({ queryKey: ["jst_warehouses", "counts"] });
    },
    onError: (e: any) => toast({ title: "同步失败", description: e.message, variant: "destructive" }),
  });

  const purchaseSyncMut = useMutation({
    mutationFn: async (input: {
      days?: number;
      label: string;
      scope: "purchase_orders" | "purchase_inbound_orders";
    }) => {
      const body: Record<string, unknown> = { action: "sync", scope: input.scope };
      if (input.days && input.days > 0) {
        const to = new Date();
        const from = new Date(Date.now() - input.days * 86400_000);
        body.start_date = from.toISOString();
        body.end_date = to.toISOString();
      }
      const { data, error } = await supabase.functions.invoke("jst-sync-purchase-orders", { body });
      if (error) throw new Error(error.message);
      if (data?.ok === false) throw new Error(data?.error ?? "同步失败");
      return { label: input.label, scope: input.scope, message: data?.message ?? "同步已在后台启动" };
    },
    onSuccess: (d) => {
      const title = d.scope === "purchase_inbound_orders" ? "已启动入库单同步" : "已启动采购单同步";
      toast({ title, description: `${d.label} — ${d.message}` });
      qc.invalidateQueries({ queryKey: ["jst_sync_logs", "purchase"] });
      qc.invalidateQueries({ queryKey: ["jst_sync_runs"] });
      qc.invalidateQueries({ queryKey: ["jst_sync_modules"] });
      setTimeout(() => document.getElementById("jst-sync-logs")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    },
    onError: (e: any) => toast({ title: "同步失败", description: e.message, variant: "destructive" }),
  });

  const [cancelAllVersion, setCancelAllVersion] = useState(0);
  const [cancelAllOpen, setCancelAllOpen] = useState(false);

  const cancelAllMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("jst_cancel_all_running_syncs");
      if (error) throw new Error(error.message || "RPC 调用失败");
      const row = Array.isArray(data) ? data[0] : data;
      return { logs: Number(row?.cancelled_logs ?? 0), jobs: Number(row?.cancelled_jobs ?? 0) };
    },
    onMutate: () => {
      toast({ title: "正在终止同步任务..." });
    },
    onSuccess: (d) => {
      if (d.logs === 0 && d.jobs === 0) {
        toast({ title: "没有可终止的运行中任务", description: "已刷新状态。" });
      } else {
        toast({ title: "已终止运行中的同步", description: `日志 ${d.logs} 条 / 任务 ${d.jobs} 个已标记为终止` });
      }
      setCancelAllVersion((v) => v + 1);
      qc.removeQueries({ queryKey: ["sync_job"] });
      qc.invalidateQueries({ queryKey: ["sync_last_job"] });
      qc.invalidateQueries({ queryKey: ["jst_sync_logs"] });
      qc.invalidateQueries({ queryKey: ["jst_sync_runs"] });
      qc.invalidateQueries({ queryKey: ["jst_sync_modules"] });
    },
    onError: (e: any) => toast({ title: "终止失败", description: e.message, variant: "destructive" }),
  });

  const pendingScope = purchaseSyncMut.isPending ? (purchaseSyncMut.variables as any)?.scope : null;
  const poBusy = pendingScope === "purchase_orders";
  const inBusy = pendingScope === "purchase_inbound_orders";

  const notWired = (label: string) =>
    toast({ title: "暂未接入", description: `${label} 暂未接入真实聚水潭 API，按钮已禁用。` });

  // ------------------------------------------------------------
  // Derived
  // ------------------------------------------------------------
  const modules = modulesQ.data ?? [];
  const metrics = metricsQ.data ?? {};
  const errors = errorsQ.data ?? [];
  const runs = runsQ.data ?? [];
  const purchaseLogs = purchaseLogsQ.data ?? [];
  const mapping = mappingQ.data;
  const supplier = supplierQ.data;
  const warehouse = warehouseQ.data;

  const baseExtra = (metrics["base_archive_summary"]?.metric_extra ?? {}) as any;
  const productExtra = (metrics["product_summary"]?.metric_extra ?? {}) as any;
  const purchaseExtra = (metrics["purchase_summary"]?.metric_extra ?? {}) as any;
  const inventoryExtra = (metrics["inventory_summary"]?.metric_extra ?? {}) as any;
  const salesExtra = (metrics["sales_summary"]?.metric_extra ?? {}) as any;
  const fulfillmentExtra = (metrics["fulfillment_summary"]?.metric_extra ?? {}) as any;
  const refundCountQ = useQuery({
    queryKey: ["jst_refund_orders_count"],
    queryFn: async () => {
      const [{ count: refundCount }, { data: lastLog }] = await Promise.all([
        supabase.from("jst_refund_orders").select("id", { count: "exact", head: true }),
        supabase.from("jst_sync_logs").select("status,ended_at,started_at")
          .in("sync_type", ["refund_orders", "aftersale_received"])
          .order("started_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      return { count: refundCount ?? 0, lastLog };
    },
    refetchInterval: 10000,
  });
  const globalMetric = metrics["global_status"];
  const globalExtra = (globalMetric?.metric_extra ?? {}) as Record<string, any>;

  const purchaseLogRows = useMemo(() => purchaseLogs.map((p: any) => {
    const fetched = (p.fetched_orders_count ?? 0) + (p.fetched_items_count ?? 0) + (p.fetched_receipts_count ?? 0);
    return {
      id: `plog-${p.id}`, _source: "purchase_log" as const, _raw: p,
      module_key: p.sync_type, trigger_type: "manual", started_at: p.started_at,
      status: p.status === "success" ? "ok" : p.status === "running" ? "running" : (p.status === "partial" || p.status === "partial_failed" || p.status === "timeout_partial") ? "warn" : "error",
      inserted_count: fetched, updated_count: 0,
      failed_count: ["failed", "partial_failed", "timeout_partial", "stalled"].includes(p.status) ? 1 : 0,
      duration_ms: p.ended_at ? new Date(p.ended_at).getTime() - new Date(p.started_at).getTime() : null,
      current_total_summary: p.message ?? "", error_message: p.error_detail ?? "",
    };
  }), [purchaseLogs]);

  // 采购单 / 入库单各自的最近一次同步统计（按 sync_type 分组）
  const poLatest = useMemo(
    () => purchaseLogs.find((p: any) => p.sync_type === "purchase_orders"),
    [purchaseLogs],
  );
  const inboundLatest = useMemo(
    () => purchaseLogs.find((p: any) => p.sync_type === "purchase_inbound_orders"),
    [purchaseLogs],
  );
  const purchaseLogsFailed = purchaseLogsQ.isError;
  const renderScopeStats = (log: any, unit: string) => {
    if (purchaseLogsFailed) return (
      <div className="text-xs text-destructive border border-destructive/40 rounded-md p-3 bg-destructive/5">
        读取失败：{(purchaseLogsQ.error as any)?.message ?? "无法获取同步日志"}
      </div>
    );
    if (!log) return (
      <div className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-3">
        暂无同步记录
      </div>
    );
    const fetched = (log.fetched_orders_count ?? 0) + (log.fetched_items_count ?? 0) + (log.fetched_receipts_count ?? 0);
    const failed = log.status === "error" ? 1 : 0;
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs border border-border rounded-md p-3 bg-muted/30">
        <div><div className="text-muted-foreground">本次{unit}数量</div><div className="font-mono text-sm">{fetched}</div></div>
        <div><div className="text-muted-foreground">新增/抓取</div><div className="font-mono text-sm">{log.fetched_orders_count ?? 0}</div></div>
        <div><div className="text-muted-foreground">明细数量</div><div className="font-mono text-sm">{log.fetched_items_count ?? log.fetched_receipts_count ?? 0}</div></div>
        <div><div className="text-muted-foreground">失败</div><div className="font-mono text-sm">{failed}</div></div>
        <div><div className="text-muted-foreground">最近同步</div><div className="font-mono text-sm">{fmtTime(log.started_at)}</div></div>
      </div>
    );
  };

  const moduleByKey = (k: string) => modules.find((m) => m.module_key === k);
  const baseMod = moduleByKey("base_archive");

  const abnormalModules = useMemo(
    () => modules.filter((m) => m.status === "error" || m.status === "warn"),
    [modules],
  );

  const filteredLogs = useMemo(() => {
    const allLogs: any[] = [...runs.map((r: any) => ({ ...r, _source: "run" })), ...purchaseLogRows];
    allLogs.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
    return allLogs.filter((l) => {
      const isPurchaseLog = l._source === "purchase_log";
      const mod = modules.find((m) => m.module_key === l.module_key);
      const isFulfillmentKey = (k: string) => k === "outbound_orders" || k === "refund_orders" || k === "aftersale_received";
      const isSalesKey = (k: string) => k === "sales_orders";
      const groupLabel = isPurchaseLog
        ? (isSalesKey(l.module_key) ? CATEGORY_LABEL.sales : isFulfillmentKey(l.module_key) ? CATEGORY_LABEL.fulfillment : CATEGORY_LABEL.purchase)
        : (mod ? (CATEGORY_LABEL[mod.category] ?? mod.category) : "");
      const moduleName = isPurchaseLog
        ? (l.module_key === "purchase_orders" ? "采购单"
          : (l.module_key === "purchase_inbound_orders" || l.module_key === "purchase_in" || l.module_key === "purchase_receipts") ? "入库单"
          : l.module_key === "outbound_orders" ? "出库API · 销售出库单"
          : l.module_key === "refund_orders" ? "售后API · 退货退款单"
          : l.module_key === "aftersale_received" ? "售后API · 销售退仓"
          : "采购与入库")
        : (mod?.module_name ?? l.module_key);
      const displayModuleName = l.module_key === "sales_orders" ? "订单API · 销售订单" : moduleName;
      const triggerLabel = TRIGGER_LABEL[l.trigger_type] ?? l.trigger_type;
      if (triggerFilter !== "all" && triggerLabel !== triggerFilter) return false;
      if (groupFilter !== "all" && groupLabel !== groupFilter) return false;
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (keyword) {
        const blob = `${displayModuleName} ${groupLabel} ${l.error_message ?? ""}`.toLowerCase();
        if (!blob.includes(keyword.toLowerCase())) return false;
      }
      return true;
    });
  }, [runs, purchaseLogRows, modules, triggerFilter, groupFilter, statusFilter, keyword]);

  const isLoading = modulesQ.isLoading || metricsQ.isLoading;

  // 阶段任务列表 - 基础API
  const baseStageTasks = [
    {
      stage: 1, name: "店铺资料同步", mode: "全量",
      progress: 100, status: "ok" as ModuleStatus, last: baseMod?.last_sync_at,
      onLog: () => document.getElementById("jst-sync-logs")?.scrollIntoView({ behavior: "smooth" }),
    },
    {
      stage: 2, name: "店铺映射检查", mode: "校验",
      progress: Math.round(mapping?.matchRate ?? 0),
      status: (mapping && mapping.unmapped > 0 ? "warn" : "ok") as ModuleStatus,
      last: mapping?.lastSync,
      onLog: () => setShopMappingsOpen(true), opLabel: "管理映射",
    },
    {
      stage: 3, name: "供应商全量同步", mode: "全量",
      progress: 100, status: "ok" as ModuleStatus, last: supplier?.lastSync,
      onLog: () => document.getElementById("jst-sync-logs")?.scrollIntoView({ behavior: "smooth" }),
    },
    {
      stage: 4, name: "仓库资料同步", mode: "全量",
      progress: 100, status: "ok" as ModuleStatus, last: warehouse?.lastSync,
      onLog: () => document.getElementById("jst-sync-logs")?.scrollIntoView({ behavior: "smooth" }),
    },
  ];

  // Tab 状态点：根据 jst_sync_logs 中各 sync_type 的最近一次状态计算
  const logsBySyncType = useMemo(() => {
    const m: Record<string, any> = {};
    for (const p of purchaseLogs as any[]) {
      const cur = m[p.sync_type];
      if (!cur || new Date(p.started_at).getTime() > new Date(cur.started_at).getTime()) m[p.sync_type] = p;
    }
    return m;
  }, [purchaseLogs]);
  const tabTone = (syncTypes: string[]): "ok" | "warn" | "error" | "running" | "muted" => {
    const candidates = syncTypes.map((t) => logsBySyncType[t]).filter(Boolean);
    if (candidates.length === 0) return "muted";
    candidates.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
    const s = String(candidates[0].status ?? "");
    if (s === "running") return "running";
    if (s === "success") return "ok";
    if (s === "failed") return "error";
    if (s === "partial_failed" || s === "partial" || s === "timeout_partial") return "warn";
    return "muted";
  };

  // Tabs metadata（状态点基于真实同步日志）
  const TABS: { key: string; label: string; tone: "ok" | "warn" | "error" | "running" | "muted" }[] = [
    { key: "base", label: "基础API", tone: "ok" },
    { key: "product", label: "商品API", tone: "warn" },
    { key: "inventory", label: "库存API", tone: "muted" },
    { key: "order", label: "订单API", tone: tabTone(["sales_orders"]) },
    { key: "logistics", label: "物流API", tone: "muted" },
    { key: "purchase", label: "采购API", tone: tabTone(["purchase_orders"]) },
    { key: "receipt", label: "入库API", tone: tabTone(["purchase_inbound_orders", "purchase_receipts", "purchase_in"]) },
    { key: "outbound", label: "出库API", tone: tabTone(["outbound_orders"]) },
    { key: "aftersales", label: "售后API", tone: tabTone(["refund_orders", "aftersale_received"]) },
  ];

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={["数据中心", "聚水潭同步"]}
        title="聚水潭同步"
        description="按 API 模块管理聚水潭数据接入。基础档案是销售/采购同步的前置条件。"
      />

      <div className="rounded-md border border-sky-300 bg-sky-50/60 px-4 py-2.5 text-xs text-sky-800">
        新架构提示：已停用「一键同步全部历史订单 / 全部商品 / 64 万 SKU / 旧版 sales_refund RAW 同步」等危险入口。新同步默认不保存完整 raw JSON，仅写入销售汇总、未发货风险、轻量订单索引和轻量商品档案。建议使用小范围的最近 10 分钟 / 1 小时 / 今日 / 未发货风险 / 按 SKU / 款号同步。
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">加载中…</div>}

      {/* 一、顶部异常提示条 */}
      {(abnormalModules.length > 0 || (mapping && mapping.unmapped > 0)) && (
        <div className="rounded-md border border-amber-300 bg-amber-50/70 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <div className="flex-1 text-sm text-amber-900">
            <span className="font-medium">警告：</span>
            发现高风险同步阻碍：
            {productExtra.status === "warn" && "SKU 初始化未完成，"}
            {mapping && mapping.unmapped > 0 && `${mapping.unmapped} 个店铺未映射，`}
            请尽快处理前置条件。
          </div>
          <Button size="sm" variant="outline"
            onClick={() => document.getElementById("jst-sync-logs")?.scrollIntoView({ behavior: "smooth" })}>
            查看异常
          </Button>
          <Button size="sm" onClick={() => setShopMappingsOpen(true)}>处理前置条件</Button>
        </div>
      )}

      {/* 二、自动同步总览 + 同步记录（取代旧的全局状态条与旧同步日志） */}
      <AutoSyncOverview />

      {/* 三、核心数据概览 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <OverviewCard
          title="基础信息"
          value={fmtNum((baseExtra.shops ?? 0) + (baseExtra.suppliers ?? 0) + (baseExtra.warehouses ?? 0))}
          badge="健康" badgeTone="ok"
          hint={`最近同步：${fmtTime(baseMod?.last_sync_at)}`}
        />
        <OverviewCard
          title="商品/SKU"
          value={fmtNum(productExtra.skus) || "—"}
          badge={productExtra.status === "warn" ? "初始化暂停" : "正常"}
          badgeTone={productExtra.status === "warn" ? "error" : "ok"}
          valueTone={productExtra.status === "warn" ? "destructive" : "default"}
          hint={productExtra.skus_total ? `进度：${fmtNum(productExtra.skus)} / ${fmtNum(productExtra.skus_total)}` : "暂未接入"}
        />
        <OverviewCard
          title="采购/入库"
          value={fmtNum(purchaseExtra.today_po) || (purchaseLogs.length > 0 ? fmtNum(purchaseLogs[0]?.fetched_orders_count) : "—")}
          badge={purchaseSyncMut.isPending ? "同步中" : "正常"}
          badgeTone={purchaseSyncMut.isPending ? "running" : "ok"}
          hint={`最近同步：${fmtTime(moduleByKey("purchase")?.last_sync_at)}`}
        />
        <OverviewCard
          title="库存"
          value={fmtNum(inventoryExtra.stock_skus) || "—"}
          badge="增量" badgeTone="ok"
          hint={`最近同步：${fmtTime(metrics["inventory_summary"]?.last_sync_at)}`}
        />
        <OverviewCard
          title="销售/退款"
          value={fmtNum(refundCountQ.data?.count) || "—"}
          badge={mapping && mapping.unmapped > 0 ? "阻塞" : (refundCountQ.data?.lastLog?.status === "failed" ? "异常" : "正常")}
          badgeTone={mapping && mapping.unmapped > 0 ? "error" : (refundCountQ.data?.lastLog?.status === "failed" ? "error" : "ok")}
          valueTone={mapping && mapping.unmapped > 0 ? "destructive" : "default"}
          hint={`售后退款单 · 最近同步：${fmtTime(refundCountQ.data?.lastLog?.ended_at ?? refundCountQ.data?.lastLog?.started_at)}`}
        />
        <OverviewCard
          title="履约"
          value={fmtNum(fulfillmentExtra.pending_shipment) || "—"}
          badge="正常" badgeTone="ok"
          hint={`最近同步：${fmtTime(metrics["fulfillment_summary"]?.last_sync_at)}`}
        />
      </div>

      {/* 四、同步模块（按 API） */}
      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-base font-semibold text-primary">同步模块</h3>
            <p className="text-xs text-muted-foreground mt-1">
              配置和监控特定的 API 同步任务。注意：原始数据同步优先于业务汇总生成。
            </p>
          </div>
          <Tabs defaultValue="base">
            <div className="px-5 pt-4 pb-3 bg-muted/40 border-b border-border">
              <div className="flex items-center gap-2 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <span className="inline-block w-1 h-3.5 bg-primary rounded-sm" />
                选择 API 模块
              </div>
              <TabsList className="bg-background border border-border shadow-sm h-auto p-1 gap-1 flex-wrap rounded-lg">
                {TABS.map((t) => (
                  <TabsTrigger key={t.key} value={t.key}
                    className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:font-semibold text-foreground/70 hover:text-foreground hover:bg-muted text-sm px-4 py-2 rounded-md transition-all">
                    <StatusDot tone={t.tone} />{t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {/* ====== 基础API ====== */}
            <TabsContent value="base" className="m-0 p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ModuleCard
                  icon={<Store className="w-4 h-4 text-muted-foreground" />}
                  title="店铺资料"
                  statusDot="ok" statusLabel="正常" statusTone="ok"
                  rows={[
                    { label: "聚水潭店铺", value: fmtNum(mapping?.total ?? baseExtra.shops) },
                    { label: "已同步数量", value: fmtNum(mapping?.total ?? baseExtra.shops) },
                    { label: "最近同步时间", value: fmtTime(baseMod?.last_sync_at) },
                    { label: "同步模式", value: "全量 + 增量" },
                  ]}
                  actions={
                    <>
                      <Button size="sm" disabled={triggerRun.isPending}
                        onClick={() => triggerRun.mutate({ kind: "base_archive", scope: ["shops"], trigger_type: "manual", label: "同步店铺" })}>
                        立即同步
                      </Button>
                      <Button size="sm" variant="outline"
                        onClick={() => document.getElementById("jst-sync-logs")?.scrollIntoView({ behavior: "smooth" })}>
                        查看日志
                      </Button>
                    </>
                  }
                />
                <ModuleCard
                  icon={<Link2 className="w-4 h-4 text-muted-foreground" />}
                  title="店铺映射"
                  statusDot={mapping && mapping.unmapped > 0 ? "warn" : "ok"}
                  statusLabel={mapping && mapping.unmapped > 0 ? "需处理" : "正常"}
                  statusTone={mapping && mapping.unmapped > 0 ? "warn" : "ok"}
                  rows={[
                    { label: "已绑定", value: fmtNum(mapping?.mapped) },
                    { label: "未绑定", value: fmtNum(mapping?.unmapped), valueTone: mapping && mapping.unmapped > 0 ? "destructive" : "default" },
                    { label: "无主体绑定", value: fmtNum(mapping?.noEntity) },
                    { label: "无平台绑定", value: fmtNum(mapping?.noPlatform) },
                    { label: "店铺匹配率", value: `${(mapping?.matchRate ?? 0).toFixed(1)}%`, valueTone: mapping && mapping.matchRate < 100 ? "destructive" : "default" },
                    { label: "主体绑定率", value: `${(mapping?.entityBindingRate ?? 0).toFixed(1)}%`, valueTone: mapping && mapping.entityBindingRate < 100 ? "destructive" : "default" },
                  ]}
                  actions={
                    <>
                      <Button size="sm" onClick={() => setShopMappingsOpen(true)}>管理映射</Button>
                      <Button size="sm" variant="outline" onClick={() => setShopMappingsOpen(true)}>查看异常</Button>
                    </>
                  }
                  footer={mapping && mapping.unmapped > 0 ? "店铺主体/平台绑定未完成将影响经营汇总" : undefined}
                />
                <ModuleCard
                  icon={<Users className="w-4 h-4 text-muted-foreground" />}
                  title="供应商资料"
                  statusDot={supplier && supplier.pending > 0 ? "warn" : "ok"}
                  statusLabel={supplier && supplier.pending > 0 ? "待处理" : "正常"}
                  statusTone={supplier && supplier.pending > 0 ? "warn" : "ok"}
                  rows={[
                    { label: "聚水潭识别供应商总数", value: fmtNum(supplier?.total ?? baseExtra.suppliers) },
                    { label: "已匹配（已绑定 ERP 档案）", value: fmtNum(supplier?.matched) },
                    { label: "待处理（未绑定）", value: fmtNum(supplier?.pending), valueTone: supplier && supplier.pending > 0 ? "destructive" : "default" },
                    { label: "已忽略", value: fmtNum(supplier?.ignored) },
                    { label: "内部 ERP 档案总数（对照）", value: fmtNum(supplier?.opsTotal) },
                    { label: "最近同步时间", value: fmtTime(supplier?.lastSync) },
                  ]}
                  footer="这里显示的是聚水潭采购/入库数据中识别到的供应商，并用于绑定到系统内部供应商档案。内部供应商档案已有数据，并不代表聚水潭供应商映射已经完成。"

                  actions={
                    <>
                      <Button size="sm" disabled={triggerRun.isPending}
                        onClick={() => triggerRun.mutate({ kind: "base_archive", scope: ["suppliers"], trigger_type: "manual", label: "同步供应商" })}>
                        立即同步
                      </Button>
                      <Button size="sm" variant="outline"
                        onClick={() => document.getElementById("jst-sync-logs")?.scrollIntoView({ behavior: "smooth" })}>
                        查看日志
                      </Button>
                    </>
                  }
                />
                <ModuleCard
                  icon={<Building2 className="w-4 h-4 text-muted-foreground" />}
                  title="仓库资料"
                  statusDot="ok" statusLabel="正常" statusTone="ok"
                  rows={[
                    { label: "仓库数量", value: fmtNum(warehouse?.total ?? baseExtra.warehouses) },
                    { label: "最近同步时间", value: fmtTime(warehouse?.lastSync) },
                    { label: "本次新增", value: baseExtra.last_warehouse_inserted ?? 0 },
                    { label: "本次更新", value: baseExtra.last_warehouse_updated ?? 0 },
                  ]}
                  actions={
                    <>
                      <Button size="sm" disabled={triggerRun.isPending}
                        onClick={() => triggerRun.mutate({ kind: "base_archive", scope: ["warehouses"], trigger_type: "manual", label: "同步仓库" })}>
                        立即同步
                      </Button>
                      <Button size="sm" variant="outline"
                        onClick={() => document.getElementById("jst-sync-logs")?.scrollIntoView({ behavior: "smooth" })}>
                        查看日志
                      </Button>
                    </>
                  }
                />
              </div>

            </TabsContent>

            {/* ====== 商品API ====== */}
            <TabsContent value="product" className="m-0">
              <PlaceholderTab
                title="商品 / SKU 分阶段同步（暂未接入）"
                hint={`SKU 总量 ${fmtNum(productExtra.skus_total) || "—"}｜已同步 ${fmtNum(productExtra.skus) || "—"}｜剩余 ${fmtNum((productExtra.skus_total ?? 0) - (productExtra.skus ?? 0))}。真实同步逻辑后续接入。`}
                items={["商品主档", "SKU 全量", "SKU 增量", "商品图片"]}
              />
            </TabsContent>

            {/* ====== 库存API ====== */}
            <TabsContent value="inventory" className="m-0">
              <PlaceholderTab
                title="库存同步（暂未接入）"
                hint="包括基础库存、可用库存、锁定库存、库存流水。"
                items={["基础库存", "可用库存", "锁定库存", "库存流水"]}
              />
            </TabsContent>

            {/* ====== 订单API ====== */}
            <TabsContent value="order" className="m-0 p-5 space-y-4">
              <div className="rounded-md border border-sky-300 bg-sky-50/60 px-4 py-2.5 text-xs text-sky-800">
                聚水潭销售订单同步（断点续跑）：调用 <code>/open/orders/single/query</code>，按修改时间窗口分页拉取，写入轻量订单主表、轻量明细、销售汇总和未发货风险表。默认不再保存完整 raw JSON；旧订单明细表仅作历史兼容。
              </div>
              <InboundSyncJobPanel
                cancelAllVersion={cancelAllVersion}
                title="销售订单同步任务（断点续跑）"
                syncType="sales_orders"
                functionName="jst-sync-sales-orders"
                startAction="start_sales_job"
                tickAction="tick_sales_job"
                cancelAction="cancel_sales_job"
                unitLabel="订单"
                toastTitle="已创建销售订单同步任务"
                presets={[
                  { label: "最近 10 分钟", minutes: 10, requested_range: "10m" },
                  { label: "最近 30 分钟", minutes: 30, requested_range: "30m" },
                  { label: "最近 1 小时", hours: 1, requested_range: "1h" },
                  { label: "今天", hours: 24, requested_range: "today" },
                  { label: "最近 3 天", days: 3, requested_range: "3d" },
                  { label: "最近 7 天", days: 7, requested_range: "7d" },
                ]}
                onJobFinished={() => {
                  qc.invalidateQueries({ queryKey: ["jst_sales_orders_recent"] });
                }}
              />

              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm">高级操作（指定时间段 / 最近 30 天）</Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3">
                  <CustomSalesOrderRange onStarted={() => qc.invalidateQueries({ queryKey: ["sync_last_job", "sales_orders"] })} />
                </CollapsibleContent>
              </Collapsible>
            </TabsContent>

            {/* ====== 物流API ====== */}
            <TabsContent value="logistics" className="m-0">
              <PlaceholderTab title="物流同步（暂未接入）" hint="物流公司、发货物流、揽收/签收状态。"
                items={["物流公司", "发货物流", "揽收状态", "签收状态"]} />
            </TabsContent>

            {/* ====== 采购API ====== */}
            <TabsContent value="purchase" className="m-0 p-5 space-y-3">
              <InboundSyncJobPanel
                cancelAllVersion={cancelAllVersion}
                title="采购单同步任务（断点续跑）"
                syncType="purchase_orders"
                startAction="start_po_job"
                tickAction="tick_po_job"
                cancelAction="cancel_po_job"
                unitLabel="采购单"
                toastTitle="已创建采购单同步任务"
                onJobFinished={() => {
                  qc.invalidateQueries({ queryKey: ["jst_purchase_logs"] });
                  qc.invalidateQueries({ queryKey: ["jst_dashboard"] });
                }}
              />
              {renderScopeStats(poLatest, "采购单")}
              <div className="text-xs text-muted-foreground space-y-1">
                <div>同步聚水潭采购单数据，已升级为「断点续跑」任务系统：每次自动按 3 天窗口、每窗口最多 3 页执行，Edge Function 不会超时；任务状态为 partial 时会自动继续，stalled 时可点「继续同步」手动恢复。</div>
                <div>任务记录写入 <code>jst_sync_jobs</code> / <code>jst_sync_log_details</code>，可在上方面板看到 job_id、窗口进度、当前页、API/主表/明细 upsert 数和错误详情。</div>
              </div>
            </TabsContent>

            {/* ====== 入库API ====== */}
            <TabsContent value="receipt" className="m-0 p-5 space-y-3">
              <InboundSyncJobPanel
                cancelAllVersion={cancelAllVersion}
                title="入库单同步任务（断点续跑）"
                syncType="purchase_inbound_orders"
                unitLabel="入库单"
                onJobFinished={() => {
                  qc.invalidateQueries({ queryKey: ["jst_purchase_logs"] });
                  qc.invalidateQueries({ queryKey: ["jst_dashboard"] });
                }}
              />
              {renderScopeStats(inboundLatest, "入库单")}
              <div className="text-xs text-muted-foreground space-y-1">
                <div>同步聚水潭采购入库单数据，已升级为「断点续跑」任务系统：每次自动按 3 天窗口、每窗口最多 3 页执行，Edge Function 不会超时；任务状态为 partial 时会自动继续，stalled 时可点「继续同步」手动恢复。</div>
                <div>任务记录写入 <code>jst_sync_jobs</code> / <code>jst_sync_log_details</code>，可在上方面板看到 job_id、窗口进度、当前页、API/主表/明细 upsert 数和错误详情。</div>
              </div>
            </TabsContent>



            <TabsContent value="outbound" className="m-0 p-5 space-y-3">
              <div className="rounded-md border border-sky-300 bg-sky-50/60 px-4 py-2.5 text-xs text-sky-800">
                聚水潭出库轻量同步（只读 · 断点续跑）：调用 <code>/open/orders/out/simple/query</code>，按修改时间窗口分页拉取，只写入 <code>warehouse_shipping_packages</code> + 包裹 SKU 明细。出库 API 仅用于仓库实际发货包裹统计。
              </div>
              <InboundSyncJobPanel
                cancelAllVersion={cancelAllVersion}
                title="出库包裹轻量同步任务（断点续跑）"
                syncType="outbound_orders"
                functionName="jst-sync-outbound-orders"
                startAction="start_outbound_job"
                tickAction="tick_outbound_job"
                cancelAction="cancel_outbound_job"
                unitLabel="包裹"
                toastTitle="已创建出库包裹轻量同步任务"
                presets={[
                  { label: "最近 2 小时测试同步", hours: 2, requested_range: "2h_test" },
                  { label: "最近 1 天同步", days: 1, requested_range: "1d" },
                ]}
              />
            </TabsContent>
            <TabsContent value="aftersales" className="m-0 p-5 space-y-3">
              <div className="rounded-md border border-sky-300 bg-sky-50/60 px-4 py-2.5 text-xs text-sky-800">
                聚水潭售后同步（断点续跑）：分为「退货退款单」（关注退款金额/状态/原因）和「销售退仓」（关注仓库实际收货 SKU 与数量），两类数据独立入库，互不混淆。
              </div>
              <InboundSyncJobPanel
                cancelAllVersion={cancelAllVersion}
                title="退货退款单同步任务（断点续跑）"
                syncType="refund_orders"
                functionName="jst-sync-refund-orders"
                startAction="start_refund_job"
                tickAction="tick_refund_job"
                cancelAction="cancel_refund_job"
                unitLabel="退款单"
                toastTitle="已创建退货退款单同步任务"
              />
              <InboundSyncJobPanel
                cancelAllVersion={cancelAllVersion}
                title="销售退仓同步任务（断点续跑）"
                syncType="aftersale_received"
                functionName="jst-sync-aftersale-received"
                startAction="start_aftersale_job"
                tickAction="tick_aftersale_job"
                cancelAction="cancel_aftersale_job"
                unitLabel="退仓单"
                toastTitle="已创建销售退仓同步任务"
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* 六、同步日志已由顶部 AutoSyncOverview 的同步记录表统一展示，旧表已移除 */}


      {/* 七、聚水潭 API 连接检测 */}
      <JstConnectionCheckCard />

      {/* 八、高级诊断 */}
      <Collapsible>
        <Card>
          <CollapsibleTrigger asChild>
            <button className="w-full px-5 py-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-2 text-left">
                <Stethoscope className="w-4 h-4 text-muted-foreground" />
                <div className="text-sm font-semibold">高级诊断和系统运行状况工具</div>
              </div>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 pb-5 px-5 space-y-3 border-t border-border">
              <div className="flex flex-wrap gap-2 pt-4">
                <Button variant="outline" size="sm" asChild>
                  <a href="https://supabase.com/dashboard/project/cnwuimllzotitgsurofn/functions" target="_blank" rel="noreferrer">查看 Edge Function 日志</a>
                </Button>
                <Button variant="outline" size="sm" disabled>查看原始响应</Button>
                <Button variant="outline" size="sm" disabled>查看任务队列</Button>
                <Button variant="outline" size="sm" disabled>查看失败批次</Button>
                <Button variant="outline" size="sm" disabled>刷新 Access Token</Button>
                <Button variant="outline" size="sm" disabled>清理卡住任务</Button>
              </div>
              <p className="text-xs text-muted-foreground">这些操作可能直接调用聚水潭接口或暴露内部状态，仅管理员可见。</p>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* 店铺映射抽屉 */}
      <Sheet open={shopMappingsOpen} onOpenChange={setShopMappingsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-4xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>店铺映射管理</SheetTitle>
            <SheetDescription>绑定聚水潭店铺到经营主体与平台。完成后销售/退款汇总才会生效。</SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <ShopMappingsCard />
          </div>
        </SheetContent>
      </Sheet>

      {/* 同步日志详情抽屉 */}
      <Sheet open={!!detailLog} onOpenChange={(o) => !o && setDetailLog(null)}>
        <SheetContent className="w-[640px] sm:max-w-[640px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>同步日志详情</SheetTitle>
            <SheetDescription>
              {(() => {
                if (detailLog?._source !== "purchase_log") return "来源:jst_sync_runs";
                const mk = detailLog?.module_key;
                const label =
                  mk === "sales_orders" ? "订单API · 销售订单" :
                  mk === "purchase_orders" ? "采购API" :
                  mk === "purchase_inbound_orders" ? "入库API" :
                  mk === "outbound_orders" ? "出库API" :
                  mk === "refund_orders" ? "售后API · 退货退款单" :
                  mk === "aftersale_received" ? "售后API · 销售退仓" :
                  "采购与入库";
                return `来源:jst_sync_logs(${label})`;
              })()}
            </SheetDescription>
          </SheetHeader>
          {detailLog && (
            <div className="space-y-3 mt-4 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">开始:</span> {fmtDateTime(detailLog.started_at)}</div>
                <div><span className="text-muted-foreground">状态:</span> {detailLog.status}</div>
                <div><span className="text-muted-foreground">模块:</span> {detailLog.module_key}</div>
                <div><span className="text-muted-foreground">耗时:</span> {fmtDuration(detailLog.duration_ms)}</div>
              </div>
              {detailLog.error_message && (
                <div>
                  <div className="font-medium mb-1">错误详情</div>
                  <pre className="bg-rose-50 text-rose-700 p-2 rounded whitespace-pre-wrap break-all">{detailLog.error_message}</pre>
                </div>
              )}
              <div>
                <div className="font-medium mb-1">原始记录</div>
                <pre className="bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap break-all">
{JSON.stringify(detailLog._raw ?? detailLog, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
