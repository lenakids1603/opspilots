// Edge Function: 聚水潭商品/SKU 资料同步
// 独立于采购单同步,负责把聚水潭商品+SKU 写入 ops_products / ops_skus / ops_sku_aliases,
// 并把图片从聚水潭外链转存到 Supabase Storage (bucket: product-images)。
//
// 鉴权:Authorization: Bearer <user_jwt>,且用户具 ops_role='admin'
// 支持的 action:
//   - sync_recent  { days?: number }            按 modified 时间增量
//   - sync_all     { max_pages?: number }       不带时间窗口的全量(慎用)
//   - sync_by_style{ style_no: string }         按款号补同步
//   - sync_by_sku  { sku_code: string }         按 SKU 编码补同步
//   - sync_images  { limit?: number }           仅图片转存,处理待转存的 N 条

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
const BUCKET = "product-images";

function sanitize(s: unknown) {
  return String(s ?? "").replace(/[A-Fa-f0-9]{32,}/g, "***");
}
function maskSecret(s: string) {
  if (!s) return "missing";
  if (s.length <= 8) return `${s.slice(0, 2)}***${s.slice(-2)}`;
  return `${s.slice(0, 4)}***${s.slice(-4)}`;
}
function fmtJst(d: Date) {
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai", hour12: false });
}
function apiPath(path: string) {
  return `/open/${path.replace(/^\/+/, "")}`;
}
function apiUrl(path: string) {
  return `${OPENWEB_BASE}${apiPath(path)}`;
}
function countPayload(payload: any): number {
  const list = payload?.datas ?? payload?.list ?? payload?.items ?? payload?.data ?? payload;
  return Array.isArray(list) ? list.length : 0;
}
function describeBiz(biz: Record<string, unknown>) {
  return {
    keys: Object.keys(biz).sort(),
    page_index: biz.page_index ?? null,
    page_size: biz.page_size ?? null,
    modified_begin: biz.modified_begin ?? null,
    modified_end: biz.modified_end ?? null,
    flds: biz.flds ?? null,
    has_i_id: Boolean(biz.i_id),
    has_sku_id: Boolean(biz.sku_id),
  };
}

// ---------- proxy ----------
let _proxyClient: Deno.HttpClient | null = null;
function getProxyClient(): Deno.HttpClient | null {
  if (!JST_PROXY_URL) return null;
  if (_proxyClient) return _proxyClient;
  // @ts-ignore Deno.createHttpClient unstable in Supabase runtime
  _proxyClient = Deno.createHttpClient({
    proxy: {
      transport: "http",
      url: JST_PROXY_URL,
      basicAuth: { username: JST_PROXY_USER, password: JST_PROXY_PASS },
    },
  });
  return _proxyClient;
}
async function proxyFetch(url: string, init: RequestInit) {
  const client = getProxyClient();
  if (client) {
    return await fetch(url, { ...init, client } as RequestInit & { client: Deno.HttpClient });
  }
  return await fetch(url, init);
}

// ---------- signing ----------
function signOpenweb(params: Record<string, string>, appSecret: string) {
  const keys = Object.keys(params).filter((k) => k !== "sign").sort();
  let src = appSecret;
  for (const k of keys) {
    const v = params[k];
    if (v !== undefined && v !== null && v !== "") src += k + v;
  }
  return md5(src);
}

