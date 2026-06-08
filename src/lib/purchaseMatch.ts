// 前端工具：把订单行批量去 purchase_order_items / purchase_orders 里查供应商和到货日期。
// 只读，不写任何表。
import { supabase } from "@/integrations/supabase/client";

export type PurchaseMatch = {
  poId: string;
  externalPoId: string | null;
  supplierName: string | null;
  status: string | null;
  statusLabel: string | null;
  expectedDeliveryDate: string | null;
  itemDeliveryDate: string | null;
  purchaseQty: number;
  receivedQty: number;
  unreceivedQty: number;
};

export type SkuMatchResult = {
  matches: PurchaseMatch[];
  matchedBy: "sku" | "style" | "product_default" | "none";
  fallbackSupplierName: string | null; // 商品档案默认供应商
};

export type PurchaseStatus =
  | "po_pending_receipt" // 已下采购单，待入库
  | "po_partial_received" // 部分入库
  | "po_completed_but_unshipped" // 采购单已完成但订单仍未发货
  | "no_po" // 未找到采购单
  | "unknown";

export type SkuKey = { sku: string | null; style: string | null };

const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 批量按 sku_code / style_no 集合查询匹配信息。 */
export async function matchPurchasesForSkus(
  keys: SkuKey[]
): Promise<Map<string, SkuMatchResult>> {
  const result = new Map<string, SkuMatchResult>();
  const skus = Array.from(new Set(keys.map(k => k.sku).filter(Boolean))) as string[];
  const styles = Array.from(new Set(keys.map(k => k.style).filter(Boolean))) as string[];

  if (skus.length === 0 && styles.length === 0) return result;

  // 1) purchase_order_items by sku_no
  let bySku: any[] = [];
  let byStyle: any[] = [];
  try {
    if (skus.length) {
      const { data } = await (supabase as any)
        .from("purchase_order_items")
        .select("purchase_order_id,sku_no,style_no,purchase_qty,received_qty,unreceived_qty,delivery_date")
        .in("sku_no", skus)
        .limit(2000);
      bySku = data ?? [];
    }
    if (styles.length) {
      const { data } = await (supabase as any)
        .from("purchase_order_items")
        .select("purchase_order_id,sku_no,style_no,purchase_qty,received_qty,unreceived_qty,delivery_date")
        .in("style_no", styles)
        .limit(4000);
      byStyle = data ?? [];
    }
  } catch {
    // ignore
  }

  const allItems = [...bySku, ...byStyle];
  const poIds = Array.from(new Set(allItems.map(i => i.purchase_order_id).filter(Boolean)));

  const poMap = new Map<string, any>();
  if (poIds.length) {
    try {
      const { data } = await (supabase as any)
        .from("purchase_orders")
        .select("id,external_po_id,supplier_name,status,status_label,expected_delivery_date")
        .in("id", poIds);
      (data ?? []).forEach((p: any) => poMap.set(p.id, p));
    } catch { /* ignore */ }
  }

  const buildMatches = (items: any[]): PurchaseMatch[] => {
    const m = new Map<string, PurchaseMatch>();
    for (const it of items) {
      const po = poMap.get(it.purchase_order_id);
      const prev = m.get(it.purchase_order_id);
      const pq = num(it.purchase_qty);
      const rq = num(it.received_qty);
      const uq = it.unreceived_qty != null ? num(it.unreceived_qty) : Math.max(0, pq - rq);
      if (prev) {
        prev.purchaseQty += pq;
        prev.receivedQty += rq;
        prev.unreceivedQty += uq;
        if (!prev.itemDeliveryDate && it.delivery_date) prev.itemDeliveryDate = it.delivery_date;
      } else {
        m.set(it.purchase_order_id, {
          poId: it.purchase_order_id,
          externalPoId: po?.external_po_id ?? null,
          supplierName: po?.supplier_name ?? null,
          status: po?.status ?? null,
          statusLabel: po?.status_label ?? null,
          expectedDeliveryDate: po?.expected_delivery_date ?? null,
          itemDeliveryDate: it.delivery_date ?? null,
          purchaseQty: pq,
          receivedQty: rq,
          unreceivedQty: uq,
        });
      }
    }
    return Array.from(m.values());
  };

  const skuIdx = new Map<string, any[]>();
  for (const it of bySku) {
    if (!it.sku_no) continue;
    const arr = skuIdx.get(it.sku_no) ?? [];
    arr.push(it);
    skuIdx.set(it.sku_no, arr);
  }
  const styleIdx = new Map<string, any[]>();
  for (const it of byStyle) {
    if (!it.style_no) continue;
    const arr = styleIdx.get(it.style_no) ?? [];
    arr.push(it);
    styleIdx.set(it.style_no, arr);
  }

  // 3) 商品档案默认供应商 fallback
  const missingSkus = skus.filter(s => !skuIdx.has(s));
  const missingStyles = styles.filter(s => !styleIdx.has(s));
  const productSupplierBySku = new Map<string, string>();
  const productSupplierByStyle = new Map<string, string>();
  if (missingSkus.length || missingStyles.length) {
    try {
      const supplierIds = new Set<string>();
      let skuRows: any[] = [];
      let prodRows: any[] = [];
      if (missingSkus.length) {
        const { data } = await (supabase as any)
          .from("ops_skus")
          .select("sku_code,style_no,supplier_id")
          .in("sku_code", missingSkus)
          .limit(2000);
        skuRows = data ?? [];
        skuRows.forEach(r => r.supplier_id && supplierIds.add(r.supplier_id));
      }
      if (missingStyles.length) {
        const { data } = await (supabase as any)
          .from("ops_products")
          .select("style_no,supplier_id")
          .in("style_no", missingStyles)
          .limit(2000);
        prodRows = data ?? [];
        prodRows.forEach(r => r.supplier_id && supplierIds.add(r.supplier_id));
      }
      const supMap = new Map<string, string>();
      if (supplierIds.size) {
        const { data } = await (supabase as any)
          .from("ops_suppliers")
          .select("id,name")
          .in("id", Array.from(supplierIds));
        (data ?? []).forEach((s: any) => supMap.set(s.id, s.name));
      }
      for (const r of skuRows) {
        const name = r.supplier_id ? supMap.get(r.supplier_id) : null;
        if (name && r.sku_code) productSupplierBySku.set(r.sku_code, name);
      }
      for (const r of prodRows) {
        const name = r.supplier_id ? supMap.get(r.supplier_id) : null;
        if (name && r.style_no) productSupplierByStyle.set(r.style_no, name);
      }
    } catch { /* ignore */ }
  }

  for (const k of keys) {
    const key = matchKey(k);
    if (result.has(key)) continue;
    let matches: PurchaseMatch[] = [];
    let matchedBy: SkuMatchResult["matchedBy"] = "none";
    if (k.sku && skuIdx.has(k.sku)) {
      matches = buildMatches(skuIdx.get(k.sku)!);
      matchedBy = "sku";
    } else if (k.style && styleIdx.has(k.style)) {
      matches = buildMatches(styleIdx.get(k.style)!);
      matchedBy = "style";
    }
    let fallback: string | null = null;
    if (matches.length === 0) {
      if (k.sku && productSupplierBySku.has(k.sku)) {
        fallback = productSupplierBySku.get(k.sku)!;
        matchedBy = "product_default";
      } else if (k.style && productSupplierByStyle.has(k.style)) {
        fallback = productSupplierByStyle.get(k.style)!;
        matchedBy = "product_default";
      }
    }
    result.set(key, { matches, matchedBy, fallbackSupplierName: fallback });
  }
  return result;
}

