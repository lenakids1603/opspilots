import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { AlertTriangle, Clock, Store, Truck, Package, Factory } from "lucide-react";

type Props = {
  shop?: string;
  styleNo?: string;
  skuCode?: string;
  supplier?: string;
};

const SAMPLE_LIMIT = 5000;

async function distinctSample(field: string, base: () => any) {
  const { data, error } = await base().select(field).not(field, "is", null).limit(SAMPLE_LIMIT);
  if (error) throw error;
  const s = new Set<string>();
  (data ?? []).forEach((r: any) => { if (r[field] != null) s.add(String(r[field])); });
  return { count: s.size, capped: (data ?? []).length >= SAMPLE_LIMIT };
}

async function countWith(predicate: (q: any) => any, filters: Props) {
  let q = (supabase as any).from("shipping_risk_orders").select("id", { count: "exact", head: true });
  if (filters.shop) q = q.ilike("shop_name", `%${filters.shop}%`);
  if (filters.styleNo) q = q.ilike("style_no", `%${filters.styleNo}%`);
  if (filters.skuCode) q = q.ilike("sku_code", `%${filters.skuCode}%`);
  if (filters.supplier) q = q.ilike("supplier_name", `%${filters.supplier}%`);
  q = predicate(q);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

function makeBase(filters: Props) {
  return () => {
    let q = (supabase as any).from("shipping_risk_orders");
    let chain = q.select("*", { head: false });
    // Use a fresh chain with filters per call instead
    chain = (supabase as any).from("shipping_risk_orders");
    return applyFilters(chain, filters);
  };
}

function applyFilters(q: any, filters: Props) {
  let r = q;
  if (filters.shop) r = r.ilike("shop_name", `%${filters.shop}%`);
  if (filters.styleNo) r = r.ilike("style_no", `%${filters.styleNo}%`);
  if (filters.skuCode) r = r.ilike("sku_code", `%${filters.skuCode}%`);
  if (filters.supplier) r = r.ilike("supplier_name", `%${filters.supplier}%`);
  return r;
}

export function ShippingRiskStatsCards(filters: Props) {
  const stats = useQuery({
    queryKey: ["shipping_risk_stats", filters],
    queryFn: async () => {
      const [timeout24, within24, within48, shops, suppliers, skus] = await Promise.all([
        countWith(q => q.eq("is_timeout", true), filters),
        countWith(q => q.eq("is_timeout", false).lte("remaining_hours", 24).gte("remaining_hours", 0), filters),
        countWith(q => q.eq("is_timeout", false).gt("remaining_hours", 24).lte("remaining_hours", 48), filters),
        distinctSample("shop_id", makeBase(filters)),
        distinctSample("supplier_name", makeBase(filters)),
        distinctSample("sku_code", makeBase(filters)),
      ]);
      return { timeout24, within24, within48, shops, suppliers, skus };
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  const cards = [
    { label: "已超时未发货", value: stats.data?.timeout24, icon: AlertTriangle, cls: "text-rose-600" },
    { label: "24h 内即将超时", value: stats.data?.within24, icon: Clock, cls: "text-orange-600" },
    { label: "48h 内即将超时", value: stats.data?.within48, icon: Clock, cls: "text-amber-600" },
    { label: "涉及店铺数", value: stats.data?.shops.count, capped: stats.data?.shops.capped, icon: Store, cls: "text-foreground" },
    { label: "涉及供应商数", value: stats.data?.suppliers.count, capped: stats.data?.suppliers.capped, icon: Factory, cls: "text-foreground" },
    { label: "涉及 SKU 数", value: stats.data?.skus.count, capped: stats.data?.skus.capped, icon: Package, cls: "text-foreground" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Card key={c.label} className="p-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-muted-foreground">{c.label}</div>
                <div className={`text-2xl font-bold tabular-nums mt-1 ${c.cls}`}>
                  {stats.isLoading ? "…" : stats.isError ? "-" : (c.value ?? 0)}
                  {(c as any).capped ? <span className="text-xs text-muted-foreground ml-1">+</span> : null}
                </div>
              </div>
              <Icon className={`w-4 h-4 ${c.cls}`} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
