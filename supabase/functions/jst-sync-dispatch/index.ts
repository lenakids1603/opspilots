// Edge Function: 聚水潭基础档案同步调度器
// 本批仅支持 module_key="base_archive"，子任务：店铺 / 供应商 / 仓库
// 鉴权: Authorization Bearer <user_jwt>，要求 ops_internal + admin

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createHash } from "node:crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const OPENWEB_BASE = "https://openapi.jushuitan.com";
const JST_APP_KEY = Deno.env.get("JST_APP_KEY") ?? "";
const JST_APP_SECRET = Deno.env.get("JST_APP_SECRET") ?? "";
const JST_ACCESS_TOKEN_SEED = Deno.env.get("JST_ACCESS_TOKEN") ?? "";
const JST_REFRESH_TOKEN_SEED = Deno.env.get("JST_REFRESH_TOKEN") ?? "";

const JST_PROXY_URL = Deno.env.get("JST_PROXY_URL") ?? "";
const JST_PROXY_USER = Deno.env.get("JST_PROXY_USER") ?? "";
const JST_PROXY_PASS = Deno.env.get("JST_PROXY_PASS") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RATE_DELAY_MS = 260;

// ---------- proxy ----------
let _proxyClient: Deno.HttpClient | null = null;
function getProxyClient(): Deno.HttpClient | null {
  if (!JST_PROXY_URL) return null;
  if (_proxyClient) return _proxyClient;
  // @ts-ignore
  _proxyClient = Deno.createHttpClient({
    proxy: { transport: "http", url: JST_PROXY_URL, basicAuth: { username: JST_PROXY_USER, password: JST_PROXY_PASS } },
  });
  return _proxyClient;
}
async function proxyFetch(url: string, init: RequestInit) {
  const c = getProxyClient();
  // @ts-ignore
  return c ? await fetch(url, { ...init, client: c }) : await fetch(url, init);
}

