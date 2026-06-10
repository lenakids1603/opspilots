// 自动同步总览 + 同步记录表（jst_sync_jobs）
// - 通过 RPC get_auto_sync_overview() 拉取每个 cron 任务的状态
// - 通过 RPC set_auto_sync_active() 启停（仅 admin）
// - 同步记录读 jst_sync_jobs，trigger_type='cron' 视为自动，其它为手动
// - 所有时间字段统一显示为北京时间 (Asia/Shanghai)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, RefreshCw, AlertCircle } from "lucide-react";

type OverviewRow = {
  jobname: string;
  sync_type: string;
  schedule: string;
  active: boolean;
  last_run_status: string | null;
  last_run_started_at: string | null;
  last_run_ended_at: string | null;
  last_run_message: string | null;
  success_count_24h: number;
  failed_count_24h: number;
};

type JobRow = {
  id: string;
  sync_type: string;
  status: string;
  trigger_type: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  message: string | null;
  error_detail: string | null;
  created_by: string | null;
};

// ===== 业务分组配置（含 API 来源标签 + 中文名）=====
type CardCfg = { sync_type: string; cn: string; api: string };
type GroupCfg = { key: string; title: string; cards: CardCfg[] };

const GROUPS: GroupCfg[] = [
  {
    key: "订单",
    title: "订单",
    cards: [
      { sync_type: "sales_orders", cn: "销售订单", api: "订单API" },
      { sync_type: "refund_orders", cn: "退货退款单", api: "售后API" },
    ],
  },
  {
    key: "出库",
    title: "出库",
    cards: [{ sync_type: "outbound_orders", cn: "出库单", api: "出库API" }],
  },
  {
    key: "入库",
    title: "入库",
    cards: [
      { sync_type: "purchase_inbound_orders", cn: "采购入库单", api: "入库API" },
      { sync_type: "aftersale_received", cn: "销退入库 / 售后收货", api: "售后API" },
    ],
  },
  {
    key: "采购",
    title: "采购",
    cards: [{ sync_type: "purchase_orders", cn: "采购单", api: "采购API" }],
  },
  {
    key: "商品档案",
    title: "商品档案",
    cards: [
      { sync_type: "dispatch_base_archive", cn: "商品基础档案", api: "基础/商品API" },
    ],
  },
];

const SYNC_TYPE_CN: Record<string, string> = Object.fromEntries(
  GROUPS.flatMap((g) => g.cards.map((c) => [c.sync_type, c.cn])),
);
const SYNC_TYPE_GROUP: Record<string, string> = Object.fromEntries(
  GROUPS.flatMap((g) => g.cards.map((c) => [c.sync_type, g.title])),
);

