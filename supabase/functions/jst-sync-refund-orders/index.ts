// Edge Function: 聚水潭售后 - 退货退款单同步 (断点续跑 + 进度条)
// API: /open/refund/single/query
// 写入 jst_refund_orders + jst_refund_order_items
// Actions: start_refund_job / tick_refund_job / cancel_refund_job
// (无 action) 旧的一次性同步, 保留兼容
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  admin, callOpenweb, fmtBJ, parseJstBeijingDateTime, parseHasNext,
  resolveCaller, resolveWindow, sleep, RATE_DELAY_MS, MAX_PAGE_NO,
} from "../_shared/jst-client.ts";
import { handleJobActions, PageResult, ProcessPageArgs } from "../_shared/jst-sync-job.ts";

const SYNC_TYPE = "refund_orders";
const METHOD_PATH = "refund/single/query";
const PAGE_SIZE = 50;

async function upsertRefund(r: any): Promise<number> {
  const asId = String(r.as_id ?? r.asId ?? "");
  if (!asId) throw new Error("missing as_id");
  const row = {
    as_id: asId,
    outer_as_id: r.outer_as_id ?? r.outerAsId ?? null,
    o_id: r.o_id ?? r.oId ?? null,
    so_id: r.so_id ?? r.soId ?? null,
    shop_id: r.shop_id != null ? String(r.shop_id) : null,
    shop_name: r.shop_name ?? null,
    type: r.type ?? null, status: r.status ?? null,
    shop_status: r.shop_status ?? null, good_status: r.good_status ?? null,
    refund_amount: Number(r.refund ?? r.refund_amount ?? 0),
    payment_amount: Number(r.payment ?? r.payment_amount ?? 0),
    freight: Number(r.freight ?? 0),
    question_type: r.question_type ?? null,
    question_reason: r.question_desc ?? r.question_reason ?? null,
    remark: r.remark ?? null, warehouse: r.warehouse ?? null,
    logistics_company: r.logistics_company ?? null, l_id: r.l_id ?? null,
    as_date: parseJstBeijingDateTime(r.as_date),
    created_at_jst: parseJstBeijingDateTime(r.created),
    modified_at_jst: parseJstBeijingDateTime(r.modified),
    confirm_date: parseJstBeijingDateTime(r.confirm_date),
    raw_data: r, synced_at: new Date().toISOString(),
  };
  const { data: up, error } = await admin.from("jst_refund_orders")
    .upsert(row, { onConflict: "as_id" }).select("id").single();
  if (error) throw error;
  let items = 0;
  for (const it of (r.items ?? [])) {
    const asiId = it.asi_id != null ? String(it.asi_id) : null;
    const skuId = it.sku_id != null ? String(it.sku_id) : null;
    const outerOiId = it.outer_oi_id != null ? String(it.outer_oi_id) : null;
    const qty = Number(it.qty ?? 0);
    const price = Number(it.price ?? 0);
    const itemType = it.type ?? null;
    const itemUniqueKey = [asId, asiId ?? "", skuId ?? "", outerOiId ?? "", itemType ?? ""].join("|");
    const itemRow = {
      refund_order_id: up.id, as_id: asId, asi_id: asiId, sku_id: skuId,
      name: it.name ?? null, properties_value: it.properties_value ?? null,
      pic: it.pic ?? null, qty, r_qty: Number(it.r_qty ?? 0), price,
      amount: Number(it.amount ?? qty * price),
      type: itemType, outer_oi_id: outerOiId, sku_type: it.sku_type ?? null,
      supplier_id: it.supplier_id != null ? String(it.supplier_id) : null,
      supplier_name: it.supplier_name ?? null, batch_no: it.batch_no ?? null,
      item_unique_key: itemUniqueKey, raw_data: it, synced_at: new Date().toISOString(),
    };
    const { error: itErr } = await admin.from("jst_refund_order_items")
      .upsert(itemRow, { onConflict: "item_unique_key" });
    if (itErr) throw itErr;
    items++;
  }
  return items;
}

async function processRefundPage(args: ProcessPageArgs): Promise<PageResult> {
  const { windowFrom, windowTo, pageIndex, pageSize } = args;
  if (pageIndex > MAX_PAGE_NO) throw new Error(`分页超过上限 ${MAX_PAGE_NO}`);
  await sleep(RATE_DELAY_MS);
  const data = await callOpenweb(METHOD_PATH, {
    page_index: pageIndex, page_size: pageSize,
    modified_begin: fmtBJ(windowFrom), modified_end: fmtBJ(windowTo),
  });
  const list: any[] = data.datas ?? data.list ?? data.refunds ?? data.orders ?? [];
  const hasNext = parseHasNext(data.has_next ?? data.hasNext, list.length === pageSize);
  let mainUpserted = 0, itemUpserted = 0, failed = 0, lastErr = "";
  for (const r of list) {
    try { itemUpserted += await upsertRefund(r); mainUpserted++; }
    catch (we) { failed++; lastErr = String((we as Error).message ?? we); }
  }
  return { apiCount: list.length, mainUpserted, itemUpserted, failed, hasNext, errorDetail: lastErr };
}

async function runLegacySync(fromIso: string, toIso: string, logId: string) {
  const winFrom = new Date(fromIso); const winTo = new Date(toIso);
  let page = 1, orders = 0, items = 0, failed = 0;
  try {
    while (true) {
      const res = await processRefundPage({
        job: {} as any, windowIndex: 0, windowFrom: winFrom, windowTo: winTo,
        pageIndex: page, pageSize: PAGE_SIZE,
      });
      orders += res.mainUpserted; items += res.itemUpserted; failed += res.failed;
      await admin.from("jst_sync_logs").update({
        fetched_orders_count: orders, fetched_items_count: items,
        message: `第 ${page} 页 累计 ${orders} 单 / ${items} 明细 · has_next=${res.hasNext}`,
        heartbeat_at: new Date().toISOString(),
      }).eq("id", logId);
      if (!res.hasNext || res.apiCount === 0) break;
      page++;
    }
    const status = failed === 0 ? "success" : (orders === 0 ? "failed" : "partial_failed");
    await admin.from("jst_sync_logs").update({
      status, ended_at: new Date().toISOString(),
      fetched_orders_count: orders, fetched_items_count: items,
      message: `退货退款单同步完成 · ${orders} 单 / ${items} 明细 · 失败 ${failed}`,
    }).eq("id", logId);
  } catch (e: any) {
    await admin.from("jst_sync_logs").update({
      status: "failed", ended_at: new Date().toISOString(),
      fetched_orders_count: orders, fetched_items_count: items,
      message: `退货退款单同步失败 page=${page}`,
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

    const jobResp = await handleJobActions({
      action, body, syncType: SYNC_TYPE, callerUid: caller.uid,
      processPage: processRefundPage,
      startActionName: "start_refund_job",
      tickActionName: "tick_refund_job",
      cancelActionName: "cancel_refund_job",
      config: { pageSize: PAGE_SIZE, maxWindowDays: 3, maxPagesPerRun: 3, timeBudgetSeconds: 45 },
      resolveWindowFromBody: (b) => resolveWindow(b),
    });
    if (jobResp) {
      const text = await jobResp.text();
      return new Response(text, { status: jobResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { from, to } = resolveWindow(body);
    const { data: log, error: logErr } = await admin.from("jst_sync_logs").insert({
      sync_type: SYNC_TYPE, status: "running",
      cursor_from: from.toISOString(), cursor_to: to.toISOString(),
      message: `开始同步退货退款单 ${fmtBJ(from)} → ${fmtBJ(to)}`,
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
