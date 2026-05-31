// Edge Function: 聚水潭采购单 + 采购入库同步
// 支持新开放平台 (openweb / openapi.jushuitan.com) 与老 ERP (legacy_erp) 两种模式
//
// 鉴权(任一即可):
//   1. Header x-cron-secret = JST_SYNC_CRON_SECRET (供 pg_cron 使用)
//   2. Authorization: Bearer <user_jwt>,且用户具 ops_role='admin'
//
// 安全:绝不输出 app_secret / access_token / refresh_token / 签名结果 / biz 原文

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createHash } from "node:crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CRON_SECRET = Deno.env.get("JST_SYNC_CRON_SECRET") ?? "";

const JST_AUTH_MODE = (Deno.env.get("JST_AUTH_MODE") ?? "openweb").trim();
// openweb 模式固定走 openapi.jushuitan.com;legacy_erp 模式才用 JST_API_BASE
const OPENWEB_BASE = "https://openapi.jushuitan.com";
const LEGACY_BASE = (Deno.env.get("JST_API_BASE") ?? "https://open.erp321.com")
  .trim()
  .replace(/\/+$/, "");
// openweb
const JST_APP_KEY = Deno.env.get("JST_APP_KEY") ?? "";
const JST_APP_SECRET = Deno.env.get("JST_APP_SECRET") ?? "";
const JST_ACCESS_TOKEN_SEED = Deno.env.get("JST_ACCESS_TOKEN") ?? "";
const JST_REFRESH_TOKEN_SEED = Deno.env.get("JST_REFRESH_TOKEN") ?? "";
// legacy
const JST_PARTNER_ID = Deno.env.get("JST_PARTNER_ID") ?? "";
const JST_PARTNER_KEY = Deno.env.get("JST_PARTNER_KEY") ?? "";
const JST_TOKEN = Deno.env.get("JST_TOKEN") ?? "";

const JST_SYNC_START_DATE = Deno.env.get("JST_SYNC_START_DATE") ?? "2026-01-01";

// ---------- HTTP proxy (Tinyproxy on fixed IP) ----------
const JST_PROXY_URL = Deno.env.get("JST_PROXY_URL") ?? "";
const JST_PROXY_USER = Deno.env.get("JST_PROXY_USER") ?? "";
const JST_PROXY_PASS = Deno.env.get("JST_PROXY_PASS") ?? "";

function assertProxyEnv() {
  const missing: string[] = [];
  if (!JST_PROXY_URL) missing.push("JST_PROXY_URL");
  if (!JST_PROXY_USER) missing.push("JST_PROXY_USER");
  if (!JST_PROXY_PASS) missing.push("JST_PROXY_PASS");
  if (missing.length) {
    throw new Error(`缺少代理环境变量: ${missing.join(", ")}`);
  }
}

let _proxyClient: Deno.HttpClient | null = null;
function getProxyClient(): Deno.HttpClient {
  if (_proxyClient) return _proxyClient;
  assertProxyEnv();
  // @ts-ignore Deno.createHttpClient is unstable but available in Supabase Edge runtime
  _proxyClient = Deno.createHttpClient({
    proxy: {
      transport: "http",
      url: JST_PROXY_URL,
      basicAuth: { username: JST_PROXY_USER, password: JST_PROXY_PASS },
    },
  });
  return _proxyClient!;
}

