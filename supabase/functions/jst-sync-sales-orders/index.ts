// Edge Function: 聚水潭销售订单同步（断点续跑 + 进度条）
// API: /open/orders/single/query  (date_type=modified)
// 写入 jst_sales_orders(轻量主表) + sales_order_light_items + sales summaries + shipping_risk_orders
// Actions:
//   - start_sales_job / tick_sales_job / cancel_sales_job  (推荐, 走 jst_sync_jobs)
//   - (无 action) 兼容旧的一次性后台同步, 可用于 cron
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  admin, callOpenweb, fmtBJ, parseJstBeijingDateTime, computeHasNext, pickList, pickItemsArray,
  resolveCaller, resolveWindow, sleep, RATE_DELAY_MS, MAX_PAGE_NO,
} from "../_shared/jst-client.ts";
import { handleJobActions, PageResult, ProcessPageArgs } from "../_shared/jst-sync-job.ts";
import { classifySalesOrder } from "../_shared/orderClassify.ts";
import { loadSkippedShops, shopIdOf, shouldSkipShop, formatSkipNote } from "../_shared/shop-filter.ts";

const SYNC_TYPE = "sales_orders";
const METHOD_PATH = "orders/single/query";
const PAGE_SIZE = 50;
const SALES_REQUEST_VERSION = 2;
const ENABLE_LEGACY_SALES_ORDER_ITEMS = Deno.env.get("ENABLE_LEGACY_SALES_ORDER_ITEMS") === "true";
const SHIPPING_DEADLINE_FALLBACK_HOURS = 48;

// 隐私字段：raw_data 写库前剥除
const PRIVACY_KEYS = new Set([
  "receiver_name", "receiver_mobile", "receiver_phone", "receiver_tel",
  "receiver_address", "receiver_zip", "receiver_email", "receiver_idcard",
  "buyer_email", "buyer_account", "buyer_id_card", "buyer_mobile", "buyer_phone",
  "consignee", "consignee_mobile", "consignee_phone", "consignee_address",
  "address", "tel", "mobile", "mobile_no", "phone", "phone_no",
]);

function sanitize(o: any): any {
  if (!o || typeof o !== "object") return o;
  if (Array.isArray(o)) return o.map(sanitize);
  const out: any = {};
  for (const k of Object.keys(o)) {
    if (PRIVACY_KEYS.has(k.toLowerCase())) continue;
    out[k] = sanitize(o[k]);
  }
  return out;
}

