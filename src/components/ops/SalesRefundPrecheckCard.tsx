import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Mapping = {
  id: string;
  matched_shop_id: string | null;
  matched_business_entity_id: string | null;
  matched_platform_id: string | null;
  mapping_status: string;
};

type Shop = {
  id: string;
  status: string | null;
  is_ignored: boolean | null;
  is_order_sync_enabled?: boolean | null;
  entity_id: string | null;
  platform_id: string | null;
};

/**
 * 仅校验"启用 且 参与订单同步"的店铺。
 * 已停用 / 已关闭订单同步 / 已忽略 的店铺不阻塞同步。
 */
function useMappingsAndShops() {
  return useQuery({
    queryKey: ["jst_shop_mappings", "precheck", "v3"],
    queryFn: async () => {
      const [{ data: m, error: e1 }, { data: s, error: e2 }] = await Promise.all([
        supabase.from("jst_shop_mappings")
          .select("id, matched_shop_id, matched_business_entity_id, matched_platform_id, mapping_status"),
        (supabase as any).from("shops")
          .select("id, status, is_ignored, is_order_sync_enabled, entity_id, platform_id").is("deleted_at", null),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      return { mappings: (m ?? []) as Mapping[], shops: (s ?? []) as Shop[] };
    },
  });
}

export function useSalesRefundPrecheck() {
  const q = useMappingsAndShops();
  const stats = useMemo(() => {
    const mappings = q.data?.mappings ?? [];
    const shopMap = new Map((q.data?.shops ?? []).map((s) => [s.id, s]));
    const total = mappings.length;
    const ignored = mappings.filter((r) => r.mapping_status === "ignored").length;
    const mappedRows = mappings.filter((r) => r.mapping_status === "mapped");
    const mapped = mappedRows.length;

    // 仅启用 + 参与订单同步 的店铺才参与正式经营统计与校验
    const isActiveAndSyncing = (s: Shop | undefined | null) =>
      !!s && s.is_ignored === false && (s.status ?? "active") === "active" && (s.is_order_sync_enabled ?? true) === true;

    const participating = mappedRows.filter((r) => isActiveAndSyncing(r.matched_shop_id ? shopMap.get(r.matched_shop_id) : null));

    // 待处理仅算"未停用 / 未关同步"的（无法确定关联 shop 时计入，避免漏判）
    const pendingRows = mappings.filter((r) => r.mapping_status !== "mapped" && r.mapping_status !== "ignored");
    const pending = pendingRows.filter((r) => {
      const s = r.matched_shop_id ? shopMap.get(r.matched_shop_id) : null;
      return !s ? true : isActiveAndSyncing(s);
    }).length;

    const noEntity = participating.filter((r) => !r.matched_business_entity_id).length;
    const noPlatform = participating.filter((r) => !r.matched_platform_id).length;
    const ready = participating.filter((r) => r.matched_business_entity_id && r.matched_platform_id).length;

    const shopCount = new Map<string, number>();
    mappedRows.forEach((r) => {
      if (r.matched_shop_id) shopCount.set(r.matched_shop_id, (shopCount.get(r.matched_shop_id) ?? 0) + 1);
    });
    const duplicates = Array.from(shopCount.values()).filter((n) => n > 1).length;

    const processedRate = total > 0 ? Math.round(((mapped + ignored) / total) * 100) : 0;
    const allowSummary = pending === 0 && noEntity === 0 && noPlatform === 0 && duplicates === 0;
    // 兼容旧字段
    const unmapped = pending;
    return {
      total, mapped, ignored, pending, unmapped,
      participating: participating.length, ready,
      noEntity, noPlatform, duplicates, processedRate, allowSummary,
    };
  }, [q.data]);
  return { ...q, stats };
}

export function SalesRefundPrecheckCard() {
  const { stats, isLoading, refetch } = useSalesRefundPrecheck();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const trigger = useMutation({
    mutationFn: async (days: number) => {
      const { data, error } = await supabase.functions.invoke("jst-sync-dispatch", {
        body: { module_key: "sales_refund", trigger_type: "manual_backfill", days },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (d) => {
      toast({
        title: d?.summary_updated ? "销售退款同步完成" : "已保存原始数据",
        description: d?.message ?? "完成",
      });
      qc.invalidateQueries({ queryKey: ["jst_sync_runs"] });
      qc.invalidateQueries({ queryKey: ["jst_sync_metrics"] });
      qc.invalidateQueries({ queryKey: ["jst_sales_refund_daily_summary"] });
    },
    onError: (e: any) => toast({ title: "同步失败", description: e.message, variant: "destructive" }),
  });

  const blocked = !stats.allowSummary;

  return (
    <Card className={blocked ? "border-amber-300 bg-amber-50/60" : "border-emerald-200 bg-emerald-50/40"}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {blocked
              ? <AlertTriangle className="w-5 h-5 text-amber-600" />
              : <ShieldCheck className="w-5 h-5 text-emerald-600" />}
            <h3 className="text-sm font-semibold">销售同步前置检查</h3>
            <Badge variant="secondary" className={blocked ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}>
              店铺处理：{stats.pending === 0 ? "全部已处理" : `${stats.pending} 个待处理`}
            </Badge>
            <Badge variant="secondary" className={blocked ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}>
              正式销售汇总：{blocked ? "暂不可用" : "可开启"}
            </Badge>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1 ${isLoading ? "animate-spin" : ""}`} />刷新
            </Button>
            <Button size="sm" onClick={() => trigger.mutate(7)} disabled={trigger.isPending}>
              {trigger.isPending && <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />}
              同步最近 7 天
            </Button>
            <Button size="sm" variant="secondary" onClick={() => trigger.mutate(30)} disabled={trigger.isPending}>
              同步最近 30 天
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 text-sm">
          <Metric label="聚水潭店铺总数" value={stats.total} />
          <Metric label="已完整可统计" value={stats.ready} tone="emerald" />
          <Metric label="已忽略店铺" value={stats.ignored} />
          <Metric label="待处理店铺" value={stats.pending} tone={stats.pending ? "rose" : undefined} />
          <Metric label="缺主体（已映射启用）" value={stats.noEntity} tone={stats.noEntity ? "rose" : undefined}
            onClick={() => navigate("/finance/master-data?tab=shops&filter=missing_entity")} />
          <Metric label="缺平台（已映射启用）" value={stats.noPlatform} tone={stats.noPlatform ? "rose" : undefined}
            onClick={() => navigate("/finance/master-data?tab=shops&filter=missing_platform")} />
          <Metric label="映射处理率" value={`${stats.processedRate}%`} tone={stats.processedRate === 100 ? "emerald" : undefined} />
        </div>

        {blocked ? (
          <div className="text-xs text-amber-800 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <div className="flex-1">
              {stats.pending > 0
                ? `仍有 ${stats.pending} 个店铺未处理。已忽略的历史店铺不会阻塞同步。`
                : `店铺已全部处理，但仍有 ${stats.noEntity} 个已映射店铺缺经营主体、${stats.noPlatform} 个缺平台，因此正式销售汇总暂不可用。请在「财务基础资料 → 店铺」中补齐，或将已废弃店铺改为忽略。`}
              <Button size="sm" variant="link" className="h-auto p-0 ml-1 text-amber-900"
                onClick={() => navigate("/finance/master-data?tab=shops&filter=missing_entity")}>
                去处理 <ExternalLink className="w-3 h-3 ml-0.5" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-xs text-emerald-800 flex items-start gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            店铺映射处理完成。已忽略店铺不参与正式经营统计。sales_refund 同步将刷新正式 GMV / GSV / 退款指标。
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, tone, onClick }: { label: string; value: number | string; tone?: "emerald" | "rose"; onClick?: () => void }) {
  const cls = tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : "";
  return (
    <div className={onClick ? "cursor-pointer hover:opacity-80" : ""} onClick={onClick}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
