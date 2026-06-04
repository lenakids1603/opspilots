// Edge Function: 聚水潭售后 - 销售退仓 / 实际收货同步 (断点续跑 + 进度条)
// API: /open/aftersale/received/query
// 写入 jst_aftersale_received_orders + jst_aftersale_received_items
// Actions: start_aftersale_job / tick_aftersale_job / cancel_aftersale_job / debug_aftersale_received_params
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  admin, callOpenweb, fmtBJ, parseJstBeijingDateTime, computeHasNext, pickList, pickItemsArray,
  resolveCaller, resolveWindow, sleep, RATE_DELAY_MS, MAX_PAGE_NO,
} from "../_shared/jst-client.ts";
import { handleJobActions, PageResult, ProcessPageArgs } from "../_shared/jst-sync-job.ts";
import { loadSkippedShops, shopIdOf, shouldSkipShop, formatSkipNote } from "../_shared/shop-filter.ts";

const SYNC_TYPE = "aftersale_received";
const METHOD_PATH = "aftersale/received/query";
const PAGE_SIZE = 50;

function buildItemUniqueKey(uniqueKey: string, it: any, _rModified: any) {
  const lineKey =
    it.ioi_id ??
    it.asi_id ??
    it.outer_oi_id ??
    [it.sku_id ?? "", it.batch_no ?? "", it.properties_value ?? ""].join(":");
  return [uniqueKey, String(lineKey)].join("|");
}

async function upsertReceived(r: any): Promise<number> {
  const asId = r.as_id ?? r.asId ?? null;
  const ioId = r.io_id ?? r.ioId ?? null;
  const outerAsId = r.outer_as_id ?? r.outerAsId ?? null;
  const uniqueKey = String(ioId ?? asId ?? outerAsId ?? "").trim();
  if (!uniqueKey) {
    throw new Error("missing aftersale received unique id: no io_id/as_id");
  }

  const row: Record<string, unknown> = {
    received_unique_key: uniqueKey,
    as_id: asId != null ? String(asId) : null,
    io_id: ioId != null ? String(ioId) : null,
    outer_as_id: outerAsId,
    o_id: r.o_id ?? null,
    so_id: r.so_id ?? null,
    shop_id: r.shop_id != null ? String(r.shop_id) : null,
    shop_name: r.shop_name ?? null,
    warehouse: r.warehouse ?? null,
    wh_id: r.wh_id != null ? String(r.wh_id) : null,
    wms_co_id: r.wms_co_id != null ? String(r.wms_co_id) : null,
    logistics_company: r.logistics_company ?? null,
    l_id: r.l_id ?? null,
    received_date: parseJstBeijingDateTime(r.received_date ?? r.io_date ?? r.in_date),
    modified_at_jst: parseJstBeijingDateTime(r.modified),
    status: r.status ?? null,
    raw_data: r,
    synced_at: new Date().toISOString(),
  };
  const { data: up, error } = await admin
    .from("jst_aftersale_received_orders")
    .upsert(row, { onConflict: "received_unique_key" })
    .select("id")
    .single();
  if (error) throw error;

  // Items: try子数组；若无且行本身像一条 item，则把 r 自己当成 item
  const subItems = pickItemsArray(r, ["received_items"]);
  const effectiveItems =
    subItems.length > 0
      ? subItems
      : (r.sku_id != null || r.qty != null ? [r] : []);

  let items = 0;
  for (const it of effectiveItems) {
    const skuId = it.sku_id != null ? String(it.sku_id) : null;
    const itemKey = buildItemUniqueKey(uniqueKey, it, r.modified);
    const itemRow = {
      received_order_id: up.id,
      as_id: asId != null ? String(asId) : null,
      sku_id: skuId,
      name: it.name ?? null,
      properties_value: it.properties_value ?? null,
      pic: it.pic ?? null,
      qty: Number(it.qty ?? 0),
      r_qty: Number(it.r_qty ?? 0),
      amount: Number(it.amount ?? 0),
      batch_no: it.batch_no ?? "",
      supplier_id: it.supplier_id != null ? String(it.supplier_id) : null,
      supplier_name: it.supplier_name ?? null,
      item_unique_key: itemKey,
      raw_data: it,
      synced_at: new Date().toISOString(),
    };
    const { error: itErr } = await admin
      .from("jst_aftersale_received_items")
      .upsert(itemRow, { onConflict: "item_unique_key" });
    if (itErr) throw itErr;
    items++;
  }
  return items;
}