function num(v: any, d = 0): number {
  if (v == null || v === "") return d;
  const n = Number(v);
  return isFinite(n) ? n : d;
}
function str(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function splitProps(v: string | null): { color: string | null; size: string | null } {
  if (!v) return { color: null, size: null };
  const parts = String(v).split(/[,;|，；\s]+/).map((s) => s.trim()).filter(Boolean);
  return { color: parts[0] ?? null, size: parts[1] ?? null };
}

function riskFromDeadline(deadlineIso: string | null) {
  if (!deadlineIso) {
    return { remainingHours: null as number | null, isTimeout: false, riskLevel: "unknown" };
  }
  const remainingHours = (new Date(deadlineIso).getTime() - Date.now()) / 3_600_000;
  const riskLevel =
    remainingHours < 0 ? "timeout" :
    remainingHours <= 6 ? "high" :
    remainingHours <= 24 ? "medium" : "low";
  return { remainingHours, isTimeout: remainingHours < 0, riskLevel };
}

function pickOrderCreatedAt(o: any): string | null {
  return parseJstBeijingDateTime(
    o.order_time ?? o.orderTime ??
    o.create_time ?? o.createTime ??
    o.created ?? o.created_time ??
    o.order_date ?? o.orderDate
  );
}

function resolveShippingDeadline(planDeliveryDateIso: string | null, payTimeIso: string | null, orderCreatedAtIso: string | null) {
  if (planDeliveryDateIso) return planDeliveryDateIso;
  const baseIso = payTimeIso ?? orderCreatedAtIso;
  if (!baseIso) return null;
  return new Date(new Date(baseIso).getTime() + SHIPPING_DEADLINE_FALLBACK_HOURS * 3_600_000).toISOString();
}

function pickItems(o: any): any[] {
  return pickItemsArray(o);
}

async function upsertSalesOrder(o: any): Promise<{ orderId: string; itemsUpserted: number }> {
  const jstOId = str(o.o_id ?? o.oId);
  if (!jstOId) throw new Error("missing o_id");
  const orderCreatedAt = pickOrderCreatedAt(o);

  const orderRow = {
    jst_o_id: jstOId,
    so_id: str(o.so_id),
    shop_id: str(o.shop_id),
    shop_name: str(o.shop_name),
    status: str(o.status),
    order_type: str(o.order_type ?? o.type),
    order_created_at: orderCreatedAt,
    created_time: orderCreatedAt,
    modified_time: parseJstBeijingDateTime(o.modified ?? o.modified_time),
    pay_time: parseJstBeijingDateTime(o.pay_date ?? o.paytime ?? o.pay_time),
    plan_delivery_date: parseJstBeijingDateTime(o.plan_delivery_date),
    io_id: str(o.io_id),
    io_date: parseJstBeijingDateTime(o.io_date),
    l_id: str(o.l_id),
    lc_id: str(o.lc_id),
    logistics_company: str(o.logistics_company),
    pay_amount: num(o.pay_amount),
    paid_amount: num(o.paid_amount ?? o.pay_amount),
    free_amount: num(o.free_amount),
    freight: num(o.freight ?? o.post_amount),
    weight: num(o.weight),
    f_weight: num(o.f_weight),
    buyer_message: str(o.buyer_message),
    seller_remark: str(o.remark ?? o.seller_remark),
    labels: o.labels ?? null,
    merge_so_id: str(o.merge_so_id),
    // 隐私：仅保留省/市/区
    receiver_province: str(o.receiver_state ?? o.receiver_province),
    receiver_city: str(o.receiver_city),
    receiver_district: str(o.receiver_district),
    receiver_mobile_masked: null,
    synced_at: new Date().toISOString(),
  } as any;

  // ERP 内部订单生命周期分类
  // 关联退款表判断 hasRefund（如果存在则更精确判定"发货后退货"）
  let hasRefund = false;
  try {
    const orFilter = `o_id.eq.${jstOId}${o.so_id ? `,so_id.eq.${o.so_id}` : ""}`;
    const [rfRes, asRes] = await Promise.all([
      admin.from("jst_refund_orders").select("id").or(orFilter).gt("refund_amount", 0).limit(1),
      admin.from("jst_aftersale_received_orders").select("id").or(orFilter).limit(1),
    ]);
    hasRefund = !!((rfRes.data && rfRes.data.length) || (asRes.data && asRes.data.length));
  } catch (_e) { /* ignore */ }
  const cls = classifySalesOrder({
    status: orderRow.status,
    paid_amount: orderRow.paid_amount,
    pay_time: orderRow.pay_time,
    io_id: orderRow.io_id,
    io_date: orderRow.io_date,
    l_id: orderRow.l_id,
  }, { hasRefund });
  orderRow.internal_order_type = cls.code;
  orderRow.internal_order_type_name = cls.name;
  orderRow.internal_order_type_updated_at = new Date().toISOString();

  const { data: up, error } = await admin
    .from("jst_sales_orders").upsert(orderRow, { onConflict: "jst_o_id" }).select("id").single();
  if (error) throw error;

  const sourceByOId = new Map<string, any>([[jstOId, o]]);
  const idByOId = new Map<string, string>([[jstOId, up.id as string]]);
  const derived = await persistDerivedSalesState([orderRow], sourceByOId, idByOId);
  return { orderId: up.id as string, itemsUpserted: derived.itemUpserted };
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v)));
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function buildSalesOrderRowForBatch(o: any, hasRefund: boolean) {
  const jstOId = str(o.o_id ?? o.oId);
  if (!jstOId) throw new Error("missing o_id");
  const orderCreatedAt = pickOrderCreatedAt(o);

  const orderRow = {
    jst_o_id: jstOId,
    so_id: str(o.so_id),
    shop_id: str(o.shop_id),
    shop_name: str(o.shop_name),
    status: str(o.status),
    order_type: str(o.order_type ?? o.type),
    order_created_at: orderCreatedAt,
    created_time: orderCreatedAt,
    modified_time: parseJstBeijingDateTime(o.modified ?? o.modified_time),
    pay_time: parseJstBeijingDateTime(o.pay_date ?? o.paytime ?? o.pay_time),
    plan_delivery_date: parseJstBeijingDateTime(o.plan_delivery_date),
    io_id: str(o.io_id),
    io_date: parseJstBeijingDateTime(o.io_date),
    l_id: str(o.l_id),
    lc_id: str(o.lc_id),
    logistics_company: str(o.logistics_company),
    pay_amount: num(o.pay_amount),
    paid_amount: num(o.paid_amount ?? o.pay_amount),
    free_amount: num(o.free_amount),
    freight: num(o.freight ?? o.post_amount),
    weight: num(o.weight),
    f_weight: num(o.f_weight),
    buyer_message: str(o.buyer_message),
    seller_remark: str(o.remark ?? o.seller_remark),
    labels: o.labels ?? null,
    merge_so_id: str(o.merge_so_id),
    receiver_province: str(o.receiver_state ?? o.receiver_province),
    receiver_city: str(o.receiver_city),
    receiver_district: str(o.receiver_district),
    receiver_mobile_masked: null,
    synced_at: new Date().toISOString(),
  } as any;

  const cls = classifySalesOrder({
    status: orderRow.status,
    paid_amount: orderRow.paid_amount,
    pay_time: orderRow.pay_time,
    io_id: orderRow.io_id,
    io_date: orderRow.io_date,
    l_id: orderRow.l_id,
  }, { hasRefund });
  orderRow.internal_order_type = cls.code;
  orderRow.internal_order_type_name = cls.name;
  orderRow.internal_order_type_updated_at = new Date().toISOString();
  return orderRow;
}

