import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, PlayCircle, XCircle, Activity } from "lucide-react";

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
};

interface Props {
  /** Optional callback fired when a job reaches a terminal state (success/failed/cancelled) */
  onJobFinished?: () => void;
  /** Title shown in the card header */
  title?: string;
  /** Whether to show built-in start buttons (1/7/30 days). Default true. */
  showStartButtons?: boolean;
}

export function InboundSyncJobPanel({ onJobFinished, title = "入库单同步任务", showStartButtons = true }: Props) {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);

  // Restore the latest unfinished job on mount
  const lastJobQ = useQuery({
    queryKey: ["inbound_last_job"],
    enabled: !jobId,
    queryFn: async () => {
      const { data } = await supabase
        .from("jst_sync_jobs")
        .select("*")
        .eq("sync_type", "purchase_inbound_orders")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });
  useEffect(() => {
    const j: any = lastJobQ.data;
    if (!jobId && j && ["pending", "running", "partial", "stalled"].includes(j.status)) {
      setJobId(j.id);
    }
  }, [lastJobQ.data, jobId]);

  // Poll active job
  const jobQ = useQuery({
    queryKey: ["inbound_job", jobId],
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
      const { data, error } = await supabase.functions.invoke("jst-sync-purchase-orders", {
        body: {
          action: "start_inbound_job",
          days,
          requested_range: days <= 1 ? "1d" : days <= 7 ? "7d" : "30d",
        },
      });
      if (error) throw new Error(error.message);
      if (data?.ok === false) throw new Error(data?.error ?? "启动失败");
      return data as { job_id: string; total_windows: number };
    },
    onSuccess: (d) => {
      setJobId(d.job_id);
      toast({
        title: "已创建入库单同步任务",
        description: `任务 ${d.job_id.slice(0, 8)}… 已拆分为 ${d.total_windows} 个窗口，将自动分批执行。`,
      });
    },
    onError: (e: any) => toast({ title: "启动同步失败", description: e.message, variant: "destructive" }),
  });

  const tickMut = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke("jst-sync-purchase-orders", {
        body: { action: "tick_inbound_job", job_id: id },
      });
      if (error) throw new Error(error.message);
      if (data?.ok === false) throw new Error(data?.error ?? "继续失败");
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbound_job", jobId] }),
    onError: (e: any) => toast({ title: "继续同步失败", description: e.message, variant: "destructive" }),
  });

  const cancelMut = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke("jst-sync-purchase-orders", {
        body: { action: "cancel_inbound_job", job_id: id },
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbound_job", jobId] }),
  });

  // auto-tick partial / notify on finish
  const status: string | undefined = (jobQ.data as any)?.status;
  const nextPage: number | undefined = (jobQ.data as any)?.next_page_index;
  useEffect(() => {
    if (!status) return;
    if (status === "partial" && !tickMut.isPending) {
      tickMut.mutate(jobId!);
    }
    if (status === "success" || status === "failed" || status === "cancelled") {
      onJobFinished?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, nextPage]);

  const j: any = jobQ.data;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <div className="font-medium text-sm">{title}</div>
          <div className="flex-1" />
          {showStartButtons && (
            <>
              <Button size="sm" variant="outline" disabled={startMut.isPending}
                onClick={() => startMut.mutate(1)}>
                <RefreshCw className={"w-4 h-4 mr-1 " + (startMut.isPending ? "animate-spin" : "")} />
                同步最近 1 天
              </Button>
              <Button size="sm" variant="outline" disabled={startMut.isPending}
                onClick={() => startMut.mutate(7)}>最近 7 天</Button>
              <Button size="sm" variant="outline" disabled={startMut.isPending}
                onClick={() => startMut.mutate(30)}>最近 30 天</Button>
            </>
          )}
        </div>

        {!j && (
          <div className="text-xs text-muted-foreground">
            暂无正在进行的入库同步任务。点击右上角按钮即可创建新任务，任务会以 3 天窗口、每次最多 3 页分批执行，避免 Edge Function 超时。
          </div>
        )}

        {j && (
          <div className="rounded border p-3 space-y-2 text-xs bg-muted/30">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={STATUS_COLOR[j.status] ?? "bg-slate-100 text-slate-700"}>{j.status}</Badge>
              <span className="font-mono text-muted-foreground">job {String(j.id).slice(0, 8)}…</span>
              <Badge variant="outline">{j.requested_range || "custom"}</Badge>
              <span className="text-muted-foreground">
                窗口 {(j.current_window_index ?? 0) + 1}/{j.total_windows || 1} · 当前页 {j.current_page_index || j.next_page_index || 0} · 下一页 {j.next_page_index ?? "-"} · page_size {j.page_size}
              </span>
              <div className="flex-1" />
              {(j.status === "partial" || j.status === "stalled" || (j.status === "failed" && j.has_next)) && (
                <Button size="sm" variant="outline" onClick={() => tickMut.mutate(j.id)} disabled={tickMut.isPending}>
                  <PlayCircle className="w-4 h-4 mr-1" />继续同步
                </Button>
              )}
              {["pending", "running", "partial", "stalled"].includes(j.status) && (
                <Button size="sm" variant="ghost" onClick={() => cancelMut.mutate(j.id)}>
                  <XCircle className="w-4 h-4 mr-1" />取消任务
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setJobId(null)}>关闭</Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-muted-foreground">
              <div>API 累计：<span className="text-foreground font-medium">{fmtInt(j.total_api_count)}</span></div>
              <div>主表 upsert：<span className="text-foreground font-medium">{fmtInt(j.total_order_upserted)}</span></div>
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default InboundSyncJobPanel;
