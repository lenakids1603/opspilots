// Edge Function: 聚水潭售后 - 销售退仓 / 实际收货同步 (断点续跑 + 进度条)
// API: /open/aftersale/received/query
// 写入 jst_aftersale_received_orders + jst_aftersale_received_items
// Actions: start_aftersale_job / tick_aftersale_job / cancel_aftersale_job
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  admin, callOpenweb, fmtBJ, parseJstBeijingDateTime, parseHasNext,
  resolveCaller, resolveWindow, sleep, RATE_DELAY_MS, MAX_PAGE_NO,
} from "../_shared/jst-client.ts";
import { handleJobActions, PageResult, ProcessPageArgs } from "../_shared/jst-sync-job.ts";

const SYNC_TYPE = "aftersale_received";
const METHOD_PATH = "aftersale/received/query";
const PAGE_SIZE = 50;

async function upsertReceived(r: any): Promise<number> {
  const asId = String(r.as_id ?? r.asId ?? "");
  if (!asId) throw new Error("missing as_id");
  const row = {
    as_id: asId, outer_as_id: r.outer_as_id ?? null,
    o_id: r.o_id ?? null, so_id: r.so_id ?? null,
    shop_id: r.shop_id != null ? String(r.shop_id) : null, shop_name: r.shop_name ?? null,
    warehouse: r.warehouse ?? null,
    wh_id: r.wh_id != null ? String(r.wh_id) : null,
    wms_co_id: r.wms_co_id != null ? String(r.wms_co_id) : null,
    logistics_company: r.logistics_company ?? null, l_id: r.l_id ?? null,
    received_date: parseJstBeijingDateTime(r.received_date ?? r.io_date ?? r.in_date),
    modified_at_jst: parseJstBeijingDateTime(r.modified),
    status: r.status ?? null,
    raw_data: r, synced_at: new Date().toISOString(),
  };
  const { data: up, error } = await admin.from("jst_aftersale_received_orders")
    .upsert(row, { onConflict: "as_id" }).select("id").single();
  if (error) throw error;
  let items = 0;
  for (const it of (r.items ?? [])) {
    const skuId = it.sku_id != null ? String(it.sku_id) : null;
    const itemRow = {
      received_order_id: up.id, as_id: asId, sku_id: skuId,
      name: it.name ?? null, properties_value: it.properties_value ?? null,
      pic: it.pic ?? null, qty: Number(it.qty ?? 0),
      r_qty: Number(it.r_qty ?? 0), amount: Number(it.amount ?? 0),
      batch_no: it.batch_no ?? "",
      supplier_id: it.supplier_id != null ? String(it.supplier_id) : null,
      supplier_name: it.supplier_name ?? null,
      raw_data: it, synced_at: new Date().toISOString(),
    };
    const { error: itErr } = await admin.from("jst_aftersale_received_items")
      .upsert(itemRow, { onConflict: "as_id,sku_id,batch_no" });
    if (itErr) throw itErr;
    items++;
  }
  return items;
}

async function processAftersalePage(args: ProcessPageArgs): Promise<PageResult> {
  const { windowFrom, windowTo, pageIndex, pageSize } = args;
  if (pageIndex > MAX_PAGE_NO) throw new Error(`分页超过上限 ${MAX_PAGE_NO}`);
  await sleep(RATE_DELAY_MS);
  const data = await callOpenweb(METHOD_PATH, {
    page_index: pageIndex, page_size: pageSize,
    modified_begin: fmtBJ(windowFrom), modified_end: fmtBJ(windowTo),
  });
  const list: any[] = data.datas ?? data.list ?? data.orders ?? [];
  const hasNext = parseHasNext(data.has_next ?? data.hasNext, list.length === pageSize);
  let mainUpserted = 0, itemUpserted = 0, failed = 0, lastErr = "";
  const oIds: string[] = [], soIds: string[] = [];
  for (const r of list) {
    try {
      itemUpserted += await upsertReceived(r); mainUpserted++;
      if (r.o_id) oIds.push(String(r.o_id));
      if (r.so_id) soIds.push(String(r.so_id));
    }
    catch (we) { failed++; lastErr = String((we as Error).message ?? we); }
  }
  if (oIds.length || soIds.length) {
    try {
      await admin.rpc("reclassify_jst_sales_orders_by_keys", {
        _o_ids: oIds.length ? Array.from(new Set(oIds)) : null,
        _so_ids: soIds.length ? Array.from(new Set(soIds)) : null,
      });
    } catch (_e) { /* ignore */ }
  }
  return { apiCount: list.length, mainUpserted, itemUpserted, failed, hasNext, errorDetail: lastErr };
}

async function runLegacySync(fromIso: string, toIso: string, logId: string) {
  const winFrom = new Date(fromIso); const winTo = new Date(toIso);
  let page = 1, orders = 0, items = 0, failed = 0;
  try {
    while (true) {
      const res = await processAftersalePage({
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
      message: `销售退仓同步完成 · ${orders} 单 / ${items} 明细 · 失败 ${failed}`,
    }).eq("id", logId);
  } catch (e: any) {
    await admin.from("jst_sync_logs").update({
      status: "failed", ended_at: new Date().toISOString(),
      fetched_orders_count: orders, fetched_items_count: items,
      message: `销售退仓同步失败 page=${page}`,
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
      processPage: processAftersalePage,
      startActionName: "start_aftersale_job",
      tickActionName: "tick_aftersale_job",
      cancelActionName: "cancel_aftersale_job",
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
      message: `开始同步销售退仓 ${fmtBJ(from)} → ${fmtBJ(to)}`,
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
