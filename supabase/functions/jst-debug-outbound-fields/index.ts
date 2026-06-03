import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { admin, callOpenweb, fmtBJ, parseHasNext, resolveCaller, resolveWindow } from "../_shared/jst-client.ts";

const METHOD_PATH = "orders/out/simple/query";
const SYNC_TYPE = "outbound_orders_field_test";

const INOUT_FLDS = "io_id,so_id,o_id,shop_id,shop_name,wh_id,warehouse,status,modified,io_date,send_date,qty";

const CASES = [
  { code: "A_no_fields", fields: {} },
  { code: "B_inout_only", fields: { InoutFlds: INOUT_FLDS } },
  { code: "C_item_qty_only", fields: { InoutItemFlds: "qty" } },
  { code: "D_both_qty", fields: { InoutFlds: INOUT_FLDS, InoutItemFlds: "qty" } },
];

const ITEM_FIELDS = ["items", "skus", "items_list", "order_items", "details", "item_list", "orderitems"];

function previewOf(biz: Record<string, unknown>) {
  const preview: Record<string, unknown> = {};
  for (const key of ["page_index", "page_size", "modified_begin", "modified_end", "InoutFlds", "InoutItemFlds"]) {
    if (key in biz) preview[key] = biz[key];
  }
  preview.value_types = Object.fromEntries(Object.entries(preview).map(([key, value]) => [key, Array.isArray(value) ? "array" : typeof value]));
  return preview;
}

function detectItems(row: any) {
  for (const field of ITEM_FIELDS) {
    const list = row?.[field];
    if (Array.isArray(list)) return { field, count: list.length, first_item_keys: list[0] ? Object.keys(list[0]).slice(0, 60) : [] };
  }
  return { field: null, count: 0, first_item_keys: [] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const caller = await resolveCaller(req);
    const cronSecret = req.headers.get("x-cron-secret") ?? "";
    const okCron = !!Deno.env.get("JST_SYNC_CRON_SECRET") && cronSecret === Deno.env.get("JST_SYNC_CRON_SECRET");
    if (!okCron && !caller.isAdmin) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const { from, to } = resolveWindow({ ...body, hours: body.hours ?? 1 });
    const pageSize = Math.min(Math.max(Number(body.page_size ?? 1), 1), 50);
    const results = [];

    for (const testCase of CASES) {
      const biz = {
        page_index: 1,
        page_size: pageSize,
        modified_begin: fmtBJ(from),
        modified_end: fmtBJ(to),
        ...testCase.fields,
      };
      const request_body_preview = previewOf(biz);
      try {
        console.log(`[outbound-field-test] ${testCase.code} params=${JSON.stringify(biz)}`);
        const data = await callOpenweb(METHOD_PATH, biz);
        const list: any[] = data.datas ?? data.list ?? data.orders ?? [];
        const first = list[0] ?? null;
        const itemShape = detectItems(first);
        results.push({
          case: testCase.code,
          ok: true,
          response_code: 0,
          response_msg: "执行成功",
          request_body_preview,
          data_count: data.data_count ?? list.length,
          list_count: list.length,
          has_next: parseHasNext(data.has_next ?? data.hasNext, list.length === pageSize),
          top_keys: first ? Object.keys(first).slice(0, 80) : [],
          detected_item_field: itemShape.field,
          first_item_count: itemShape.count,
          first_item_keys: itemShape.first_item_keys,
        });
      } catch (e: any) {
        results.push({
          case: testCase.code,
          ok: false,
          response_code: e?.code ?? null,
          response_msg: e?.apiMsg ?? null,
          request_url: e?.url ?? null,
          request_body_preview,
          error_message: String(e?.message ?? e).slice(0, 800),
        });
      }
    }

    const successCount = results.filter((r) => r.ok).length;
    await admin.from("jst_sync_logs").insert({
      sync_type: SYNC_TYPE,
      status: successCount > 0 ? (successCount === results.length ? "success" : "partial_failed") : "failed",
      cursor_from: from.toISOString(),
      cursor_to: to.toISOString(),
      fetched_orders_count: results.reduce((sum, r: any) => sum + Number(r.list_count ?? 0), 0),
      fetched_items_count: results.reduce((sum, r: any) => sum + Number(r.first_item_count ?? 0), 0),
      message: `销售出库字段参数 A/B 测试完成 · 成功 ${successCount}/${results.length}`,
      ended_at: new Date().toISOString(),
      metadata: {
        final_api_path: `/open/${METHOD_PATH}`,
        tests: results,
      },
    });

    return new Response(JSON.stringify({ ok: true, final_api_path: `/open/${METHOD_PATH}`, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
