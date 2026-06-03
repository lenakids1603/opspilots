// Edge Function: 聚水潭销售出库单同步（只读 + 断点续跑 + 进度条）
// API: /open/orders/out/simple/query
// 写入 jst_outbound_orders + jst_outbound_order_items
// Actions:
//   - start_outbound_job / tick_outbound_job / cancel_outbound_job (推荐, 走 jst_sync_jobs)
//   - (无 action) 旧的一次性后台同步, 保留给 cron / 兼容
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  admin, callOpenweb, fmtBJ, parseJstBeijingDateTime, parseHasNext,
  resolveCaller, resolveWindow, sleep, RATE_DELAY_MS, MAX_PAGE_NO,
} from "../_shared/jst-client.ts";
import { handleJobActions, PageResult, ProcessPageArgs } from "../_shared/jst-sync-job.ts";

const SYNC_TYPE = "outbound_orders";
const METHOD_PATH = "orders/out/simple/query";
const PAGE_SIZE = 50;

function splitProps(v: string | null): { color: string | null; size: string | null } {
  if (!v) return { color: null, size: null };
  const parts = String(v).split(/[,;|，；]/).map((s) => s.trim()).filter(Boolean);
  return { color: parts[0] ?? null, size: parts[1] ?? null };
}

const ITEM_FIELDS = ["items", "skus", "items_list", "order_items", "details", "item_list", "orderitems"];
function pickItems(r: any): { list: any[]; field: string | null } {
  for (const f of ITEM_FIELDS) {
    const v = r?.[f];
    if (Array.isArray(v) && v.length > 0) return { list: v, field: f };
  }
  return { list: [], field: null };
}

async function upsertOutboundOrder(r: any): Promise<{ orderId: string; itemsUpserted: number }> {
  const ioId = String(r.io_id ?? r.ioId ?? "");
  if (!ioId) throw new Error("missing io_id");
  const { list: itemList } = pickItems(r);
  const aggQty = itemList.reduce((s, it) => s + Number(it.qty ?? it.sale_qty ?? it.total_qty ?? 0), 0);
  const row = {
    io_id: ioId,
    o_id: r.o_id ?? null,
    so_id: r.so_id ?? null,
    shop_id: r.shop_id != null ? String(r.shop_id) : null,
    shop_name: r.shop_name ?? null,
    warehouse: r.warehouse ?? null,
    wms_co_id: r.wms_co_id != null ? String(r.wms_co_id) : null,
    status: r.status ?? null,
    logistics_company: r.logistics_company ?? null,
    l_id: r.l_id ?? null,
    lc_id: r.lc_id != null ? String(r.lc_id) : null,
    io_date: parseJstBeijingDateTime(r.io_date),
    consign_time: parseJstBeijingDateTime(r.consign_time ?? r.consigntime),
    modified_at_jst: parseJstBeijingDateTime(r.modified),
    qty: aggQty > 0 ? aggQty : Number(r.qty ?? 0),
    raw_data: r,
    synced_at: new Date().toISOString(),
  };
  const { data: up, error } = await admin
    .from("jst_outbound_orders").upsert(row, { onConflict: "io_id" }).select("id").single();
  if (error) throw error;
  let itemsUpserted = 0;
  for (const it of itemList) {
    const skuId = it.sku_id != null ? String(it.sku_id) : it.shop_sku_id != null ? String(it.shop_sku_id) : null;
    const oiId = it.oi_id != null ? String(it.oi_id) : null;
    const ioiId = it.ioi_id != null ? String(it.ioi_id) : null;
    const props = splitProps(it.properties_value ?? null);
    const itemUniqueKey = `${ioId}|${ioiId ?? ""}|${skuId ?? ""}|${oiId ?? ""}`;
    const itemRow = {
      outbound_order_id: up.id, io_id: ioId, oi_id: oiId, ioi_id: ioiId, sku_id: skuId,
      i_id: it.i_id != null ? String(it.i_id) : it.item_id != null ? String(it.item_id) : null,
      name: it.name ?? it.sku_name ?? null,
      properties_value: it.properties_value ?? null,
      color: props.color, size: props.size,
      qty: Number(it.qty ?? it.sale_qty ?? it.total_qty ?? 0),
      amount: Number(it.amount ?? it.sale_amount ?? 0),
      pic: it.pic ?? null, item_unique_key: itemUniqueKey, raw_data: it,
      synced_at: new Date().toISOString(),
    };
    const { error: itErr } = await admin
      .from("jst_outbound_order_items").upsert(itemRow, { onConflict: "item_unique_key" });
    if (itErr) throw itErr;
    itemsUpserted++;
  }
  return { orderId: up.id as string, itemsUpserted };
}

