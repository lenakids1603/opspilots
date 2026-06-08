import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDateTimeCN } from "@/lib/datetime";
import { matchPurchasesForSkus, derivePurchaseStatus, PURCHASE_STATUS_LABEL, aggregatedSupplierNames } from "@/lib/purchaseMatch";

type Props = {
  oId: string | null;
  onClose: () => void;
};

export function ShippingRiskDetailDrawer({ oId, onClose }: Props) {
  const items = useQuery({
    queryKey: ["shipping_risk_detail", oId],
    enabled: !!oId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shipping_risk_orders")
        .select("*")
        .eq("o_id", oId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    retry: false,
  });

  const rows = items.data ?? [];
  const first = rows[0];

  const match = useQuery({
    queryKey: ["shipping_risk_detail_match", oId, rows.map(r => `${r.sku_code}__${r.style_no}`).join("|")],
    enabled: rows.length > 0,
    queryFn: () => matchPurchasesForSkus(rows.map(r => ({ sku: r.sku_code, style: r.style_no }))),
    retry: false,
  });

  return (
    <Sheet open={!!oId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>发货风险订单详情</SheetTitle>
          <SheetDescription>订单 {oId} · 数据只读，不触发同步</SheetDescription>
        </SheetHeader>

        {items.isLoading && <div className="py-10 text-center text-muted-foreground text-sm">加载中…</div>}
        {!items.isLoading && rows.length === 0 && (
          <div className="py-10 text-center text-muted-foreground text-sm">未找到该订单的风险记录</div>
        )}

        {first && (
          <div className="space-y-4 mt-4">
            <Card className="p-3 text-xs">
              <div className="font-medium text-sm mb-2">订单信息</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <Info label="店铺" value={first.shop_name ?? first.shop_id ?? "-"} />
                <Info label="平台" value={first.platform ?? "-"} />
                <Info label="订单状态" value={first.order_status ?? "-"} />
                <Info label="收货省份" value={first.receiver_province ?? "-"} />
                <Info label="下单时间" value={formatDateTimeCN(first.order_created_at ?? first.pay_time)} />
                <Info label="付款时间" value={formatDateTimeCN(first.pay_time)} />
                <Info label="最晚发货" value={formatDateTimeCN(first.latest_ship_time)} />
                <Info label="剩余 (小时)" value={first.remaining_hours == null ? "-" : Number(first.remaining_hours).toFixed(1)} />
              </div>
            </Card>

            <Card className="p-3">
              <div className="font-medium text-sm mb-2">商品明细 ({rows.length})</div>
              <div className="space-y-2">
                {rows.map(r => {
                  const m = match.data?.get(`${r.sku_code ?? ""}__${r.style_no ?? ""}`);
                  const status = m ? derivePurchaseStatus(m) : "unknown";
                  const sups = m ? aggregatedSupplierNames(m) : (r.supplier_name ? [r.supplier_name] : []);
                  return (
                    <div key={r.id} className="border rounded p-2 text-xs space-y-1">
                      <div className="font-medium">{r.sku_name ?? "-"}</div>
                      <div className="font-mono text-muted-foreground">
                        {r.sku_code ?? "-"} · {r.style_no ?? "-"} · {r.color ?? "-"}/{r.size ?? "-"} · ×{r.qty ?? 0}
                      </div>
                      <div className="flex flex-wrap gap-1.5 items-center pt-1">
                        <Badge variant="outline">{PURCHASE_STATUS_LABEL[status]}</Badge>
                        <span className="text-muted-foreground">供应商：</span>
                        <span>{sups.length ? sups.join("、") : "待匹配"}</span>
                        {m?.matchedBy === "product_default" && <Badge variant="secondary" className="text-[10px]">商品档案默认</Badge>}
                      </div>
                      {m && m.matches.length > 0 && (
                        <div className="mt-1.5 pt-1.5 border-t space-y-1">
                          {m.matches.map(p => (
                            <div key={p.poId} className="font-mono text-[11px] text-muted-foreground">
                              PO {p.externalPoId ?? p.poId.slice(0, 8)} · {p.statusLabel ?? p.status ?? "-"} ·
                              到货 {p.itemDeliveryDate ? formatDateTimeCN(p.itemDeliveryDate, { withSeconds: false }) : (p.expectedDeliveryDate ? formatDateTimeCN(p.expectedDeliveryDate, { withSeconds: false }) : "-")}
                              · 采购 {p.purchaseQty} / 已收 {p.receivedQty} / 未收 {p.unreceivedQty}
                            </div>
                          ))}
                        </div>
                      )}
                      {match.data && (!m || m.matches.length === 0) && (
                        <div className="text-[11px] text-muted-foreground italic pt-1">
                          未匹配到采购单，建议在采购模块补录
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Info({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}：</span>
      <span>{value ?? "-"}</span>
    </div>
  );
}
