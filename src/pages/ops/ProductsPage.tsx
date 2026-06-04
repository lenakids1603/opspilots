import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ops/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, Database, AlertTriangle } from "lucide-react";

type Sku = {
  id: string;
  sku_code: string | null;
  jst_sku_id: string | null;
  style_no: string | null;
  product_name: string | null;
  sku_name: string | null;
  color: string | null;
  size: string | null;
  cost_price: number | null;
  supplier_id: string | null;
  sku_image_url: string | null;
  external_image_url: string | null;
  status: string | null;
  is_active: boolean | null;
  last_seen_at: string | null;
  source: string | null;
};

export default function ProductsPage() {
  const [rows, setRows] = useState<Sku[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [exceptionCount, setExceptionCount] = useState(0);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    let q = supabase.from("ops_skus")
      .select("id, sku_code, jst_sku_id, style_no, product_name, sku_name, color, size, cost_price, supplier_id, sku_image_url, external_image_url, status, is_active, last_seen_at, source")
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (keyword.trim()) {
      const k = `%${keyword.trim()}%`;
      q = q.or(`sku_code.ilike.${k},style_no.ilike.${k},product_name.ilike.${k},sku_name.ilike.${k}`);
    }
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setRows((data as any) ?? []);

    const { count } = await supabase.from("ops_product_mapping_exceptions")
      .select("id", { count: "exact", head: true }).eq("status", "pending");
    setExceptionCount(count ?? 0);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const derive = async (days: number) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("ops-product-master-derive", {
        body: { source: "all", days, limit: 20000 },
      });
      if (error) throw error;
      toast.success(`沉淀完成：新增 ${data?.masters_inserted ?? 0} / 更新 ${data?.masters_updated ?? 0} / 映射 ${data?.aliases_upserted ?? 0} / 异常 ${data?.exceptions_recorded ?? 0}`);
      load();
    } catch (e: any) {
      toast.error(e?.message || "调用失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        breadcrumb={["商品系统", "商品档案"]}
        title="商品档案"
        description="按内部 SKU 维度展示。聚水潭线上商品记录仅作为映射保存在 ops_sku_aliases，不在此页展示。"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> 刷新
            </Button>
          </div>
        }
      />

      <Card className="p-4 mb-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-sm">从业务数据沉淀商品主档</h2>
          {exceptionCount > 0 && (
            <Link to="/products/exceptions">
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="w-3 h-3" /> {exceptionCount} 条映射异常
              </Badge>
            </Link>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          从订单 / 出库 / 退款 / 销退仓中已同步的数据反查 SKU、款号、颜色、尺码、图片、供应商，去重后写入 ops_skus 主档；线上店铺商品编码写入 ops_sku_aliases；未匹配的线上 SKU 记录到映射异常表。本阶段不做聚水潭 60 万条商品全量同步。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => derive(7)} disabled={busy}>
            <Database className="w-4 h-4 mr-1" /> 沉淀近 7 天
          </Button>
          <Button size="sm" variant="outline" onClick={() => derive(30)} disabled={busy}>
            沉淀近 30 天
          </Button>
          <Button size="sm" variant="outline" onClick={() => derive(90)} disabled={busy}>
            沉淀近 90 天
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Input
            placeholder="搜索 SKU / 款号 / 商品名"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            className="max-w-xs"
          />
          <Button size="sm" variant="outline" onClick={load}>搜索</Button>
          <span className="text-xs text-muted-foreground ml-auto">共 {rows.length} 条（最多展示 200 条）</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="text-left p-2 w-14">图片</th>
                <th className="text-left p-2">款号</th>
                <th className="text-left p-2">SKU</th>
                <th className="text-left p-2">商品名</th>
                <th className="text-left p-2">颜色</th>
                <th className="text-left p-2">尺码</th>
                <th className="text-right p-2">成本</th>
                <th className="text-left p-2">来源</th>
                <th className="text-left p-2">最近出现</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const img = r.sku_image_url || r.external_image_url;
                return (
                  <tr key={r.id} className="border-b hover:bg-muted/40 cursor-pointer" onClick={() => navigate(`/products/${r.id}`)}>
                    <td className="p-2">
                      {img ? <img src={img} alt="" className="w-10 h-10 object-cover rounded" /> : <div className="w-10 h-10 rounded bg-muted" />}
                    </td>
                    <td className="p-2 font-mono text-xs">{r.style_no ?? "-"}</td>
                    <td className="p-2 font-mono text-xs">{r.sku_code ?? <span className="text-muted-foreground">JST:{r.jst_sku_id}</span>}</td>
                    <td className="p-2">{r.product_name ?? r.sku_name ?? "-"}</td>
                    <td className="p-2">{r.color ?? "-"}</td>
                    <td className="p-2">{r.size ?? "-"}</td>
                    <td className="p-2 text-right tabular-nums">{r.cost_price ?? "-"}</td>
                    <td className="p-2 text-xs text-muted-foreground">{r.source ?? "-"}</td>
                    <td className="p-2 text-xs">{r.last_seen_at ? new Date(r.last_seen_at).toLocaleDateString("zh-CN") : "-"}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="py-12 text-center text-muted-foreground">
                  暂无商品主档。点击上方"沉淀近 N 天"从已同步业务数据自动生成。
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