function buildSalesItemRowsForBatch(o: any, salesOrderId: string) {
  const jstOId = str(o.o_id ?? o.oId);
  if (!jstOId) throw new Error("missing o_id");
  const rows: any[] = [];
  const itemList = pickItems(o);
  for (let i = 0; i < itemList.length; i++) {
    const it = itemList[i];
    const jstItemId = str(it.oi_id ?? it.item_id ?? it.id);
    const skuId = str(it.sku_id);
    rows.push({
      sales_order_id: salesOrderId,
      jst_o_id: jstOId,
      so_id: str(o.so_id),
      shop_id: str(o.shop_id),
      item_index: i,
      jst_item_id: jstItemId,
      sku_id: skuId,
      i_id: str(it.i_id),
      sku_code: str(it.sku_code ?? it.sku),
      shop_sku_id: str(it.shop_sku_id),
      product_name: str(it.name ?? it.product_name),
      sku_name: str(it.sku_name ?? it.properties_value),
      qty: num(it.qty ?? it.amount_qty ?? it.sale_qty),
      sale_price: num(it.sale_price ?? it.price),
      amount: num(it.amount ?? it.sale_amount),
      paid_amount: num(it.paid_amount ?? it.pay_amount),
      refund_status: str(it.refund_status),
      pic: str(it.pic),
      supplier_id: str(it.supplier_id),
      supplier_name: str(it.supplier_name),
      item_unique_key: `${jstOId}|${jstItemId ?? ""}|${skuId ?? ""}|${i}`,
      synced_at: new Date().toISOString(),
    });
  }
  return rows;
}

function buildSalesLightItemRowsForBatch(o: any, orderRow: any) {
  const jstOId = str(o.o_id ?? o.oId);
  if (!jstOId) throw new Error("missing o_id");
  const rows: any[] = [];
  const itemList = pickItems(o);
  const isShipped = ["shipped", "returned_after_ship"].includes(String(orderRow.internal_order_type ?? ""));
  const hasRefund = ["paid_cancelled_before_ship", "returned_after_ship"].includes(String(orderRow.internal_order_type ?? ""));
  for (let i = 0; i < itemList.length; i++) {
    const it = itemList[i];
    const jstItemId = str(it.oi_id ?? it.item_id ?? it.id);
    const skuId = str(it.sku_id);
    const props = splitProps(str(it.properties_value ?? it.sku_name));
    const qty = num(it.qty ?? it.amount_qty ?? it.sale_qty);
    const payAmount = num(it.paid_amount ?? it.pay_amount ?? it.amount ?? it.sale_amount);
    const costPrice = num(it.cost_price ?? it.purchase_price, 0);
    rows.push({
      item_unique_key: `${jstOId}|${jstItemId ?? ""}|${skuId ?? ""}|${i}`,
      o_id: jstOId,
      so_id: str(o.so_id),
      shop_id: str(o.shop_id),
      shop_name: str(o.shop_name),
      platform: str(o.platform ?? o.shop_site ?? o.platform_type),
      order_status: orderRow.status,
      internal_order_type: orderRow.internal_order_type,
      internal_order_type_name: orderRow.internal_order_type_name,
      order_created_at: orderRow.order_created_at,
      created_time: orderRow.created_time,
      pay_time: orderRow.pay_time,
      modified_time: orderRow.modified_time,
      plan_delivery_date: orderRow.plan_delivery_date,
      io_id: orderRow.io_id,
      io_date: orderRow.io_date,
      l_id: orderRow.l_id,
      sku_id: skuId,
      sku_code: str(it.sku_code ?? it.sku),
      sku_name: str(it.sku_name ?? it.properties_value),
      style_no: str(it.style_no ?? it.styleNo ?? it.i_id),
      product_name: str(it.name ?? it.product_name),
      color: str(it.color) ?? props.color,
      size: str(it.size) ?? props.size,
      supplier_id: str(it.supplier_id),
      supplier_name: str(it.supplier_name),
      qty,
      sale_price: num(it.sale_price ?? it.price),
      pay_amount: payAmount,
      paid_amount: payAmount,
      refund_status: str(it.refund_status),
      estimated_cost_price: costPrice > 0 ? costPrice : null,
      estimated_cost_amount: costPrice > 0 ? costPrice * qty : 0,
      is_shipped: isShipped,
      has_refund: hasRefund,
      last_jst_modified: orderRow.modified_time,
      synced_at: new Date().toISOString(),
    });
  }
  return rows;
}

