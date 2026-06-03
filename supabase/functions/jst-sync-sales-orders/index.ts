// Edge Function: 聚水潭销售订单同步（断点续跑 + 进度条）
// API: /open/orders/single/query  (date_type=modified)
// 写入 jst_sales_orders + jst_sales_order_items
// Actions:
//   - start_sales_job / tick_sales_job / cancel_sales_job  (推荐, 走 jst_sync_jobs)
//   - (无 action) 兼容旧的一次性后台同步, 可用于 cron
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  admin, callOpenweb, fmtBJ, parseJstBeijingDateTime, parseHasNext,
  resolveCaller, resolveWindow, sleep, RATE_DELAY_MS, MAX_PAGE_NO,
} from "../_shared/jst-client.ts";
import { handleJobActions, PageResult, ProcessPageArgs } from "../_shared/jst-sync-job.ts";
import { classifySalesOrder } from "../_shared/orderClassify.ts";

const SYNC_TYPE = "sales_orders";
const METHOD_PATH = "orders/single/query";
const PAGE_SIZE = 100;

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

const ITEM_FIELDS = ["items", "orderitems", "order_items", "item_list", "details", "skus"];
function pickItems(o: any): any[] {
  for (const f of ITEM_FIELDS) {
    const v = o?.[f];
    if (Array.isArray(v) && v.length > 0) return v;
  }
  return [];
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

async function processSalesPage(args: ProcessPageArgs): Promise<PageResult> {
  const { windowFrom, windowTo, pageIndex, pageSize } = args;
  await sleep(RATE_DELAY_MS);
  if (pageIndex > MAX_PAGE_NO) throw new Error(`分页超过上限 ${MAX_PAGE_NO}`);
  // 聚水潭 orders/single/query 使用 modified_begin / modified_end 作为时间窗
  // 不支持 date_type 参数；时间格式为北京时间字符串 yyyy-MM-dd HH:mm:ss
  const reqBody = {
    page_index: Number(pageIndex),
    page_size: Number(pageSize),
    modified_begin: fmtBJ(windowFrom),
    modified_end: fmtBJ(windowTo),
  };
  console.log(`[jst-sync-sales-orders] request orders/single/query`, JSON.stringify(reqBody));
  const data = await callOpenweb(METHOD_PATH, reqBody);
  const list: any[] = data.orders ?? data.datas ?? data.list ?? [];
  const hasNext = parseHasNext(data.has_next ?? data.hasNext, list.length === pageSize);
  let mainUpserted = 0, itemUpserted = 0, failed = 0;
  let lastErr = "";
  for (const r of list) {
    try {
      const res = await upsertSalesOrder(r);
      mainUpserted++; itemUpserted += res.itemsUpserted;
    } catch (we) {
      failed++; lastErr = String((we as Error).message ?? we);
    }
  }
  return { apiCount: list.length, mainUpserted, itemUpserted, failed, hasNext, errorDetail: lastErr };
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
    if (!okCron && !caller.isAdmin) {
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
      // 订单量大：每个窗口最多 1 天，避免单窗口分页过多
      config: { pageSize: PAGE_SIZE, maxWindowDays: 1, maxPagesPerRun: 3, timeBudgetSeconds: 45 },
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
