import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ops/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  AlertTriangle, RefreshCw, ChevronDown, FileText, Boxes, Package,
  Warehouse, LineChart, Truck, Wrench, Search, Clock, Info, Stethoscope,
  Store, Users, Building2, ShoppingCart, PackageCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { ShopMappingsCard } from "@/components/ops/ShopMappingsCard";
import { SalesRefundPrecheckCard, useSalesRefundPrecheck } from "@/components/ops/SalesRefundPrecheckCard";
import { JstConnectionCheckCard } from "@/components/ops/JstConnectionCheckCard";

// ============================================================
// Types
// ============================================================

type ModuleStatus = "ok" | "warn" | "error";

const STATUS_META: Record<ModuleStatus, { label: string; cls: string }> = {
  ok:    { label: "正常", cls: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" },
  warn:  { label: "需维护", cls: "bg-amber-100 text-amber-700 hover:bg-amber-100" },
  error: { label: "异常", cls: "bg-rose-100 text-rose-700 hover:bg-rose-100" },
};

const TRIGGER_LABEL: Record<string, string> = {
  auto: "自动同步",
  retry: "失败重试",
  manual_backfill: "手动补数据",
  manual: "手动同步",
};

const CATEGORY_LABEL: Record<string, string> = {
  base: "基础档案",
  product: "商品与 SKU",
  purchase: "采购与入库",
  inventory: "库存",
  sales: "销售经营",
  fulfillment: "履约与售后",
};

function asStatus(s: string | null | undefined): ModuleStatus {
  return s === "ok" || s === "warn" || s === "error" ? s : "ok";
}

function StatusBadge({ value }: { value: ModuleStatus }) {
  const m = STATUS_META[value];
  return <Badge variant="secondary" className={m.cls}>{m.label}</Badge>;
}

const fmtMoney = (n: number) => "¥" + (n ?? 0).toLocaleString("zh-CN");
const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
const fmtDuration = (ms?: number | null) =>
  ms == null ? "—" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

// ============================================================
// Subcomponents
// ============================================================

function SectionCard({
  icon, title, status, children, footer,
}: {
  icon: React.ReactNode; title: string; status?: ModuleStatus;
  children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            {icon}{title}
          </div>
          {status && <StatusBadge value={status} />}
        </div>
        {children}
        {footer && (
          <div className="pt-2 mt-2 border-t border-border text-xs text-muted-foreground space-y-0.5">
            {footer}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricRow({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "destructive" | "default" }) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums font-medium ${tone === "destructive" ? "text-destructive" : ""}`}>{value}</span>
    </div>
  );
}

// ============================================================
// Data hooks
// ============================================================

function useModules() {
  return useQuery({
    queryKey: ["jst_sync_modules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jst_sync_modules")
        .select("*")
        .order("priority", { ascending: true });
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
      const { data, error } = await supabase
        .from("jst_sync_errors")
        .select("*")
        .neq("status", "resolved")
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useRuns() {
  return useQuery({
    queryKey: ["jst_sync_runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jst_sync_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
}

function usePurchaseLogs() {
  return useQuery({
    queryKey: ["jst_sync_logs", "purchase"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jst_sync_logs")
        .select("*")
        .in("sync_type", ["purchase_orders", "purchase_receipts", "purchase"])
        .order("started_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 5000,
  });
}

// ============================================================
// Main page
// ============================================================

// ============================================================
// SalesRefundTodayPanel — 今日销售卡片(来自 jst_sales_refund_daily_summary)
// ============================================================
function SalesRefundTodayPanel() {
  const { stats } = useSalesRefundPrecheck();
  const todayQ = useQuery({
    queryKey: ["jst_sales_refund_daily_summary", "today"],
    queryFn: async () => {
      const today = new Date().toISOString().substring(0, 10);
      const { data, error } = await supabase
        .from("jst_sales_refund_daily_summary")
        .select("*")
        .eq("summary_date", today);
      if (error) throw error;
      return data ?? [];
    },
  });
  const rows = todayQ.data ?? [];
  const gmv = rows.reduce((s, r: any) => s + Number(r.gmv_amount ?? 0), 0);
  const gsv = rows.reduce((s, r: any) => s + Number(r.gsv_amount ?? 0), 0);
  const refund = rows.reduce((s, r: any) => s + Number(r.refund_amount ?? 0), 0);
  const orderCount = rows.reduce((s, r: any) => s + Number(r.order_count ?? 0), 0);
  const refundCount = rows.reduce((s, r: any) => s + Number(r.refund_count ?? 0), 0);
  const refundRate = gmv > 0 ? Number(((refund / gmv) * 100).toFixed(2)) : 0;
  const lastGenerated = rows.reduce<string | null>(
    (m, r: any) => (!m || (r.generated_at && r.generated_at > m) ? r.generated_at : m), null);
  const hasSummary = rows.length > 0;

  return (
    <div className="rounded-md border border-border p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div>统计来源：jst_sales_refund_daily_summary｜口径：聚水潭经营口径</div>
        <div>最近生成：{fmtTime(lastGenerated)}</div>
      </div>
      {!hasSummary && !stats.allowSummary && (
        <div className="rounded-md border border-amber-300 bg-amber-50/60 p-3 text-xs text-amber-800">
          已同步原始销售数据，但因店铺映射未完成，暂未更新正式经营指标。
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div><div className="text-xs text-muted-foreground">今日 GMV</div><div className="text-xl font-semibold tabular-nums">{fmtMoney(gmv)}</div></div>
        <div><div className="text-xs text-muted-foreground">今日 GSV</div><div className="text-xl font-semibold tabular-nums">{fmtMoney(gsv)}</div></div>
        <div><div className="text-xs text-muted-foreground">今日退款金额</div><div className="text-xl font-semibold tabular-nums">{fmtMoney(refund)}</div></div>
        <div><div className="text-xs text-muted-foreground">今日订单数</div><div className="text-xl font-semibold tabular-nums">{orderCount}</div></div>
        <div><div className="text-xs text-muted-foreground">今日退款数</div><div className="text-xl font-semibold tabular-nums">{refundCount}</div></div>
        <div><div className="text-xs text-muted-foreground">今日退款率</div><div className="text-xl font-semibold tabular-nums">{refundRate}%</div></div>
      </div>
      <div className="text-xs text-muted-foreground pt-2 border-t border-border">
        进入正式汇总店铺数：{rows.length}｜仅展示通过映射治理的店铺数据。
      </div>
    </div>
  );
}

export default function JstDataIntegrationPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const modulesQ = useModules();
  const metricsQ = useMetrics();
  const errorsQ = useErrors();
  const runsQ = useRuns();
  const purchaseLogsQ = usePurchaseLogs();

  const [keyword, setKeyword] = useState("");
  const [triggerFilter, setTriggerFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [detailLog, setDetailLog] = useState<any | null>(null);

  // ------------------------------------------------------------
  // 触发同步：base_archive / shop / supplier / warehouse 走真实 Edge Function；
  // 其他模块暂为占位（写日志 + 提示未接入）。
  // ------------------------------------------------------------
  // 真实接入的 module_key：
  //   - base_archive(+scope: shops/suppliers/warehouses)
  //   - sales_refund(+days)
  // 其它 module_key 一律按钮禁用，不允许写入 jst_sync_runs 占位记录。
  const REAL_BASE_KEYS = new Set(["base_archive", "shop", "supplier", "warehouse"]);
  const isRealModuleKey = (k: string) => REAL_BASE_KEYS.has(k) || k === "sales_refund";

  type TriggerInput =
    | { kind: "base_archive"; scope?: string[]; trigger_type: string; label: string }
    | { kind: "sales_refund"; days: number; trigger_type: string; label: string };

  const triggerRun = useMutation({
    mutationFn: async (input: TriggerInput) => {
      if (!user) throw new Error("未登录");
      const body: Record<string, unknown> = {
        trigger_type: input.trigger_type,
      };
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
      return {
        summary: data?.message ?? data?.summary ?? "已完成",
        label: input.label,
        summary_updated: data?.summary_updated,
      };
    },
    onSuccess: (d) => {
      toast({
        title: d.summary_updated === false ? "已保存原始数据" : "同步完成",
        description: `${d.label} — ${d.summary}`,
      });
      qc.invalidateQueries({ queryKey: ["jst_sync_runs"] });
      qc.invalidateQueries({ queryKey: ["jst_sync_modules"] });
      qc.invalidateQueries({ queryKey: ["jst_sync_metrics"] });
      qc.invalidateQueries({ queryKey: ["jst_sync_errors"] });
    },
    onError: (e: any) => toast({ title: "同步失败", description: e.message, variant: "destructive" }),
  });

  // 真实接入:聚水潭采购单 + 采购入库同步(一个 Edge Function 同时拉两类数据)
  const purchaseSyncMut = useMutation({
    mutationFn: async (input: { days?: number; label: string }) => {
      const body: Record<string, unknown> = { action: "sync" };
      if (input.days && input.days > 0) {
        const to = new Date();
        const from = new Date(Date.now() - input.days * 86400_000);
        body.start_date = from.toISOString();
        body.end_date = to.toISOString();
      }
      const { data, error } = await supabase.functions.invoke("jst-sync-purchase-orders", { body });
      if (error) throw new Error(error.message);
      if (data?.ok === false) throw new Error(data?.error ?? "同步失败");
      return { label: input.label, log_id: data?.log_id as string | undefined, message: data?.message ?? "同步已在后台启动" };
    },
    onSuccess: (d) => {
      toast({
        title: "已启动采购同步",
        description: `${d.label} — ${d.message}${d.log_id ? `（日志 ${d.log_id.slice(0, 8)}）` : ""}`,
      });
      qc.invalidateQueries({ queryKey: ["jst_sync_runs"] });
      qc.invalidateQueries({ queryKey: ["jst_sync_logs", "purchase"] });
      qc.invalidateQueries({ queryKey: ["jst_sync_modules"] });
      qc.invalidateQueries({ queryKey: ["jst_sync_metrics"] });
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["purchase_order_items"] });
      qc.invalidateQueries({ queryKey: ["purchase_receipts"] });
      qc.invalidateQueries({ queryKey: ["purchase_receipt_items"] });
      // 跳转到日志区
      setTimeout(() => document.getElementById("jst-sync-logs")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    },
    onError: (e: any) => toast({ title: "采购同步失败", description: e.message, variant: "destructive" }),
  });

  // 给未接入按钮统一弹提示
  const notWired = (label: string) =>
    toast({
      title: "暂未接入",
      description: `${label} 暂未接入真实聚水潭 API，按钮已禁用。`,
    });

  const baseArchiveScopeOf = (k: string): string[] | undefined => ({
    shop: ["shops"], supplier: ["suppliers"], warehouse: ["warehouses"],
    base_archive: undefined as unknown as string[],
  } as Record<string, string[] | undefined>)[k];

  const retryAbnormalModule = (moduleKey: string, label = "重试异常任务") => {
    if (REAL_BASE_KEYS.has(moduleKey)) {
      triggerRun.mutate({ kind: "base_archive", scope: baseArchiveScopeOf(moduleKey), trigger_type: "retry", label });
    } else if (moduleKey === "sales_refund") {
      triggerRun.mutate({ kind: "sales_refund", days: 1, trigger_type: "retry", label });
    } else {
      notWired(label);
    }
  };

  // ------------------------------------------------------------
  // Derived state
  // ------------------------------------------------------------
  const modules = modulesQ.data ?? [];
  const metrics = metricsQ.data ?? {};
  const errors = errorsQ.data ?? [];
  const runs = runsQ.data ?? [];
  const purchaseLogs = purchaseLogsQ.data ?? [];

  // 将 jst_sync_logs(采购) 归一化为日志行结构
  const purchaseLogRows = useMemo(() => purchaseLogs.map((p: any) => {
    const fetched = (p.fetched_orders_count ?? 0) + (p.fetched_items_count ?? 0) + (p.fetched_receipts_count ?? 0);
    return {
      id: `plog-${p.id}`,
      _source: "purchase_log" as const,
      _raw: p,
      module_key: p.sync_type,
      trigger_type: "manual",
      started_at: p.started_at,
      status: p.status === "success" ? "ok" : p.status === "running" ? "running" : p.status === "partial" ? "warn" : "error",
      inserted_count: fetched,
      updated_count: 0,
      failed_count: p.status === "error" ? 1 : 0,
      duration_ms: p.ended_at ? new Date(p.ended_at).getTime() - new Date(p.started_at).getTime() : null,
      current_total_summary: p.message ?? "",
      error_message: p.error_detail ?? "",
    };
  }), [purchaseLogs]);

  const globalMetric = metrics["global_status"];
  const globalExtra = (globalMetric?.metric_extra ?? {}) as Record<string, any>;

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
      const groupLabel = isPurchaseLog
        ? CATEGORY_LABEL.purchase
        : (mod ? (CATEGORY_LABEL[mod.category] ?? mod.category) : "");
      const moduleName = isPurchaseLog
        ? (l.module_key === "purchase_orders" ? "采购单" : l.module_key === "purchase_receipts" ? "采购入库单" : "采购与入库")
        : (mod?.module_name ?? l.module_key);
      const triggerLabel = TRIGGER_LABEL[l.trigger_type] ?? l.trigger_type;

      if (triggerFilter !== "all" && triggerLabel !== triggerFilter) return false;
      if (groupFilter !== "all" && groupLabel !== groupFilter) return false;
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (keyword) {
        const blob = `${moduleName} ${groupLabel} ${l.error_message ?? ""}`.toLowerCase();
        if (!blob.includes(keyword.toLowerCase())) return false;
      }
      return true;
    });
  }, [runs, purchaseLogRows, modules, triggerFilter, groupFilter, statusFilter, keyword]);

  const isLoading = modulesQ.isLoading || metricsQ.isLoading || errorsQ.isLoading || runsQ.isLoading;

  // helper to render a SectionCard from metric_extra
  const moduleByKey = (k: string) => modules.find((m) => m.module_key === k);

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={["系统设置", "聚水潭数据接入详情"]}
        title="聚水潭数据接入详情"
        description="用于管理聚水潭的数据接入状态。日常以自动同步为主，下面所有经营指标均为指定时间范围内的累计值，不是本次同步新增金额。"
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={triggerRun.isPending}>
                <RefreshCw className={`w-4 h-4 mr-1.5 ${triggerRun.isPending ? "animate-spin" : ""}`} /> 同步控制
                <ChevronDown className="w-4 h-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                全局控制
              </DropdownMenuLabel>
              <DropdownMenuItem
                disabled={!abnormalModules.some((m) => isRealModuleKey(m.module_key))}
                onClick={() => {
                  const target = abnormalModules.find((m) => isRealModuleKey(m.module_key));
                  if (!target) return notWired("重试异常任务");
                  retryAbnormalModule(target.module_key, `重试异常任务（${target.module_name}）`);
                }}
              >
                重试异常任务{(() => {
                  const n = abnormalModules.filter((m) => isRealModuleKey(m.module_key)).length;
                  return n > 0 ? `（${n}）` : "";
                })()}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                document.getElementById("jst-sync-logs")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}>
                查看同步日志
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                document.getElementById("jst-advanced-diagnostics")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}>
                打开高级同步面板
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />


      {isLoading && (
        <div className="text-sm text-muted-foreground">加载中…</div>
      )}

      {/* 一、异常提示 */}
      {abnormalModules.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1 space-y-1">
              <div className="text-sm font-medium text-amber-900">
                {abnormalModules.length} 个模块同步异常（自动重试中）
              </div>
              <div className="text-xs text-amber-800">
                {abnormalModules.map((m) => `${m.module_name}（${m.status === "error" ? "失败" : "需维护"}）`).join("、")}
                。系统正在进行指数级重试，建议观察。
              </div>
              {errors.length > 0 && (
                <div className="text-xs text-amber-800/80">
                  最新异常：{errors[0].error_message}
                </div>
              )}
            </div>
            <Button variant="outline" size="sm">查看异常</Button>
            <Button size="sm" onClick={() => retryAbnormalModule(abnormalModules[0].module_key, "手动重试异常模块")}>
              手动重试
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 二、全局同步状态 */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-primary" />
                <h3 className="text-base font-semibold">全局同步状态</h3>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="secondary" className="bg-amber-100 text-amber-700">{globalMetric?.metric_value ?? "—"}</Badge>
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
                  自动同步：{globalExtra.auto_enabled ? "已开启" : "已关闭"}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-3">
                <span>最近同步：{fmtTime(globalMetric?.last_sync_at)}</span>
                <span>下次自动同步：{globalExtra.next_sync_at ?? "—"}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-x-8 gap-y-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">今日同步批次</div>
                <div className="text-xl font-semibold tabular-nums">{globalExtra.today_batches ?? 0}</div>
                <div className="text-[11px] text-muted-foreground">任务运行次数</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">今日同步记录</div>
                <div className="text-xl font-semibold tabular-nums">{(globalExtra.today_records ?? 0).toLocaleString()}</div>
                <div className="text-[11px] text-muted-foreground">处理数据条数</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">成功记录</div>
                <div className="text-xl font-semibold tabular-nums text-emerald-600">{(globalExtra.success_records ?? 0).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">失败记录</div>
                <div className="text-xl font-semibold tabular-nums text-rose-600">{globalExtra.failed_records ?? 0}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">运行中任务</div>
                <div className="text-xl font-semibold tabular-nums">{globalExtra.running ?? 0}</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 二点二、聚水潭连接检测 */}
      <JstConnectionCheckCard />

      {/* 二点五、聚水潭店铺映射 */}
      <ShopMappingsCard />

      {/* 三、自动同步计划 */}
      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-4 flex items-center gap-2 border-b border-border">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">自动同步计划</h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>业务模块</TableHead>
                <TableHead>同步内容</TableHead>
                <TableHead>同步频率</TableHead>
                <TableHead>上次执行</TableHead>
                <TableHead>下次执行</TableHead>
                <TableHead>当前状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {modules.map((row) => {
                const s = asStatus(row.status);
                return (
                  <TableRow key={row.module_key}>
                    <TableCell className="font-medium">{row.module_name}</TableCell>
                    <TableCell className="text-muted-foreground">{row.sync_content}</TableCell>
                    <TableCell className="text-muted-foreground">{row.sync_frequency}</TableCell>
                    <TableCell className={s === "error" ? "text-rose-600" : ""}>{fmtTime(row.last_sync_at)}</TableCell>
                    <TableCell className={s === "error" ? "text-rose-600" : ""}>
                      {s === "error" ? "自动重试中" : fmtTime(row.next_sync_at)}
                    </TableCell>
                    <TableCell><StatusBadge value={s} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 四、核心数据概览 */}
      <div>
        <h3 className="text-sm font-semibold mb-3">核心数据概览</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(() => {
            const base = (metrics["base_archive_summary"]?.metric_extra ?? {}) as any;
            const baseMod = moduleByKey("base_archive");
            return (
              <SectionCard
                icon={<FileText className="w-4 h-4 text-muted-foreground" />}
                title="基础档案"
                status={asStatus(base.status)}
                footer={<div>最近同步：{fmtTime(baseMod?.last_sync_at)}（{baseMod?.sync_frequency}）</div>}
              >
                <MetricRow label="店铺" value={base.shops ?? 0} />
                <MetricRow label="供应商" value={base.suppliers ?? 0} />
                <MetricRow label="仓库" value={base.warehouses ?? 0} />
              </SectionCard>
            );
          })()}

          {(() => {
            const p = (metrics["product_summary"]?.metric_extra ?? {}) as any;
            const mod = moduleByKey("product");
            return (
              <SectionCard
                icon={<Package className="w-4 h-4 text-muted-foreground" />}
                title="商品与 SKU"
                status={asStatus(p.status)}
                footer={<div>最近同步：{fmtTime(mod?.last_sync_at)}（{mod?.sync_frequency}）</div>}
              >
                <MetricRow label="商品" value={p.products ?? 0} />
                <MetricRow label="SKU" value={p.skus ?? 0} />
                <MetricRow label="图片缓存" value={p.image_cache ?? "—"} />
              </SectionCard>
            );
          })()}

          {(() => {
            const p = (metrics["purchase_summary"]?.metric_extra ?? {}) as any;
            const mod = moduleByKey("purchase");
            return (
              <SectionCard
                icon={<Boxes className="w-4 h-4 text-muted-foreground" />}
                title="采购与入库"
                status={asStatus(p.status)}
                footer={<div>最近同步：{fmtTime(mod?.last_sync_at)}（{mod?.sync_frequency}）</div>}
              >
                <MetricRow label="今日采购单" value={p.today_po ?? 0} />
                <MetricRow label="今日入库单" value={p.today_io ?? 0} />
                <MetricRow label="入库异常" value={p.io_errors ?? 0} />
              </SectionCard>
            );
          })()}

          {(() => {
            const p = (metrics["inventory_summary"]?.metric_extra ?? {}) as any;
            const mod = moduleByKey("inventory");
            const s = asStatus(p.status);
            return (
              <SectionCard
                icon={<Warehouse className="w-4 h-4 text-muted-foreground" />}
                title="库存情况"
                status={s}
                footer={
                  <>
                    <div>最近同步：{fmtTime(mod?.last_sync_at)}{s === "error" ? "（超时）" : ""}</div>
                    {s === "error" && <div className="text-amber-700">当前状态：自动重试中</div>}
                  </>
                }
              >
                <MetricRow label="库存 SKU" value={p.stock_skus ?? 0} />
                <MetricRow label="异常记录" value={p.errors ?? 0} tone={p.errors ? "destructive" : "default"} />
              </SectionCard>
            );
          })()}

          {(() => {
            const sales = metrics["sales_summary"];
            const p = (sales?.metric_extra ?? {}) as any;
            return (
              <SectionCard
                icon={<LineChart className="w-4 h-4 text-muted-foreground" />}
                title="销售与退款"
                status={asStatus(p.status)}
                footer={
                  <>
                    <div>统计范围：{sales?.time_range_label}｜最近同步：{fmtTime(sales?.last_sync_at)}</div>
                    <div>口径：{sales?.data_source_label}</div>
                    <div className="text-muted-foreground/80">
                      本次同步新增：{p.sync_delta_orders ?? 0} 单 / {fmtMoney(p.sync_delta_gmv ?? 0)} GMV
                    </div>
                  </>
                }
              >
                <MetricRow label="今日 GMV" value={fmtMoney(p.today_gmv ?? 0)} />
                <MetricRow label="今日 GSV" value={fmtMoney(p.today_gsv ?? 0)} />
                <MetricRow label="今日退款金额" value={fmtMoney(p.today_refund ?? 0)} />
                <MetricRow label="今日退款率" value={`${p.refund_rate ?? 0}%`} />
              </SectionCard>
            );
          })()}

          {(() => {
            const p = (metrics["fulfillment_summary"]?.metric_extra ?? {}) as any;
            const mod = moduleByKey("purchase");
            return (
              <SectionCard
                icon={<Truck className="w-4 h-4 text-muted-foreground" />}
                title="履约与售后"
                status={asStatus(p.status)}
                footer={<div>最近同步：{fmtTime(metrics["fulfillment_summary"]?.last_sync_at ?? mod?.last_sync_at)}</div>}
              >
                <MetricRow label="待发货" value={p.pending_shipment ?? 0} />
                <MetricRow label="超时未发货" value={p.overdue_shipment ?? 0} tone={p.overdue_shipment ? "destructive" : "default"} />
                <MetricRow label="今日售后单" value={p.today_aftersales ?? 0} />
              </SectionCard>
            );
          })()}
        </div>
      </div>

      {/* 五、同步模块管理（按业务区域） */}
      <div>
        <h3 className="text-sm font-semibold mb-3">同步模块管理</h3>
        <Card>
          <CardContent className="p-0">
            <Tabs defaultValue="base">
              <div className="px-4 pt-3">
                <TabsList>
                  <TabsTrigger value="base">基础档案同步</TabsTrigger>
                  <TabsTrigger value="sales">销售与退款同步</TabsTrigger>
                  <TabsTrigger value="purchase">采购与入库同步</TabsTrigger>
                </TabsList>
              </div>

              {/* —— 基础档案同步 —— */}
              <TabsContent value="base" className="m-0">
                <div className="px-5 pt-4 pb-3 border-b border-border flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => triggerRun.mutate({ kind: "base_archive", scope: ["shops"], trigger_type: "manual", label: "同步店铺" })}>
                    <Store className="w-3.5 h-3.5 mr-1" /> 同步店铺
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => triggerRun.mutate({ kind: "base_archive", scope: ["suppliers"], trigger_type: "manual", label: "同步供应商" })}>
                    <Users className="w-3.5 h-3.5 mr-1" /> 同步供应商
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => triggerRun.mutate({ kind: "base_archive", scope: ["warehouses"], trigger_type: "manual", label: "同步仓库" })}>
                    <Building2 className="w-3.5 h-3.5 mr-1" /> 同步仓库
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => triggerRun.mutate({ kind: "base_archive", trigger_type: "manual", label: "同步基础档案（店铺/供应商/仓库）" })}>
                    <FileText className="w-3.5 h-3.5 mr-1" /> 同步基础档案
                  </Button>
                  <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 ml-1">已接入真实同步</Badge>
                  <span className="text-xs text-muted-foreground ml-2">基础档案是销售/采购同步的前置条件。</span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>模块名称</TableHead>
                      <TableHead>同步内容</TableHead>
                      <TableHead>自动同步频率</TableHead>
                      <TableHead>上次同步</TableHead>
                      <TableHead>下次同步</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>最近结果 / 异常处理</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modules
                      .filter((m) => m.category !== "sales" && m.category !== "purchase" && m.category !== "fulfillment")
                      .map((m) => {
                        const s = asStatus(m.status);
                        return (
                          <TableRow key={m.module_key}>
                            <TableCell className="font-medium">{m.module_name}</TableCell>
                            <TableCell className="text-muted-foreground">{m.sync_content}</TableCell>
                            <TableCell className="text-muted-foreground">{m.sync_frequency}</TableCell>
                            <TableCell className={s === "error" ? "text-rose-600" : ""}>{fmtTime(m.last_sync_at)}</TableCell>
                            <TableCell className={s === "error" ? "text-rose-600" : ""}>
                              {s === "error" ? "自动重试中" : fmtTime(m.next_sync_at)}
                            </TableCell>
                            <TableCell><StatusBadge value={s} /></TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[260px]">{m.last_result_summary}</TableCell>
                            <TableCell className="text-right space-x-2">
                              {isRealModuleKey(m.module_key) ? (
                                <Button variant="ghost" size="sm" onClick={() => retryAbnormalModule(m.module_key, `${s === "error" ? "重试" : "同步"} ${m.module_name}`)}>
                                  {s === "error" ? "重试" : "同步"}
                                </Button>
                              ) : (
                                <Button variant="ghost" size="sm" disabled title="该模块暂未接入真实同步">暂未接入</Button>
                              )}
                              <Button variant="ghost" size="sm">日志</Button>
                              <Button variant="ghost" size="sm">查看异常</Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </TabsContent>

              {/* —— 销售与退款同步 —— */}
              <TabsContent value="sales" className="m-0 p-5 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => triggerRun.mutate({ kind: "sales_refund", days: 1, trigger_type: "manual", label: "同步今日销售与退款" })}>
                    同步今日销售与退款
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => triggerRun.mutate({ kind: "sales_refund", days: 7, trigger_type: "manual_backfill", label: "同步最近 7 天" })}>
                    同步最近 7 天
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => triggerRun.mutate({ kind: "sales_refund", days: 30, trigger_type: "manual_backfill", label: "同步最近 30 天" })}>
                    同步最近 30 天
                  </Button>
                  <Button size="sm" variant="outline" disabled title="需要先在店铺映射页选择已映射店铺，暂未接入" onClick={() => notWired("按店铺同步销售与退款")}>
                    按店铺同步（暂未接入）
                  </Button>
                  <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 ml-1">已接入真实同步</Badge>
                  <span className="text-xs text-amber-700 ml-2 inline-flex items-center gap-1">
                    <Info className="w-3.5 h-3.5" />
                    店铺映射未完成时，只允许同步 raw 原始数据，不更新正式 GMV / GSV 汇总。
                  </span>
                </div>
                <SalesRefundPrecheckCard />
                <SalesRefundTodayPanel />
              </TabsContent>

              {/* —— 采购与入库同步 —— */}
              <TabsContent value="purchase" className="m-0">
                <div className="px-5 pt-4 pb-3 border-b border-border flex flex-wrap items-center gap-2">
                  <Button size="sm" disabled={purchaseSyncMut.isPending}
                    onClick={() => purchaseSyncMut.mutate({ label: "同步采购单（增量）" })}>
                    <ShoppingCart className="w-3.5 h-3.5 mr-1" />
                    {purchaseSyncMut.isPending ? "同步中..." : "同步采购单"}
                  </Button>
                  <Button size="sm" variant="outline" disabled={purchaseSyncMut.isPending}
                    onClick={() => purchaseSyncMut.mutate({ label: "同步采购入库单（增量）" })}>
                    <PackageCheck className="w-3.5 h-3.5 mr-1" /> 同步采购入库单
                  </Button>
                  <Button size="sm" variant="outline" disabled={purchaseSyncMut.isPending}
                    onClick={() => purchaseSyncMut.mutate({ days: 7, label: "最近 7 天采购与入库" })}>
                    同步最近 7 天采购与入库
                  </Button>
                  <Button size="sm" variant="outline" disabled={purchaseSyncMut.isPending}
                    onClick={() => purchaseSyncMut.mutate({ days: 30, label: "最近 30 天采购与入库" })}>
                    同步最近 30 天采购与入库
                  </Button>
                  <Badge variant="default" className="ml-1">已接入</Badge>
                  <span className="text-xs text-muted-foreground ml-2">
                    采购单与采购入库单由同一个 Edge Function 同时拉取，写入 purchase_orders / purchase_receipts，日志在 jst_sync_logs。
                  </span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>模块名称</TableHead>
                      <TableHead>同步内容</TableHead>
                      <TableHead>自动同步频率</TableHead>
                      <TableHead>上次同步</TableHead>
                      <TableHead>下次同步</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>最近结果 / 异常处理</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modules
                      .filter((m) => m.category === "purchase" || m.category === "fulfillment")
                      .map((m) => {
                        const s = asStatus(m.status);
                        return (
                          <TableRow key={m.module_key}>
                            <TableCell className="font-medium">{m.module_name}</TableCell>
                            <TableCell className="text-muted-foreground">{m.sync_content}</TableCell>
                            <TableCell className="text-muted-foreground">{m.sync_frequency}</TableCell>
                            <TableCell className={s === "error" ? "text-rose-600" : ""}>{fmtTime(m.last_sync_at)}</TableCell>
                            <TableCell className={s === "error" ? "text-rose-600" : ""}>
                              {s === "error" ? "自动重试中" : fmtTime(m.next_sync_at)}
                            </TableCell>
                            <TableCell><StatusBadge value={s} /></TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[260px]">{m.last_result_summary}</TableCell>
                            <TableCell className="text-right space-x-2">
                              <Button variant="ghost" size="sm" disabled={purchaseSyncMut.isPending}
                                onClick={() => purchaseSyncMut.mutate({ label: `同步 ${m.module_name}` })}>
                                {purchaseSyncMut.isPending ? "同步中..." : "同步"}
                              </Button>
                              <Button variant="ghost" size="sm">日志</Button>
                              <Button variant="ghost" size="sm">查看异常</Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>


      {/* 六、补数据工具 */}
      <Collapsible>
        <Card>
          <CollapsibleTrigger asChild>
            <button className="w-full px-5 py-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-2 text-left">
                <Wrench className="w-4 h-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-semibold">补数据工具</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    日常不需要操作，仅用于异常修复和历史数据补同步。
                  </div>
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 pb-5 px-5 space-y-3 border-t border-border">
              <div className="flex flex-wrap gap-2 pt-4">
                <Button variant="outline" size="sm" onClick={() => triggerRun.mutate({ kind: "sales_refund", days: 7, trigger_type: "manual_backfill", label: "按时间窗补同步（销售退款最近 7 天）" })}>按时间窗补同步（销售退款 7d）</Button>
                <Button variant="outline" size="sm" disabled title="按款号补同步暂未接入" onClick={() => notWired("按款号补同步")}>按款号补同步</Button>
                <Button variant="outline" size="sm" disabled title="按 SKU 补同步暂未接入" onClick={() => notWired("按 SKU 补同步")}>按 SKU 补同步</Button>
                <Button variant="outline" size="sm" onClick={() => triggerRun.mutate({ kind: "base_archive", scope: ["shops"], trigger_type: "manual_backfill", label: "按店铺补同步（重新拉取店铺资料）" })}>按店铺补同步（基础档案）</Button>

                <Button variant="outline" size="sm" disabled title="商品/SKU 同步还未接入到本调度，按钮已禁用" onClick={() => notWired("全量同步商品资料")}>
                  <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                  全量同步商品资料（暂未接入）
                </Button>


                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                      全量同步基础档案
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>确认全量重拉店铺 / 供应商 / 仓库？</AlertDialogTitle>
                      <AlertDialogDescription>
                        会重新拉取聚水潭所有店铺、供应商、仓库资料并 upsert 到本系统的主数据表，
                        不会覆盖已绑定的经营主体。耗时较长且占用 API 配额，仅在异常修复时使用。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction onClick={() => triggerRun.mutate({ kind: "base_archive", trigger_type: "manual_backfill", label: "全量同步基础档案（店铺/供应商/仓库）" })}>
                        确认执行
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              <p className="text-xs text-muted-foreground">
                提示：所有补数据操作都会在同步日志中留痕，触发方式标记为「手动补数据」。
              </p>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* 六点五、高级诊断 */}
      <Collapsible>
        <Card id="jst-advanced-diagnostics">
          <CollapsibleTrigger asChild>
            <button className="w-full px-5 py-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-2 text-left">
                <Stethoscope className="w-4 h-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-semibold">高级诊断</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    仅供开发与运维排查使用，日常不需要操作。
                  </div>
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 pb-5 px-5 space-y-3 border-t border-border">
              <div className="flex flex-wrap gap-2 pt-4">
                <Button variant="outline" size="sm">测试聚水潭接口</Button>
                <Button variant="outline" size="sm">刷新 Access Token</Button>
                <Button variant="outline" size="sm">查看任务队列</Button>
                <Button variant="outline" size="sm">查看原始响应</Button>
                <Button variant="outline" size="sm">查看 Edge Function 错误</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                这些操作可能直接调用聚水潭接口或暴露内部状态，请谨慎使用。
              </p>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* 七、同步日志 */}
      <Card id="jst-sync-logs">

        <CardContent className="p-0">
          <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3 border-b border-border">
            <h3 className="text-sm font-semibold">同步日志</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={triggerFilter} onValueChange={setTriggerFilter}>
                <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder="触发方式" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部触发方式</SelectItem>
                  <SelectItem value="自动同步">自动同步</SelectItem>
                  <SelectItem value="失败重试">失败重试</SelectItem>
                  <SelectItem value="手动补数据">手动补数据</SelectItem>
                  <SelectItem value="手动同步">手动同步</SelectItem>
                </SelectContent>
              </Select>
              <Select value={groupFilter} onValueChange={setGroupFilter}>
                <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="模块分类" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部模块分类</SelectItem>
                  {Object.values(CATEGORY_LABEL).map((v) => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[120px] h-9"><SelectValue placeholder="状态" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="ok">成功</SelectItem>
                  <SelectItem value="warn">部分失败</SelectItem>
                  <SelectItem value="error">失败</SelectItem>
                  <SelectItem value="running">运行中</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜索关键词"
                  className="h-9 pl-7 w-[180px]"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>触发方式</TableHead>
                  <TableHead>模块分类</TableHead>
                  <TableHead>同步模块</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>本次新增</TableHead>
                  <TableHead>本次更新</TableHead>
                  <TableHead>本次失败</TableHead>
                  <TableHead>当前累计</TableHead>
                  <TableHead>耗时</TableHead>
                  <TableHead>错误原因</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center text-muted-foreground py-10">
                      没有匹配的日志
                    </TableCell>
                  </TableRow>
                ) : filteredLogs.map((l: any) => {
                  const isPurchase = l._source === "purchase_log";
                  const mod = modules.find((m) => m.module_key === l.module_key);
                  const groupLabel = isPurchase
                    ? CATEGORY_LABEL.purchase
                    : (mod ? (CATEGORY_LABEL[mod.category] ?? mod.category) : "—");
                  const moduleName = isPurchase
                    ? (l.module_key === "purchase_orders" ? "采购单" : l.module_key === "purchase_receipts" ? "采购入库单" : "采购与入库")
                    : (mod?.module_name ?? l.module_key);
                  const s = asStatus(l.status === "running" ? "ok" : l.status);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{fmtDateTime(l.started_at)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-normal">{TRIGGER_LABEL[l.trigger_type] ?? l.trigger_type}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{groupLabel}</TableCell>
                      <TableCell>{moduleName}</TableCell>
                      <TableCell>
                        {l.status === "running"
                          ? <Badge variant="secondary" className="bg-sky-100 text-sky-700">运行中</Badge>
                          : <StatusBadge value={s} />}
                      </TableCell>
                      <TableCell className="text-xs">{l.inserted_count ?? 0}</TableCell>
                      <TableCell className="text-xs">{l.updated_count ?? 0}</TableCell>
                      <TableCell className={`text-xs ${(l.failed_count ?? 0) > 0 ? "text-rose-600" : ""}`}>{l.failed_count ?? 0}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{l.current_total_summary || "—"}</TableCell>
                      <TableCell className="text-xs">{fmtDuration(l.duration_ms)}</TableCell>
                      <TableCell className="text-xs text-rose-600 max-w-[200px] truncate" title={l.error_message ?? ""}>
                        {l.error_message || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setDetailLog(l)}>
                          详情
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="px-5 py-3 text-[11px] text-muted-foreground border-t border-border">
            <span className="font-medium">本次新增</span> = 这次同步真正写入的数据；
            <span className="font-medium ml-2">当前累计</span> = 该模块在系统里的累计值。两者不可混淆。
          </div>
        </CardContent>
      </Card>

      {/* 全局说明 */}
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          系统以<strong className="text-foreground">自动同步</strong>为主，人工同步仅用于异常重试和补数据。
          页面中的 GMV、GSV、退款金额等经营指标均为指定时间范围内的累计值，不代表本次同步新增金额。
        </div>
      </div>

      <Sheet open={!!detailLog} onOpenChange={(o) => !o && setDetailLog(null)}>
        <SheetContent className="w-[640px] sm:max-w-[640px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>同步日志详情</SheetTitle>
            <SheetDescription>
              {detailLog?._source === "purchase_log" ? "来源:jst_sync_logs(采购与入库)" : "来源:jst_sync_runs"}
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