async function upsertLightItemRows(rows: any[]) {
  let upserted = 0;
  let failed = 0;
  let lastErr = "";
  // 单批 200 行：批次过大时持锁/语句时长随之放大，曾触发 statement timeout
  for (const itemChunk of chunk(rows, 200)) {
    const { error } = await admin
      .from("sales_order_light_items")
      .upsert(itemChunk, { onConflict: "item_unique_key" });
    if (!error) {
      upserted += itemChunk.length;
      continue;
    }
    for (const itemRow of itemChunk) {
      const { error: rowErr } = await admin
        .from("sales_order_light_items")
        .upsert(itemRow, { onConflict: "item_unique_key" });
      if (rowErr) {
        failed++;
        lastErr = String(rowErr.message ?? rowErr);
      } else {
        upserted++;
      }
    }
  }
  return { upserted, failed, errorDetail: lastErr };
}

async function maybeUpsertLegacyItemRows(rows: any[]) {
  if (!ENABLE_LEGACY_SALES_ORDER_ITEMS || rows.length === 0) return { upserted: 0, failed: 0, errorDetail: "" };
  let upserted = 0;
  let failed = 0;
  let lastErr = "";
  for (const itemChunk of chunk(rows, 200)) {
    const { error } = await admin
      .from("jst_sales_order_items")
      .upsert(itemChunk, { onConflict: "item_unique_key" });
    if (!error) {
      upserted += itemChunk.length;
      continue;
    }
    for (const itemRow of itemChunk) {
      const { error: rowErr } = await admin
        .from("jst_sales_order_items")
        .upsert(itemRow, { onConflict: "item_unique_key" });
      if (rowErr) {
        failed++;
        lastErr = String(rowErr.message ?? rowErr);
      } else {
        upserted++;
      }
    }
  }
  return { upserted, failed, errorDetail: lastErr };
}

async function refreshSalesSummaries(itemKeys: string[]) {
  const keys = Array.from(new Set(itemKeys.filter(Boolean)));
  if (keys.length === 0) return { refreshed: false, detail: null as any };
  const { data, error } = await admin.rpc("refresh_sales_summaries_for_order_items", { _item_keys: keys });
  if (error) throw error;
  return { refreshed: true, detail: data };
}

async function upsertOrderLookup(lightRows: any[]) {
  const byOrder = new Map<string, any>();
  for (const row of lightRows) {
    const key = row.o_id;
    if (!key) continue;
    const cur = byOrder.get(key) ?? {
      o_id: key,
      so_id: row.so_id,
      shop_id: row.shop_id,
      shop_name: row.shop_name,
      platform: row.platform,
      order_status: row.order_status,
      order_created_at: row.order_created_at,
      pay_time: row.pay_time,
      pay_amount: 0,
      item_count: 0,
      qty: 0,
      has_refund: false,
      jst_modified: row.last_jst_modified,
      synced_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 90 * 86400_000).toISOString(),
    };
    cur.pay_amount += Number(row.pay_amount ?? 0);
    cur.qty += Number(row.qty ?? 0);
    cur.item_count += 1;
    cur.has_refund = cur.has_refund || !!row.has_refund;
    cur.jst_modified = row.last_jst_modified ?? cur.jst_modified;
    cur.order_created_at = cur.order_created_at ?? row.order_created_at;
    byOrder.set(key, cur);
  }
  const rows = Array.from(byOrder.values());
  if (rows.length === 0) return 0;
  const { error } = await admin.from("order_lookup_index").upsert(rows, { onConflict: "o_id" });
  if (error) throw error;
  return rows.length;
}

