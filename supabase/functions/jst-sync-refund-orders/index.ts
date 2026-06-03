// Edge Function: 聚水潭售后 - 退货退款单同步
// 调用 method: refund.list.query  (映射为 /open/refund/list/query)
// 写入 jst_refund_orders + jst_refund_order_items
// 日志写入 jst_sync_logs, sync_type='refund_orders'
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  admin, callOpenweb, fmtBJ, parseJstBeijingDateTime, parseHasNext,
  resolveCaller, resolveWindow, sleep, RATE_DELAY_MS, MAX_PAGE_NO,
} from "../_shared/jst-client.ts";

const SYNC_TYPE = "refund_orders";
const METHOD_PATH = "refund/single/query";
const PAGE_SIZE = 50;

async function runSync(fromIso: string, toIso: string, logId: string) {
  const winFrom = new Date(fromIso);
  const winTo = new Date(toIso);
  let page = 1, apiCount = 0, orders = 0, items = 0, failed = 0;
  const errors: string[] = [];

  try {
    while (true) {
      if (page > MAX_PAGE_NO) throw new Error(`分页超过上限 ${MAX_PAGE_NO}`);
      await sleep(RATE_DELAY_MS);
      const data = await callOpenweb(METHOD_PATH, {
        page_index: page, page_size: PAGE_SIZE,
        modified_begin: fmtBJ(winFrom), modified_end: fmtBJ(winTo),
      });
      apiCount++;
      const list: any[] = data.datas ?? data.list ?? data.refunds ?? data.orders ?? [];
      const hasNext = parseHasNext(data.has_next ?? data.hasNext, list.length === PAGE_SIZE);

      for (const r of list) {
        const asId = String(r.as_id ?? r.asId ?? "");
        if (!asId) continue;
        try {
          const row = {
            as_id: asId,
            outer_as_id: r.outer_as_id ?? r.outerAsId ?? null,
            o_id: r.o_id ?? r.oId ?? null,
            so_id: r.so_id ?? r.soId ?? null,
            shop_id: r.shop_id != null ? String(r.shop_id) : null,
            shop_name: r.shop_name ?? null,
            type: r.type ?? null,
            status: r.status ?? null,
            shop_status: r.shop_status ?? null,
            good_status: r.good_status ?? null,
            refund_amount: Number(r.refund ?? r.refund_amount ?? 0),
            payment_amount: Number(r.payment ?? r.payment_amount ?? 0),
            freight: Number(r.freight ?? 0),
            question_type: r.question_type ?? null,
            question_reason: r.question_desc ?? r.question_reason ?? null,
            remark: r.remark ?? null,
            warehouse: r.warehouse ?? null,
            logistics_company: r.logistics_company ?? null,
            l_id: r.l_id ?? null,
            as_date: parseJstBeijingDateTime(r.as_date),
            created_at_jst: parseJstBeijingDateTime(r.created),
            modified_at_jst: parseJstBeijingDateTime(r.modified),
            confirm_date: parseJstBeijingDateTime(r.confirm_date),
            raw_data: r,
            synced_at: new Date().toISOString(),
          };
          const { data: up, error } = await admin
            .from("jst_refund_orders")
            .upsert(row, { onConflict: "as_id" })
            .select("id")
            .single();
          if (error) throw error;
          orders++;
          const refundOrderId = up.id as string;

          const itemList: any[] = r.items ?? [];
          for (const it of itemList) {
            const asiId = it.asi_id != null ? String(it.asi_id) : null;
            const skuId = it.sku_id != null ? String(it.sku_id) : null;
            const outerOiId = it.outer_oi_id != null ? String(it.outer_oi_id) : null;
            const qty = Number(it.qty ?? 0);
            const price = Number(it.price ?? 0);
            const itemRow = {
              refund_order_id: refundOrderId,
              as_id: asId,
              asi_id: asiId,
              sku_id: skuId,
              name: it.name ?? null,
              properties_value: it.properties_value ?? null,
              pic: it.pic ?? null,
              qty,
              r_qty: Number(it.r_qty ?? 0),
              price,
              amount: Number(it.amount ?? qty * price),
              type: it.type ?? null,
              outer_oi_id: outerOiId,
              sku_type: it.sku_type ?? null,
              supplier_id: it.supplier_id != null ? String(it.supplier_id) : null,
              supplier_name: it.supplier_name ?? null,
              batch_no: it.batch_no ?? null,
              raw_data: it,
              synced_at: new Date().toISOString(),
            };
            const onConflict = asiId ? "as_id,asi_id" : "as_id,sku_id,outer_oi_id";
            const { error: itErr } = await admin
              .from("jst_refund_order_items")
              .upsert(itemRow, { onConflict });
            if (itErr) throw itErr;
            items++;
          }
        } catch (we) {
          failed++;
          errors.push(`as_id=${asId}: ${(we as Error).message}`);
        }
      }

      await admin.from("jst_sync_logs").update({
        fetched_orders_count: orders,
        fetched_items_count: items,
        message: `第 ${page} 页 已同步 ${orders} 单 / ${items} 明细 · has_next=${hasNext}`,
        heartbeat_at: new Date().toISOString(),
      }).eq("id", logId);

      if (!hasNext || list.length === 0) break;
      page++;
    }

    await admin.from("jst_sync_logs").update({
      status: errors.length && orders === 0 ? "failed" : (errors.length ? "partial_failed" : "success"),
      ended_at: new Date().toISOString(),
      fetched_orders_count: orders,
      fetched_items_count: items,
      message: `退货退款单同步完成 · API ${apiCount} 次 · ${orders} 单 / ${items} 明细 · 失败 ${failed}`,
      error_detail: errors.length ? errors.slice(0, 10).join(" | ").slice(0, 1500) : null,
    }).eq("id", logId);
  } catch (e: any) {
    const err = e as any;
    const isAbort = err?.aborted || err?.name === "AbortError" || /abort/i.test(String(err?.message ?? ""));
    const friendly = isAbort
      ? `退货退款单同步请求超时或被中断，请检查接口路径、page_size、时间范围和 Edge Function 超时设置。`
      : `退货退款单同步失败 page=${page}`;
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
      message: `开始同步退货退款单 ${fmtBJ(from)} → ${fmtBJ(to)}`,
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