// ---------- token ----------
async function loadToken() {
  const { data } = await admin
    .from("jst_tokens")
    .select("access_token, refresh_token, expires_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.access_token) return null;
  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string) ?? "",
    expiresAt: data.expires_at ? new Date(data.expires_at as string) : null,
  };
}
async function saveToken(accessToken: string, refreshToken: string, expiresInSec: number) {
  const expiresAt = new Date(Date.now() + Math.max(60, expiresInSec - 30) * 1000).toISOString();
  await admin.from("jst_tokens").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await admin.from("jst_tokens").insert({ access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt });
}
async function refreshAccessToken(currentRefreshToken: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  const params: Record<string, string> = {
    app_key: JST_APP_KEY, charset: "utf-8", grant_type: "refresh_token",
    refresh_token: currentRefreshToken, scope: "all", timestamp: ts,
  };
  params.sign = signOpenweb(params, JST_APP_SECRET);
  const resp = await proxyFetch(`${OPENWEB_BASE}/openWeb/auth/refreshToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const text = await resp.text();
  const json = JSON.parse(text);
  const code = json.code ?? json.errCode;
  if (code !== 0 && code !== "0" && json.issuccess !== true) {
    throw new Error(`刷新 token 失败 code=${code} msg=${json.msg ?? text.slice(0, 200)}`);
  }
  const d = json.data ?? json;
  const accessToken = d.access_token ?? d.accessToken;
  const refreshToken = d.refresh_token ?? d.refreshToken ?? currentRefreshToken;
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

// ---------- JST call ----------
type CallMeta = {
  path: string;
  url: string;
  env: "production";
  appKeyMasked: string;
  request: ReturnType<typeof describeBiz>;
  dataCount: number;
};
type CallResult = { ok: boolean; data: any; code: any; msg: string; permissionDenied: boolean; meta: CallMeta };

async function callOpenweb(path: string, biz: Record<string, unknown>, attempt = 1): Promise<CallResult> {
  if (!JST_APP_KEY || !JST_APP_SECRET) throw new Error("缺少 JST_APP_KEY / JST_APP_SECRET");
  const accessToken = await getValidAccessToken();
  const ts = String(Math.floor(Date.now() / 1000));
  const bizJson = JSON.stringify(biz);
  const params: Record<string, string> = {
    access_token: accessToken, app_key: JST_APP_KEY, biz: bizJson,
    charset: "utf-8", timestamp: ts, version: "2",
  };
  params.sign = signOpenweb(params, JST_APP_SECRET);
  const url = apiUrl(path);
  console.log(`[jst-products] call path=${apiPath(path)} url=${url} env=production app_key=${maskSecret(JST_APP_KEY)} biz_len=${bizJson.length}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  let resp: Response;
  try {
    resp = await proxyFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal: ctrl.signal,
    });
  } finally { clearTimeout(timer); }
  const text = await resp.text();
  let json: any;
  try { json = JSON.parse(text); }
  catch { throw new Error(`聚水潭 ${path} 返回非 JSON: ${text.slice(0, 200)}`); }
  const code = json.code ?? json.errCode;
  const msg = json.msg ?? json.message ?? "";
  const isOk = code === 0 || code === "0" || json.issuccess === true;
  const permissionDenied = String(code) === "190" || /无API权限|API权限|无权限|未开通|权限/i.test(String(msg));
  const payload = json.data ?? json;
  const meta: CallMeta = {
    path: apiPath(path),
    url,
    env: "production",
    appKeyMasked: maskSecret(JST_APP_KEY),
    request: describeBiz(biz),
    dataCount: countPayload(payload),
  };

  if (!isOk && attempt === 1 && /token|授权|access_token|令牌/i.test(String(msg))) {
    const seed = (await loadToken())?.refreshToken || JST_REFRESH_TOKEN_SEED;
    if (seed) await refreshAccessToken(seed);
    return await callOpenweb(path, biz, 2);
  }

  return { ok: isOk, data: payload, code, msg: sanitize(msg), permissionDenied, meta };
}

// 聚水潭 SKU 查询接口路径 (openweb)
const SKU_QUERY_PATH = "sku/query";

// ---------- supplier resolution ----------
async function resolveSupplierId(jstSupplierId: string | null, supplierName: string | null): Promise<string | null> {
  if (jstSupplierId) {
    const { data } = await admin.from("ops_suppliers").select("id").eq("jst_supplier_id", jstSupplierId).maybeSingle();
    if (data?.id) return data.id as string;
  }
  if (supplierName) {
    const { data } = await admin.from("ops_suppliers").select("id").eq("name", supplierName).maybeSingle();
    if (data?.id) return data.id as string;
  }
  return null;
}