async function proxyFetch(url: string, init: RequestInit): Promise<Response> {
  const client = getProxyClient();
  return await fetch(url, { ...init, client } as RequestInit & { client: Deno.HttpClient });
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// ---------- helpers ----------
function md5(s: string) {
  return createHash("md5").update(s).digest("hex");
}

function fmt(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 聚水潭 openweb 签名: MD5(app_secret + sorted(k+v 拼接, 排除 sign)),32 位小写
function signOpenweb(params: Record<string, string>, appSecret: string) {
  const keys = Object.keys(params).filter((k) => k !== "sign").sort();
  let src = appSecret;
  for (const k of keys) {
    const v = params[k];
    if (v !== undefined && v !== null && v !== "") src += k + v;
  }
  return md5(src);
}

// 老 ERP 签名: MD5(method + partnerid + sorted(k+v) + partnerkey)
function signLegacy(
  method: string,
  partnerId: string,
  partnerKey: string,
  params: Record<string, string>,
) {
  const skip = new Set(["sign", "method", "partnerid", "partnerkey"]);
  const keys = Object.keys(params).filter((k) => !skip.has(k)).sort();
  let src = method + partnerId;
  for (const k of keys) src += k + params[k];
  src += partnerKey;
  return md5(src);
}

// ---------- token store (openweb) ----------
async function loadToken(): Promise<
  { accessToken: string; refreshToken: string; expiresAt: Date | null } | null
> {
  const { data } = await admin
    .from("jst_tokens")
    .select("access_token, refresh_token, expires_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.access_token) return null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? "",
    expiresAt: data.expires_at ? new Date(data.expires_at) : null,
  };
}

async function saveToken(accessToken: string, refreshToken: string, expiresInSec: number) {
  const expiresAt = new Date(
    Date.now() + Math.max(60, expiresInSec - 30) * 1000,
  ).toISOString();
  await admin
    .from("jst_tokens")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  const { error } = await admin.from("jst_tokens").insert({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
  });
  if (error) console.error("saveToken error", error.message);
}

async function refreshAccessToken(
  currentRefreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const ts = String(Math.floor(Date.now() / 1000));
  const params: Record<string, string> = {
    app_key: JST_APP_KEY,
    charset: "utf-8",
    grant_type: "refresh_token",
    refresh_token: currentRefreshToken,
    scope: "all",
    timestamp: ts,
  };
  params.sign = signOpenweb(params, JST_APP_SECRET);

  const body = new URLSearchParams(params).toString();
  const url = `${OPENWEB_BASE}/openWeb/auth/refreshToken`;
  console.log(
    `[jst] refresh token attempt url=${url} keys=${Object.keys(params).sort().join(",")}`,
  );
  const resp = await proxyFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await resp.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`刷新 token 返回非 JSON: ${text.slice(0, 200)}`);
  }
  const code = json.code ?? json.errCode;
  if (code !== 0 && code !== "0" && json.issuccess !== true) {
    throw new Error(
      `刷新 token 失败 code=${code} msg=${json.msg ?? json.message ?? text.slice(0, 200)}`,
    );
  }
  const d = json.data ?? json;
  const accessToken = d.access_token ?? d.accessToken;
  const refreshToken = d.refresh_token ?? d.refreshToken ?? currentRefreshToken;
  const expiresIn = Number(d.expires_in ?? d.expiresIn ?? 7200);
  if (!accessToken) throw new Error("刷新 token 响应缺少 access_token");
  await saveToken(accessToken, refreshToken, expiresIn);
  console.log(`[jst] refresh token ok, expires_in=${expiresIn}s`);
  return { accessToken, refreshToken, expiresIn };
}

async function getValidAccessToken(): Promise<string> {
  const tok = await loadToken();
  if (!tok) {
    if (!JST_ACCESS_TOKEN_SEED) throw new Error("缺少 JST_ACCESS_TOKEN 种子");
    return JST_ACCESS_TOKEN_SEED;
  }
  if (tok.expiresAt && tok.expiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
    return tok.accessToken;
  }
  const refreshSeed = tok.refreshToken || JST_REFRESH_TOKEN_SEED;
  if (!refreshSeed) return tok.accessToken;
  try {
    const r = await refreshAccessToken(refreshSeed);
    return r.accessToken;
  } catch (e) {
    console.error("[jst] proactive refresh failed:", (e as Error).message);
    return tok.accessToken;
  }
}

