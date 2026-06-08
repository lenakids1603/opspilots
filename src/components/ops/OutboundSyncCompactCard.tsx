import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, Activity } from "lucide-react";

const FUNCTION_NAME = "jst-sync-outbound-orders";
const SYNC_TYPE = "outbound_orders";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  success: { label: "正常", cls: "bg-emerald-100 text-emerald-700" },
  partial_failed: { label: "部分失败", cls: "bg-amber-100 text-amber-700" },
  partial: { label: "部分完成", cls: "bg-amber-100 text-amber-700" },
  timeout_partial: { label: "超时未完成", cls: "bg-amber-100 text-amber-700" },
  running: { label: "同步中", cls: "bg-blue-100 text-blue-700" },
  failed: { label: "异常", cls: "bg-rose-100 text-rose-700" },
  none: { label: "暂未同步", cls: "bg-slate-100 text-slate-700" },
};

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "-";

export function OutboundSyncCompactCard() {
  const qc = useQueryClient();
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const countQ = useQuery({
    queryKey: ["warehouse_shipping_package_count_compact"],
    queryFn: async () => {
      const { count, error } = await (supabase as any)
        .from("warehouse_shipping_packages")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 8000,
  });

  const lastLogQ = useQuery({
    queryKey: ["outbound_last_log_compact"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jst_sync_logs")
        .select("id,status,started_at,ended_at,message,error_detail,fetched_orders_count,fetched_items_count")
        .eq("sync_type", SYNC_TYPE)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: 5000,
  });

  const syncMut = useMutation({
    mutationFn: async (payload: { hours?: number; days?: number; start_time?: string; end_time?: string; requested_range?: string }) => {
      const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
        body: { action: "start_outbound_job", ...payload },
      });
      if (error) throw new Error(error.message);
      if (data?.ok === false) throw new Error(data?.error ?? "同步失败");
      return data;
    },
    onSuccess: () => {
      toast({ title: "已创建出库轻量同步任务", description: "后台按小窗口运行，进度会在卡片刷新" });
      qc.invalidateQueries({ queryKey: ["warehouse_shipping_package_count_compact"] });
      qc.invalidateQueries({ queryKey: ["outbound_last_log_compact"] });
      qc.invalidateQueries({ queryKey: ["jst_sync_logs", "purchase"] });
    },
    onError: (error: unknown) => {
      toast({ title: "出库轻量同步失败", description: (error as Error).message, variant: "destructive" });
    },
  });

  const log = lastLogQ.data;
  const statusKey = !log ? "none" : (log.status as string);
  const meta = STATUS_LABEL[statusKey] ?? STATUS_LABEL.none;

  return (
    <div className="p-5 space-y-4">
      <div className="rounded-md border border-sky-300 bg-sky-50/60 px-4 py-2.5 text-xs text-sky-800">
        聚水潭出库 API 仅用于仓库实际发货包裹统计；新同步写入 <code>warehouse_shipping_packages</code> 和明细表，不再写旧重型出库表。
      </div>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <div className="font-medium text-sm">出库轻量同步</div>
            <Badge variant="secondary" className={meta.cls}>{meta.label}</Badge>
            <div className="flex-1" />
            <span className="text-xs text-muted-foreground">
              已同步 <span className="font-semibold tabular-nums text-foreground">{(countQ.data ?? 0).toLocaleString("zh-CN")}</span> 个包裹
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <div>最近同步：<span className="text-foreground">{fmt(log?.ended_at ?? log?.started_at)}</span></div>
            <div>本次结果：<span className="text-foreground">
              {log ? `${log.fetched_orders_count ?? 0} 包裹 / ${log.fetched_items_count ?? 0} 明细` : "-"}
            </span></div>
          </div>

          {log?.message && (
            <div className="text-[11px] text-muted-foreground bg-muted/30 rounded px-2 py-1.5 break-all">
              {log.message}
            </div>
          )}
          {log?.error_detail && (
            <div className="text-[11px] text-rose-600 break-all">错误：{log.error_detail}</div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={syncMut.isPending}
              onClick={() => syncMut.mutate({ hours: 2, requested_range: "2h_test" })}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1 ${syncMut.isPending ? "animate-spin" : ""}`} />
              最近 2 小时测试同步
            </Button>
            <Button size="sm" disabled={syncMut.isPending}
              onClick={() => syncMut.mutate({ days: 1, requested_range: "1d" })}>最近 1 天同步</Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border">
            <span className="text-xs text-muted-foreground">自定义范围：</span>
            <Input type="datetime-local" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
              className="h-8 w-[180px] text-xs" />
            <span className="text-xs text-muted-foreground">→</span>
            <Input type="datetime-local" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
              className="h-8 w-[180px] text-xs" />
            <Button size="sm" variant="outline" disabled={syncMut.isPending || !customStart || !customEnd}
              onClick={() => syncMut.mutate({
                start_time: new Date(customStart).toISOString(),
                end_time: new Date(customEnd).toISOString(),
                requested_range: "custom",
              })}>同步该范围</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default OutboundSyncCompactCard;
