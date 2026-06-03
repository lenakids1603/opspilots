// Edge Function: 聚水潭销售出库单同步（只读）
// API: /open/orders/out/simple/query  → method path orders/out/simple/query
// 写入 jst_outbound_orders + jst_outbound_order_items
// 日志写入 jst_sync_logs, sync_type='outbound_orders'
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  admin, callOpenweb, fmtBJ, parseJstBeijingDateTime, parseHasNext,
  resolveCaller, resolveWindow, sleep, RATE_DELAY_MS, MAX_PAGE_NO,
} from "../_shared/jst-client.ts";

const SYNC_TYPE = "outbound_orders";
const METHOD_PATH = "orders/out/simple/query";
const PAGE_SIZE = 50;

const INOUT_FLDS = [
  "io_id", "so_id", "o_id", "shop_id", "shop_name", "wh_id", "warehouse",
  "wms_co_id", "status", "logistics_company", "l_name", "l_id", "lc_id",
  "modified", "io_date", "send_date", "consign_time", "qty", "items", "skus",
].join(",");

const INOUT_ITEM_FLDS = [
  "io_id", "ioi_id", "sku_id", "shop_sku_id", "i_id", "shop_i_id", "oi_id",
  "outer_oi_id", "name", "pic", "properties_value", "qty", "sale_price",
  "sale_amount", "sale_base_price", "buyer_paid_amount", "seller_income_amount",
  "combine_sku_id", "combine_sku_qty", "raw_so_id", "is_gift",
].join(",");

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