// Split/Merged/Delivering 属已核销状态：父单拆/合并后需求转入子单，发货中即将出库，
// 这些行不应留在催发货风险表里（历史僵尸行由 ops_chase_refresh_risk_meta 全表清理）。
const RISK_SETTLED_STATUSES = new Set(["Split", "Merged", "Delivering"]);

async function syncShippingRisks(orderRows: any[], lightRows: any[]) {
  const removeOIds = orderRows
    .filter((row) =>
      row.jst_o_id &&
      (row.internal_order_type !== "paid_pending_ship" || RISK_SETTLED_STATUSES.has(String(row.status ?? ""))))
    .map((row) => String(row.jst_o_id));
  let deleted = 0;
  for (const ids of chunk(Array.from(new Set(removeOIds)), 200)) {
    const { data, error } = await admin.from("shipping_risk_orders").delete().in("o_id", ids).select("id");
    if (error) throw error;
    deleted += data?.length ?? 0;
  }

  const riskRows = lightRows
    .filter((row) =>
      row.internal_order_type === "paid_pending_ship" &&
      !RISK_SETTLED_STATUSES.has(String(row.order_status ?? "")))
    .map((row) => {
      const latestShipTime = resolveShippingDeadline(row.plan_delivery_date, row.pay_time, row.order_created_at);
      const risk = riskFromDeadline(latestShipTime);
      return {
        item_unique_key: row.item_unique_key,
        o_id: row.o_id,
        so_id: row.so_id,
        shop_id: row.shop_id,
        shop_name: row.shop_name,
        platform: row.platform,
        order_status: row.order_status,
        order_created_at: row.order_created_at,
        pay_time: row.pay_time,
        jst_modified: row.last_jst_modified,
        latest_ship_time: latestShipTime,
        remaining_hours: risk.remainingHours,
        is_timeout: risk.isTimeout,
        risk_level: risk.riskLevel,
        // JST 订单明细的商家 SKU 编码在 sku_id 字段（sku_code 在历史数据中恒为空）
        sku_code: row.sku_id ?? row.sku_code,
        sku_name: row.sku_name,
        style_no: row.style_no,
        color: row.color,
        size: row.size,
        qty: row.qty,
        supplier_name: row.supplier_name,
        last_checked_at: new Date().toISOString(),
      };
    });
  if (riskRows.length > 0) {
    const { error } = await admin.from("shipping_risk_orders").upsert(riskRows, { onConflict: "item_unique_key" });
    if (error) throw error;
    // 回填 supplier_name（style_no → 商品档案，兜底最近采购单）+ 清理僵尸行；失败不阻断同步
    const { error: metaError } = await admin.rpc("ops_chase_refresh_risk_meta", {
      _item_keys: riskRows.map((row) => row.item_unique_key),
    });
    if (metaError) console.error("ops_chase_refresh_risk_meta failed:", metaError.message);
  }
  return { riskUpserted: riskRows.length, riskDeleted: deleted };
}

async function persistDerivedSalesState(orderRows: any[], sourceByOId: Map<string, any>, idByOId: Map<string, string>) {
  const lightRows: any[] = [];
  const legacyRows: any[] = [];
  for (const orderRow of orderRows) {
    const source = sourceByOId.get(orderRow.jst_o_id);
    if (!source) continue;
    const rows = buildSalesLightItemRowsForBatch(source, orderRow);
    lightRows.push(...rows);
    const salesOrderId = idByOId.get(orderRow.jst_o_id);
    if (salesOrderId && ENABLE_LEGACY_SALES_ORDER_ITEMS) {
      legacyRows.push(...buildSalesItemRowsForBatch(source, salesOrderId));
    }
  }

  const light = await upsertLightItemRows(lightRows);
  const legacy = await maybeUpsertLegacyItemRows(legacyRows);
  const summary = await refreshSalesSummaries(lightRows.map((row) => row.item_unique_key));
  const lookupUpserted = await upsertOrderLookup(lightRows);
  const risks = await syncShippingRisks(orderRows, lightRows);
  const failed = light.failed + legacy.failed;
  const errorDetail = [light.errorDetail, legacy.errorDetail].filter(Boolean).join(" | ");
  return {
    itemUpserted: light.upserted,
    legacyItemUpserted: legacy.upserted,
    failed,
    errorDetail,
    lookupUpserted,
    summary,
    ...risks,
  };
}

