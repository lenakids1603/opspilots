// Edge Function: 聚水潭售后 - 退货退款单同步
// API: /open/refund/single/query  (docId=1443)
// 写入 jst_refund_orders + jst_refund_order_items
// 日志写入 jst_sync_logs, sync_type='refund_orders'
//
// 关键策略：
//  - 时间窗口按 1 小时切片循环，避免一次拉取过大数据被中断
//  - 每页 page_size=50；每页写入后立即更新 heartbeat/checkpoint
//  - 整体运行预算 8 分钟，超时返回 status='timeout_partial'，下次可从 cursor_from 继续
//  - 每页打印 final 请求参数到日志和控制台，便于调试

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  admin, callOpenweb, fmtBJ, parseJstBeijingDateTime, parseHasNext,
  resolveCaller, resolveWindow, sleep, RATE_DELAY_MS, MAX_PAGE_NO,
} from "../_shared/jst-client.ts";

const SYNC_TYPE = "refund_orders";
const METHOD_PATH = "refund/single/query";
const PAGE_SIZE = 50;
const RUN_BUDGET_MS = 8 * 60 * 1000; // 8 分钟硬预算
const SLICE_MS = 60 * 60 * 1000;     // 1 小时切片

function buildSlices(from: Date, to: Date): Array<[Date, Date]> {
  const slices: Array<[Date, Date]> = [];
  if (to.getTime() - from.getTime() <= SLICE_MS) return [[from, to]];
  let cursor = from.getTime();
  const end = to.getTime();
  while (cursor < end) {
    const next = Math.min(cursor + SLICE_MS, end);
    slices.push([new Date(cursor), new Date(next)]);
    cursor = next;
  }
  return slices;
}