function buildRequestBody(windowFrom: Date, windowTo: Date, pageIndex: number, pageSize: number, withDateType: boolean) {
  const body: Record<string, string> = {
    page_index: String(pageIndex),
    page_size: String(Math.min(Number(pageSize) || 50, 50)),
    modified_begin: fmtBJ(windowFrom),
    modified_end: fmtBJ(windowTo),
  };
  if (withDateType) body.date_type = "1";
  return body;
}

async function callAftersale(windowFrom: Date, windowTo: Date, pageIndex: number, pageSize: number) {
  let reqBody = buildRequestBody(windowFrom, windowTo, pageIndex, pageSize, true);
  const t0 = Date.now();
  try {
    const data = await callOpenweb(METHOD_PATH, reqBody, { timeoutMs: 30_000 });
    return { data, reqBody, durationMs: Date.now() - t0 };
  } catch (e: any) {
    // code=130: 参数错误 → 去掉 date_type 重试一次
    if (String(e?.code ?? "") === "130") {
      reqBody = buildRequestBody(windowFrom, windowTo, pageIndex, pageSize, false);
      const t1 = Date.now();
      try {
        const data = await callOpenweb(METHOD_PATH, reqBody, { timeoutMs: 30_000 });
        return { data, reqBody, durationMs: Date.now() - t1 };
      } catch (e2: any) {
        e2.requestBody = reqBody;
        e2.apiPath = METHOD_PATH;
        e2.durationMs = Date.now() - t1;
        e2.responseCode = e2.responseCode ?? (e2.code != null ? String(e2.code) : null);
        e2.responseMsg = e2.responseMsg ?? e2.apiMsg ?? null;
        throw e2;
      }
    }
    e.requestBody = reqBody;
    e.apiPath = METHOD_PATH;
    e.durationMs = Date.now() - t0;
    e.responseCode = e.responseCode ?? (e.code != null ? String(e.code) : null);
    e.responseMsg = e.responseMsg ?? e.apiMsg ?? null;
    throw e;
  }
}

async function processAftersalePage(args: ProcessPageArgs): Promise<PageResult> {
  const { windowFrom, windowTo, pageIndex, pageSize } = args;
  if (pageIndex > MAX_PAGE_NO) throw new Error(`分页超过上限 ${MAX_PAGE_NO}`);
  await sleep(RATE_DELAY_MS);
  const { data, reqBody, durationMs } = await callAftersale(windowFrom, windowTo, pageIndex, pageSize);
  const list = pickList(data, ["receiveds", "after_sales", "aftersales"]);
  const hasNext = computeHasNext(data, list.length, pageSize, pageIndex);
  let mainUpserted = 0, itemUpserted = 0, failed = 0, lastErr = "";
  const oIds: string[] = [], soIds: string[] = [];
  for (const r of list) {
    try {
      itemUpserted += await upsertReceived(r);
      mainUpserted++;
      if (r.o_id) oIds.push(String(r.o_id));
      if (r.so_id) soIds.push(String(r.so_id));
    } catch (we) {
      failed++;
      lastErr = String((we as Error).message ?? we);
    }
  }
  if (oIds.length || soIds.length) {
    try {
      await admin.rpc("reclassify_jst_sales_orders_by_keys", {
        _o_ids: oIds.length ? Array.from(new Set(oIds)) : null,
        _so_ids: soIds.length ? Array.from(new Set(soIds)) : null,
      });
    } catch (_e) { /* ignore */ }
  }
  return {
    apiCount: list.length,
    mainUpserted,
    itemUpserted,
    failed,
    hasNext,
    errorDetail: lastErr || undefined,
    requestBody: reqBody,
    durationMs,
    responseCode: (data as any)?.code != null ? String((data as any).code) : null,
    responseMsg: (data as any)?.msg ?? null,
  };
}