export function matchKey(k: SkuKey): string {
  return `${k.sku ?? ""}__${k.style ?? ""}`;
}

export function derivePurchaseStatus(m: SkuMatchResult): PurchaseStatus {
  if (m.matches.length === 0) return "no_po";
  const anyPending = m.matches.some(x => x.unreceivedQty > 0);
  const anyReceived = m.matches.some(x => x.receivedQty > 0);
  if (!anyPending) return "po_completed_but_unshipped";
  if (anyReceived) return "po_partial_received";
  return "po_pending_receipt";
}

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  po_pending_receipt: "已下采购单，待入库",
  po_partial_received: "部分入库",
  po_completed_but_unshipped: "采购单已完成但订单仍未发货",
  no_po: "未找到采购单",
  unknown: "未知",
};

export function isAgreementOverdue(m: SkuMatchResult): boolean {
  if (!m.matches.length) return false;
  const today = Date.now();
  return m.matches.some(x => {
    const d = x.itemDeliveryDate ?? x.expectedDeliveryDate;
    if (!d) return false;
    const t = new Date(d).getTime();
    return Number.isFinite(t) && t < today && x.unreceivedQty > 0;
  });
}

export function earliestDeliveryDate(m: SkuMatchResult): string | null {
  let earliest: number | null = null;
  let raw: string | null = null;
  for (const x of m.matches) {
    const d = x.itemDeliveryDate ?? x.expectedDeliveryDate;
    if (!d) continue;
    const t = new Date(d).getTime();
    if (!Number.isFinite(t)) continue;
    if (earliest == null || t < earliest) { earliest = t; raw = d; }
  }
  return raw;
}

export function aggregatedSupplierNames(m: SkuMatchResult): string[] {
  const names = new Set<string>();
  for (const x of m.matches) {
    if (x.supplierName) names.add(x.supplierName);
  }
  if (names.size === 0 && m.fallbackSupplierName) names.add(m.fallbackSupplierName);
  return Array.from(names);
}