// ===== 时间工具：统一显示北京时间 =====
function fmtBJ(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(d)
    .reduce<Record<string, string>>((a, p) => {
      a[p.type] = p.value;
      return a;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

// ===== cron 解析：人话描述 + 下次触发时间（pg_cron 默认 UTC） =====
function parseField(s: string, lo: number, hi: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of s.split(",")) {
    const [range, stepStr] = part.split("/");
    const step = stepStr ? parseInt(stepStr, 10) : 1;
    if (!step || step <= 0) return null;
    let start = lo;
    let end = hi;
    if (range !== "*") {
      if (range.includes("-")) {
        const [a, b] = range.split("-").map(Number);
        if (isNaN(a) || isNaN(b)) return null;
        start = a;
        end = b;
      } else {
        const v = parseInt(range, 10);
        if (isNaN(v)) return null;
        start = end = v;
      }
    }
    for (let v = start; v <= end; v += step) out.add(v);
  }
  return out;
}
function nextCronFireUtc(expr: string, from: Date): Date | null {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const mins = parseField(f[0], 0, 59);
  const hrs = parseField(f[1], 0, 23);
  const doms = parseField(f[2], 1, 31);
  const mons = parseField(f[3], 1, 12);
  const dows = parseField(f[4], 0, 6);
  if (!mins || !hrs || !doms || !mons || !dows) return null;
  const d = new Date(from.getTime() + 60_000);
  d.setUTCSeconds(0, 0);
  for (let i = 0; i < 60 * 24 * 40; i++) {
    if (
      mins.has(d.getUTCMinutes()) &&
      hrs.has(d.getUTCHours()) &&
      doms.has(d.getUTCDate()) &&
      mons.has(d.getUTCMonth() + 1) &&
      dows.has(d.getUTCDay())
    ) {
      return new Date(d);
    }
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  return null;
}
function describeSchedule(expr: string, sync_type: string): string {
  const e = expr.trim();
  // window 默认提示（与 cron migration 中 payload 对齐）
  const WIN: Record<string, string> = {
    sales_orders: "最近 45 分钟",
    outbound_orders: "最近 45 分钟",
    refund_orders: "最近 180 分钟",
    aftersale_received: "最近 180 分钟",
    purchase_orders: "最近 60 分钟",
    purchase_inbound_orders: "最近 60 分钟",
    dispatch_base_archive: "最近 2 天",
  };
  const win = WIN[sync_type] ? ` · 同步${WIN[sync_type]}` : "";
  let m = e.match(/^\*\/(\d+) \* \* \* \*$/);
  if (m) return `每 ${m[1]} 分钟${win}`;
  m = e.match(/^\d+(?:-\d+)?\/(\d+) \* \* \* \*$/);
  if (m) return `每 ${m[1]} 分钟${win}`;
  if (/^\d+ \* \* \* \*$/.test(e)) return `每小时${win}`;
  m = e.match(/^(\d+) (\d+) \* \* \*$/);
  if (m) {
    const utcHr = +m[2];
    const min = +m[1];
    const bjHr = (utcHr + 8) % 24;
    return `每天 ${String(bjHr).padStart(2, "0")}:${String(min).padStart(2, "0")}（北京）${win}`;
  }
  return `${e}${win}`;
}

function humanCountdown(ms: number): string {
  if (ms <= 0) return "即将触发";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} 时 ${m} 分 ${sec} 秒后`;
  if (m > 0) return `${m} 分 ${sec} 秒后`;
  return `${sec} 秒后`;
}

// ===== 状态点 =====
function StatusDot({ status }: { status?: string | null }) {
  const cls =
    status === "success"
      ? "bg-emerald-500"
      : status === "running"
        ? "bg-sky-500 animate-pulse"
        : status === "failed" || status === "stalled"
          ? "bg-red-500"
          : "bg-slate-300";
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} />;
}
function statusLabel(s?: string | null): string {
  if (!s) return "尚未运行";
  if (s === "success") return "成功";
  if (s === "running") return "运行中";
  if (s === "failed") return "失败";
  if (s === "stalled") return "卡住";
  if (s === "partial_failed") return "部分失败";
  if (s === "cancelled") return "已取消";
  return s;
}

// ===== 主组件 =====
export default function AutoSyncOverview() {
  const [overview, setOverview] = useState<OverviewRow[] | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const recordsRef = useRef<HTMLDivElement>(null);

  // 同步记录
  type TriggerFilter = "all" | "auto" | "manual";
  type StatusFilter = "all" | "success" | "failed" | "running";
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [syncTypeFilter, setSyncTypeFilter] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 每秒刷新倒计时
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // 是否 admin
  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase
        .from("ops_user_roles")
        .select("role_code")
        .eq("user_id", u.user.id);
      const admin = ((data as any[]) ?? []).some((r) => r.role_code === "admin");
      setIsAdmin(admin);
    })();
  }, []);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_auto_sync_overview" as any);
    if (error) {
      setOverviewError(error.message);
      setOverview([]);
    } else {
      setOverviewError(null);
      setOverview((data as OverviewRow[]) ?? []);
    }
    setLoading(false);
  }, []);

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    const pageSize = 20;
    let q = supabase
      .from("jst_sync_jobs")
      .select(
        "id,sync_type,status,trigger_type,started_at,ended_at,created_at,message,error_detail,created_by",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });
    if (triggerFilter === "auto") q = q.eq("trigger_type", "cron");
    else if (triggerFilter === "manual") q = q.neq("trigger_type", "cron");
    if (statusFilter === "success") q = q.eq("status", "success");
    else if (statusFilter === "failed") q = q.in("status", ["failed", "stalled", "partial_failed"]);
    else if (statusFilter === "running") q = q.eq("status", "running");
    if (syncTypeFilter) q = q.eq("sync_type", syncTypeFilter);
    q = q.range(page * pageSize, page * pageSize + pageSize - 1);
    const { data, count, error } = await q;
    if (error) {
      toast.error(error.message);
    } else {
      setJobs((data as JobRow[]) ?? []);
      setJobsTotal(count ?? 0);
    }
    setJobsLoading(false);
  }, [triggerFilter, statusFilter, syncTypeFilter, page]);

  useEffect(() => {
    loadOverview();
    const t = setInterval(loadOverview, 30_000);
    return () => clearInterval(t);
  }, [loadOverview]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // 健康摘要
  const summary = useMemo(() => {
    const list = overview ?? [];
    const configured = list.length;
    const activeCount = list.filter((r) => r.active).length;
    const configuredTypes = new Set(list.map((r) => r.sync_type));
    const allTypes = GROUPS.flatMap((g) => g.cards.map((c) => c.sync_type));
    const unconfigured = allTypes.filter((t) => !configuredTypes.has(t)).length;
    const succ = list.reduce((a, r) => a + Number(r.success_count_24h || 0), 0);
    const fail = list.reduce((a, r) => a + Number(r.failed_count_24h || 0), 0);
    const failedJobs = list.filter(
      (r) => r.last_run_status === "failed" || r.last_run_status === "stalled",
    );
    return { configured, activeCount, unconfigured, succ, fail, failedJobs };
  }, [overview]);

  const toggleActive = async (row: OverviewRow, next: boolean) => {
    const { error } = await supabase.rpc("set_auto_sync_active" as any, {
      p_jobname: row.jobname,
      p_active: next,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${row.jobname} 已${next ? "启用" : "暂停"}`);
    loadOverview();
  };

  const jumpToFailed = (sync_type: string) => {
    setStatusFilter("failed");
    setTriggerFilter("auto");
    setSyncTypeFilter(sync_type);
    setPage(0);
    setTimeout(() => {
      recordsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  // 渲染卡片
  const overviewByType = useMemo(() => {
    const m: Record<string, OverviewRow> = {};
    (overview ?? []).forEach((r) => {
      m[r.sync_type] = r;
    });
    return m;
  }, [overview]);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(jobsTotal / pageSize));

  return (
    <div className="space-y-6">
      {/* 一、健康摘要 */}
      <Card className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">自动同步总览</h2>
            {overviewError ? (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">自动同步状态未知</span>
                {" · 无法读取定时任务信息"}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                自动同步运行中 · <span className="font-medium text-foreground">{summary.activeCount}</span> 个定时任务启用
                {" · "}
                <span className="font-medium text-foreground">{summary.unconfigured}</span> 个模块未配置
                {" · 最近 24 小时 "}
                成功{" "}
                <span className="text-emerald-600 font-medium">{summary.succ}</span>
                {" / 失败 "}
                <span className={summary.fail > 0 ? "text-red-600 font-medium" : "font-medium"}>{summary.fail}</span>
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={loadOverview} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>

        {overviewError && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-900">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div className="flex-1 space-y-1">
                <p className="font-medium">自动同步功能尚未在当前环境启用</p>
                <p className="text-amber-800/80">
                  下方手动同步功能不受影响，可继续使用。如需启用自动同步，请联系运维配置。
                </p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-amber-700 hover:text-amber-900 select-none">
                    技术详情
                  </summary>
                  <pre className="mt-1 whitespace-pre-wrap break-all text-[11px] text-amber-900/80 bg-amber-100/50 rounded px-2 py-1.5">
                    {overviewError}
                  </pre>
                </details>
              </div>
            </div>
          </div>
        )}

        {!overviewError && summary.failedJobs.length > 0 && (
          <div className="mt-3 space-y-2">
            {summary.failedJobs.map((r) => (
              <div
                key={r.jobname}
                className="flex items-center justify-between rounded-md border border-red-300 bg-red-50/70 px-3 py-2 text-xs text-red-800"
              >
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    「{SYNC_TYPE_CN[r.sync_type] ?? r.sync_type}」最近一次自动同步失败（
                    {fmtBJ(r.last_run_started_at)}），系统将在下个周期自动重试。
                  </span>
                </div>
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-red-900"
                  onClick={() => jumpToFailed(r.sync_type)}
                >
                  查看详情
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 二、卡片分组 */}
      <div className="space-y-5">
        {GROUPS.map((g) => (
          <div key={g.key} className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">{g.title}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {g.cards.map((c) => {
                const row = overviewByType[c.sync_type];
                if (!row) {
                  return (
                    <Card
                      key={c.sync_type}
                      className="p-4 border-dashed bg-muted/30 text-muted-foreground"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{c.cn}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {c.api}
                        </span>
                        <Badge variant="outline" className="ml-auto text-xs">
                          仅手动
                        </Badge>
                      </div>
                      <p className="text-xs mt-2">尚未配置自动同步，目前为手动触发。</p>
                    </Card>
                  );
                }
                const failed =
                  row.last_run_status === "failed" || row.last_run_status === "stalled";
                const nextFire = nextCronFireUtc(row.schedule, new Date(now));
                const countdown = nextFire
                  ? humanCountdown(nextFire.getTime() - now)
                  : "-";
                return (
                  <Card
                    key={c.sync_type}
                    className={`p-4 ${failed ? "border-red-300" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{c.cn}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {c.api}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {describeSchedule(row.schedule, row.sync_type)}
                        </p>
                      </div>
                      {isAdmin ? (
                        <Switch
                          checked={row.active}
                          onCheckedChange={(v) => toggleActive(row, v)}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {row.active ? "已启用" : "已暂停"}
                        </span>
                      )}
                    </div>
                    <div className="mt-3 space-y-1 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-16 shrink-0">上次运行</span>
                        <StatusDot status={row.last_run_status} />
                        <span>{statusLabel(row.last_run_status)}</span>
                        <span className="text-muted-foreground">
                          {row.last_run_started_at ? fmtBJ(row.last_run_started_at) : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-16 shrink-0">下次运行</span>
                        <span className="tabular-nums">{row.active ? countdown : "已暂停"}</span>
                      </div>
                    </div>
                    {failed && row.last_run_message && (
                      <p className="mt-2 text-xs text-red-600 break-words line-clamp-2">
                        失败原因：{row.last_run_message}
                      </p>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 三、同步记录表 */}
      <Card className="p-4" ref={recordsRef}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="font-semibold">同步记录</h2>
          <div className="flex items-center gap-2 text-xs">
            {/* 触发方式 */}
            <span className="text-muted-foreground">触发：</span>
            {(["all", "auto", "manual"] as TriggerFilter[]).map((k) => (
              <button
                key={k}
                onClick={() => {
                  setTriggerFilter(k);
                  setPage(0);
                }}
                className={`px-2.5 py-1 rounded-full border transition ${
                  triggerFilter === k
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted"
                }`}
              >
                {k === "all" ? "全部" : k === "auto" ? "自动" : "手动"}
              </button>
            ))}
            <span className="text-muted-foreground ml-2">状态：</span>
            {(["all", "success", "failed", "running"] as StatusFilter[]).map((k) => (
              <button
                key={k}
                onClick={() => {
                  setStatusFilter(k);
                  setPage(0);
                }}
                className={`px-2.5 py-1 rounded-full border transition ${
                  statusFilter === k
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted"
                }`}
              >
                {k === "all" ? "全部" : k === "success" ? "成功" : k === "failed" ? "失败" : "运行中"}
              </button>
            ))}
            {syncTypeFilter && (
              <button
                onClick={() => {
                  setSyncTypeFilter(null);
                  setPage(0);
                }}
                className="ml-2 px-2.5 py-1 rounded-full border bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100"
              >
                清除「{SYNC_TYPE_CN[syncTypeFilter] ?? syncTypeFilter}」筛选 ×
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground border-b">
              <tr>
                <th className="py-2 pr-3 w-6"></th>
                <th className="py-2 pr-3">同步对象</th>
                <th className="py-2 pr-3 hidden md:table-cell">分组</th>
                <th className="py-2 pr-3">触发方式</th>
                <th className="py-2 pr-3">状态</th>
                <th className="py-2 pr-3">开始时间</th>
                <th className="py-2 pr-3 hidden md:table-cell">结果</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const isAuto = j.trigger_type === "cron";
                const cn = SYNC_TYPE_CN[j.sync_type] ?? j.sync_type;
                const grp = SYNC_TYPE_GROUP[j.sync_type] ?? "-";
                const open = expanded.has(j.id);
                return (
                  <>
                    <tr
                      key={j.id}
                      className="border-b hover:bg-muted/30 cursor-pointer"
                      onClick={() => {
                        const n = new Set(expanded);
                        if (n.has(j.id)) n.delete(j.id);
                        else n.add(j.id);
                        setExpanded(n);
                      }}
                    >
                      <td className="py-2 pr-3">
                        {open ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </td>
                      <td className="py-2 pr-3 font-medium">{cn}</td>
                      <td className="py-2 pr-3 hidden md:table-cell text-muted-foreground">
                        {grp}
                      </td>
                      <td className="py-2 pr-3">
                        {isAuto ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-purple-100 text-purple-800">
                            ⏱ 自动
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-700">
                            👤 手动
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] bg-muted">
                          <StatusDot status={j.status} />
                          {statusLabel(j.status)}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-xs whitespace-nowrap">
                        {fmtBJ(j.started_at ?? j.created_at)}
                      </td>
                      <td className="py-2 pr-3 hidden md:table-cell text-xs text-muted-foreground max-w-[360px] truncate">
                        {j.message || j.error_detail || "-"}
                      </td>
                    </tr>
                    {open && (
                      <tr key={j.id + "-d"} className="border-b bg-muted/20">
                        <td></td>
                        <td colSpan={6} className="py-3 pr-3 space-y-1.5 text-xs">
                          <div>
                            <span className="text-muted-foreground">完整结果：</span>
                            <span className="whitespace-pre-wrap break-all">
                              {j.error_detail || j.message || "-"}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <div>
                              <span className="text-muted-foreground">开始时间：</span>
                              {fmtBJ(j.started_at)}
                            </div>
                            <div>
                              <span className="text-muted-foreground">结束时间：</span>
                              {fmtBJ(j.ended_at)}
                            </div>
                            <div>
                              <span className="text-muted-foreground">操作人：</span>
                              {isAuto ? "系统自动" : (j.created_by ?? "-")}
                            </div>
                          </div>
                          <div className="pt-1 text-[11px] text-muted-foreground border-t">
                            sync_type: {j.sync_type} · trigger_type: {j.trigger_type ?? "-"} · 任务 ID: {j.id}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
              {jobs.length === 0 && !jobsLoading && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-muted-foreground text-sm">
                    当前筛选条件下没有同步记录
                  </td>
                </tr>
              )}
              {jobsLoading && jobs.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-muted-foreground text-sm">
                    加载中…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
          <div>
            共 {jobsTotal} 条 · 第 {page + 1} / {totalPages} 页
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0 || jobsLoading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= totalPages || jobsLoading}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
