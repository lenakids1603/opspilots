import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { RefreshCw, PlayCircle, ImageIcon, Search } from "lucide-react";

type SyncLog = {
  id: string;
  sync_type: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  fetched_items_count: number | null;
  message: string | null;
  error_detail: string | null;
};

const statusVariant = (s: string) =>
  s === "success" ? "default"
    : s === "running" ? "secondary"
    : s === "partial_failed" ? "secondary"
    : "destructive";

export default function JstProductSyncPage() {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [styleNo, setStyleNo] = useState("");
  const [skuCode, setSkuCode] = useState("");
  const [recentDays, setRecentDays] = useState(3);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("jst_sync_logs")
      .select("*")
      .in("sync_type", ["jst_products", "jst_skus", "jst_product_images"])
      .order("started_at", { ascending: false })
      .limit(50);
    setLogs((data as any) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 8_000);
    return () => clearInterval(t);
  }, []);

  const invoke = async (body: Record<string, unknown>, label: string) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("jst-sync-products", { body });
      if (error) throw error;
      toast.success(`${label} 已提交,正在后台执行`);
      console.log("jst-sync-products result", data);
      setTimeout(load, 1500);
    } catch (e: any) {
      const msg = e?.message || "调用失败";
      if (/401|Unauthorized/i.test(msg)) {
        toast.error("登录失效或没有管理员权限,请重新登录");
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString("zh-CN") : "-");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">聚水潭商品资料同步</h1>
          <p className="text-sm text-muted-foreground mt-1">
            从聚水潭同步商品/SKU 资料到 ERP 商品档案,并把商品图片转存到本系统。采购单页面会自动用这里的图片。
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      <div className="rounded-md border border-sky-300 bg-sky-50/60 px-4 py-2.5 text-xs text-sky-800">
        新架构提示：不再支持一键同步聚水潭 60 万+ SKU 全量商品。建议按最近 N 天、按 SKU、或按款号小范围同步。新同步默认不保存完整 raw JSON。
      </div>

      <Card className="p-4 space-y-4">
        <h2 className="font-medium">手动同步</h2>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">最近 N 天有更新的商品（最多 7 天）</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={recentDays}
                onChange={(e) => setRecentDays(Number(e.target.value) || 30)}
                className="w-[100px]"
                min={1}
                max={7}
              />
              <Button onClick={() => invoke({ action: "sync_recent", days: recentDays, max_pages: 10 }, `同步最近 ${recentDays} 天商品`)} disabled={busy}>
                <PlayCircle className="w-4 h-4 mr-2" /> 同步最近 {recentDays} 天
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">按款号同步</Label>
            <div className="flex items-center gap-2">
              <Input value={styleNo} onChange={(e) => setStyleNo(e.target.value)} placeholder="输入款号" />
              <Button
                variant="outline"
                onClick={() => { if (!styleNo.trim()) return toast.error("请输入款号"); invoke({ action: "sync_by_style", style_no: styleNo.trim() }, `同步款号 ${styleNo}`); }}
                disabled={busy}
              >
                <Search className="w-4 h-4 mr-2" /> 同步
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">按 SKU 同步</Label>
            <div className="flex items-center gap-2">
              <Input value={skuCode} onChange={(e) => setSkuCode(e.target.value)} placeholder="输入 SKU 编码" />
              <Button
                variant="outline"
                onClick={() => { if (!skuCode.trim()) return toast.error("请输入 SKU"); invoke({ action: "sync_by_sku", sku_code: skuCode.trim() }, `同步 SKU ${skuCode}`); }}
                disabled={busy}
              >
                <Search className="w-4 h-4 mr-2" /> 同步
              </Button>
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-border flex flex-wrap items-end gap-3">
          <Button variant="outline" onClick={() => invoke({ action: "sync_images", limit: 50 }, "同步商品图片")} disabled={busy}>
            <ImageIcon className="w-4 h-4 mr-2" /> 同步商品图片 (每次 50 张)
          </Button>
          <p className="text-xs text-muted-foreground">
            图片会从聚水潭外链下载,转存到本系统 product-images 存储。
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          说明:商品资料和采购单接口在聚水潭是独立授权的,如果同步显示"permission_denied",请联系聚水潭开通"商品/SKU 查询"接口权限。
        </p>
      </Card>

      <Card className="p-4">
        <h2 className="font-medium mb-3">最近 50 条商品同步日志</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">类型</th>
                <th className="py-2 pr-4">状态</th>
                <th className="py-2 pr-4">开始</th>
                <th className="py-2 pr-4">结束</th>
                <th className="py-2 pr-4">写入数</th>
                <th className="py-2 pr-4">信息</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="py-2 pr-4 font-mono text-xs">{l.sync_type}</td>
                  <td className="py-2 pr-4">
                    <Badge variant={statusVariant(l.status) as any}>{l.status}</Badge>
                  </td>
                  <td className="py-2 pr-4 text-xs">{fmt(l.started_at)}</td>
                  <td className="py-2 pr-4 text-xs">{fmt(l.ended_at)}</td>
                  <td className="py-2 pr-4 tabular-nums">{l.fetched_items_count ?? 0}</td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground max-w-[640px] whitespace-pre-wrap" title={l.error_detail || l.message || ""}>
                    {l.error_detail || l.message || "-"}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">暂无同步日志</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