// ---------- 聚水潭调用 ----------
async function callOpenweb(
  methodPath: string,
  biz: Record<string, unknown>,
  attempt = 1,
): Promise<JstCallResult> {
  if (!JST_APP_KEY || !JST_APP_SECRET) {
    throw new Error("缺少 JST_APP_KEY / JST_APP_SECRET");
  }
  const accessToken = await getValidAccessToken();
  const ts = String(Math.floor(Date.now() / 1000));
  const bizJson = JSON.stringify(biz);
  const params: Record<string, string> = {
    access_token: accessToken,
    app_key: JST_APP_KEY,
    biz: bizJson,
    charset: "utf-8",
    timestamp: ts,
    version: "2",
  };
  params.sign = signOpenweb(params, JST_APP_SECRET);

  const url = `${OPENWEB_BASE}/open/${methodPath.replace(/^\/+/, "")}`;
  const path = `/open/${methodPath.replace(/^\/+/, "")}`;
  const body = new URLSearchParams(params).toString();

  console.log(
    `[jst] call ${methodPath} url=${url} ts=${ts} biz_len=${bizJson.length} keys=${
      Object.keys(params).sort().join(",")
    }`,
  );

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  let resp: Response;
  try {
    resp = await proxyFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await resp.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `聚水潭 ${methodPath} 返回非 JSON (http ${resp.status}): ${text.slice(0, 200)}`,
    );
  }
  const code = json.code ?? json.errCode;
  const msg = json.msg ?? json.message ?? "";
  const isOk = code === 0 || code === "0" || json.issuccess === true;
  const meta: JstCallMeta = {
    method: methodPath,
    path,
    url,
    requestParams: describeBiz(biz),
    code: code ?? null,
    msg: sanitizeMsg(msg),
    appKeyMasked: maskSecret(JST_APP_KEY),
    env: "production",
    isIpWhitelistIssue: /ip|白名单|whitelist/i.test(String(msg)),
    isApiPermissionIssue: String(code) === "190" || /无API权限|API权限|权限/i.test(String(msg)),
  };

  if (!isOk && attempt === 1 && /token|授权|access_token|令牌/i.test(String(msg))) {
    console.log(`[jst] token invalid msg="${msg}", refreshing`);
    try {
      const seed = (await loadToken())?.refreshToken || JST_REFRESH_TOKEN_SEED;
      if (seed) await refreshAccessToken(seed);
      return await callOpenweb(methodPath, biz, 2);
    } catch (e) {
      throw new Error(
        `聚水潭 ${methodPath} 失败且刷新 token 失败:${(e as Error).message} (原始 msg=${msg})`,
      );
    }
  }

  if (!isOk) {
    const codeStr = String(code);
    const hints: string[] = [];
    if (codeStr === "190") {
      hints.push("API 权限问题：当前应用未授权该接口，请到聚水潭开放平台确认 method/path 是否与已授权接口完全一致");
    }
    if (/ip|白名单|whitelist/i.test(String(msg))) {
      hints.push("可能为 IP 白名单问题");
    }
    const hintStr = hints.length ? ` | hint=${hints.join("; ")}` : "";
    console.error(
      `[jst] FAIL method=${methodPath} url=${url} code=${code} msg=${msg}${hintStr}`,
    );
    throw new Error(
      `聚水潭 ${methodPath} 失败 code=${code} msg=${msg || text.slice(0, 200)} url=${url}${hintStr}`,
    );
  }
  return { data: json.data ?? json, meta };
}

async function callLegacy(method: string, biz: Record<string, unknown>): Promise<JstCallResult> {
  if (!JST_PARTNER_ID || !JST_PARTNER_KEY || !JST_TOKEN) {
    throw new Error("缺少 legacy_erp 凭据");
  }
  const ts = String(Math.floor(Date.now() / 1000));
  const bizJson = JSON.stringify(biz);
  const params: Record<string, string> = {
    method,
    partnerid: JST_PARTNER_ID,
    token: JST_TOKEN,
    ts,
    biz: bizJson,
  };
  params.sign = signLegacy(method, JST_PARTNER_ID, JST_PARTNER_KEY, params);

  const url = LEGACY_BASE.includes("query.aspx")
    ? LEGACY_BASE
    : `${LEGACY_BASE}/api/open/query.aspx`;
  const path = url.replace(/^https?:\/\/[^/]+/i, "");
  const body = new URLSearchParams(params).toString();
  console.log(`[jst-legacy] call ${method} ts=${ts} biz_len=${bizJson.length}`);
  const resp = await proxyFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await resp.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`聚水潭 ${method} 返回非 JSON: ${text.slice(0, 200)}`);
  }
  const code = json.code ?? (json.issuccess === true ? 0 : 1);
  const msg = json.msg ?? json.message ?? "";
  const meta: JstCallMeta = {
    method,
    path,
    url,
    requestParams: describeBiz(biz),
    code,
    msg: sanitizeMsg(msg),
    env: "legacy_erp",
    isIpWhitelistIssue: /ip|白名单|whitelist/i.test(String(msg)),
    isApiPermissionIssue: String(code) === "190" || /无API权限|API权限|权限/i.test(String(msg)),
  };
  if (code !== 0 && json.issuccess !== true) {
    throw new Error(
      `聚水潭 ${method} 失败 code=${code} msg=${msg || text.slice(0, 200)} url=${url}`,
    );
  }
  return { data: json.data ?? json, meta };
}

// 聚水潭开放平台 method → 实际授权 API 路径映射
// 注意:purchasein.query (采购入库查询) 实际授权路径是 webapi/wmsapi/purchasein/purchaseinquery
// 不要和 purchase.query (采购单查询) 混用
const OPENWEB_METHOD_PATHS: Record<string, string> = {
  "purchase.query": "purchase/query",
  "purchasein.query": "webapi/wmsapi/purchasein/purchaseinquery",
};

