// Edge Function: 聚水潭销售出库单同步（最小请求参数 + 自动 fallback + 详细日志）
// API: /open/orders/out/simple/query
// 写入 jst_outbound_orders + jst_outbound_order_items
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  admin, callOpenweb, fmtBJ, parseJstBeijingDateTime, computeHasNext, pickList, pickItemsArray,
  resolveCaller, resolveWindow, sleep, RATE_DELAY_MS, MAX_PAGE_NO,
} from "../_shared/jst-client.ts";
import { handleJobActions, PageResult, ProcessPageArgs } from "../_shared/jst-sync-job.ts";

const SYNC_TYPE = "outbound_orders";
const METHOD_PATH = "orders/out/simple/query";
const PAGE_SIZE = 50;

// 参数形态：
//  - "with_status": 最小参数 + status=Confirmed
//  - "minimal":     仅最小参数（modified_begin/end + page_index/size 字符串）
type ParamMode = "with_status" | "minimal";

function buildReqBody(mode: ParamMode, pageIndex: number, pageSize: number, from: Date, to: Date) {
  const size = Math.min(Math.max(Number(pageSize) || PAGE_SIZE, 1), 50);
  const body: Record<string, unknown> = {
    page_index: String(pageIndex),
    page_size: String(size),
    modified_begin: fmtBJ(from),
    modified_end: fmtBJ(to),
  };
  if (mode === "with_status") body.status = "Confirmed";
  return body;
}

function splitProps(v: string | null): { color: string | null; size: string | null } {
  if (!v) return { color: null, size: null };
  const parts = String(v).split(/[,;|，；]/).map((s) => s.trim()).filter(Boolean);
  return { color: parts[0] ?? null, size: parts[1] ?? null };
}

async function upsertOutboundOrder(r: any): Promise<{ orderId: string; itemsUpserted: number }> {
  const ioId = String(r.io_id ?? r.ioId ?? "");
  if (!ioId) throw new Error("missing io_id");
  const itemList = pickItemsArray(r);
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

// 调用一次接口，遇到 code=130 时自动尝试移除 status 再试一次。
// 返回结果同时携带最终采用的 mode，方便上层持久化。
async function callOutbound(initialMode: ParamMode, pageIndex: number, pageSize: number, from: Date, to: Date) {
  const order: ParamMode[] = initialMode === "minimal" ? ["minimal"] : ["with_status", "minimal"];
  let lastErr: any = null;
  for (const mode of order) {
    const reqBody = buildReqBody(mode, pageIndex, pageSize, from, to);
    const t0 = Date.now();
    try {
      const data = await callOpenweb(METHOD_PATH, reqBody, { timeoutMs: 30_000 });
      return { data, mode, reqBody, durationMs: Date.now() - t0, responseCode: "0", responseMsg: "success" };
    } catch (e: any) {
      lastErr = e;
      // 仅当确认是参数错误且当前是 with_status 时，才尝试 fallback 去掉 status
      const code = String(e?.code ?? "");
      const isParamErr = code === "130" || /参数无法转换|参数错误/.test(String(e?.apiMsg ?? e?.message ?? ""));
      if (!(isParamErr && mode === "with_status")) {
        // 附带请求上下文给上层写日志（包括 transient 超时）
        e.requestBody = reqBody;
        e.apiPath = METHOD_PATH;
        e.responseCode = e.responseCode ?? (code || null);
        e.responseMsg = e.responseMsg ?? (e?.apiMsg ?? null);
        e.durationMs = e.durationMs ?? (Date.now() - t0);
        throw e;
      }
    }
  }
  if (lastErr) {
    lastErr.apiPath = METHOD_PATH;
    throw lastErr;
  }
  throw new Error("callOutbound: unknown error");
}

async function processOutboundPage(args: ProcessPageArgs): Promise<PageResult> {
  const { job, windowFrom, windowTo, pageIndex, pageSize } = args;
  await sleep(RATE_DELAY_MS);
  if (pageIndex > MAX_PAGE_NO) throw new Error(`分页超过上限 ${MAX_PAGE_NO}`);
  const meta = (job?.metadata ?? {}) as Record<string, unknown>;
  const initialMode: ParamMode = meta.param_mode === "minimal" ? "minimal" : "with_status";

  const { data, mode, reqBody, durationMs } = await callOutbound(initialMode, pageIndex, pageSize, windowFrom, windowTo);

  // 持久化采用的 mode（仅在变化时写）
  if (mode !== initialMode) {
    try {
      await admin.from("jst_sync_jobs").update({
        metadata: { ...meta, param_mode: mode, param_mode_locked_at: new Date().toISOString() },
      }).eq("id", job.id);
    } catch (_e) { /* ignore */ }
  }

  const list = pickList(data);
  const hasNext = computeHasNext(data, list.length, Number(reqBody.page_size), pageIndex);
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
  return {
    apiCount: list.length, mainUpserted, itemUpserted, failed, hasNext,
    errorDetail: lastErr || undefined,
    requestBody: { ...reqBody, _param_mode: mode },
    responseCode: "0", responseMsg: "success",
    durationMs,
  };
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
      processPage: processOutboundPage,
      startActionName: "start_outbound_job",
      tickActionName: "tick_outbound_job",
      cancelActionName: "cancel_outbound_job",
      config: { pageSize: PAGE_SIZE, maxWindowDays: 0.25, maxPagesPerRun: 2, timeBudgetSeconds: 35 },
      resolveWindowFromBody: (b) => resolveWindow(b),
    });
    if (jobResp) {
      const text = await jobResp.text();
      return new Response(text, { status: jobResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      ok: false, error: "请使用 start_outbound_job / tick_outbound_job / cancel_outbound_job",
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: (err as Error).message,
      response_code: err?.responseCode ?? err?.code ?? null,
      response_msg: err?.responseMsg ?? err?.apiMsg ?? null,
      request_body: err?.requestBody ?? null,
    }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
