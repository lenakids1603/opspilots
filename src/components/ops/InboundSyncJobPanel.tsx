import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, PlayCircle, XCircle, Activity } from "lucide-react";

const STALE_RUNNING_MS = 2 * 60_000;

const fmtInt = (n: any) => (n == null ? "-" : Number(n).toLocaleString("zh-CN"));
const fmtDT = (s: any) => {
  if (!s) return "-";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString("zh-CN", { hour12: false });
};

const STATUS_COLOR: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-700",
  partial: "bg-blue-100 text-blue-700",
  running: "bg-blue-100 text-blue-700",
  pending: "bg-slate-100 text-slate-700",
  stalled: "bg-amber-100 text-amber-700",
  failed: "bg-rose-100 text-rose-700",
  cancelled: "bg-slate-100 text-slate-700",
  waiting_next_tick: "bg-blue-100 text-blue-700",
};

interface Props {
  onJobFinished?: (job: any) => void;
  title?: string;
  showStartButtons?: boolean;
  /** sync_type used for last-job lookup & query keys. */
  syncType?: string;
  /** Edge function name to invoke. */
  functionName?: string;
  /** Edge function action names */
  startAction?: string;
  tickAction?: string;
  cancelAction?: string;
  /** UI labels */
  unitLabel?: string;
  emptyText?: string;
  toastTitle?: string;
}

