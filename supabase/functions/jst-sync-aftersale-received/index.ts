// Edge Function: 聚水潭售后 - 销售退仓 / 实际收货同步
// 调用 method: aftersale.receive.query  (映射为 /open/aftersale/receive/query)
// 写入 jst_aftersale_received_orders + jst_aftersale_received_items
// 日志写入 jst_sync_logs, sync_type='aftersale_received'
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  admin, callOpenweb, fmtBJ, parseJstBeijingDateTime, parseHasNext,
  resolveCaller, resolveWindow, sleep, RATE_DELAY_MS, MAX_PAGE_NO,
} from "../_shared/jst-client.ts";

const SYNC_TYPE = "aftersale_received";
const METHOD_PATH = "aftersale/received/query";
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
      const list: any[] = data.datas ?? data.list ?? data.orders ?? [];
      const hasNext = parseHasNext(data.has_next ?? data.hasNext, list.length === PAGE_SIZE);

      for (const r of list) {
        const asId = String(r.as_id ?? r.asId ?? "");
        if (!asId) continue;
        try {
          const row = {
            as_id: asId,
            outer_as_id: r.outer_as_id ?? null,
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
            .upsert(row, { onConflict: "as_id" })
            .select("id")
            .single();
          if (error) throw error;
          orders++;
          const receivedOrderId = up.id as string;

          const itemList: any[] = r.items ?? [];
          for (const it of itemList) {
            const skuId = it.sku_id != null ? String(it.sku_id) : null;
            const qty = Number(it.qty ?? 0);
            const itemRow = {
              received_order_id: receivedOrderId,
              as_id: asId,
              sku_id: skuId,
              name: it.name ?? null,
              properties_value: it.properties_value ?? null,
              pic: it.pic ?? null,
              qty,
              r_qty: Number(it.r_qty ?? 0),
              amount: Number(it.amount ?? 0),
              batch_no: it.batch_no ?? "",
              supplier_id: it.supplier_id != null ? String(it.supplier_id) : null,
              supplier_name: it.supplier_name ?? null,
              raw_data: it,
              synced_at: new Date().toISOString(),
            };
            const { error: itErr } = await admin
              .from("jst_aftersale_received_items")
              .upsert(itemRow, { onConflict: "as_id,sku_id,batch_no" });
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
      message: `销售退仓同步完成 · API ${apiCount} 次 · ${orders} 单 / ${items} 明细 · 失败 ${failed}`,
      error_detail: errors.length ? errors.slice(0, 10).join(" | ").slice(0, 1500) : null,
    }).eq("id", logId);
  } catch (e) {
    await admin.from("jst_sync_logs").update({
      status: "failed",
      ended_at: new Date().toISOString(),
      fetched_orders_count: orders,
      fetched_items_count: items,
      message: `销售退仓同步失败 page=${page}`,
      error_detail: String((e as Error).message ?? e).slice(0, 1500),
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
      message: `开始同步销售退仓 ${fmtBJ(from)} → ${fmtBJ(to)}`,
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