async function loadRefundKeySet(orders: any[]): Promise<Set<string>> {
  const oIds = uniqueStrings(orders.map((o) => str(o.o_id ?? o.oId)));
  const soIds = uniqueStrings(orders.map((o) => str(o.so_id)));
  const mark = new Set<string>();
  const queries: Array<PromiseLike<any>> = [];
  if (oIds.length) {
    queries.push(admin.from("jst_refund_orders").select("o_id,so_id").in("o_id", oIds).gt("refund_amount", 0));
    queries.push(admin.from("jst_aftersale_received_orders").select("o_id,so_id").in("o_id", oIds));
  }
  if (soIds.length) {
    queries.push(admin.from("jst_refund_orders").select("o_id,so_id").in("so_id", soIds).gt("refund_amount", 0));
    queries.push(admin.from("jst_aftersale_received_orders").select("o_id,so_id").in("so_id", soIds));
  }
  const results = await Promise.allSettled(queries);
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const row of (result.value?.data ?? []) as any[]) {
      const oId = str(row.o_id);
      const soId = str(row.so_id);
      if (oId) mark.add(`o:${oId}`);
      if (soId) mark.add(`so:${soId}`);
    }
  }
  return mark;
}

function hasRefundForOrder(o: any, refundKeys: Set<string>) {
  const oId = str(o.o_id ?? o.oId);
  const soId = str(o.so_id);
  return (!!oId && refundKeys.has(`o:${oId}`)) || (!!soId && refundKeys.has(`so:${soId}`));
}

async function upsertSalesOrdersBatch(orders: any[]) {
  if (orders.length === 0) return { mainUpserted: 0, itemUpserted: 0, failed: 0, errorDetail: "" };

  let failed = 0;
  let lastErr = "";
  const refundKeys = await loadRefundKeySet(orders);
  const sourceByOId = new Map<string, any>();
  const orderRows: any[] = [];

  for (const o of orders) {
    try {
      const row = buildSalesOrderRowForBatch(o, hasRefundForOrder(o, refundKeys));
      sourceByOId.set(row.jst_o_id, o);
      orderRows.push(row);
    } catch (e) {
      failed++;
      lastErr = String((e as Error).message ?? e);
    }
  }

  if (orderRows.length === 0) return { mainUpserted: 0, itemUpserted: 0, failed, errorDetail: lastErr };

  const { data: upsertedOrders, error: orderErr } = await admin
    .from("jst_sales_orders")
    .upsert(orderRows, { onConflict: "jst_o_id" })
    .select("id,jst_o_id");

  if (orderErr) {
    let mainUpserted = 0;
    let itemUpserted = 0;
    for (const o of orders) {
      try {
        const res = await upsertSalesOrder(o);
        mainUpserted++;
        itemUpserted += res.itemsUpserted;
      } catch (e) {
        failed++;
        lastErr = String((e as Error).message ?? e);
      }
    }
    return { mainUpserted, itemUpserted, failed, errorDetail: lastErr };
  }

  const idByOId = new Map<string, string>();
  for (const row of upsertedOrders ?? []) idByOId.set(String(row.jst_o_id), String(row.id));

  const missingIds = orderRows.filter((row) => !idByOId.get(row.jst_o_id)).map((row) => row.jst_o_id);
  if (missingIds.length > 0) {
    failed += missingIds.length;
    lastErr = `missing upserted id for o_id=${missingIds.slice(0, 5).join(",")}`;
  }

  try {
    const derived = await persistDerivedSalesState(orderRows, sourceByOId, idByOId);
    failed += derived.failed;
    lastErr = derived.errorDetail || lastErr;
    return { mainUpserted: orderRows.length, itemUpserted: derived.itemUpserted, failed, errorDetail: lastErr };
  } catch (e) {
    failed++;
    lastErr = String((e as Error).message ?? e);
    return { mainUpserted: orderRows.length, itemUpserted: 0, failed, errorDetail: lastErr };
  }
}