async function processOutboundPage(args: ProcessPageArgs): Promise<PageResult> {
  const { windowFrom, windowTo, pageIndex, pageSize } = args;
  await sleep(RATE_DELAY_MS);
  if (pageIndex > MAX_PAGE_NO) throw new Error(`分页超过上限 ${MAX_PAGE_NO}`);
  const data = await callOpenweb(METHOD_PATH, {
    page_index: pageIndex, page_size: pageSize,
    modified_begin: fmtBJ(windowFrom), modified_end: fmtBJ(windowTo),
  });
  const list: any[] = data.datas ?? data.list ?? data.orders ?? [];
  const hasNext = parseHasNext(data.has_next ?? data.hasNext, list.length === pageSize);
  let mainUpserted = 0, itemUpserted = 0, failed = 0;
  let lastErr = "";
  for (const r of list) {
    try {
      const res = await upsertOutboundOrder(r);
      mainUpserted++; itemUpserted += res.itemsUpserted;
    } catch (we) {
      failed++; lastErr = String((we as Error).message ?? we);
    }
  }
  return { apiCount: list.length, mainUpserted, itemUpserted, failed, hasNext, errorDetail: lastErr };
}

// ===== legacy 一次性同步 (保留兼容/cron) =====
async function runLegacySync(fromIso: string, toIso: string, logId: string) {
  const winFrom = new Date(fromIso); const winTo = new Date(toIso);
  let page = 1, apiCount = 0, orders = 0, items = 0, failed = 0;
  try {
    while (true) {
      if (page > MAX_PAGE_NO) throw new Error(`分页超过上限 ${MAX_PAGE_NO}`);
      const res = await processOutboundPage({
        job: { page_size: PAGE_SIZE } as any,
        windowIndex: 0, windowFrom: winFrom, windowTo: winTo, pageIndex: page, pageSize: PAGE_SIZE,
      });
      apiCount++; orders += res.mainUpserted; items += res.itemUpserted; failed += res.failed;
      await admin.from("jst_sync_logs").update({
        fetched_orders_count: orders, fetched_items_count: items,
        message: `第 ${page} 页 已同步 ${orders} 出库单 / ${items} 明细 · 失败 ${failed} · has_next=${res.hasNext}`,
        heartbeat_at: new Date().toISOString(),
      }).eq("id", logId);
      if (!res.hasNext || res.apiCount === 0) break;
      page++;
    }
    const status = failed === 0 ? "success" : (orders === 0 ? "failed" : "partial_failed");
    await admin.from("jst_sync_logs").update({
      status, ended_at: new Date().toISOString(),
      fetched_orders_count: orders, fetched_items_count: items,
      message: `销售出库同步完成 · API ${apiCount} 次 · ${orders} 单 / ${items} 明细 · 失败 ${failed}`,
    }).eq("id", logId);
  } catch (e: any) {
    await admin.from("jst_sync_logs").update({
      status: "failed", ended_at: new Date().toISOString(),
      fetched_orders_count: orders, fetched_items_count: items,
      message: `销售出库同步失败 page=${page}`,
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

    // 新: 断点续跑 job 协议
    const jobResp = await handleJobActions({
      action, body, syncType: SYNC_TYPE, callerUid: caller.uid,
      processPage: processOutboundPage,
      startActionName: "start_outbound_job",
      tickActionName: "tick_outbound_job",
      cancelActionName: "cancel_outbound_job",
      config: { pageSize: PAGE_SIZE, maxWindowDays: 3, maxPagesPerRun: 3, timeBudgetSeconds: 45 },
      resolveWindowFromBody: (b) => resolveWindow(b),
    });
    if (jobResp) {
      // attach cors
      const text = await jobResp.text();
      return new Response(text, { status: jobResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 旧: 一次性后台同步 (兼容)
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
      message: `开始同步销售出库 ${fmtBJ(from)} → ${fmtBJ(to)}`,
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
