// Edge Function: 聚水潭销售订单同步（只读 · 断点续跑 · 进度条）
// API: /open/orders/single/query (modified_begin/modified_end 增量)
// 写入 jst_sales_orders + jst_sales_order_items
// Actions:
//   - start_sales_job / tick_sales_job / cancel_sales_job
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  admin, callOpenweb, fmtBJ, parseJstBeijingDateTime, parseHasNext,
  resolveCaller, resolveWindow, sleep, RATE_DELAY_MS, MAX_PAGE_NO,
} from "../_shared/jst-client.ts";
import { handleJobActions, PageResult, ProcessPageArgs } from "../_shared/jst-sync-job.ts";

const SYNC_TYPE = "sales_orders";
const METHOD_PATH = "orders/single/query";
const PAGE_SIZE = 50;

function n(v: unknown): number {
  if (v == null || v === "") return 0;
  const x = Number(v);
  return isNaN(x) ? 0 : x;
}
function s(v: unknown): string | null {
  if (v == null) return null;
  const str = String(v).trim();
  return str === "" ? null : str;
}
function maskMobile(m: unknown): string | null {
  const str = s(m);
  if (!str) return null;
  if (str.length < 4) return null;
  return str.slice(-4);
}

const ITEM_FIELDS = ["items", "skus", "order_items", "details", "item_list", "orderitems"];
function pickItems(r: any): any[] {
  for (const f of ITEM_FIELDS) {
    const v = r?.[f];
    if (Array.isArray(v)) return v;
  }
  return [];
}

async function upsertSalesOrder(r: any): Promise<{ itemsUpserted: number }> {
  const jstOId = s(r.o_id ?? r.oid);
  if (!jstOId) throw new Error("missing o_id");
  const items = pickItems(r);

  const row: Record<string, unknown> = {
    jst_o_id: jstOId,
    so_id: s(r.so_id),
    shop_id: s(r.shop_id),
    shop_name: s(r.shop_name),
    status: s(r.status ?? r.shop_status),
    order_type: s(r.type ?? r.order_type),
    created_time: parseJstBeijingDateTime(r.order_date ?? r.created ?? r.create_time),
    modified_time: parseJstBeijingDateTime(r.modified ?? r.modified_time),
    pay_time: parseJstBeijingDateTime(r.pay_date ?? r.pay_time),
    io_id: s(r.io_id),
    io_date: parseJstBeijingDateTime(r.io_date),
    l_id: s(r.l_id),
    lc_id: s(r.lc_id),
    logistics_company: s(r.logistics_company),
    pay_amount: n(r.pay_amount),
    paid_amount: n(r.paid_amount),
    free_amount: n(r.free_amount),
    freight: n(r.freight),
    weight: n(r.weight),
    f_weight: n(r.f_weight),
    buyer_message: s(r.buyer_message),
    seller_remark: s(r.remark ?? r.seller_remark),
    labels: r.labels ?? null,
    merge_so_id: s(r.merge_so_id),
    receiver_province: s(r.receiver_state ?? r.receiver_province),
    receiver_city: s(r.receiver_city),
    receiver_district: s(r.receiver_district),
    receiver_mobile_masked: maskMobile(r.receiver_mobile),
    raw_data: r,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: up, error } = await admin
    .from("jst_sales_orders")
    .upsert(row, { onConflict: "jst_o_id" })
    .select("id")
    .single();
  if (error) throw error;

  let itemsUpserted = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const jstItemId = s(it.oi_id ?? it.item_id);
    const skuId = s(it.sku_id ?? it.shop_sku_id);
    const uniqueKey = `${jstOId}|${jstItemId ?? `idx${i}`}|${skuId ?? ""}`;
    const itemRow: Record<string, unknown> = {
      sales_order_id: up.id,
      jst_o_id: jstOId,
      so_id: row.so_id,
      shop_id: row.shop_id,
      item_index: i,
      jst_item_id: jstItemId,
      sku_id: skuId,
      i_id: s(it.i_id),
      sku_code: s(it.sku_id ?? it.sku_code),
      shop_sku_id: s(it.shop_sku_id),
      product_name: s(it.name ?? it.product_name),
      sku_name: s(it.properties_value ?? it.sku_name),
      qty: n(it.qty),
      sale_price: n(it.price ?? it.sale_price ?? it.base_price),
      amount: n(it.amount ?? it.sale_amount),
      paid_amount: n(it.paid_amount ?? it.amount_after_discount),
      refund_status: s(it.refund_status),
      pic: s(it.pic),
      supplier_id: null,
      supplier_name: null,
      item_unique_key: uniqueKey,
      raw_item_data: it,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error: itErr } = await admin
      .from("jst_sales_order_items")
      .upsert(itemRow, { onConflict: "item_unique_key" });
    if (itErr) throw itErr;
    itemsUpserted++;
  }
  return { itemsUpserted };
}

async function processSalesPage(args: ProcessPageArgs): Promise<PageResult> {
  const { windowFrom, windowTo, pageIndex, pageSize } = args;
  await sleep(RATE_DELAY_MS);
  if (pageIndex > MAX_PAGE_NO) throw new Error(`分页超过上限 ${MAX_PAGE_NO}`);
  const data = await callOpenweb(METHOD_PATH, {
    page_index: pageIndex,
    page_size: pageSize,
    modified_begin: fmtBJ(windowFrom),
    modified_end: fmtBJ(windowTo),
  });
  const list: any[] = data.datas ?? data.list ?? data.orders ?? [];
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

// resolveWindow override: also accepts start_time/end_time with 10-min back-shift baked in by caller
function resolveSalesWindow(body: any) {
  const w = resolveWindow(body);
  return w;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const caller = await resolveCaller(req);
    if (!caller.isAdmin) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action: string = body.action ?? "";

    const jobResp = await handleJobActions({
      action, body, syncType: SYNC_TYPE, callerUid: caller.uid,
      processPage: processSalesPage,
      startActionName: "start_sales_job",
      tickActionName: "tick_sales_job",
      cancelActionName: "cancel_sales_job",
      // smaller window for high-volume sales orders → finer progress bar
      config: { pageSize: PAGE_SIZE, maxWindowDays: 1, maxPagesPerRun: 3, timeBudgetSeconds: 45 },
      resolveWindowFromBody: (b) => resolveSalesWindow(b),
    });
    if (jobResp) {
      const text = await jobResp.text();
      return new Response(text, { status: jobResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      ok: false, error: "请使用 start_sales_job / tick_sales_job / cancel_sales_job action",
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