type SalesParamMode = "start_time" | "modified_begin";

function buildSalesRequestBody(mode: SalesParamMode, pageIndex: number, pageSize: number, from: Date, to: Date) {
  const base: Record<string, unknown> = {
    page_index: Number(pageIndex),
    page_size: Number(pageSize),
  };
  if (mode === "start_time") {
    return { ...base, start_time: fmtBJ(from), end_time: fmtBJ(to), date_type: "modified" };
  }
  return { ...base, modified_begin: fmtBJ(from), modified_end: fmtBJ(to) };
}

async function callSalesOrders(pageIndex: number, pageSize: number, from: Date, to: Date) {
  let lastErr: any = null;
  for (const mode of ["start_time", "modified_begin"] as SalesParamMode[]) {
    const reqBody = buildSalesRequestBody(mode, pageIndex, pageSize, from, to);
    console.log(`[jst-sync-sales-orders] request orders/single/query`, JSON.stringify(reqBody));
    const t0 = Date.now();
    try {
      const data = await callOpenweb(METHOD_PATH, reqBody, { timeoutMs: 25_000 });
      return { data, reqBody, durationMs: Date.now() - t0 };
    } catch (e: any) {
      e.requestBody = reqBody;
      e.durationMs = e.durationMs ?? (Date.now() - t0);
      lastErr = e;
      const code = String(e?.code ?? "");
      const msg = String(e?.apiMsg ?? e?.message ?? "");
      const isParamError = code === "130" || /param|date_type|start_time|end_time/i.test(msg);
      if (!(mode === "start_time" && isParamError)) throw e;
    }
  }
  throw lastErr ?? new Error("orders/single/query failed");
}

async function processSalesPage(args: ProcessPageArgs): Promise<PageResult> {
  const { job, windowFrom, windowTo, pageIndex, pageSize } = args;
  await sleep(RATE_DELAY_MS);
  if (pageIndex > MAX_PAGE_NO) throw new Error(`分页超过上限 ${MAX_PAGE_NO}`);
  const meta = (job?.metadata && typeof job.metadata === "object") ? job.metadata : {};
  if (job?.id && pageIndex > 1 && meta.sales_order_request_version !== SALES_REQUEST_VERSION) {
    throw new Error("销售订单同步请求参数已升级，请取消/重新启动该 sales_orders 任务，避免从旧分页继续造成漏单");
  }
  meta.sales_order_request_version = SALES_REQUEST_VERSION;
  const pageStart = Date.now();
  const { data, reqBody } = await callSalesOrders(pageIndex, pageSize, windowFrom, windowTo);
  const list = pickList(data);
  const hasNext = computeHasNext(data, list.length, pageSize, pageIndex);
  const sk = await loadSkippedShops();
  const syncRows: any[] = [];
  let skippedDisabled = 0, skippedSyncOff = 0;
  const skippedShopIds = new Set<string>();
  for (const r of list) {
    const sid = shopIdOf(r);
    const skip = shouldSkipShop(sid, sk);
    if (skip === "disabled") { skippedDisabled++; skippedShopIds.add(sid); continue; }
    if (skip === "sync_off") { skippedSyncOff++; skippedShopIds.add(sid); continue; }
    syncRows.push(r);
  }
  const batch = await upsertSalesOrdersBatch(syncRows);
  const skipNote = formatSkipNote(skippedDisabled, skippedSyncOff, skippedShopIds.size);
  return {
    apiCount: list.length,
    mainUpserted: batch.mainUpserted,
    itemUpserted: batch.itemUpserted,
    failed: batch.failed,
    hasNext,
    errorDetail: (batch.errorDetail || skipNote) ? `${batch.errorDetail}${skipNote}` : undefined,
    requestBody: reqBody,
    responseCode: "0",
    responseMsg: "success",
    durationMs: Date.now() - pageStart,
  };
}

