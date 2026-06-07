import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ops/PageHeader";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

type Sku = any;

function fmt(s?: string | null) { return s ? new Date(s).toLocaleString("zh-CN") : "-"; }
function fmtDate(s?: string | null) { return s ? new Date(s).toLocaleDateString("zh-CN") : "-"; }

function DataTable({ columns, rows, empty = "暂无数据" }: { columns: string[]; rows: any[][]; empty?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">{columns.map((c, i) => <th key={i} className="text-left p-2">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b hover:bg-muted/40">
              {r.map((c, j) => <td key={j} className="p-2 align-top">{c ?? "-"}</td>)}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={columns.length} className="py-8 text-center text-muted-foreground">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default function ProductDetailPage() {
  const { skuId } = useParams<{ skuId: string }>();
  const [sku, setSku] = useState<Sku | null>(null);
  const [aliases, setAliases] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [outbound, setOutbound] = useState<any[]>([]);
  const [refunds, setRefunds] = useState<any[]>([]);
  const [aftersale, setAftersale] = useState<any[]>([]);
  const [purchase, setPurchase] = useState<any[]>([]);
  const [receipt, setReceipt] = useState<any[]>([]);
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!skuId) return;
    (async () => {
      setLoading(true);
      const { data: s, error } = await supabase.from("ops_skus").select("*").eq("id", skuId).maybeSingle();
      if (error) { toast.error(error.message); setLoading(false); return; }
      if (!s) { setLoading(false); return; }
      setSku(s);

      const code = s.sku_code as string | null;
      const jstId = s.jst_sku_id as string | null;

      // 线上映射：优先按 sku_id；为兼容旧数据，也按 jst_sku_id 兜底
      {
        const ors: string[] = [`sku_id.eq.${skuId}`];
        if (jstId) ors.push(`jst_sku_id.eq.${jstId}`);
        const { data: al } = await supabase.from("ops_sku_aliases").select("*").or(ors.join(",")).limit(200);
        setAliases(al ?? []);
      }

      const orSku = (col: string) => code ? `${col}.eq.${code}` : null;
      const orJst = (col: string) => jstId ? `${col}.eq.${jstId}` : null;

      // 销售订单明细
      {
        const filters = [orSku("sku_code"), orJst("sku_id")].filter(Boolean).join(",");
        if (filters) {
          const { data: light, error: lightErr } = await (supabase as any).from("sales_order_light_items")
            .select("o_id, so_id, shop_id, product_name, sku_code, sku_name, qty, pay_amount, paid_amount, refund_status, synced_at")
            .or(filters).order("synced_at", { ascending: false }).limit(200);
          if (!lightErr && (light ?? []).length > 0) {
            setSales((light ?? []).map((r: any) => ({ ...r, jst_o_id: r.o_id, amount: r.pay_amount })));
          } else {
            const { data } = await supabase.from("jst_sales_order_items")
              .select("jst_o_id, so_id, shop_id, product_name, sku_code, sku_name, qty, amount, paid_amount, refund_status, synced_at")
              .or(filters).order("synced_at", { ascending: false }).limit(200);
            setSales(data ?? []);
          }
        }
      }

      // 出库（仅有 sku_id）
      if (jstId) {
        const { data } = await supabase.from("jst_outbound_order_items")
          .select("io_id, oi_id, name, color, size, qty, amount, synced_at")
          .eq("sku_id", jstId).order("synced_at", { ascending: false }).limit(200);
        setOutbound(data ?? []);
      }

      // 退款 / 销退（仅有 sku_id）
      if (jstId) {
        const [{ data: r1 }, { data: r2 }] = await Promise.all([
          supabase.from("jst_refund_order_items")
            .select("as_id, name, qty, r_qty, price, amount, type, synced_at")
            .eq("sku_id", jstId).order("synced_at", { ascending: false }).limit(200),
          supabase.from("jst_aftersale_received_items")
            .select("as_id, name, qty, r_qty, amount, synced_at")
            .eq("sku_id", jstId).order("synced_at", { ascending: false }).limit(200),
        ]);
        setRefunds(r1 ?? []);
        setAftersale(r2 ?? []);
      }

      // 采购单：sku_no 优先，sku_id 兜底
      {
        const filters = [orSku("sku_no"), orJst("sku_id")].filter(Boolean).join(",");
        if (filters) {
          const { data } = await supabase.from("purchase_order_items")
            .select("external_po_id, sku_no, product_name, color, size, purchase_qty, received_qty, unreceived_qty, unit_price, delivery_date, purchase_order:purchase_orders(supplier_name, status, po_date)")
            .or(filters).order("updated_at", { ascending: false }).limit(200);
          setPurchase(data ?? []);
        }
      }

      // 入库单：sku_no 优先，sku_id 兜底
      {
        const filters = [orSku("sku_no"), orJst("sku_id")].filter(Boolean).join(",");
        if (filters) {
          const { data } = await supabase.from("purchase_receipt_items")
            .select("external_io_id, external_po_id, sku_no, product_name, received_qty, cost_price, receipt:purchase_receipts(supplier_name, warehouse_name, io_date, status)")
            .or(filters).order("updated_at", { ascending: false }).limit(200);
          setReceipt(data ?? []);
        }
      }

      // 映射异常：按 resolved_sku_id（已解析回当前 SKU）或 jst_sku_id 关联
      {
        const ors: string[] = [`resolved_sku_id.eq.${skuId}`];
        if (jstId) ors.push(`jst_sku_id.eq.${jstId}`);
        const { data } = await supabase.from("ops_product_mapping_exceptions")
          .select("*").or(ors.join(",")).order("created_at", { ascending: false }).limit(100);
        setExceptions(data ?? []);
      }


      setLoading(false);
    })();
  }, [skuId]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">加载中…</div>;
  if (!sku) return <div className="p-6 text-sm text-muted-foreground">未找到该 SKU</div>;

  const img = sku.sku_image_url || sku.external_image_url;

  return (
    <div>
      <PageHeader
        breadcrumb={["商品系统", "商品档案", sku.sku_code ?? sku.jst_sku_id ?? "详情"]}
        title={sku.product_name ?? sku.sku_name ?? sku.sku_code ?? "商品详情"}
        description={`款号 ${sku.style_no ?? "-"} · SKU ${sku.sku_code ?? `JST:${sku.jst_sku_id}`}`}
        actions={<Link to="/products"><Button variant="outline" size="sm"><ArrowLeft className="w-4 h-4 mr-1" /> 返回</Button></Link>}
      />

      <div className="mx-6 mb-3 rounded-md border border-sky-300 bg-sky-50/60 px-4 py-2.5 text-xs text-sky-800">
        新架构提示：当前系统只同步活跃商品和近期业务相关商品，并不保存聚水潭全部商品档案。订单 / 出库 / 退款明细以聚水潭为准；新同步默认不保存完整 raw JSON。
      </div>

      <Tabs defaultValue="basic" className="px-6 pb-6">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="basic">基础资料</TabsTrigger>
          <TabsTrigger value="aliases">线上映射 ({aliases.length})</TabsTrigger>
          <TabsTrigger value="sales">销售订单 ({sales.length})</TabsTrigger>
          <TabsTrigger value="outbound">出库 ({outbound.length})</TabsTrigger>
          <TabsTrigger value="refund">退款/售后 ({refunds.length + aftersale.length})</TabsTrigger>
          <TabsTrigger value="purchase">采购 ({purchase.length})</TabsTrigger>
          <TabsTrigger value="receipt">入库 ({receipt.length})</TabsTrigger>
          <TabsTrigger value="stock">库存</TabsTrigger>
          <TabsTrigger value="exceptions">异常 ({exceptions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <Card className="p-6 grid grid-cols-1 md:grid-cols-[160px_1fr] gap-6">
            {img ? <img src={img} alt="" className="w-40 h-40 object-cover rounded border" /> : <div className="w-40 h-40 rounded bg-muted" />}
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
              {[
                ["款号", sku.style_no], ["SKU", sku.sku_code], ["JST SKU ID", sku.jst_sku_id],
                ["商品名称", sku.product_name ?? sku.sku_name], ["颜色", sku.color], ["尺码", sku.size],
                ["季节", sku.season], ["类目", sku.category], ["供应商 ID", sku.supplier_id],
                ["成本", sku.cost_price], ["售价", sku.sale_price], ["状态", sku.status ?? (sku.is_active ? "active" : "inactive")],
                ["来源", sku.source], ["首次出现", fmt(sku.first_seen_at)], ["最近出现", fmt(sku.last_seen_at)],
              ].map(([k, v], i) => (
                <div key={i}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="font-mono text-xs mt-0.5">{v == null || v === "" ? "-" : String(v)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </TabsContent>

        <TabsContent value="aliases">
          <Card className="p-4">
            <DataTable
              columns={["平台", "店铺 ID", "店铺名", "线上商品编码", "线上 SKU", "线上商品名", "线上规格", "状态", "modified_at"]}
              rows={aliases.map(a => [a.platform, a.shop_id, a.shop_name, a.external_product_id, a.external_sku_code, a.online_product_name, a.online_sku_name, a.online_status, fmt(a.modified_at)])}
            />
          </Card>
        </TabsContent>

        <TabsContent value="sales">
          <Card className="p-4">
            <DataTable
              columns={["订单号", "店铺", "商品名", "SKU", "数量", "金额", "实付", "退款状态", "时间"]}
              rows={sales.map(s => [s.jst_o_id ?? s.so_id, s.shop_id, s.product_name, s.sku_code, s.qty, s.amount, s.paid_amount, s.refund_status, fmt(s.synced_at)])}
            />
          </Card>
        </TabsContent>

        <TabsContent value="outbound">
          <Card className="p-4">
            <DataTable
              columns={["出库单号", "订单明细", "商品名", "颜色", "尺码", "数量", "金额", "时间"]}
              rows={outbound.map(o => [o.io_id, o.oi_id, o.name, o.color, o.size, o.qty, o.amount, fmt(o.synced_at)])}
            />
          </Card>
        </TabsContent>

        <TabsContent value="refund">
          <Card className="p-4 space-y-6">
            <div>
              <h3 className="text-sm font-medium mb-2">退款单明细</h3>
              <DataTable
                columns={["退款单号", "商品名", "数量", "退货数量", "单价", "退款金额", "类型", "时间"]}
                rows={refunds.map(r => [r.as_id, r.name, r.qty, r.r_qty, r.price, r.amount, r.type, fmt(r.synced_at)])}
              />
            </div>
            <div>
              <h3 className="text-sm font-medium mb-2">销退仓收货明细</h3>
              <DataTable
                columns={["售后单号", "商品名", "数量", "实收数量", "金额", "时间"]}
                rows={aftersale.map(r => [r.as_id, r.name, r.qty, r.r_qty, r.amount, fmt(r.synced_at)])}
              />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="purchase">
          <Card className="p-4">
            <DataTable
              columns={["采购单号", "供应商", "SKU", "采购数", "已入库", "未入库", "单价", "协议到货", "状态"]}
              rows={purchase.map(p => [p.external_po_id, p.purchase_order?.supplier_name, p.sku_no, p.purchase_qty, p.received_qty, p.unreceived_qty, p.unit_price, fmtDate(p.delivery_date), p.purchase_order?.status])}
            />
          </Card>
        </TabsContent>

        <TabsContent value="receipt">
          <Card className="p-4">
            <DataTable
              columns={["入库单号", "采购单号", "供应商", "SKU", "入库数", "成本", "仓库", "入库时间", "状态"]}
              rows={receipt.map(r => [r.external_io_id, r.external_po_id, r.receipt?.supplier_name, r.sku_no, r.received_qty, r.cost_price, r.receipt?.warehouse_name, fmt(r.receipt?.io_date), r.receipt?.status])}
            />
          </Card>
        </TabsContent>

        <TabsContent value="stock">
          <Card className="p-6 text-sm text-muted-foreground">
            项目暂未接入库存明细表（仅有 jst_warehouses）。库存模块将在后续阶段补全。
          </Card>
        </TabsContent>

        <TabsContent value="exceptions">
          <Card className="p-4">
            <DataTable
              columns={["平台", "店铺", "线上商品编码", "线上 SKU", "来源", "原因", "状态", "时间"]}
              rows={exceptions.map(e => [e.platform, e.shop_name ?? e.shop_id, e.online_item_code, e.online_sku_code, e.source_table, e.reason, <Badge key={e.id} variant={e.status === "pending" ? "destructive" : "secondary"}>{e.status}</Badge>, fmt(e.created_at)])}
            />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