export function InboundSyncJobPanel({
  onJobFinished,
  title = "入库单同步任务",
  showStartButtons = true,
  syncType = "purchase_inbound_orders",
  functionName = "jst-sync-purchase-orders",
  startAction = "start_inbound_job",
  tickAction = "tick_inbound_job",
  cancelAction = "cancel_inbound_job",
  unitLabel = "入库单",
  emptyText,
  toastTitle,
}: Props) {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [tickError, setTickError] = useState<string | null>(null);
  const isTickingRef = useRef(false);

  const lastJobKey = ["sync_last_job", syncType];

  // Restore the latest unfinished job on mount
  const lastJobQ = useQuery({
    queryKey: lastJobKey,
    enabled: !jobId,
    queryFn: async () => {
      const { data } = await supabase
        .from("jst_sync_jobs")
        .select("*")
        .eq("sync_type", syncType)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });
  useEffect(() => {
    const j: any = lastJobQ.data;
    if (!jobId && j && ["pending", "running", "partial", "waiting_next_tick", "stalled", "failed"].includes(j.status)) {
      setJobId(j.id);
    }
  }, [lastJobQ.data, jobId]);

  // Poll active job
  const jobQ = useQuery({
    queryKey: ["sync_job", syncType, jobId],
    enabled: !!jobId,
    refetchInterval: (q) => {
      const d: any = q.state.data;
      if (!d) return 3000;
      if (["success", "failed", "cancelled"].includes(d.status)) return false;
      return 3000;
    },
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jst_sync_jobs")
        .select("*")
        .eq("id", jobId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const startMut = useMutation({
    mutationFn: async (days: number) => {
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: {
          action: startAction,
          days,
          requested_range: days <= 1 ? "1d" : days <= 7 ? "7d" : "30d",
        },
      });
      if (error) throw new Error(error.message);
      if (data?.ok === false) throw new Error(data?.error ?? "启动失败");
      return data as { job_id: string; total_windows: number; reused?: boolean };
    },
    onSuccess: (d) => {
      setJobId(d.job_id);
      qc.invalidateQueries({ queryKey: lastJobKey });
      toast({
        title: toastTitle ?? `已创建${unitLabel}同步任务`,
        description: d.reused
          ? `已有进行中的任务 ${d.job_id.slice(0, 8)}…，已切换到该任务并继续。`
          : `任务 ${d.job_id.slice(0, 8)}… 已拆分为 ${d.total_windows} 个窗口，将自动分批执行。`,
      });
    },
    onError: (e: any) => toast({ title: "启动同步失败", description: e.message, variant: "destructive" }),
  });

  const tickMut = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: { action: tickAction, job_id: id },
      });
      if (error) throw new Error(error.message);
      if (data?.ok === false) throw new Error(data?.error ?? "继续失败");
      return data;
    },
    onSuccess: () => {
      setTickError(null);
      qc.invalidateQueries({ queryKey: ["sync_job", syncType, jobId] });
    },
    onError: (e: any) => {
      setTickError(e.message);
      toast({ title: "继续同步失败", description: e.message, variant: "destructive" });
    },
    onSettled: () => {
      isTickingRef.current = false;
    },
  });

  const requestTick = useCallback((id: string) => {
    if (isTickingRef.current || tickMut.isPending) return;
    isTickingRef.current = true;
    tickMut.mutate(id);
  }, [tickMut]);

  const cancelMut = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: { action: cancelAction, job_id: id },
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sync_job", syncType, jobId] }),
  });

  const j: any = jobQ.data;
  const status: string | undefined = j?.status;
  const nextPage: number | undefined = j?.next_page_index;
  const heartbeatMs = j?.heartbeat_at ? new Date(j.heartbeat_at).getTime() : 0;
  const isRunningStale = status === "running" && (!heartbeatMs || Date.now() - heartbeatMs > STALE_RUNNING_MS);
  const hasMoreWork = !!j && (j.has_next === true || (j.current_window_index ?? 0) < Math.max((j.total_windows ?? 1) - 1, 0));
  const isResumable = !!j && hasMoreWork && (
    status === "pending" ||
    status === "partial" ||
    status === "waiting_next_tick" ||
    status === "stalled" ||
    (status === "failed" && ((j.next_page_index ?? 0) > 0 || j.has_next === true)) ||
    isRunningStale
  );
  const totalWindows = Math.max(Number(j?.total_windows ?? 1), 1);
  const currentWindowNumber = Math.min(Number(j?.current_window_index ?? 0) + 1, totalWindows);
  const progressValue = status === "success" ? 100 : Math.max(1, Math.min(99, Math.round((currentWindowNumber / totalWindows) * 100)));

  // auto-tick resumable states / notify on finish
  useEffect(() => {
    if (!status || !jobId) return;
    if (isResumable) {
      requestTick(jobId);
    }
    if (status === "success" || status === "failed" || status === "cancelled") {
      onJobFinished?.(j);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, nextPage, isResumable, jobId]);

  const emptyMsg = emptyText ?? `暂无正在进行的${unitLabel}同步任务。点击右上角按钮即可创建新任务，任务会以 3 天窗口、每次最多 3 页分批执行，避免 Edge Function 超时。`;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <div className="font-medium text-sm">{title}</div>
          <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">已接入</Badge>
          <Badge variant="secondary" className="bg-sky-100 text-sky-700">支持断点续跑</Badge>
          <div className="flex-1" />
          {showStartButtons && (
            <div className="flex flex-wrap gap-2">
              <Button size="default" variant="default" className="h-9" disabled={startMut.isPending}
                onClick={() => startMut.mutate(1)}>
                <RefreshCw className={"w-4 h-4 mr-1 " + (startMut.isPending ? "animate-spin" : "")} />
                同步最近 1 天
              </Button>
              <Button size="default" variant="outline" className="h-9 border-primary/40 text-primary hover:bg-primary/5"
                disabled={startMut.isPending} onClick={() => startMut.mutate(7)}>同步最近 7 天</Button>
              <Button size="default" variant="outline" className="h-9 border-primary/40 text-primary hover:bg-primary/5"
                disabled={startMut.isPending} onClick={() => startMut.mutate(30)}>同步最近 30 天</Button>
            </div>
          )}
        </div>

        {!j && (
          <div className="text-xs text-muted-foreground">{emptyMsg}</div>
        )}

        {j && (
          <div className="rounded border p-3 space-y-2 text-xs bg-muted/30">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={STATUS_COLOR[j.status] ?? "bg-slate-100 text-slate-700"}>{j.status}</Badge>
              {isRunningStale && <Badge variant="destructive">无心跳，可继续</Badge>}
              <span className="font-mono text-muted-foreground">job {String(j.id).slice(0, 8)}…</span>
              <Badge variant="outline">{j.requested_range || "custom"}</Badge>
              <span className="text-muted-foreground">
                窗口 {currentWindowNumber}/{totalWindows} · 当前页 {j.current_page_index || j.next_page_index || 0} · 下一页 {j.next_page_index ?? "-"} · page_size {j.page_size}
              </span>
              <div className="flex-1" />
              {isResumable && (
                <Button size="sm" variant="default" onClick={() => requestTick(j.id)} disabled={tickMut.isPending || isTickingRef.current}>
                  <PlayCircle className="w-4 h-4 mr-1" />{tickMut.isPending || isTickingRef.current ? "续跑中..." : "继续同步"}
                </Button>
              )}
              {["pending", "running", "partial", "waiting_next_tick", "stalled"].includes(j.status) && (
                <Button size="sm" variant="ghost" onClick={() => cancelMut.mutate(j.id)}>
                  <XCircle className="w-4 h-4 mr-1" />取消任务
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setJobId(null)}>关闭</Button>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>窗口进度 {currentWindowNumber}/{totalWindows}</span>
                <span>{progressValue}%</span>
              </div>
              <Progress value={progressValue} className="h-2" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-muted-foreground">
              <div>API 累计：<span className="text-foreground font-medium">{fmtInt(j.total_api_count)}</span></div>
              <div>{unitLabel} upsert：<span className="text-foreground font-medium">{fmtInt(j.total_order_upserted)}</span></div>
              <div>明细 upsert：<span className="text-foreground font-medium">{fmtInt(j.total_item_upserted)}</span></div>
              <div>失败：<span className={j.total_failed > 0 ? "text-rose-600 font-medium" : "text-foreground font-medium"}>{fmtInt(j.total_failed)}</span></div>
              <div>has_next：<span className="text-foreground">{String(j.has_next)}</span></div>
              <div>心跳：<span className="text-foreground">{fmtDT(j.heartbeat_at)}</span></div>
              <div>开始：<span className="text-foreground">{fmtDT(j.started_at)}</span></div>
              <div>结束：<span className="text-foreground">{fmtDT(j.ended_at)}</span></div>
            </div>

            <div className="text-muted-foreground">
              当前窗口：{fmtDT(j.current_window_from)} → {fmtDT(j.current_window_to)}
              <span className="ml-2">（总区间 {fmtDT(j.requested_from)} → {fmtDT(j.requested_to)}）</span>
            </div>

            {j.message && (
              <div className="whitespace-pre-wrap break-all"><span className="text-muted-foreground">message：</span>{j.message}</div>
            )}
            {j.error_detail && (
              <div className="text-rose-600 whitespace-pre-wrap break-all">error_detail：{j.error_detail}</div>
            )}
            {tickError && (
              <div className="text-rose-600 whitespace-pre-wrap break-all">tick_error：{tickError}</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default InboundSyncJobPanel;