async function runSync(fromIso: string, toIso: string, logId: string) {
  const winFrom = new Date(fromIso);
  const winTo = new Date(toIso);
  let page = 1, apiCount = 0, orders = 0, items = 0, failed = 0;
  let ordersWithoutItems = 0;
  let detectedItemField: string | null = null;
  let firstTopKeys: string[] = [];
  const sampleShapes: any[] = [];
  const errors: string[] = [];
  const errorTypes: Record<string, number> = {};

  try {
    while (true) {
      if (page > MAX_PAGE_NO) throw new Error(`分页超过上限 ${MAX_PAGE_NO}`);
      await sleep(RATE_DELAY_MS);
      const requestBiz = {
        page_index: page, page_size: PAGE_SIZE,
        modified_begin: fmtBJ(winFrom), modified_end: fmtBJ(winTo),
        InoutFlds: INOUT_FLDS,
        InoutItemFlds: INOUT_ITEM_FLDS,
      };
      console.log(`[outbound] FINAL REQUEST path=/open/${METHOD_PATH} params=${JSON.stringify(requestBiz)}`);
      const data = await callOpenweb(METHOD_PATH, requestBiz);
      apiCount++;
      const list: any[] = data.datas ?? data.list ?? data.orders ?? [];
      const hasNext = parseHasNext(data.has_next ?? data.hasNext, list.length === PAGE_SIZE);

      for (const r of list) {
        const ioId = String(r.io_id ?? r.ioId ?? "");
        if (!ioId) continue;
        try {
          const { list: itemList, field: itemField } = pickItems(r);
          if (itemField && !detectedItemField) detectedItemField = itemField;
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
            .from("jst_outbound_orders")
            .upsert(row, { onConflict: "io_id" })
            .select("id")
            .single();
          if (error) throw error;
          orders++;
          const outboundOrderId = up.id as string;

          if (itemList.length === 0) {
            ordersWithoutItems++;
          }
          if (sampleShapes.length < 5) {
            if (firstTopKeys.length === 0) firstTopKeys = Object.keys(r);
            sampleShapes.push({
              io_id: ioId,
              item_field: itemField,
              item_count: itemList.length,
              top_keys: Object.keys(r).slice(0, 80),
              first_item_keys: itemList[0] ? Object.keys(itemList[0]).slice(0, 80) : [],
            });
          }
          for (let idx = 0; idx < itemList.length; idx++) {
            const it = itemList[idx];
            const skuId = it.sku_id != null ? String(it.sku_id) : it.shop_sku_id != null ? String(it.shop_sku_id) : null;
            const oiId = it.oi_id != null ? String(it.oi_id) : null;
            const ioiId = it.ioi_id != null ? String(it.ioi_id) : null;
            const props = splitProps(it.properties_value ?? null);
            const itemUniqueKey = `${ioId}|${ioiId ?? ""}|${skuId ?? ""}|${oiId ?? ""}`;
            const itemRow = {
              outbound_order_id: outboundOrderId,
              io_id: ioId,
              oi_id: oiId,
              ioi_id: ioiId,
              sku_id: skuId,
              i_id: it.i_id != null ? String(it.i_id) : it.item_id != null ? String(it.item_id) : null,
              name: it.name ?? it.sku_name ?? null,
              properties_value: it.properties_value ?? null,
              color: props.color,
              size: props.size,
              qty: Number(it.qty ?? it.sale_qty ?? it.total_qty ?? 0),
              amount: Number(it.amount ?? it.sale_amount ?? 0),
              pic: it.pic ?? null,
              item_unique_key: itemUniqueKey,
              raw_data: it,
              synced_at: new Date().toISOString(),
            };
            const { error: itErr } = await admin
              .from("jst_outbound_order_items")
              .upsert(itemRow, { onConflict: "item_unique_key" });
            if (itErr) throw itErr;
            items++;
          }
          if (page === 1 && orders <= 1) {
            console.log(`[outbound] sample io_id=${ioId} items_field=${itemField ?? "(none)"} item_count=${itemList.length} top_keys=${Object.keys(r).join(",")}`);
          }
        } catch (we) {
          failed++;
          const msg = (we as Error).message ?? String(we);
          errorTypes[msg] = (errorTypes[msg] ?? 0) + 1;
          if (errors.length < 10) errors.push(`io_id=${ioId}: ${msg}`);
        }
      }

      await admin.from("jst_sync_logs").update({
        fetched_orders_count: orders,
        fetched_items_count: items,
        message: `第 ${page} 页 已同步 ${orders} 出库单 / ${items} 明细 · 失败 ${failed} · has_next=${hasNext}`,
        heartbeat_at: new Date().toISOString(),
        metadata: {
          final_api_path: `/open/${METHOD_PATH}`,
          request_fields: { InoutFlds: INOUT_FLDS, InoutItemFlds: INOUT_ITEM_FLDS },
          last_request: { page_index: page, page_size: PAGE_SIZE, start_time: fmtBJ(winFrom), end_time: fmtBJ(winTo) },
          detected_item_field: detectedItemField,
          top_keys: firstTopKeys,
          samples: sampleShapes,
          failed_total: failed,
          orders_without_items: ordersWithoutItems,
          error_types: errorTypes,
        },
      }).eq("id", logId);

      if (!hasNext || list.length === 0) break;
      page++;
    }

    const noItemsNote = orders > 0 && items === 0
      ? ` · 接口未返回明细字段（已尝试 ${ITEM_FIELDS.join("/")}）`
      : detectedItemField ? ` · 明细字段=${detectedItemField}` : "";
    const status = failed === 0
      ? "success"
      : orders === 0
        ? "failed"
        : "partial_failed";
    const detailLines = [
      `failed_total=${failed}`,
      `orders_without_items=${ordersWithoutItems}`,
      `detected_item_field=${detectedItemField ?? "(none)"}`,
      `top_keys=${firstTopKeys.join(",").slice(0, 600)}`,
      `error_types=${JSON.stringify(errorTypes).slice(0, 600)}`,
      `samples=${errors.slice(0, 5).join(" | ").slice(0, 600)}`,
    ];
    await admin.from("jst_sync_logs").update({
      status,
      ended_at: new Date().toISOString(),
      fetched_orders_count: orders,
      fetched_items_count: items,
      message: `销售出库同步完成 · API ${apiCount} 次 · ${orders} 单 / ${items} 明细 · 失败 ${failed}${noItemsNote}`,
      error_detail: failed > 0 ? detailLines.join(" | ").slice(0, 1800) : null,
      metadata: {
        final_api_path: `/open/${METHOD_PATH}`,
        request_fields: { InoutFlds: INOUT_FLDS, InoutItemFlds: INOUT_ITEM_FLDS },
        detected_item_field: detectedItemField,
        top_keys: firstTopKeys,
        samples: sampleShapes,
        failed_total: failed,
        orders_without_items: ordersWithoutItems,
        error_types: errorTypes,
      },
    }).eq("id", logId);
  } catch (e: any) {
    const err = e as any;
    const isAbort = err?.aborted || err?.name === "AbortError" || /abort/i.test(String(err?.message ?? ""));
    const isNoPerm = String(err?.code) === "190" || /无API权限|无api权限|无权限/i.test(String(err?.apiMsg ?? err?.message ?? ""));
    const friendly = isNoPerm
      ? "聚水潭无API权限，请在开放平台为当前应用申请：销售出库查询 /open/orders/out/simple/query"
      : isAbort
        ? "销售出库同步请求超时或被中断，请缩小时间范围。"
        : `销售出库同步失败 page=${page}`;
    const detail = [
      `final_api_path=${METHOD_PATH}`,
      err?.url ? `request_url=${err.url}` : null,
      `page_index=${page}`,
      `page_size=${PAGE_SIZE}`,
      `start_time=${fmtBJ(winFrom)}`,
      `end_time=${fmtBJ(winTo)}`,
      err?.code != null ? `response_code=${err.code}` : null,
      err?.apiMsg ? `response_msg=${err.apiMsg}` : null,
      err?.requestId ? `request_id=${err.requestId}` : null,
      `error_name=${err?.name ?? "Error"}`,
      `error_message=${String(err?.message ?? err).slice(0, 600)}`,
    ].filter(Boolean).join(" | ");
    await admin.from("jst_sync_logs").update({
      status: "failed",
      ended_at: new Date().toISOString(),
      fetched_orders_count: orders,
      fetched_items_count: items,
      message: friendly,
      error_detail: detail.slice(0, 1500),
      metadata: {
        final_api_path: `/open/${METHOD_PATH}`,
        request_fields: { InoutFlds: INOUT_FLDS, InoutItemFlds: INOUT_ITEM_FLDS },
        detected_item_field: detectedItemField,
        top_keys: firstTopKeys,
        samples: sampleShapes,
        failed_total: failed,
        orders_without_items: ordersWithoutItems,
        error_types: errorTypes,
      },
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
    const { from, to } = resolveWindow(body);

    const { data: log, error: logErr } = await admin.from("jst_sync_logs").insert({
      sync_type: SYNC_TYPE,
      status: "running",
      cursor_from: from.toISOString(),
      cursor_to: to.toISOString(),
      message: `开始同步销售出库 ${fmtBJ(from)} → ${fmtBJ(to)}`,
    }).select("id").single();
    if (logErr) throw logErr;

    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil(runSync(from.toISOString(), to.toISOString(), log.id));

    return new Response(JSON.stringify({
      ok: true, background: true, log_id: log.id,
      cursor_from: from.toISOString(), cursor_to: to.toISOString(),
      message: "同步已在后台启动",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