async function runLegacySync(fromIso: string, toIso: string, logId: string) {
  const winFrom = new Date(fromIso);
  const winTo = new Date(toIso);
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

async function tryCall(reqBody: any) {
  const t0 = Date.now();
  try {
    const data = await callOpenweb(METHOD_PATH, reqBody, { timeoutMs: 30_000 });
    const list = pickList(data, ["receiveds", "after_sales", "aftersales"]);
    const first = list[0] ?? null;
    const subItems = first ? pickItemsArray(first, ["received_items"]) : [];
    const detectedItemField = first
      ? ["received_items", "items", "details", "skus"].find((k) => Array.isArray(first?.[k])) ?? null
      : null;
    const firstItem = subItems[0] ?? (first && (first.sku_id != null || first.qty != null) ? first : null);
    return {
      ok: true,
      duration_ms: Date.now() - t0,
      req: reqBody,
      top_keys: data && typeof data === "object" ? Object.keys(data) : [],
      list_path: Array.isArray(data) ? "(root array)" : (data?.receiveds ? "receiveds" : data?.list ? "list" : data?.datas ? "datas" : "(auto)"),
      list_count: list.length,
      first_row_keys: first ? Object.keys(first) : [],
      detected_item_field: detectedItemField,
      first_item_keys: firstItem ? Object.keys(firstItem) : [],
      first_row_has_io_id: !!(first && (first.io_id ?? first.ioId)),
      first_row_has_as_id: !!(first && (first.as_id ?? first.asId)),
      first_row_has_sku_id: !!(first && first.sku_id != null),
    };
  } catch (e: any) {
    return {
      ok: false,
      duration_ms: Date.now() - t0,
      req: reqBody,
      code: e?.code ?? null,
      message: String(e?.message ?? e).slice(0, 500),
      apiMsg: e?.apiMsg ?? null,
    };
  }
}

async function runDebugParams(body: any) {
  const { from, to } = resolveWindow(body);
  const base = { modified_begin: fmtBJ(from), modified_end: fmtBJ(to) };
  const cases: Record<string, any> = {
    A_minimal_strings: { ...base, page_index: "1", page_size: "50" },
    B_with_date_type_1: { ...base, page_index: "1", page_size: "50", date_type: "1" },
    C_numbers_compare: { ...base, page_index: 1, page_size: 50 },
  };
  const results: Record<string, any> = {};
  for (const [k, v] of Object.entries(cases)) {
    results[k] = await tryCall(v);
    await sleep(500);
  }
  // D_response_shape uses whichever case succeeded with the most rows
  const winning = Object.entries(results)
    .filter(([, v]: any) => v.ok)
    .sort((a: any, b: any) => (b[1].list_count ?? 0) - (a[1].list_count ?? 0))[0];
  results.D_response_shape = winning
    ? {
        from_case: winning[0],
        top_keys: winning[1].top_keys,
        list_path: winning[1].list_path,
        first_row_keys: winning[1].first_row_keys,
        detected_item_field: winning[1].detected_item_field,
        first_item_keys: winning[1].first_item_keys,
        first_row_has_io_id: winning[1].first_row_has_io_id,
        first_row_has_as_id: winning[1].first_row_has_as_id,
        first_row_has_sku_id: winning[1].first_row_has_sku_id,
      }
    : { note: "no successful case" };

  await admin.from("jst_sync_logs").insert({
    sync_type: SYNC_TYPE,
    status: "success",
    ended_at: new Date().toISOString(),
    message: `[debug_aftersale_received_params] ${fmtBJ(from)} → ${fmtBJ(to)}`,
    metadata: results,
  });
  return { ok: true, window: { from: fmtBJ(from), to: fmtBJ(to) }, results };
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

    if (action === "debug_aftersale_received_params") {
      const out = await runDebugParams(body);
      return new Response(JSON.stringify(out), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const jobResp = await handleJobActions({
      action, body, syncType: SYNC_TYPE, callerUid: caller.uid,
      processPage: processAftersalePage,
      startActionName: "start_aftersale_job",
      tickActionName: "tick_aftersale_job",
      cancelActionName: "cancel_aftersale_job",
      functionName: "jst-sync-aftersale-received",
      config: { pageSize: PAGE_SIZE, maxWindowDays: 1, maxPagesPerRun: 2, timeBudgetSeconds: 35, proactiveSplitAfterPage: 10 },
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