async function runSync(fromIso: string, toIso: string, logId: string) {
  const winFrom = new Date(fromIso);
  const winTo = new Date(toIso);
  const slices = buildSlices(winFrom, winTo);
  const startedAt = Date.now();
  let apiCount = 0, orders = 0, items = 0, failed = 0;
  const errors: string[] = [];
  let sliceIdx = 0;
  let timedOut = false;
  let lastPage = 0;
  let currentSliceFrom = winFrom;

  console.log(`[refund_orders] start window=${fmtBJ(winFrom)} → ${fmtBJ(winTo)} slices=${slices.length} method=/open/${METHOD_PATH}`);

  try {
    for (sliceIdx = 0; sliceIdx < slices.length; sliceIdx++) {
      const [sFrom, sTo] = slices[sliceIdx];
      currentSliceFrom = sFrom;
      let page = 1;
      lastPage = 0;

      while (true) {
        if (Date.now() - startedAt > RUN_BUDGET_MS) {
          timedOut = true;
          break;
        }
        if (page > MAX_PAGE_NO) throw new Error(`分页超过上限 ${MAX_PAGE_NO}`);
        await sleep(RATE_DELAY_MS);

        const biz = {
          page_index: page,
          page_size: PAGE_SIZE,
          modified_begin: fmtBJ(sFrom),
          modified_end: fmtBJ(sTo),
        };
        console.log(`[refund_orders] FINAL REQUEST path=/open/${METHOD_PATH} slice=${sliceIdx + 1}/${slices.length} ${fmtBJ(sFrom)}→${fmtBJ(sTo)} page=${page} size=${PAGE_SIZE}`);

        const data = await callOpenweb(METHOD_PATH, biz);
        apiCount++;
        const list: any[] = data.datas ?? data.list ?? data.refunds ?? data.orders ?? [];
        const hasNext = parseHasNext(data.has_next ?? data.hasNext, list.length === PAGE_SIZE);
        lastPage = page;

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
              const itemType = it.type ?? null;
              const itemUniqueKey = [
                asId || "",
                asiId || "",
                skuId || "",
                outerOiId || "",
                itemType || "",
              ].join("|");
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
                type: itemType,
                outer_oi_id: outerOiId,
                sku_type: it.sku_type ?? null,
                supplier_id: it.supplier_id != null ? String(it.supplier_id) : null,
                supplier_name: it.supplier_name ?? null,
                batch_no: it.batch_no ?? null,
                item_unique_key: itemUniqueKey,
                raw_data: it,
                synced_at: new Date().toISOString(),
              };
              const { error: itErr } = await admin
                .from("jst_refund_order_items")
                .upsert(itemRow, { onConflict: "item_unique_key" });
              if (itErr) throw itErr;
              items++;
            }
          } catch (we) {
            failed++;
            errors.push(`as_id=${asId}: ${(we as Error).message}`);
          }
        }

        // 每页写入后更新 checkpoint
        await admin.from("jst_sync_logs").update({
          fetched_orders_count: orders,
          fetched_items_count: items,
          cursor_from: sFrom.toISOString(),
          cursor_to: winTo.toISOString(),
          message: `窗口 ${sliceIdx + 1}/${slices.length} [${fmtBJ(sFrom)}~${fmtBJ(sTo)}] · 第 ${page} 页 · 累计 ${orders} 单 / ${items} 明细 · has_next=${hasNext}`,
          heartbeat_at: new Date().toISOString(),
        }).eq("id", logId);

        if (!hasNext || list.length === 0) break;
        page++;
      }

      if (timedOut) break;
    }

    let status: string;
    let finalMsg: string;
    if (timedOut) {
      status = "timeout_partial";
      finalMsg = `部分同步：达到 8 分钟运行预算，已完成 ${sliceIdx}/${slices.length} 个时间窗口。点击「继续同步」从 ${fmtBJ(currentSliceFrom)} 续传。累计 ${orders} 单 / ${items} 明细 · 失败 ${failed}`;
    } else if (errors.length && orders === 0) {
      status = "failed";
      finalMsg = `退货退款单同步失败 · API ${apiCount} 次 · 失败 ${failed}`;
    } else if (errors.length) {
      status = "partial_failed";
      finalMsg = `退货退款单同步完成（含失败）· API ${apiCount} 次 · ${orders} 单 / ${items} 明细 · 失败 ${failed}`;
    } else {
      status = "success";
      finalMsg = `退货退款单同步完成 · API ${apiCount} 次 · ${slices.length} 个时间窗口 · ${orders} 单 / ${items} 明细`;
    }

    await admin.from("jst_sync_logs").update({
      status,
      ended_at: new Date().toISOString(),
      fetched_orders_count: orders,
      fetched_items_count: items,
      cursor_from: timedOut ? currentSliceFrom.toISOString() : winFrom.toISOString(),
      cursor_to: winTo.toISOString(),
      message: finalMsg,
      error_detail: errors.length ? errors.slice(0, 10).join(" | ").slice(0, 1500) : null,
    }).eq("id", logId);
    console.log(`[refund_orders] done status=${status} ${finalMsg}`);
  } catch (e: any) {
    const err = e as any;
    const isAbort = err?.aborted || err?.name === "AbortError" || /abort/i.test(String(err?.message ?? ""));
    const friendly = isAbort
      ? `退货退款单同步请求超时或被中断（slice ${sliceIdx + 1}/${slices.length}, page ${lastPage}）。已写入的数据已保留，下次可从 ${fmtBJ(currentSliceFrom)} 继续同步。`
      : `退货退款单同步失败 slice=${sliceIdx + 1}/${slices.length} page=${lastPage}`;
    const detail = [
      `final_api_path=/open/${METHOD_PATH}`,
      `slice_from=${fmtBJ(currentSliceFrom)}`,
      `slice_to=${fmtBJ(slices[sliceIdx]?.[1] ?? winTo)}`,
      `page_index=${lastPage}`,
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
      status: isAbort ? "timeout_partial" : "failed",
      ended_at: new Date().toISOString(),
      fetched_orders_count: orders,
      fetched_items_count: items,
      cursor_from: currentSliceFrom.toISOString(),
      cursor_to: winTo.toISOString(),
      message: friendly,
      error_detail: detail.slice(0, 1500),
    }).eq("id", logId);
    console.error(`[refund_orders] error ${friendly} | ${detail}`);
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
      message: `开始同步退货退款单 ${fmtBJ(from)} → ${fmtBJ(to)} · 窗口将按 1 小时切片`,
    }).select("id").single();
    if (logErr) throw logErr;

    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil(runSync(from.toISOString(), to.toISOString(), log.id));

    return new Response(JSON.stringify({
      ok: true, background: true, log_id: log.id,
      cursor_from: from.toISOString(), cursor_to: to.toISOString(),
      api_path: `/open/${METHOD_PATH}`,
      message: "同步已在后台启动",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