async function callJushuitan(method: string, biz: Record<string, unknown>) {
  if (JST_AUTH_MODE === "openweb") {
    const path = OPENWEB_METHOD_PATHS[method] ?? method.replace(/\./g, "/");
    return await callOpenweb(path, biz);
  }
  return await callLegacy(method, biz);
}

// ---------- 时间窗口 ----------
function* timeWindows(from: Date, to: Date, days = 1) {
  let cur = new Date(from);
  while (cur < to) {
    const end = new Date(Math.min(cur.getTime() + days * 86400_000, to.getTime()));
    yield [new Date(cur), end] as const;
    cur = end;
  }
}

// 限流:聚水潭 5次/秒、100次/分钟。保守 ~4 req/s
const RATE_DELAY_MS = 260;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STALE_RUNNING_MS = 10 * 60_000;
const SEGMENT_TIMEOUT_MS = 4 * 60_000;
const MAX_PAGE_NO = 200;

type JstCallMeta = {
  method: string;
  path: string;
  url: string;
  requestParams: string;
  code: string | number | null;
  msg: string;
  appKeyMasked?: string;
  env?: "production" | "legacy_erp";
  isIpWhitelistIssue: boolean;
  isApiPermissionIssue: boolean;
};

type JstCallResult = { data: any; meta: JstCallMeta };

function sanitizeMsg(s: unknown) {
  return String(s ?? "").replace(/[A-Fa-f0-9]{32,}/g, "***");
}
function maskSecret(s: string) {
  if (!s) return "missing";
  if (s.length <= 8) return `${s.slice(0, 2)}***${s.slice(-2)}`;
  return `${s.slice(0, 4)}***${s.slice(-4)}`;
}

function describeBiz(biz: Record<string, unknown>) {
  return JSON.stringify(biz).replace(/[A-Fa-f0-9]{32,}/g, "***");
}

function parseHasNext(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") return ["true", "1", "yes", "y"].includes(value.toLowerCase());
  return fallback;
}

function assertSegmentNotTimedOut(startedAt: number, label: string) {
  const durationMs = Date.now() - startedAt;
  if (durationMs > SEGMENT_TIMEOUT_MS) {
    throw new Error(`${label} 超时：单个时间窗口耗时 ${Math.round(durationMs / 1000)} 秒，已自动结束`);
  }
}

function buildApiDetail(meta: JstCallMeta | null, args: {
  page: number;
  returned: number;
  hasNext: boolean;
  dbOk: number;
  dbFailed: number;
  durationMs: number;
}) {
  if (!meta) return `page=${args.page}; 本页返回=${args.returned}; has_next=${args.hasNext}; 写入成功=${args.dbOk}; 写入失败=${args.dbFailed}; 耗时=${Math.round(args.durationMs / 1000)}s`;
  return [
    `接口路径=${meta.path}`,
    `环境=${meta.env ?? (meta.url.includes("openapi.jushuitan.com") ? "production" : "legacy_erp")}`,
    meta.appKeyMasked ? `app_key=${meta.appKeyMasked}` : null,
    `请求参数=${meta.requestParams}`,
    `当前页码=${args.page}`,
    `本页返回数量=${args.returned}`,
    `has_next=${args.hasNext}`,
    `code=${meta.code ?? ""}`,
    `msg=${meta.msg || "OK"}`,
    `IP白名单问题=${meta.isIpWhitelistIssue ? "是" : "否"}`,
    `API权限问题=${meta.isApiPermissionIssue ? "是" : "否"}`,
    `数据库写入成功=${args.dbOk}`,
    `数据库写入失败=${args.dbFailed}`,
    `任务耗时=${Math.round(args.durationMs / 1000)}s`,
  ].join("; ");
}

