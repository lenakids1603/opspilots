import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  RefreshCw,
  PlayCircle,
  RotateCcw,
  ShieldAlert,
  Package,
  Boxes,
  ImageIcon,
  Search,
} from "lucide-react";

type SyncLog = {
  id: string;
  sync_type: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  cursor_from: string | null;
  cursor_to: string | null;
  fetched_orders_count: number | null;
  fetched_items_count: number | null;
  fetched_receipts_count: number | null;
  message: string | null;
  error_detail: string | null;
};

type SyncState = { key: string; value: any; updated_at: string };

type RangePreset = "24h" | "7d" | "30d" | "custom";

type Stats = {
  products: number;
  products_from_jst: number;
  skus: number;
  skus_from_jst: number;
  products_with_image: number;
  skus_with_image: number;
  products_storage: number;
  skus_storage: number;
  last_product_sync: string | null;
  last_sku_sync: string | null;
  last_image_sync: string | null;
  image_failed_recent: number;
};

const PO_TYPES = ["purchase_orders", "purchase_in"];
const PROD_TYPES = ["jst_products", "jst_skus", "jst_product_images"];

const statusVariant = (s: string) =>
  s === "success" ? "default" : s === "running" ? "secondary" : "destructive";

const toLocalInputValue = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString("zh-CN") : "-");