// ---------- field mapping ----------
function pickStr(...vals: any[]): string {
  for (const v of vals) if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  return "";
}
function pickNum(...vals: any[]): number {
  for (const v of vals) {
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

// 把单条 JST sku 记录写入 ops_products + ops_skus + ops_sku_aliases
async function upsertSku(rec: any): Promise<{ productId: string; skuId: string }> {
  const jstSkuId = pickStr(rec.sku_id, rec.skuId, rec.id);
  const skuCode = pickStr(rec.sku_id, rec.sku_code, rec.skuCode, rec.skuId);
  const jstProductId = pickStr(rec.i_id, rec.iId, rec.item_id, rec.product_id);
  const styleNo = pickStr(rec.style_no, rec.styleNo, rec.style, rec.i_id, rec.iId);
  const productName = pickStr(rec.name, rec.item_name, rec.product_name, rec.title);
  const skuName = pickStr(rec.sku_name, rec.skuName, rec.properties_value, rec.name);
  const color = pickStr(rec.color, rec.properties_value && String(rec.properties_value).split(/[,;\s]+/)[0]);
  const size = pickStr(rec.size, rec.properties_value && String(rec.properties_value).split(/[,;\s]+/)[1]);
  const spec = pickStr(rec.properties_value, rec.spec, rec.spec_name);
  const barcode = pickStr(rec.barcode, rec.standard_barcode);
  const costPrice = pickNum(rec.cost_price, rec.costPrice, rec.purchase_price);
  const salePrice = pickNum(rec.sale_price, rec.salePrice, rec.price);
  const jstSupplierId = pickStr(rec.supplier_id, rec.supplierId);
  const supplierName = pickStr(rec.supplier_name, rec.supplierName);
  const skuImageUrl = pickStr(rec.pic, rec.pic_url, rec.picture, rec.image_url, rec.sku_pic);
  const productImageUrl = pickStr(rec.item_pic, rec.itemPic, rec.product_pic);

  if (!skuCode && !jstSkuId) throw new Error("SKU 缺少 sku_code / jst_sku_id");

  const supplierId = await resolveSupplierId(jstSupplierId || null, supplierName || null);

  // ── ops_products upsert by jst_product_id (优先) 否则 code
  const productCode = jstProductId || styleNo || skuCode;
  const productRow: Record<string, unknown> = {
    code: productCode,
    name: productName || productCode,
    product_name: productName || null,
    style_no: styleNo || null,
    jst_product_id: jstProductId || null,
    supplier_id: supplierId,
    supplier_name_snapshot: supplierName || null,
    external_image_url: productImageUrl || null,
    cost_price: costPrice,
    sale_price: salePrice,
    is_active: true,
    raw_jst_json: rec,
    last_synced_at: new Date().toISOString(),
  };
  // 先按 jst_product_id 查
  let productId: string | null = null;
  if (jstProductId) {
    const { data } = await admin.from("ops_products").select("id").eq("jst_product_id", jstProductId).maybeSingle();
    productId = (data?.id as string) ?? null;
  }
  if (!productId) {
    const { data } = await admin.from("ops_products").select("id").eq("code", productCode).maybeSingle();
    productId = (data?.id as string) ?? null;
  }
  if (productId) {
    await admin.from("ops_products").update(productRow).eq("id", productId);
  } else {
    const { data, error } = await admin.from("ops_products").insert(productRow).select("id").single();
    if (error) throw new Error(`upsert product 失败: ${error.message}`);
    productId = data!.id as string;
  }

  // ── ops_skus upsert
  const skuRow: Record<string, unknown> = {
    product_id: productId,
    sku_code: skuCode || jstSkuId,
    jst_sku_id: jstSkuId || null,
    sku_name: skuName || null,
    color: color || null,
    size: size || null,
    spec: spec || null,
    spec_name: spec || null,
    barcode: barcode || null,
    cost_price: costPrice,
    sale_price: salePrice,
    supplier_id: supplierId,
    external_image_url: skuImageUrl || null,
    is_active: true,
    raw_jst_json: rec,
    last_synced_at: new Date().toISOString(),
  };
  let skuId: string | null = null;
  if (jstSkuId) {
    const { data } = await admin.from("ops_skus").select("id").eq("jst_sku_id", jstSkuId).maybeSingle();
    skuId = (data?.id as string) ?? null;
  }
  if (!skuId) {
    const { data } = await admin.from("ops_skus").select("id").eq("sku_code", skuRow.sku_code as string).maybeSingle();
    skuId = (data?.id as string) ?? null;
  }
  if (skuId) {
    await admin.from("ops_skus").update(skuRow).eq("id", skuId);
  } else {
    const { data, error } = await admin.from("ops_skus").insert(skuRow).select("id").single();
    if (error) throw new Error(`upsert sku 失败: ${error.message}`);
    skuId = data!.id as string;
  }

  // ── alias jst
  if (jstSkuId || skuCode) {
    await admin.from("ops_sku_aliases").upsert({
      sku_id: skuId,
      alias_type: "jst",
      external_sku_code: skuCode || jstSkuId,
      external_sku_id: jstSkuId || null,
      jst_sku_id: jstSkuId || null,
      barcode: barcode || null,
      is_primary: true,
    }, { onConflict: "alias_type,external_sku_code" });
  }

  return { productId: productId!, skuId: skuId! };
}

// ---------- sync logic ----------
async function startLog(syncType: string, params: any) {
  const { data, error } = await admin.from("jst_sync_logs").insert({
    sync_type: syncType,
    status: "running",
    message: `params=${JSON.stringify(params)}`,
  }).select("id").single();
  if (error) throw error;
  return data!.id as string;
}
async function finishLog(id: string, status: string, info: any) {
  await admin.from("jst_sync_logs").update({
    status,
    ended_at: new Date().toISOString(),
    fetched_items_count: info.success ?? 0,
    message: info.message ?? null,
    error_detail: info.error_detail ?? null,
  }).eq("id", id);
}
function diagnosticText(res: CallResult, label: string) {
  return [
    `${label}`,
    `api_path=${res.meta.path}`,
    `url=${res.meta.url}`,
    `env=${res.meta.env}`,
    `app_key=${res.meta.appKeyMasked}`,
    `code=${res.code ?? ""}`,
    `msg=${res.msg || ""}`,
    `data_count=${res.meta.dataCount}`,
    `request=${JSON.stringify(res.meta.request)}`,
  ].join("\n");
}
async function runMinimalSkuQuery(logId: string) {
  const to = new Date();
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const biz = {
    page_index: 1,
    page_size: 1,
    modified_begin: fmtJst(from),
    modified_end: fmtJst(to),
    flds: "purchase_price,pics",
  };
  const res = await callOpenweb(SKU_QUERY_PATH, biz);
  const detail = diagnosticText(res, "最小请求 /open/sku/query");
  await admin.from("jst_sync_logs").update({
    message: detail,
    error_detail: res.ok ? null : `${detail}\n提示: 若这里仍返回无API权限,请确认 Secrets 中 app_key/access_token 属于已开通权限的 opspilot 应用,并重新授权/刷新 token。`,
  }).eq("id", logId);
  return res;
}

async function syncByBiz(biz: Record<string, unknown>, logId: string) {
  const minimal = await runMinimalSkuQuery(logId);
  if (!minimal.ok) {
    await finishLog(logId, minimal.permissionDenied ? "permission_denied" : "failed", {
      success: 0,
      message: `最小请求失败 code=${minimal.code} data_count=${minimal.meta.dataCount}`,
      error_detail: diagnosticText(minimal, "最小请求失败") + "\n下一步: 请在聚水潭对当前 app_key 重新授权后刷新 access_token。",
    });
    return { permissionDenied: minimal.permissionDenied, success: 0, failed: 0, msg: minimal.msg };
  }
  let page = 1;
  let success = 0, failed = 0;
  const errors: string[] = [];
  const MAX_PAGES = 200;
  while (page <= MAX_PAGES) {
    const callBiz = { flds: "purchase_price,pics", ...biz, page_index: page, page_size: 50 };
    const res = await callOpenweb(SKU_QUERY_PATH, callBiz);
    if (!res.ok) {
      if (res.permissionDenied) {
        await finishLog(logId, "permission_denied", {
          success, message: `商品接口权限/授权失败 code=${res.code} path=${res.meta.path}`,
          error_detail: diagnosticText(res, "正式同步失败") + "\n提示: 若最小请求成功但这里失败,请检查同步参数/字段映射;若最小请求也失败,请重新授权 access_token。",
        });
        return { permissionDenied: true, success, failed, msg: res.msg };
      }
      throw new Error(`聚水潭 ${SKU_QUERY_PATH} 失败 code=${res.code} msg=${res.msg}`);
    }
    const list: any[] = res.data?.datas ?? res.data?.list ?? res.data?.items ?? res.data ?? [];
    if (!Array.isArray(list) || list.length === 0) break;
    for (const rec of list) {
      try {
        await upsertSku(rec);
        success++;
      } catch (e) {
        failed++;
        errors.push(sanitize((e as Error).message));
      }
    }
    await admin.from("jst_sync_logs").update({
      fetched_items_count: success,
      message: `api_path=${res.meta.path} url=${res.meta.url} env=production app_key=${res.meta.appKeyMasked} code=${res.code} data_count=${res.meta.dataCount}\npage=${page} 累计成功=${success} 失败=${failed}`,
    }).eq("id", logId);
    const hasNext = res.data?.has_next ?? res.data?.hasNext ?? (list.length >= 50);
    if (!hasNext) break;
    page++;
    await sleep(RATE_DELAY_MS);
  }
  await finishLog(logId, failed === 0 ? "success" : (success > 0 ? "partial_failed" : "failed"), {
    success,
    message: `共写入 ${success}, 失败 ${failed}, 页数 ${page}`,
    error_detail: errors.length ? errors.slice(0, 5).join(" | ").slice(0, 1500) : null,
  });
  return { permissionDenied: false, success, failed };
}

// ---------- image transfer ----------
async function transferOneImage(externalUrl: string, storagePath: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const resp = await fetch(externalUrl, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.jushuitan.com/" },
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") ?? "image/jpeg";
    const buf = new Uint8Array(await resp.arrayBuffer());
    const { error } = await admin.storage.from(BUCKET).upload(storagePath, buf, {
      contentType, upsert: true,
    });
    if (error) {
      console.error("[jst-products] storage upload error", error.message);
      return null;
    }
    const { data } = admin.storage.from(BUCKET).getPublicUrl(storagePath);
    return data.publicUrl ?? null;
  } catch (e) {
    console.error("[jst-products] image fetch failed", externalUrl, (e as Error).message);
    return null;
  }
}
function safeSegment(s: string) {
  return (s || "unknown").replace(/[^\w.\-]+/g, "_").slice(0, 80);
}

async function syncImages(limit: number, logId: string) {
  let success = 0, failed = 0;
  // SKU 图片
  const { data: skus } = await admin
    .from("ops_skus")
    .select("id, sku_code, external_image_url, sku_image_url, product_id")
    .not("external_image_url", "is", null)
    .is("sku_image_url", null)
    .limit(limit);
  for (const s of (skus ?? []) as any[]) {
    const { data: p } = await admin.from("ops_products").select("style_no, code").eq("id", s.product_id).maybeSingle();
    const styleSeg = safeSegment(p?.style_no || p?.code || "_");
    const path = `${styleSeg}/${safeSegment(s.sku_code)}.jpg`;
    const publicUrl = await transferOneImage(s.external_image_url, path);
    if (publicUrl) {
      await admin.from("ops_skus").update({ sku_image_url: publicUrl, image_storage_path: path }).eq("id", s.id);
      success++;
    } else failed++;
    await sleep(50);
  }
  // 商品主图
  const { data: products } = await admin
    .from("ops_products")
    .select("id, code, style_no, external_image_url, main_image_url")
    .not("external_image_url", "is", null)
    .is("main_image_url", null)
    .limit(limit);
  for (const p of (products ?? []) as any[]) {
    const styleSeg = safeSegment(p.style_no || p.code || "_");
    const path = `${styleSeg}/main.jpg`;
    const publicUrl = await transferOneImage(p.external_image_url, path);
    if (publicUrl) {
      await admin.from("ops_products").update({ main_image_url: publicUrl, image_storage_path: path }).eq("id", p.id);
      success++;
    } else failed++;
    await sleep(50);
  }
  await finishLog(logId, failed === 0 ? "success" : (success > 0 ? "partial_failed" : "failed"), {
    success, message: `图片转存成功=${success}, 失败=${failed}`,
  });
  return { success, failed };
}

// ---------- auth ----------
async function isAdminCaller(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data, error } = await userClient.auth.getClaims(token);
  if (error || !data?.claims?.sub) return false;
  const uid = data.claims.sub as string;
  const { data: hasAdmin } = await admin.rpc("has_ops_role", { _uid: uid, _code: "admin" });
  return !!hasAdmin;
}

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!(await isAdminCaller(req))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action: string = body.action ?? "sync_recent";

    if (action === "test_minimal_sku") {
      const logId = await startLog("jst_products", { action, path: apiPath(SKU_QUERY_PATH), env: "production", app_key: maskSecret(JST_APP_KEY) });
      try {
        const res = await runMinimalSkuQuery(logId);
        await finishLog(logId, res.ok ? "success" : (res.permissionDenied ? "permission_denied" : "failed"), {
          success: res.meta.dataCount,
          message: diagnosticText(res, "最小请求 /open/sku/query"),
          error_detail: res.ok ? null : diagnosticText(res, "最小请求失败") + "\n下一步: 重新授权/刷新 access_token 后再测。",
        });
        return new Response(JSON.stringify({ ok: res.ok, log_id: logId, code: res.code, msg: res.msg, data_count: res.meta.dataCount, path: res.meta.path, app_key: res.meta.appKeyMasked }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        await finishLog(logId, "failed", { success: 0, message: "最小请求异常", error_detail: sanitize((e as Error).message).slice(0, 1000) });
        throw e;
      }
    }

    if (action === "refresh_token") {
      const logId = await startLog("jst_products", { action, token_endpoint: "/openWeb/auth/refreshToken", app_key: maskSecret(JST_APP_KEY) });
      const seed = (await loadToken())?.refreshToken || JST_REFRESH_TOKEN_SEED;
      if (!seed) throw new Error("缺少 refresh_token,请在聚水潭对 opspilot 应用重新授权后更新 JST_REFRESH_TOKEN / JST_ACCESS_TOKEN");
      try {
        await refreshAccessToken(seed);
        await finishLog(logId, "success", {
          success: 1,
          message: `access_token 已刷新; token_endpoint=/openWeb/auth/refreshToken; app_key=${maskSecret(JST_APP_KEY)}; 刷新后请重新点击最小请求测试 /open/sku/query`,
        });
        return new Response(JSON.stringify({ ok: true, log_id: logId, app_key: maskSecret(JST_APP_KEY) }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        await finishLog(logId, "failed", {
          success: 0,
          message: `access_token 刷新失败 app_key=${maskSecret(JST_APP_KEY)}`,
          error_detail: sanitize((e as Error).message).slice(0, 1000),
        });
        throw e;
      }
    }

    // 图片转存
    if (action === "sync_images") {
      const limit = Math.min(200, Number(body.limit ?? 50));
      const logId = await startLog("jst_product_images", { limit });
      const runBg = async () => {
        try { await syncImages(limit, logId); }
        catch (e) {
          await finishLog(logId, "failed", { success: 0, message: "图片转存失败", error_detail: sanitize((e as Error).message).slice(0, 1000) });
        }
      };
      // @ts-ignore
      EdgeRuntime.waitUntil(runBg());
      return new Response(JSON.stringify({ ok: true, background: true, log_id: logId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 商品/SKU 同步
    let biz: Record<string, unknown> = {};
    let syncType = "jst_products";
    if (action === "sync_recent") {
      const days = Math.max(1, Math.min(90, Number(body.days ?? 30)));
      const to = new Date();
      const from = new Date(Date.now() - days * 86400_000);
      const fmt = (d: Date) => {
        const p = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      };
      biz = { modified_begin: fmt(from), modified_end: fmt(to) };
    } else if (action === "sync_all") {
      biz = {};
    } else if (action === "sync_by_style") {
      const styleNo = String(body.style_no ?? "").trim();
      if (!styleNo) throw new Error("缺少 style_no");
      biz = { i_id: styleNo };
    } else if (action === "sync_by_sku") {
      const skuCode = String(body.sku_code ?? "").trim();
      if (!skuCode) throw new Error("缺少 sku_code");
      biz = { sku_id: skuCode };
    } else {
      throw new Error(`未知 action: ${action}`);
    }

    const logId = await startLog(syncType, { action, biz });

    const runBg = async () => {
      try { await syncByBiz(biz, logId); }
      catch (e) {
        await finishLog(logId, "failed", { success: 0, message: "同步失败", error_detail: sanitize((e as Error).message).slice(0, 1000) });
      }
    };
    // @ts-ignore
    EdgeRuntime.waitUntil(runBg());

    return new Response(JSON.stringify({ ok: true, background: true, log_id: logId, action }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: sanitize((err as Error).message) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