// ---------- signing & token ----------
function signOpenweb(params: Record<string, string>, secret: string) {
  const keys = Object.keys(params).filter((k) => k !== "sign").sort();
  let src = secret;
  for (const k of keys) {
    const v = params[k];
    if (v !== undefined && v !== null && v !== "") src += k + v;
  }
  return md5(src);
}
async function loadToken() {
  const { data } = await admin.from("jst_tokens").select("access_token, refresh_token, expires_at")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!data?.access_token) return null;
  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string) ?? "",
    expiresAt: data.expires_at ? new Date(data.expires_at as string) : null,
  };
}
async function saveToken(at: string, rt: string, exp: number) {
  const expiresAt = new Date(Date.now() + Math.max(60, exp - 30) * 1000).toISOString();
  await admin.from("jst_tokens").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await admin.from("jst_tokens").insert({ access_token: at, refresh_token: rt, expires_at: expiresAt });
}
async function refreshAccessToken(rt: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  const params: Record<string, string> = {
    app_key: JST_APP_KEY, charset: "utf-8", grant_type: "refresh_token",
    refresh_token: rt, scope: "all", timestamp: ts,
  };
  params.sign = signOpenweb(params, JST_APP_SECRET);
  const resp = await proxyFetch(`${OPENWEB_BASE}/openWeb/auth/refreshToken`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const json = JSON.parse(await resp.text());
  const code = json.code ?? json.errCode;
  if (code !== 0 && code !== "0" && json.issuccess !== true) {
    throw new Error(`刷新 token 失败 code=${code} msg=${json.msg ?? ""}`);
  }
  const d = json.data ?? json;
  const accessToken = d.access_token ?? d.accessToken;
  const refreshToken = d.refresh_token ?? d.refreshToken ?? rt;
  const expiresIn = Number(d.expires_in ?? d.expiresIn ?? 7200);
  await saveToken(accessToken, refreshToken, expiresIn);
  return accessToken as string;
}
async function getValidAccessToken() {
  const tok = await loadToken();
  if (!tok) {
    if (!JST_ACCESS_TOKEN_SEED) throw new Error("缺少 JST_ACCESS_TOKEN 种子");
    return JST_ACCESS_TOKEN_SEED;
  }
  if (tok.expiresAt && tok.expiresAt.getTime() - Date.now() > 5 * 60 * 1000) return tok.accessToken;
  const seed = tok.refreshToken || JST_REFRESH_TOKEN_SEED;
  if (!seed) return tok.accessToken;
  try { return await refreshAccessToken(seed); } catch { return tok.accessToken; }
}

async function callOpenweb(path: string, biz: Record<string, unknown>, attempt = 1): Promise<any> {
  if (!JST_APP_KEY || !JST_APP_SECRET) throw new Error("缺少 JST_APP_KEY / JST_APP_SECRET");
  const accessToken = await getValidAccessToken();
  const ts = String(Math.floor(Date.now() / 1000));
  const params: Record<string, string> = {
    access_token: accessToken, app_key: JST_APP_KEY, biz: JSON.stringify(biz),
    charset: "utf-8", timestamp: ts, version: "2",
  };
  params.sign = signOpenweb(params, JST_APP_SECRET);
  const url = `${OPENWEB_BASE}/open/${path.replace(/^\/+/, "")}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  let text: string;
  try {
    const resp = await proxyFetch(url, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(), signal: ctrl.signal,
    });
    text = await resp.text();
  } finally { clearTimeout(timer); }
  const json = JSON.parse(text);
  const code = json.code ?? json.errCode;
  const msg = json.msg ?? json.message ?? "";
  const isOk = code === 0 || code === "0" || json.issuccess === true;
  if (!isOk && attempt === 1 && /token|授权|access_token|令牌/i.test(String(msg))) {
    const seed = (await loadToken())?.refreshToken || JST_REFRESH_TOKEN_SEED;
    if (seed) await refreshAccessToken(seed);
    return await callOpenweb(path, biz, 2);
  }
  if (!isOk) throw new Error(`JST ${path} 失败 code=${code} msg=${msg}`);
  return json.data ?? json;
}

const pickStr = (...vs: any[]) => {
  for (const v of vs) if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  return "";
};

// ---------- syncers ----------
async function syncShops() {
  let page = 1, total = 0, mappingInserted = 0, mappingUpdated = 0,
    autoMatched = 0, shopsUpdated = 0, unmapped = 0;
  const nowIso = new Date().toISOString();
  while (true) {
    const data = await callOpenweb("shops/query", { page_index: page, page_size: 100 });
    const list: any[] = data.shops ?? data.datas ?? data.list ?? [];
    if (list.length === 0) break;
    for (const r of list) {
      const jstShopId = pickStr(r.shop_id, r.shopId, r.id);
      const jstShopName = pickStr(r.shop_name, r.name, r.nick);
      const platformType = pickStr(r.shop_site, r.platform, r.shop_type, r.site);
      const platformShopId = pickStr(r.platform_shop_id, r.out_shop_id, r.shop_no, r.code);
      const shopStatus = pickStr(r.shop_status, r.status, r.co_status);
      const authStatus = pickStr(r.auth_status, r.authorize_status);
      if (!jstShopId) continue;
      total++;

      // 1) upsert 到映射表
      const { data: existingMap } = await admin.from("jst_shop_mappings")
        .select("id, matched_shop_id, mapping_status")
        .eq("jst_shop_id", jstShopId).maybeSingle();

      // 2) 尝试自动匹配系统 shops
      let matchedShopId: string | null = existingMap?.matched_shop_id ?? null;
      if (!matchedShopId) {
        const { data: shopHit } = await admin.from("shops").select("id, entity_id, platform_id")
          .eq("external_shop_id", jstShopId).is("deleted_at", null).maybeSingle();
        if (shopHit) {
          matchedShopId = shopHit.id;
          autoMatched++;
        }
      }

      const mappingStatus = existingMap?.mapping_status === "ignored"
        ? "ignored"
        : (matchedShopId ? "mapped" : "unmapped");

      const row = {
        jst_shop_id: jstShopId,
        jst_shop_name: jstShopName,
        platform_type: platformType,
        platform_shop_id: platformShopId,
        shop_status: shopStatus,
        auth_status: authStatus,
        raw_json: r,
        matched_shop_id: matchedShopId,
        mapping_status: mappingStatus,
        last_sync_at: nowIso,
        updated_at: nowIso,
      };

      if (existingMap) {
        await admin.from("jst_shop_mappings").update(row).eq("id", existingMap.id);
        mappingUpdated++;
      } else {
        await admin.from("jst_shop_mappings").insert(row);
        mappingInserted++;
      }

      // 3) 已映射的同步更新系统 shops 表的名称（不动 entity/platform 绑定）
      if (matchedShopId && mappingStatus === "mapped") {
        await admin.from("shops").update({ name: jstShopName, updated_at: nowIso })
          .eq("id", matchedShopId);
        shopsUpdated++;
      } else if (mappingStatus === "unmapped") {
        unmapped++;
      }
    }
    if (list.length < 100) break;
    page++;
    await sleep(RATE_DELAY_MS);
  }
  return {
    total, mappingInserted, mappingUpdated, autoMatched, shopsUpdated, unmapped,
    summary: `店铺 ${total} 条（新增映射 ${mappingInserted}，更新 ${mappingUpdated}，自动绑定 ${autoMatched}，未绑定 ${unmapped}）`,
  };
}

async function syncSuppliers() {
  let page = 1, total = 0, inserted = 0, updated = 0;
  while (true) {
    const data = await callOpenweb("suppliers/query", { page_index: page, page_size: 100 });
    const list: any[] = data.suppliers ?? data.datas ?? data.list ?? [];
    if (list.length === 0) break;
    for (const r of list) {
      const jstId = pickStr(r.supplier_id, r.supplierId, r.id);
      const name = pickStr(r.supplier_name, r.name);
      if (!jstId || !name) continue;
      total++;
      const { data: existing } = await admin.from("ops_suppliers").select("id")
        .eq("jst_supplier_id", jstId).maybeSingle();
      const row = {
        jst_supplier_id: jstId,
        name,
        code: pickStr(r.code, r.supplier_code, jstId),
        contact: pickStr(r.contact, r.contact_name),
        phone: pickStr(r.phone, r.mobile, r.tel),
        email: pickStr(r.email),
        address: pickStr(r.address),
        updated_at: new Date().toISOString(),
      };
      if (existing) {
        await admin.from("ops_suppliers").update(row).eq("id", existing.id);
        updated++;
      } else {
        await admin.from("ops_suppliers").insert({ ...row, status: "active" });
        inserted++;
      }
    }
    if (list.length < 100) break;
    page++;
    await sleep(RATE_DELAY_MS);
  }
  return { total, inserted, updated, summary: `供应商 ${total} 条（新增 ${inserted}，更新 ${updated}）` };
}

async function syncWarehouses() {
  let page = 1, total = 0, inserted = 0, updated = 0;
  while (true) {
    const data = await callOpenweb("wms/partner/query", { page_index: page, page_size: 100 });
    const list: any[] = data.partners ?? data.datas ?? data.list ?? [];
    if (list.length === 0) break;
    for (const r of list) {
      const wmsCoId = pickStr(r.wms_co_id, r.wmsCoId, r.id);
      const name = pickStr(r.name, r.co_name, r.partner_name);
      if (!wmsCoId) continue;
      total++;
      const row = {
        jst_wms_co_id: wmsCoId,
        name,
        type: pickStr(r.type, r.co_type),
        status: pickStr(r.status) === "Disabled" ? "disabled" : "active",
        remark: pickStr(r.remark),
        raw_jst_json: r,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { data: existing } = await admin.from("jst_warehouses").select("id")
        .eq("jst_wms_co_id", wmsCoId).maybeSingle();
      if (existing) {
        await admin.from("jst_warehouses").update(row).eq("id", existing.id);
        updated++;
      } else {
        await admin.from("jst_warehouses").insert(row);
        inserted++;
      }
    }
    if (list.length < 100) break;
    page++;
    await sleep(RATE_DELAY_MS);
  }
  return { total, inserted, updated, summary: `仓库 ${total} 条（新增 ${inserted}，更新 ${updated}）` };
}

// ---------- 销售/退款同步 ----------
async function fetchShopMappingIndex() {
  const { data } = await admin.from("jst_shop_mappings")
    .select("jst_shop_id, matched_shop_id, matched_business_entity_id, matched_platform_id, mapping_status");
  const map = new Map<string, any>();
  (data ?? []).forEach((r: any) => { if (r.jst_shop_id) map.set(String(r.jst_shop_id), r); });
  return map;
}

function pickDate(...vs: any[]): string | null {
  for (const v of vs) if (v) { const d = new Date(v); if (!isNaN(d.getTime())) return d.toISOString(); }
  return null;
}
function pickNum(...vs: any[]): number {
  for (const v of vs) if (v !== undefined && v !== null && v !== "") { const n = Number(v); if (!isNaN(n)) return n; }
  return 0;
}

async function syncSalesRefund(runId: string, days: number, allowSummary: boolean) {
  const shopIdx = await fetchShopMappingIndex();
  const endDate = new Date();
  const startDate = new Date(Date.now() - days * 86400_000);
  const fmt = (d: Date) => d.toISOString().replace("T", " ").substring(0, 19);

  let rawOrders = 0, rawRefunds = 0;

  // ----- 订单 -----
  let page = 1;
  while (true) {
    let data: any;
    try {
      data = await callOpenweb("orders/single/query", {
        page_index: page, page_size: 100,
        start_time: fmt(startDate), end_time: fmt(endDate),
        date_type: "modified",
      });
    } catch (e) {
      // 接口路径可能不同,记录后停止订单同步
      await admin.from("jst_sync_errors").insert({
        module_key: "sales_refund", error_level: "warn", status: "open",
        error_message: `订单接口调用失败(可能路径不匹配):${String((e as any)?.message ?? e)}`,
      });
      break;
    }
    const list: any[] = data.orders ?? data.datas ?? data.list ?? [];
    if (list.length === 0) break;

    const rows = list.flatMap((o) => {
      const jstShopId = pickStr(o.shop_id, o.shopId);
      const m = shopIdx.get(jstShopId) ?? {};
      const items: any[] = o.items ?? o.order_items ?? [{ sku_id: o.sku_id, sku: o.sku, name: o.name, amount: o.pay_amount ?? o.amount }];
      return items.map((it) => ({
        sync_run_id: runId,
        record_type: "order",
        jst_shop_id: jstShopId,
        matched_shop_id: m.matched_shop_id ?? null,
        matched_business_entity_id: m.matched_business_entity_id ?? null,
        matched_platform_id: m.matched_platform_id ?? null,
        mapping_status: m.mapping_status ?? "unmapped",
        jst_order_id: pickStr(o.o_id, o.order_id, o.id),
        platform_order_id: pickStr(o.so_id, o.platform_order_id, o.out_order_id),
        sku_id: pickStr(it.sku_id, it.skuId),
        sku_code: pickStr(it.sku, it.sku_code, it.outer_sku_id),
        product_code: pickStr(it.i_id, it.item_id, it.product_code),
        product_name: pickStr(it.name, it.product_name),
        order_paid_at: pickDate(o.pay_date, o.paid_at, o.modified),
        order_amount: pickNum(it.amount, it.pay_amount, o.pay_amount),
        order_status: pickStr(o.status, o.order_status),
        raw_json: o,
        source_updated_at: pickDate(o.modified, o.updated_at),
      })).filter((r) => r.jst_order_id);
    });

    if (rows.length) {
      const { error } = await admin.from("jst_sales_refund_raw")
        .upsert(rows, { onConflict: "jst_order_id,sku_code", ignoreDuplicates: false });
      if (!error) rawOrders += rows.length;
    }

    if (list.length < 100) break;
    page++;
    await sleep(RATE_DELAY_MS);
  }

  // ----- 退款 -----
  page = 1;
  while (true) {
    let data: any;
    try {
      data = await callOpenweb("refunds/query", {
        page_index: page, page_size: 100,
        start_time: fmt(startDate), end_time: fmt(endDate),
        date_type: "modified",
      });
    } catch (e) {
      await admin.from("jst_sync_errors").insert({
        module_key: "sales_refund", error_level: "warn", status: "open",
        error_message: `退款接口调用失败(可能路径不匹配):${String((e as any)?.message ?? e)}`,
      });
      break;
    }
    const list: any[] = data.refunds ?? data.datas ?? data.list ?? [];
    if (list.length === 0) break;

    const rows = list.flatMap((r) => {
      const jstShopId = pickStr(r.shop_id, r.shopId);
      const m = shopIdx.get(jstShopId) ?? {};
      const items: any[] = r.items ?? r.refund_items ?? [{ sku: r.sku, sku_id: r.sku_id, name: r.name, refund: r.refund }];
      return items.map((it) => ({
        sync_run_id: runId,
        record_type: "refund",
        jst_shop_id: jstShopId,
        matched_shop_id: m.matched_shop_id ?? null,
        matched_business_entity_id: m.matched_business_entity_id ?? null,
        matched_platform_id: m.matched_platform_id ?? null,
        mapping_status: m.mapping_status ?? "unmapped",
        refund_id: pickStr(r.as_id, r.refund_id, r.id),
        jst_order_id: pickStr(r.o_id, r.order_id),
        platform_order_id: pickStr(r.so_id, r.out_order_id),
        sku_id: pickStr(it.sku_id, it.skuId),
        sku_code: pickStr(it.sku, it.sku_code),
        product_name: pickStr(it.name, it.product_name),
        refund_completed_at: pickDate(r.refunded_date, r.refund_date, r.modified),
        refund_amount: pickNum(it.refund, it.refund_amount, r.refund),
        refund_status: pickStr(r.status, r.refund_status),
        raw_json: r,
        source_updated_at: pickDate(r.modified, r.updated_at),
      })).filter((x) => x.refund_id);
    });

    if (rows.length) {
      const { error } = await admin.from("jst_sales_refund_raw")
        .upsert(rows, { onConflict: "refund_id,sku_code", ignoreDuplicates: false });
      if (!error) rawRefunds += rows.length;
    }

    if (list.length < 100) break;
    page++;
    await sleep(RATE_DELAY_MS);
  }

  // ----- 汇总 -----
  let summaryRows = 0, todayGmv = 0, todayGsv = 0, todayRefund = 0, todayOrders = 0, activeShops = 0;
  if (allowSummary) {
    // 拉取 mapped 且字段完整的原始数据
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const { data: raws } = await admin.from("jst_sales_refund_raw")
      .select("record_type, matched_shop_id, matched_business_entity_id, matched_platform_id, mapping_status, order_paid_at, refund_completed_at, order_amount, refund_amount, jst_order_id, refund_id")
      .eq("mapping_status", "mapped")
      .gte("created_at", since);

    const grouped = new Map<string, any>();
    (raws ?? []).forEach((r: any) => {
      if (!r.matched_shop_id || !r.matched_business_entity_id || !r.matched_platform_id) return;
      const ts = r.record_type === "order" ? r.order_paid_at : r.refund_completed_at;
      if (!ts) return;
      const dateStr = String(ts).substring(0, 10);
      const key = `${dateStr}__${r.matched_shop_id}`;
      const g = grouped.get(key) ?? {
        summary_date: dateStr, shop_id: r.matched_shop_id,
        business_entity_id: r.matched_business_entity_id, platform_id: r.matched_platform_id,
        gmv_amount: 0, gsv_amount: 0, refund_amount: 0,
        order_count: 0, refund_count: 0,
        order_ids: new Set<string>(), refund_ids: new Set<string>(),
      };
      if (r.record_type === "order") {
        g.gmv_amount += Number(r.order_amount ?? 0);
        if (r.jst_order_id) g.order_ids.add(r.jst_order_id);
      } else {
        g.refund_amount += Number(r.refund_amount ?? 0);
        if (r.refund_id) g.refund_ids.add(r.refund_id);
      }
      grouped.set(key, g);
    });

    const today = new Date().toISOString().substring(0, 10);
    const upserts = Array.from(grouped.values()).map((g) => {
      const orderCount = g.order_ids.size, refundCount = g.refund_ids.size;
      const gsv = Math.max(0, g.gmv_amount - g.refund_amount);
      const refundRate = g.gmv_amount > 0 ? Number((g.refund_amount / g.gmv_amount * 100).toFixed(2)) : 0;
      if (g.summary_date === today) {
        todayGmv += g.gmv_amount; todayGsv += gsv; todayRefund += g.refund_amount; todayOrders += orderCount;
      }
      return {
        summary_date: g.summary_date, shop_id: g.shop_id,
        business_entity_id: g.business_entity_id, platform_id: g.platform_id,
        gmv_amount: g.gmv_amount, gsv_amount: gsv, refund_amount: g.refund_amount,
        order_count: orderCount, refund_count: refundCount, refund_rate: refundRate,
        data_source_label: "聚水潭经营口径",
        generated_from_run_id: runId, generated_at: new Date().toISOString(),
      };
    });

    if (upserts.length) {
      await admin.from("jst_sales_refund_daily_summary")
        .upsert(upserts, { onConflict: "summary_date,shop_id" });
      summaryRows = upserts.length;
    }
    activeShops = new Set(upserts.filter((u) => u.summary_date === today).map((u) => u.shop_id)).size;
  }

  return { rawOrders, rawRefunds, summaryRows, todayGmv, todayGsv, todayRefund, todayOrders, activeShops };
}

// ---------- 店铺映射前置校验 (sales_refund 等真实业务同步前调用) ----------
async function shopMappingPrecheck() {
  const { data } = await admin.from("jst_shop_mappings")
    .select("matched_shop_id, matched_business_entity_id, matched_platform_id, mapping_status");
  const rows = (data ?? []) as any[];
  const active = rows.filter(r => r.mapping_status !== "ignored");
  const unmapped = active.filter(r => r.mapping_status === "unmapped").length;
  const noEntity = active.filter(r => !r.matched_business_entity_id).length;
  const noPlatform = active.filter(r => !r.matched_platform_id).length;
  const shopCount = new Map<string, number>();
  active.forEach(r => { if (r.matched_shop_id) shopCount.set(r.matched_shop_id, (shopCount.get(r.matched_shop_id) ?? 0) + 1); });
  const dupCount = Array.from(shopCount.values()).filter(n => n > 1).length;
  const blocking = unmapped > 0 || noEntity > 0 || noPlatform > 0 || dupCount > 0;
  return {
    blocking, unmapped, noEntity, noPlatform, dupCount,
    summary: `未绑定 ${unmapped} 个,无主体 ${noEntity} 个,无平台 ${noPlatform} 个,重复绑定 ${dupCount} 组`,
  };
}



// ---------- main ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const respJson = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return respJson({ error: "缺少 Authorization" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return respJson({ error: "未登录" }, 401);

    // 权限校验
    const { data: isInternal } = await admin.rpc("is_ops_internal", { _uid: user.id });
    const { data: isAdmin } = await admin.rpc("has_ops_role", { _uid: user.id, _code: "admin" });
    if (!isInternal || !isAdmin) return respJson({ error: "需 admin 权限" }, 403);

    const body = await req.json().catch(() => ({}));
    const moduleKey = String(body.module_key ?? "");
    const triggerType = String(body.trigger_type ?? "manual");
    const scope = body.scope as string[] | undefined;
    const days = Math.max(1, Math.min(60, Number(body.days ?? 7)));

    // ============ sales_refund ============
    if (moduleKey === "sales_refund") {
      const precheck = await shopMappingPrecheck();
      const startedAt = new Date().toISOString();
      const t0 = Date.now();

      const { data: runRow, error: runErr } = await admin.from("jst_sync_runs").insert({
        module_key: "sales_refund", trigger_type: triggerType, status: "running",
        started_at: startedAt, created_by: user.id,
        current_total_summary: precheck.blocking
          ? `开始同步原始数据(店铺映射未完成,跳过正式汇总):${precheck.summary}`
          : `开始同步并生成正式汇总`,
      }).select("id").single();
      if (runErr) return respJson({ error: runErr.message }, 500);
      const runId = runRow.id;

      try {
        const result = await syncSalesRefund(runId, days, !precheck.blocking);
        const finishedAt = new Date().toISOString();
        const durationMs = Date.now() - t0;
        const summaryUpdated = !precheck.blocking;
        const msg = summaryUpdated
          ? `原始订单 ${result.rawOrders} 条,原始退款 ${result.rawRefunds} 条,正式汇总 ${result.summaryRows} 行(店铺×日)`
          : `原始订单 ${result.rawOrders} 条,原始退款 ${result.rawRefunds} 条;被阻止汇总:${precheck.summary}`;

        await admin.from("jst_sync_runs").update({
          status: "ok", finished_at: finishedAt, duration_ms: durationMs,
          inserted_count: result.rawOrders + result.rawRefunds,
          updated_count: result.summaryRows,
          current_total_summary: msg,
          error_message: precheck.blocking ? `店铺映射未完成,未更新正式汇总:${precheck.summary}` : "",
        }).eq("id", runId);

        if (precheck.blocking) {
          await admin.from("jst_sync_errors").insert({
            module_key: "sales_refund", error_level: "warn", status: "open",
            error_message: `店铺映射未完成,允许保存原始数据但不更新正式销售汇总:${precheck.summary}`,
          });
        } else {
          await admin.from("jst_sync_metrics").upsert({
            metric_key: "sales_summary", metric_name: "销售与退款",
            metric_value: `今日 GMV ¥${result.todayGmv.toFixed(0)}`,
            metric_extra: {
              today_gmv: result.todayGmv, today_gsv: result.todayGsv,
              today_refund: result.todayRefund, today_orders: result.todayOrders,
              refund_rate: result.todayGmv > 0 ? Number((result.todayRefund / result.todayGmv * 100).toFixed(2)) : 0,
              active_shops: result.activeShops,
              sync_delta_orders: result.rawOrders, sync_delta_gmv: result.todayGmv, status: "ok",
            },
            time_range_label: `最近 ${days} 天`,
            data_source_label: "聚水潭经营口径",
            last_sync_at: finishedAt, updated_at: finishedAt,
          }, { onConflict: "metric_key" });
        }

        return respJson({ ok: true, run_id: runId, summary_updated: summaryUpdated, message: msg, precheck, ...result });
      } catch (e: any) {
        const finishedAt = new Date().toISOString();
        const errMsg = String(e?.message ?? e);
        await admin.from("jst_sync_runs").update({
          status: "error", finished_at: finishedAt, duration_ms: Date.now() - t0,
          error_message: errMsg, current_total_summary: "同步失败",
        }).eq("id", runId);
        await admin.from("jst_sync_errors").insert({
          module_key: "sales_refund", error_level: "error",
          error_message: errMsg, status: "open",
        });
        return respJson({ ok: false, run_id: runId, error: errMsg }, 200);
      }
    }

    if (moduleKey !== "base_archive") {
      return respJson({ error: `module_key=${moduleKey} 暂未接入真实同步，目前仅支持 base_archive` }, 400);
    }


    const targets = scope?.length ? scope : ["shops", "suppliers", "warehouses"];
    const startedAt = new Date().toISOString();
    const t0 = Date.now();

    // 写入 run 记录
    const { data: runRow, error: runErr } = await admin.from("jst_sync_runs").insert({
      module_key: moduleKey, trigger_type: triggerType, status: "running",
      started_at: startedAt, created_by: user.id,
      current_total_summary: `开始同步：${targets.join(", ")}`,
    }).select("id").single();
    if (runErr) return respJson({ error: runErr.message }, 500);
    const runId = runRow.id;

    try {
      const parts: string[] = [];
      let inserted = 0, updated = 0;
      let shopStats: any = null;
      for (const t of targets) {
        if (t === "shops") {
          const r = await syncShops();
          parts.push(r.summary);
          inserted += r.mappingInserted; updated += r.mappingUpdated + r.shopsUpdated;
          shopStats = r;
        } else if (t === "suppliers") {
          const r = await syncSuppliers();
          parts.push(r.summary);
          inserted += r.inserted; updated += r.updated;
        } else if (t === "warehouses") {
          const r = await syncWarehouses();
          parts.push(r.summary);
          inserted += r.inserted; updated += r.updated;
        }
      }
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - t0;
      const summary = parts.join("；");
      const nextSync = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      await admin.from("jst_sync_runs").update({
        status: "ok", finished_at: finishedAt, duration_ms: durationMs,
        inserted_count: inserted, updated_count: updated,
        current_total_summary: summary,
      }).eq("id", runId);

      await admin.from("jst_sync_modules").update({
        status: "ok", last_sync_at: finishedAt, next_sync_at: nextSync,
        last_result_summary: summary, retry_count: 0,
      }).eq("module_key", "base_archive");

      await admin.from("jst_sync_errors").update({ status: "resolved", resolved_at: finishedAt })
        .eq("module_key", "base_archive").neq("status", "resolved");

      await admin.from("jst_sync_metrics").upsert({
        metric_key: "base_archive_summary",
        metric_name: "基础档案",
        metric_value: summary,
        metric_extra: { parts, inserted, updated },
        time_range_label: "全量快照",
        data_source_label: "聚水潭基础档案",
        last_sync_at: finishedAt,
        updated_at: finishedAt,
      }, { onConflict: "metric_key" });

      // 店铺映射指标（从映射表实时聚合，避免只反映本次同步增量）
      if (shopStats) {
        const { data: allMaps } = await admin.from("jst_shop_mappings")
          .select("mapping_status");
        const totalAll = allMaps?.length ?? 0;
        const mapped = (allMaps ?? []).filter((m) => m.mapping_status === "mapped").length;
        const ignored = (allMaps ?? []).filter((m) => m.mapping_status === "ignored").length;
        const unmappedAll = (allMaps ?? []).filter((m) => m.mapping_status === "unmapped").length;
        await admin.from("jst_sync_metrics").upsert({
          metric_key: "shop_mapping_summary",
          metric_name: "店铺映射",
          metric_value: `共 ${totalAll}，已绑 ${mapped}，未绑 ${unmappedAll}，已忽略 ${ignored}`,
          metric_extra: { total: totalAll, mapped, unmapped: unmappedAll, ignored, ...shopStats },
          time_range_label: "全量快照",
          data_source_label: "聚水潭店铺",
          last_sync_at: finishedAt,
          updated_at: finishedAt,
        }, { onConflict: "metric_key" });
      }

      return respJson({ ok: true, run_id: runId, summary, inserted, updated, duration_ms: durationMs, shopStats });

    } catch (e: any) {
      const finishedAt = new Date().toISOString();
      const errMsg = String(e?.message ?? e);
      await admin.from("jst_sync_runs").update({
        status: "error", finished_at: finishedAt, duration_ms: Date.now() - t0,
        error_message: errMsg, current_total_summary: "同步失败",
      }).eq("id", runId);

      // 累计 retry_count
      const { data: existingErr } = await admin.from("jst_sync_errors").select("id, retry_count")
        .eq("module_key", "base_archive").neq("status", "resolved").maybeSingle();
      if (existingErr) {
        await admin.from("jst_sync_errors").update({
          error_message: errMsg, retry_count: (existingErr.retry_count ?? 0) + 1,
          last_seen_at: finishedAt, status: "retrying",
        }).eq("id", existingErr.id);
      } else {
        await admin.from("jst_sync_errors").insert({
          module_key: "base_archive", error_level: "error",
          error_message: errMsg, status: "open",
          first_seen_at: finishedAt, last_seen_at: finishedAt,
        });
      }
      await admin.from("jst_sync_modules").update({
        status: "error", last_result_summary: errMsg.slice(0, 200),
        retry_count: 0, last_sync_at: finishedAt,
      }).eq("module_key", "base_archive");

      return respJson({ ok: false, run_id: runId, error: errMsg }, 200);
    }
  } catch (e: any) {
    return respJson({ error: String(e?.message ?? e) }, 500);
  }
});