export default function JstSyncPage() {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [state, setState] = useState<SyncState[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [productBusy, setProductBusy] = useState(false);
  const [actingLogId, setActingLogId] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<"all" | "po" | "products">("all");

  const now = new Date();
  const [preset, setPreset] = useState<RangePreset>("24h");
  const [customStart, setCustomStart] = useState(
    toLocalInputValue(new Date(Date.now() - 24 * 60 * 60 * 1000)),
  );
  const [customEnd, setCustomEnd] = useState(toLocalInputValue(now));

  const [recentDays, setRecentDays] = useState(3);
  const [styleNo, setStyleNo] = useState("");
  const [skuCode, setSkuCode] = useState("");

  const loadStats = async () => {
    const [
      p, pj, s, sj, pi, si, ps, ss, lp, ls, lim, lif,
    ] = await Promise.all([
      supabase.from("ops_products").select("*", { count: "exact", head: true }),
      supabase.from("ops_products").select("*", { count: "exact", head: true }).not("jst_product_id", "is", null),
      supabase.from("ops_skus").select("*", { count: "exact", head: true }),
      supabase.from("ops_skus").select("*", { count: "exact", head: true }).not("jst_sku_id", "is", null),
      supabase.from("ops_products").select("*", { count: "exact", head: true }).or("main_image_url.not.is.null,external_image_url.not.is.null"),
      supabase.from("ops_skus").select("*", { count: "exact", head: true }).or("sku_image_url.not.is.null,external_image_url.not.is.null"),
      supabase.from("ops_products").select("*", { count: "exact", head: true }).not("image_storage_path", "is", null),
      supabase.from("ops_skus").select("*", { count: "exact", head: true }).not("image_storage_path", "is", null),
      supabase.from("ops_products").select("last_synced_at").order("last_synced_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
      supabase.from("ops_skus").select("last_synced_at").order("last_synced_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
      supabase.from("jst_sync_logs").select("ended_at").eq("sync_type", "jst_product_images").order("started_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("jst_sync_logs").select("*", { count: "exact", head: true }).eq("sync_type", "jst_product_images").in("status", ["failed", "partial_failed"]),
    ]);

    setStats({
      products: p.count ?? 0,
      products_from_jst: pj.count ?? 0,
      skus: s.count ?? 0,
      skus_from_jst: sj.count ?? 0,
      products_with_image: pi.count ?? 0,
      skus_with_image: si.count ?? 0,
      products_storage: ps.count ?? 0,
      skus_storage: ss.count ?? 0,
      last_product_sync: (lp.data as any)?.last_synced_at ?? null,
      last_sku_sync: (ls.data as any)?.last_synced_at ?? null,
      last_image_sync: (lim.data as any)?.ended_at ?? null,
      image_failed_recent: lif.count ?? 0,
    });
  };

  const load = async () => {
    setLoading(true);
    const [{ data: logsData }, { data: stateData }] = await Promise.all([
      supabase.from("jst_sync_logs").select("*").order("started_at", { ascending: false }).limit(50),
      supabase.from("jst_sync_state").select("*").order("updated_at", { ascending: false }),
    ]);
    setLogs((logsData as any) ?? []);
    setState((stateData as any) ?? []);
    await loadStats();
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  const computeRange = (): { startDate: Date; endDate: Date } => {
    const endDate = new Date();
    if (preset === "24h") return { startDate: new Date(Date.now() - 24 * 60 * 60 * 1000), endDate };
    if (preset === "7d") return { startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), endDate };
    if (preset === "30d") return { startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), endDate };
    return { startDate: new Date(customStart), endDate: new Date(customEnd) };
  };

  const runPoSync = async () => {
    const { startDate, endDate } = computeRange();
    if (!(startDate instanceof Date) || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      toast.error("时间范围无效");
      return;
    }
    if (startDate >= endDate) {
      toast.error("开始时间必须早于结束时间");
      return;
    }
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / 86400_000);
    if (days > 90) {
      toast.error("单次最多同步 90 天");
      return;
    }
    setSyncing(true);
    try {
      const fmtRange = (d: Date) => d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
      toast.info(`同步采购单 / 采购入库 ${fmtRange(startDate)} → ${fmtRange(endDate)} (约 ${days} 天)`);
      const { error } = await supabase.functions.invoke("jst-sync-purchase-orders", {
        body: {
          trigger: "manual",
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
        },
      });
      if (error) throw error;
      toast.success("采购单同步任务已触发,后台运行");
      setTimeout(load, 1500);
    } catch (e: any) {
      toast.error(e?.message || "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  const invokeProduct = async (body: Record<string, unknown>, label: string) => {
    setProductBusy(true);
    try {
      const { error } = await supabase.functions.invoke("jst-sync-products", { body });
      if (error) throw error;
      toast.success(`${label} 已提交,后台执行中`);
      setTimeout(load, 1500);
    } catch (e: any) {
      const msg = e?.message || "调用失败";
      if (/401|Unauthorized/i.test(msg)) toast.error("登录失效或没有管理员权限,请重新登录");
      else toast.error(msg);
    } finally {
      setProductBusy(false);
    }
  };

  const isStaleRunning = (l: SyncLog) =>
    l.status === "running" && Date.now() - new Date(l.started_at).getTime() > 10 * 60 * 1000;

  const invokeSyncAction = async (body: Record<string, unknown>, success: string) => {
    setActingLogId(String(body.log_id ?? body.action ?? "action"));
    try {
      const { error } = await supabase.functions.invoke("jst-sync-purchase-orders", { body });
      if (error) throw error;
      toast.success(success);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "操作失败");
    } finally {
      setActingLogId(null);
    }
  };

  const cleanupStale = () =>
    invokeSyncAction({ action: "cleanup_stale" }, "已清理超过 10 分钟仍在运行的任务");

  const markFailed = (l: SyncLog) =>
    invokeSyncAction({ action: "mark_failed", log_id: l.id }, "已将卡住任务标记为 failed");

  const retryWindow = (l: SyncLog) => {
    if (!l.cursor_from || !l.cursor_to) {
      toast.error("该日志缺少时间窗口,无法重试");
      return;
    }
    invokeSyncAction(
      { trigger: "manual", start_date: l.cursor_from, end_date: l.cursor_to },
      "已重新提交该时间窗口同步",
    );
  };

  const filteredLogs = logs.filter((l) =>
    logFilter === "all" ? true : logFilter === "po" ? PO_TYPES.includes(l.sync_type) : PROD_TYPES.includes(l.sync_type),
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">聚水潭同步</h1>
          <p className="text-sm text-muted-foreground mt-1">
            采购单 / 采购入库 / 商品资料 / SKU / 商品图片 全部在此页面手动触发,
            按 sync_type 区分日志。
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      <div className="rounded-md border border-sky-300 bg-sky-50/60 px-4 py-2.5 text-xs text-sky-800">
        新架构提示：本系统不再做「一键同步全部历史订单 / 全部商品 / 64 万 SKU」。新同步默认不保存完整 raw JSON，仅写入销售汇总、未发货风险、轻量订单索引和轻量商品档案。建议使用小范围按时间窗口或按 SKU / 款号同步。
      </div>

      {/* === 同步结果统计 === */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Package className="w-3 h-3" /> 商品数量
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{stats?.products ?? "-"}</div>
          <div className="text-xs text-muted-foreground mt-1">
            其中聚水潭来源: {stats?.products_from_jst ?? 0}
          </div>
          <div className="text-xs text-muted-foreground">
            最近商品同步: {fmt(stats?.last_product_sync)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Boxes className="w-3 h-3" /> SKU 数量
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{stats?.skus ?? "-"}</div>
          <div className="text-xs text-muted-foreground mt-1">
            其中聚水潭来源: {stats?.skus_from_jst ?? 0}
          </div>
          <div className="text-xs text-muted-foreground">
            最近 SKU 同步: {fmt(stats?.last_sku_sync)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ImageIcon className="w-3 h-3" /> 已有图片
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {(stats?.products_with_image ?? 0) + (stats?.skus_with_image ?? 0)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            商品图: {stats?.products_with_image ?? 0} / SKU 图: {stats?.skus_with_image ?? 0}
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ImageIcon className="w-3 h-3" /> 已转存到存储
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {(stats?.products_storage ?? 0) + (stats?.skus_storage ?? 0)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            商品: {stats?.products_storage ?? 0} / SKU: {stats?.skus_storage ?? 0}
          </div>
          <div className="text-xs text-destructive">
            图片同步失败任务: {stats?.image_failed_recent ?? 0}
          </div>
        </Card>
      </div>

      {/* === 1+2 采购单 / 采购入库 === */}
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">1 / 2. 同步采购单 + 采购入库</h2>
          <span className="text-xs text-muted-foreground">sync_type: purchase_orders, purchase_in</span>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">同步范围</Label>
            <Select value={preset} onValueChange={(v) => setPreset(v as RangePreset)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">最近 24 小时</SelectItem>
                <SelectItem value="7d">最近 7 天</SelectItem>
                <SelectItem value="30d">最近 30 天</SelectItem>
                <SelectItem value="custom">自定义</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {preset === "custom" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">开始时间</Label>
                <Input type="datetime-local" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="w-[220px]" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">结束时间</Label>
                <Input type="datetime-local" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="w-[220px]" />
              </div>
            </>
          )}
          <Button onClick={runPoSync} disabled={syncing}>
            <PlayCircle className="w-4 h-4 mr-2" />
            {syncing ? "提交中…" : "立即同步采购单 / 采购入库"}
          </Button>
          <Button variant="outline" onClick={cleanupStale} disabled={!!actingLogId}>
            <ShieldAlert className="w-4 h-4 mr-2" />
            清理卡住任务
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          按天分段拉取,running 超过 10 分钟视为卡住任务,可手动清理或按原时间窗口重试。
        </p>
      </Card>

      {/* === 3 商品 + 4 SKU === */}
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">3 / 4. 同步商品资料 + SKU 资料</h2>
          <span className="text-xs text-muted-foreground">sync_type: jst_products, jst_skus</span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">最近 N 天有更新（最多 7 天）</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={recentDays}
                onChange={(e) => setRecentDays(Number(e.target.value) || 30)}
                className="w-[100px]"
                min={1}
                max={7}
              />
              <Button
                onClick={() => invokeProduct({ action: "sync_recent", days: recentDays, max_pages: 10 }, `同步最近 ${recentDays} 天商品`)}
                disabled={productBusy}
              >
                <PlayCircle className="w-4 h-4 mr-2" /> 同步最近 {recentDays} 天
              </Button>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => invokeProduct({ action: "test_minimal_sku" }, "最小请求测试 /open/sku/query")}
            disabled={productBusy}
          >
            <ShieldAlert className="w-4 h-4 mr-2" /> 测试 /open/sku/query
          </Button>
          <Button
            variant="outline"
            onClick={() => invokeProduct({ action: "refresh_token" }, "刷新 access_token")}
            disabled={productBusy}
          >
            <RotateCcw className="w-4 h-4 mr-2" /> 刷新 access_token
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          商品同步固定调用正式环境 https://openapi.jushuitan.com/open/sku/query,日志会记录 api_path、脱敏 app_key、code、msg、data_count。
          如果最小请求仍 permission_denied,通常是当前 Secrets 中 app_key / access_token 与已授权应用不一致,或需要重新授权后刷新 token。
        </p>
      </Card>

      {/* === 5 商品图片 === */}
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">5. 同步商品图片</h2>
          <span className="text-xs text-muted-foreground">sync_type: jst_product_images</span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Button
            onClick={() => invokeProduct({ action: "sync_images", limit: 50 }, "同步商品图片 50 张")}
            disabled={productBusy}
          >
            <ImageIcon className="w-4 h-4 mr-2" /> 同步图片 50 张
          </Button>
          <Button
            variant="outline"
            onClick={() => invokeProduct({ action: "sync_images", limit: 200 }, "同步商品图片 200 张")}
            disabled={productBusy}
          >
            <ImageIcon className="w-4 h-4 mr-2" /> 同步图片 200 张
          </Button>
          <p className="text-xs text-muted-foreground">
            从聚水潭外链下载图片,转存到本系统 product-images 存储桶。需先成功同步商品资料。
          </p>
        </div>
      </Card>

      {/* === 6 按款号 / SKU 补同步 === */}
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">6. 按款号 / SKU 补同步商品资料</h2>
          <span className="text-xs text-muted-foreground">sync_type: jst_products</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">按款号同步</Label>
            <div className="flex items-center gap-2">
              <Input value={styleNo} onChange={(e) => setStyleNo(e.target.value)} placeholder="输入款号,例如 25A001" />
              <Button
                variant="outline"
                onClick={() => {
                  if (!styleNo.trim()) return toast.error("请输入款号");
                  invokeProduct({ action: "sync_by_style", style_no: styleNo.trim() }, `同步款号 ${styleNo}`);
                }}
                disabled={productBusy}
              >
                <Search className="w-4 h-4 mr-2" /> 同步该款号
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">按 SKU 编码同步</Label>
            <div className="flex items-center gap-2">
              <Input value={skuCode} onChange={(e) => setSkuCode(e.target.value)} placeholder="输入 SKU 编码" />
              <Button
                variant="outline"
                onClick={() => {
                  if (!skuCode.trim()) return toast.error("请输入 SKU");
                  invokeProduct({ action: "sync_by_sku", sku_code: skuCode.trim() }, `同步 SKU ${skuCode}`);
                }}
                disabled={productBusy}
              >
                <Search className="w-4 h-4 mr-2" /> 同步该 SKU
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="font-medium mb-3">同步游标</h2>
        {state.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无成功同步记录。</p>
        ) : (
          <div className="space-y-2">
            {state.map((s) => (
              <div key={s.key} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                <span className="font-mono">{s.key}</span>
                <span className="text-muted-foreground">{JSON.stringify(s.value)}</span>
                <span className="text-xs text-muted-foreground">{fmt(s.updated_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">最近 50 条同步日志</h2>
          <Select value={logFilter} onValueChange={(v) => setLogFilter(v as any)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部 sync_type</SelectItem>
              <SelectItem value="po">采购单 / 采购入库</SelectItem>
              <SelectItem value="products">商品 / SKU / 图片</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">sync_type</th>
                <th className="py-2 pr-4">状态</th>
                <th className="py-2 pr-4">开始</th>
                <th className="py-2 pr-4">结束</th>
                <th className="py-2 pr-4">窗口</th>
                <th className="py-2 pr-4">采购单</th>
                <th className="py-2 pr-4">明细 / 写入</th>
                <th className="py-2 pr-4">入库</th>
                <th className="py-2 pr-4">信息</th>
                <th className="py-2 pr-4">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="py-2 pr-4 font-mono text-xs">
                    <Badge variant="outline">{l.sync_type}</Badge>
                  </td>
                  <td className="py-2 pr-4">
                    <Badge variant={statusVariant(l.status) as any}>{l.status}</Badge>
                  </td>
                  <td className="py-2 pr-4 text-xs">{fmt(l.started_at)}</td>
                  <td className="py-2 pr-4 text-xs">{fmt(l.ended_at)}</td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground">
                    {l.cursor_from || l.cursor_to ? `${fmt(l.cursor_from)} → ${fmt(l.cursor_to)}` : "-"}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{l.fetched_orders_count ?? 0}</td>
                  <td className="py-2 pr-4 tabular-nums">{l.fetched_items_count ?? 0}</td>
                  <td className="py-2 pr-4 tabular-nums">{l.fetched_receipts_count ?? 0}</td>
                  <td
                    className="py-2 pr-4 text-xs text-muted-foreground max-w-[560px] whitespace-pre-wrap"
                    title={l.error_detail || l.message || ""}
                  >
                    {l.error_detail || l.message || "-"}
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      {isStaleRunning(l) && PO_TYPES.includes(l.sync_type) && (
                        <Button size="sm" variant="outline" onClick={() => markFailed(l)} disabled={!!actingLogId}>
                          标记失败
                        </Button>
                      )}
                      {(l.status === "failed" || l.status === "partial_failed") && PO_TYPES.includes(l.sync_type) && (
                        <Button size="sm" variant="outline" onClick={() => retryWindow(l)} disabled={!!actingLogId}>
                          <RotateCcw className="w-3 h-3 mr-1" />
                          重试
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-muted-foreground">
                    暂无同步日志
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