async function insertSegmentLog(
  syncType: string,
  fromIso: string,
  toIso: string,
  parentLogId: string,
): Promise<string> {
  const { data, error } = await admin
    .from("jst_sync_logs")
    .insert({
      sync_type: syncType,
      status: "running",
      cursor_from: fromIso,
      cursor_to: toIso,
      message: `parent=${parentLogId}`,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function finishSegmentLog(
  id: string,
  status: "success" | "failed",
  patch: Record<string, unknown>,
) {
  const { error } = await admin
    .from("jst_sync_logs")
    .update({ status, ended_at: new Date().toISOString(), ...patch })
    .eq("id", id);
  if (error) console.error("finishSegmentLog error", error.message);
}

async function updateSegmentProgress(id: string, patch: Record<string, unknown>) {
  const { error } = await admin
    .from("jst_sync_logs")
    .update({ ...patch })
    .eq("id", id);
  if (error) console.error("updateSegmentProgress error", error.message);
}

// ---------- supplier upsert ----------
async function ensureSupplier(
  jstSupplierId: string | null | undefined,
  name: string,
) {
  if (!jstSupplierId) return null;
  const idStr = String(jstSupplierId);
  const { data: existing } = await admin
    .from("ops_suppliers")
    .select("id")
    .eq("jst_supplier_id", idStr)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const code = `JST-${idStr}`;
  const { data: ins, error } = await admin
    .from("ops_suppliers")
    .insert({
      jst_supplier_id: idStr,
      code,
      name: name || `供应商${idStr}`,
      status: "active",
    })
    .select("id")
    .single();
  if (error) throw error;
  return ins.id as string;
}

// ---------- 主流程 ----------
async function syncPurchaseOrdersSegment(
  winFrom: Date,
  winTo: Date,
  parentLogId: string,
  affectedPoIds: Set<string>,
): Promise<{ orders: number; items: number; pages: number }> {
  const segId = await insertSegmentLog("purchase_orders", winFrom.toISOString(), winTo.toISOString(), parentLogId);
  const startedAt = Date.now();
  let orders = 0, items = 0, page = 1, pages = 0, dbOk = 0, dbFailed = 0;
  let finalized = false;
  try {
    while (true) {
      assertSegmentNotTimedOut(startedAt, "采购单同步");
      if (page > MAX_PAGE_NO) throw new Error(`采购单分页超过上限 ${MAX_PAGE_NO}，强制退出，避免无限循环`);
      await sleep(RATE_DELAY_MS);
      const { data, meta } = await callJushuitan("purchase.query", {
        page_index: page, page_size: 50,
        modified_begin: fmt(winFrom), modified_end: fmt(winTo),
      });
      const list: any[] = data.datas ?? data.list ?? data.orders ?? [];
      pages++;
      const hasNext = parseHasNext(data.has_next ?? data.hasNext, list.length === 50);
      for (const po of list) {
        const externalPoId = String(po.po_id ?? po.poId ?? "");
        if (!externalPoId) continue;
        try {
          const supplierId = await ensureSupplier(po.supplier_id ?? po.supplierId, po.seller ?? po.supplier_name ?? "");
          const row = {
            external_po_id: externalPoId,
            supplier_id: supplierId,
            jst_supplier_id: po.supplier_id ? String(po.supplier_id) : null,
            supplier_name: po.seller ?? po.supplier_name ?? "",
            po_date: po.po_date ? new Date(po.po_date).toISOString() : null,
            status: po.status ?? "", status_label: po.status ?? "",
            raw_receive_status: po.receive_status ?? "",
            remark: po.remark ?? "",
            jst_modified_at: po.modified ? new Date(po.modified).toISOString() : null,
            raw: po,
          };
          const { data: upPo, error: upErr } = await admin.from("purchase_orders")
            .upsert(row, { onConflict: "external_po_id" }).select("id").single();
          if (upErr) throw upErr;
          const poId = upPo.id as string;
          affectedPoIds.add(poId);
          orders++; dbOk++;
          const itemList: any[] = po.items ?? [];
          for (const it of itemList) {
            const poiId = it.poi_id ? String(it.poi_id) : null;
            const props = it.properties_value ?? "";
            const propMap: Record<string, string> = {};
            String(props).split(/[;,]/).forEach((p: string) => {
              const [k, v] = p.split(":");
              if (k && v) propMap[k.trim()] = v.trim();
            });
            const qty = Number(it.qty ?? 0);
            const price = Number(it.price ?? 0);
            const itemRow = {
              purchase_order_id: poId, external_po_id: externalPoId, external_poi_id: poiId,
              style_no: it.i_id ? String(it.i_id) : "",
              sku_no: it.sku_id ? String(it.sku_id) : "",
              product_name: it.name ?? "", properties_value: props,
              color: propMap["颜色"] ?? propMap["color"] ?? "",
              size: propMap["尺码"] ?? propMap["size"] ?? "",
              spec: props, purchase_qty: qty, unit_price: price, amount: qty * price,
              delivery_date: it.delivery_date ? new Date(it.delivery_date).toISOString() : null,
              item_remark: it.remark ?? "", raw: it,
            };
            const conflict = poiId ? "external_poi_id" : "external_po_id,sku_no,style_no";
            const { error: itErr } = await admin.from("purchase_order_items")
              .upsert(itemRow, { onConflict: conflict });
            if (itErr) throw itErr;
            items++; dbOk++;
          }
        } catch (writeErr) {
          dbFailed++;
          throw writeErr;
        }
      }
      await updateSegmentProgress(segId, {
        fetched_orders_count: orders,
        fetched_items_count: items,
        message: buildApiDetail(meta, { page, returned: list.length, hasNext, dbOk, dbFailed, durationMs: Date.now() - startedAt }),
      });
      if (!hasNext || list.length === 0) break;
      page++;
    }
    finalized = true;
    await finishSegmentLog(segId, "success", {
      fetched_orders_count: orders, fetched_items_count: items,
      message: `采购单 ${fmt(winFrom)} → ${fmt(winTo)} pages=${pages} orders=${orders} items=${items}; 写入成功=${dbOk}; 写入失败=${dbFailed}; 耗时=${Math.round((Date.now() - startedAt) / 1000)}s`,
    });
    return { orders, items, pages };
  } catch (e) {
    finalized = true;
    const msg = sanitizeMsg((e as Error).message ?? "未知错误");
    await finishSegmentLog(segId, "failed", {
      fetched_orders_count: orders, fetched_items_count: items,
      message: `采购单段失败 page=${page}; 写入成功=${dbOk}; 写入失败=${dbFailed}; 耗时=${Math.round((Date.now() - startedAt) / 1000)}s`, error_detail: msg.slice(0, 1000),
    });
    throw e;
  } finally {
    if (!finalized) {
      await finishSegmentLog(segId, "failed", {
        fetched_orders_count: orders,
        fetched_items_count: items,
        message: "采购单同步异常中断，已自动结束",
        error_detail: `finally guard: page=${page}; 耗时=${Math.round((Date.now() - startedAt) / 1000)}s`,
      });
    }
  }
}

async function syncPurchaseInSegment(
  winFrom: Date,
  winTo: Date,
  parentLogId: string,
  affectedPoIds: Set<string>,
): Promise<{ receipts: number; pages: number }> {
  const segId = await insertSegmentLog("purchase_in", winFrom.toISOString(), winTo.toISOString(), parentLogId);
  const startedAt = Date.now();
  let receipts = 0, receiptItems = 0, page = 1, pages = 0, dbOk = 0, dbFailed = 0;
  let finalized = false;
  try {
    while (true) {
      assertSegmentNotTimedOut(startedAt, "采购入库同步");
      if (page > MAX_PAGE_NO) throw new Error(`采购入库分页超过上限 ${MAX_PAGE_NO}，强制退出，避免无限循环`);
      await sleep(RATE_DELAY_MS);
      const { data, meta } = await callJushuitan("purchasein.query", {
        page_index: page, page_size: 50,
        modified_begin: fmt(winFrom), modified_end: fmt(winTo),
      });
      const list: any[] = data.datas ?? data.list ?? [];
      pages++;
      const hasNext = parseHasNext(data.has_next ?? data.hasNext, list.length === 50);
      for (const io of list) {
        const externalIoId = String(io.io_id ?? "");
        if (!externalIoId) continue;
        try {
          const externalPoId = io.po_id ? String(io.po_id) : null;
          let poId: string | null = null;
          if (externalPoId) {
            const { data: po } = await admin.from("purchase_orders").select("id").eq("external_po_id", externalPoId).maybeSingle();
            poId = po?.id ?? null;
            if (poId) affectedPoIds.add(poId);
          }
          const recRow = {
            external_io_id: externalIoId, purchase_order_id: poId, external_po_id: externalPoId,
            jst_supplier_id: io.supplier_id ? String(io.supplier_id) : null,
            supplier_name: io.supplier_name ?? "", warehouse_name: io.warehouse ?? "",
            io_date: io.io_date ? new Date(io.io_date).toISOString() : null,
            status: io.status ?? "",
            jst_modified_at: io.modified ? new Date(io.modified).toISOString() : null,
            remark: io.remark ?? "", raw: io,
          };
          const { data: upRec, error: recErr } = await admin.from("purchase_receipts")
            .upsert(recRow, { onConflict: "external_io_id" }).select("id").single();
          if (recErr) throw recErr;
          const receiptId = upRec.id as string;
          receipts++; dbOk++;
          const itemList: any[] = io.items ?? [];
          for (const it of itemList) {
            const ioiId = it.ioi_id ? String(it.ioi_id) : null;
            const qty = Number(it.qty ?? 0);
            const itemRow = {
              receipt_id: receiptId, purchase_order_id: poId,
              external_io_id: externalIoId, external_ioi_id: ioiId, external_po_id: externalPoId,
              sku_no: it.sku_id ? String(it.sku_id) : "",
              product_name: it.name ?? "", received_qty: qty,
              cost_price: Number(it.cost_price ?? 0),
              cost_amount: Number(it.cost_amount ?? qty * Number(it.cost_price ?? 0)),
              remark: it.remark ?? "", raw: it,
            };
            const conflict = ioiId ? "external_ioi_id" : "external_io_id,sku_no";
            const { error: itErr } = await admin.from("purchase_receipt_items")
              .upsert(itemRow, { onConflict: conflict });
            if (itErr) throw itErr;
            receiptItems++; dbOk++;
          }
        } catch (writeErr) {
          dbFailed++;
          throw writeErr;
        }
      }
      await updateSegmentProgress(segId, {
        fetched_receipts_count: receipts,
        fetched_items_count: receiptItems,
        message: buildApiDetail(meta, { page, returned: list.length, hasNext, dbOk, dbFailed, durationMs: Date.now() - startedAt }),
      });
      if (!hasNext || list.length === 0) break;
      page++;
    }
    finalized = true;
    const emptyMsg = receipts === 0 ? "本时间窗口无采购入库数据。" : `采购入库 ${fmt(winFrom)} → ${fmt(winTo)} pages=${pages} receipts=${receipts}`;
    await finishSegmentLog(segId, "success", {
      fetched_receipts_count: receipts,
      fetched_items_count: receiptItems,
      message: `${emptyMsg}; 写入成功=${dbOk}; 写入失败=${dbFailed}; 耗时=${Math.round((Date.now() - startedAt) / 1000)}s`,
    });
    return { receipts, pages };
  } catch (e) {
    finalized = true;
    const msg = sanitizeMsg((e as Error).message ?? "未知错误");
    await finishSegmentLog(segId, "failed", {
      fetched_receipts_count: receipts,
      fetched_items_count: receiptItems,
      message: `采购入库段失败 page=${page}; 写入成功=${dbOk}; 写入失败=${dbFailed}; 耗时=${Math.round((Date.now() - startedAt) / 1000)}s`, error_detail: msg.slice(0, 1000),
    });
    throw e;
  } finally {
    if (!finalized) {
      await finishSegmentLog(segId, "failed", {
        fetched_receipts_count: receipts,
        fetched_items_count: receiptItems,
        message: "采购入库同步异常中断，已自动结束",
        error_detail: `finally guard: page=${page}; 耗时=${Math.round((Date.now() - startedAt) / 1000)}s`,
      });
    }
  }
}

async function syncRange(fromIso: string, toIso: string, logId: string) {
  let ordersCount = 0, itemsCount = 0, receiptsCount = 0;
  const affectedPoIds = new Set<string>();
  const errors: string[] = [];

  for (const [winFrom, winTo] of timeWindows(new Date(fromIso), new Date(toIso), 1)) {
    try {
      const r = await syncPurchaseOrdersSegment(winFrom, winTo, logId, affectedPoIds);
      ordersCount += r.orders; itemsCount += r.items;
    } catch (e) {
      errors.push(`PO ${fmt(winFrom)}: ${(e as Error).message}`);
    }
    try {
      const r = await syncPurchaseInSegment(winFrom, winTo, logId, affectedPoIds);
      receiptsCount += r.receipts;
    } catch (e) {
      errors.push(`IN ${fmt(winFrom)}: ${(e as Error).message}`);
    }
  }

  for (const poId of affectedPoIds) {
    await admin.rpc("recalc_purchase_order_aggregates", { _po_id: poId });
  }

  const status = errors.length === 0 ? "success" : (ordersCount + receiptsCount > 0 ? "partial_failed" : "failed");
  await admin.from("jst_sync_logs").update({
    status,
    ended_at: new Date().toISOString(),
    fetched_orders_count: ordersCount,
    fetched_items_count: itemsCount,
    fetched_receipts_count: receiptsCount,
    message: `${errors.length ? "部分成功 / 部分失败。" : "全部同步成功。"}汇总:单 ${ordersCount}、明细 ${itemsCount}、入库 ${receiptsCount}${errors.length ? `,失败段 ${errors.length}` : ""}`,
    error_detail: errors.length ? sanitizeMsg(errors.join(" | ")).slice(0, 1500) : null,
  }).eq("id", logId);

  return { ordersCount, itemsCount, receiptsCount };
}

async function markStaleRunningAsFailed() {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  const { data, error } = await admin
    .from("jst_sync_logs")
    .update({
      status: "failed",
      ended_at: new Date().toISOString(),
      message: "同步超时，已自动结束",
      error_detail: "timeout: running > 10 minutes",
    })
    .eq("status", "running")
    .lt("started_at", cutoff)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
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
  const { data: hasAdmin } = await admin.rpc("has_ops_role", {
    _uid: uid,
    _code: "admin",
  });
  return !!hasAdmin;
}

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const cronSecret = req.headers.get("x-cron-secret") ?? "";
    const okCron = !!CRON_SECRET && cronSecret === CRON_SECRET;
    const okAdmin = okCron ? false : await isAdminCaller(req);
    if (!okCron && !okAdmin) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action: string = body.action ?? "sync";

    // 自愈:把 running 超过 10 分钟的旧任务标记为 failed,避免页面一直显示在跑
    const cleanedStale = await markStaleRunningAsFailed();

    if (action === "cleanup_stale") {
      return new Response(JSON.stringify({ ok: true, cleaned: cleanedStale }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "mark_failed") {
      const logId = String(body.log_id ?? "");
      if (!logId) throw new Error("缺少 log_id");
      const staleBefore = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
      const { data: changed, error: markErr } = await admin
        .from("jst_sync_logs")
        .update({
          status: "failed",
          ended_at: new Date().toISOString(),
          message: "同步超时，已手动结束",
          error_detail: "manual cleanup: stale running > 10 minutes",
        })
        .eq("id", logId)
        .eq("status", "running")
        .lt("started_at", staleBefore)
        .select("id");
      if (markErr) throw markErr;
      return new Response(JSON.stringify({ ok: true, changed: changed?.length ?? 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const explicitFrom: string | undefined = body.start_date;
    const explicitTo: string | undefined = body.end_date;

    let fromIso: string;
    let toIso: string = new Date().toISOString();
    if (explicitFrom) {
      fromIso = new Date(explicitFrom).toISOString();
      if (explicitTo) toIso = new Date(explicitTo).toISOString();
    } else {
      const { data: st } = await admin
        .from("jst_sync_state")
        .select("value")
        .eq("key", "purchase_orders_last_sync")
        .maybeSingle();
      const last = (st?.value as any)?.last_modified_at as string | undefined;
      if (last) {
        fromIso = new Date(new Date(last).getTime() - 10 * 60_000).toISOString();
      } else {
        fromIso = new Date(`${JST_SYNC_START_DATE}T00:00:00+08:00`).toISOString();
      }
    }

    const { data: log, error: logErr } = await admin
      .from("jst_sync_logs")
      .insert({
        sync_type: "purchase_orders",
        status: "running",
        cursor_from: fromIso,
        cursor_to: toIso,
        message: `开始同步 mode=${JST_AUTH_MODE}`,
      })
      .select("id")
      .single();
    if (logErr) throw logErr;

    // 后台执行,避免 Edge Function CPU/wall-time 超限
    const runBackground = async () => {
      try {
        await syncRange(fromIso, toIso, log.id);
        await admin.from("jst_sync_state").upsert({
          key: "purchase_orders_last_sync",
          value: { last_modified_at: toIso },
          updated_at: new Date().toISOString(),
        });
      } catch (err) {
        const msg = (err as Error).message ?? "未知错误";
        const safe = msg.replace(/[A-Fa-f0-9]{32,}/g, "***");
        await admin
          .from("jst_sync_logs")
          .update({
            status: "failed",
            ended_at: new Date().toISOString(),
            error_detail: safe.slice(0, 1000),
            message: "同步失败",
          })
          .eq("id", log.id);
      }
    };
    // @ts-ignore EdgeRuntime is provided by Supabase edge runtime
    EdgeRuntime.waitUntil(runBackground());

    return new Response(
      JSON.stringify({
        ok: true,
        mode: JST_AUTH_MODE,
        background: true,
        log_id: log.id,
        cursor_from: fromIso,
        cursor_to: toIso,
        message: "同步已在后台启动,请在同步记录中查看进度",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