// ===== legacy 一次性同步 (兼容 / cron) =====
async function runLegacySync(fromIso: string, toIso: string, logId: string) {
  const winFrom = new Date(fromIso), winTo = new Date(toIso);
  let page = 1, apiCount = 0, orders = 0, items = 0, failed = 0;
  try {
    while (true) {
      if (page > MAX_PAGE_NO) throw new Error(`分页超过上限 ${MAX_PAGE_NO}`);
      const res = await processSalesPage({
        job: { page_size: PAGE_SIZE } as any,
        windowIndex: 0, windowFrom: winFrom, windowTo: winTo, pageIndex: page, pageSize: PAGE_SIZE,
      });
      apiCount++; orders += res.mainUpserted; items += res.itemUpserted; failed += res.failed;
      await admin.from("jst_sync_logs").update({
        fetched_orders_count: orders, fetched_items_count: items,
        message: `第 ${page} 页 已同步 ${orders} 订单 / ${items} 明细 · 失败 ${failed} · has_next=${res.hasNext}`,
        heartbeat_at: new Date().toISOString(),
      }).eq("id", logId);
      if (!res.hasNext || res.apiCount === 0) break;
      page++;
    }
    const status = failed === 0 ? "success" : (orders === 0 ? "failed" : "partial_failed");
    await admin.from("jst_sync_logs").update({
      status, ended_at: new Date().toISOString(),
      fetched_orders_count: orders, fetched_items_count: items,
      message: `销售订单同步完成 · API ${apiCount} 次 · ${orders} 单 / ${items} 明细 · 失败 ${failed}`,
    }).eq("id", logId);
  } catch (e: any) {
    await admin.from("jst_sync_logs").update({
      status: "failed", ended_at: new Date().toISOString(),
      fetched_orders_count: orders, fetched_items_count: items,
      message: `销售订单同步失败 page=${page}`,
      error_detail: String(e?.message ?? e).slice(0, 1500),
    }).eq("id", logId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const caller = await resolveCaller(req);
    const cronSecret = req.headers.get("x-cron-secret") ?? "";
    const okCron = !!Deno.env.get("JST_SYNC_CRON_SECRET") && cronSecret === Deno.env.get("JST_SYNC_CRON_SECRET");
    const internalTick = req.headers.get("x-internal-tick") ?? "";
    const okInternal = !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") && internalTick === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!okCron && !okInternal && !caller.isAdmin) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action: string = body.action ?? "";

    // 断点续跑 job 协议
    const jobResp = await handleJobActions({
      action, body, syncType: SYNC_TYPE, callerUid: caller.uid,
      processPage: processSalesPage,
      startActionName: "start_sales_job",
      tickActionName: "tick_sales_job",
      cancelActionName: "cancel_sales_job",
      functionName: "jst-sync-sales-orders",
      // 订单量大：每个窗口最多 1 天，避免单窗口分页过多
      config: { pageSize: PAGE_SIZE, maxWindowDays: 1 / 24, maxPagesPerRun: 2, timeBudgetSeconds: 35, proactiveSplitAfterPage: 0 },
      resolveWindowFromBody: (b) => resolveWindow(b),
    });
    if (jobResp) {
      const text = await jobResp.text();
      return new Response(text, { status: jobResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 兼容：一次性后台同步
    const { from, to } = resolveWindow(body);
    const STALE_MIN = 10;
    const staleCutoff = new Date(Date.now() - STALE_MIN * 60_000).toISOString();
    await admin.from("jst_sync_logs").update({
      status: "timeout_partial", ended_at: new Date().toISOString(),
      error_detail: `timeout: running > ${STALE_MIN} minutes`,
    }).eq("sync_type", SYNC_TYPE).eq("status", "running").lt("started_at", staleCutoff);

    const { data: aliveRunning } = await admin.from("jst_sync_logs")
      .select("id,started_at").eq("sync_type", SYNC_TYPE).eq("status", "running")
      .gte("started_at", staleCutoff).order("started_at", { ascending: false }).limit(1);
    if (aliveRunning && aliveRunning.length > 0) {
      return new Response(JSON.stringify({
        ok: false, error: "已有同步任务正在运行，请稍后再试",
        running_log_id: aliveRunning[0].id, running_started_at: aliveRunning[0].started_at,
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: log, error: logErr } = await admin.from("jst_sync_logs").insert({
      sync_type: SYNC_TYPE, status: "running",
      cursor_from: from.toISOString(), cursor_to: to.toISOString(),
      message: `开始同步销售订单 ${fmtBJ(from)} → ${fmtBJ(to)}`,
    }).select("id").single();
    if (logErr) throw logErr;
    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil(runLegacySync(from.toISOString(), to.toISOString(), log.id));
    return new Response(JSON.stringify({
      ok: true, background: true, log_id: log.id,
      cursor_from: from.toISOString(), cursor_to: to.toISOString(), message: "同步已在后台启动",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
