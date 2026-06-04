// Edge Function: 聚水潭销售订单同步（断点续跑 + 进度条）
// API: /open/orders/single/query  (date_type=modified)
// 写入 jst_sales_orders + jst_sales_order_items
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

function pickItems(o: any): any[] {
  return pickItemsArray(o);
}

async function upsertSalesOrder(o: any): Promise<{ orderId: string; itemsUpserted: number }> {
  const jstOId = str(o.o_id ?? o.oId);
  if (!jstOId) throw new Error("missing o_id");

  const safeRaw = sanitize(o);
  const orderRow = {
    jst_o_id: jstOId,
    so_id: str(o.so_id),
    shop_id: str(o.shop_id),
    shop_name: str(o.shop_name),
    status: str(o.status),
    order_type: str(o.order_type ?? o.type),
    created_time: parseJstBeijingDateTime(o.created ?? o.create_time),
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
    raw_data: safeRaw,
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

  const itemList = pickItems(o);
  let itemsUpserted = 0;
  for (let i = 0; i < itemList.length; i++) {
    const it = itemList[i];
    const jstItemId = str(it.oi_id ?? it.item_id ?? it.id);
    const skuId = str(it.sku_id);
    const itemUniqueKey = `${jstOId}|${jstItemId ?? ""}|${skuId ?? ""}|${i}`;
    const itemRow = {
      sales_order_id: up.id,
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
      item_unique_key: itemUniqueKey,
      raw_item_data: sanitize(it),
      synced_at: new Date().toISOString(),
    };
    const { error: itErr } = await admin
      .from("jst_sales_order_items").upsert(itemRow, { onConflict: "item_unique_key" });
    if (itErr) throw itErr;
    itemsUpserted++;
  }
  return { orderId: up.id as string, itemsUpserted };
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

  const orderRow = {
    jst_o_id: jstOId,
    so_id: str(o.so_id),
    shop_id: str(o.shop_id),
    shop_name: str(o.shop_name),
    status: str(o.status),
    order_type: str(o.order_type ?? o.type),
    created_time: parseJstBeijingDateTime(o.created ?? o.create_time),
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
    raw_data: sanitize(o),
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
      raw_item_data: sanitize(it),
      synced_at: new Date().toISOString(),
    });
  }
  return rows;
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

  const itemRows: any[] = [];
  for (const orderRow of orderRows) {
    const salesOrderId = idByOId.get(orderRow.jst_o_id);
    const source = sourceByOId.get(orderRow.jst_o_id);
    if (!salesOrderId || !source) {
      failed++;
      lastErr = `missing upserted id for o_id=${orderRow.jst_o_id}`;
      continue;
    }
    itemRows.push(...buildSalesItemRowsForBatch(source, salesOrderId));
  }

  let itemUpserted = 0;
  for (const itemChunk of chunk(itemRows, 500)) {
    const { error: itemErr } = await admin
      .from("jst_sales_order_items")
      .upsert(itemChunk, { onConflict: "item_unique_key" });
    if (!itemErr) {
      itemUpserted += itemChunk.length;
      continue;
    }
    for (const itemRow of itemChunk) {
      const { error } = await admin
        .from("jst_sales_order_items")
        .upsert(itemRow, { onConflict: "item_unique_key" });
      if (error) {
        failed++;
        lastErr = String(error.message ?? error);
      } else {
        itemUpserted++;
      }
    }
  }

  return { mainUpserted: orderRows.length, itemUpserted, failed, errorDetail: lastErr };
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
