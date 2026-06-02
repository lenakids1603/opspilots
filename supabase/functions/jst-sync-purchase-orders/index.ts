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

// 聚水潭返回的业务时间(po_date / io_date / modified / delivery_date)是北京时间(无时区后缀)
// 例如 "2026-06-01 17:39:29" 实际指北京时间,对应 UTC 09:39:29
// 不能直接 new Date(),否则会按运行环境本地时区(UTC)解析,导致整体偏移 8 小时
function parseJstBeijingDateTime(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  // 已带时区(Z 或 +/-HH:MM)的,按原样解析
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  // 匹配 YYYY-MM-DD[ T]HH:mm[:ss[.sss]]  或  YYYY-MM-DD
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d+))?)?)?$/);
  if (!m) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const [, y, mo, da, hh = "0", mm = "0", ss = "0", ms = "0"] = m;
  // 视为北京时间(UTC+8),减去 8 小时得到 UTC
  const utcMs = Date.UTC(+y, +mo - 1, +da, +hh - 8, +mm, +ss, +(ms.padEnd(3, "0").slice(0, 3) || 0));
  const d = new Date(utcMs);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

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

// 聚水潭 API 的 modified_begin / modified_end 期望北京时间字符串 (YYYY-MM-DD HH:mm:ss)。
// Edge Function 运行在 UTC 时区,直接用 d.getHours() 会拿到 UTC 小时,
// 等于把窗口在北京视角下整体后退 8 小时 —— 会漏掉「现在 - 8h」之内的新增/修改单据。
// 必须显式转换为 Asia/Shanghai 时区再格式化。
function fmt(d: Date) {
  // sv-SE 输出 "YYYY-MM-DD HH:mm:ss" 形式,刚好符合聚水潭格式
  return d.toLocaleString("sv-SE", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
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
// 聚水潭采购入库/采购单查询接口对 modified_begin~modified_end 限制单次最长 7 天。
// 为保险起见,每段实际使用 6 天 23 小时 59 分钟,避免边界判断报错。
// 任何 days > 7 的范围都会被自动拆分成多个不超过 7 天的窗口。
const JST_MAX_WINDOW_MS = 7 * 86400_000 - 60_000; // 6d 23h 59m
function buildJstTimeWindows(from: Date, to: Date): Array<readonly [Date, Date]> {
  const out: Array<readonly [Date, Date]> = [];
  let cur = new Date(from);
  while (cur < to) {
    const end = new Date(Math.min(cur.getTime() + JST_MAX_WINDOW_MS, to.getTime()));
    out.push([new Date(cur), end] as const);
    cur = end;
  }
  return out;
}

// 限流:聚水潭 5次/秒、100次/分钟。保守 ~4 req/s
const RATE_DELAY_MS = 260;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STALE_RUNNING_MS = 5 * 60_000;
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
          const itemListEarly: any[] = po.items ?? [];
          let maxDeliveryIso: string | null = null;
          for (const it of itemListEarly) {
            const d = parseJstBeijingDateTime(it.delivery_date);
            if (d && (!maxDeliveryIso || d > maxDeliveryIso)) maxDeliveryIso = d;
          }
          const row = {
            external_po_id: externalPoId,
            supplier_id: supplierId,
            jst_supplier_id: po.supplier_id ? String(po.supplier_id) : null,
            supplier_name: po.seller ?? po.supplier_name ?? "",
            po_date: parseJstBeijingDateTime(po.po_date),
            status: po.status ?? "", status_label: po.status ?? "",
            raw_receive_status: po.receive_status ?? "",
            expected_delivery_date: maxDeliveryIso,
            remark: po.remark ?? "",
            jst_modified_at: parseJstBeijingDateTime(po.modified),
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
              delivery_date: parseJstBeijingDateTime(it.delivery_date),
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
  const segId = await insertSegmentLog("purchase_inbound_orders", winFrom.toISOString(), winTo.toISOString(), parentLogId);
  const startedAt = Date.now();
  let receipts = 0, receiptItems = 0, page = 1, pages = 0, dbOk = 0, dbFailed = 0;
  let apiReturned = 0;
  let firstIoDate: string | null = null, lastIoDate: string | null = null;
  let firstModified: string | null = null, lastModified: string | null = null;
  let finalized = false;
  const reqWinBJ = `${fmt(winFrom)} → ${fmt(winTo)} (Asia/Shanghai)`;
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
      apiReturned += list.length;
      if (list.length > 0) {
        if (!firstIoDate) firstIoDate = String(list[0].io_date ?? "");
        if (!firstModified) firstModified = String(list[0].modified ?? "");
        lastIoDate = String(list[list.length - 1].io_date ?? "");
        lastModified = String(list[list.length - 1].modified ?? "");
      }
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
            io_date: parseJstBeijingDateTime(io.io_date),
            status: io.status ?? "",
            jst_modified_at: parseJstBeijingDateTime(io.modified),
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
        message: `[入库] 窗口=${reqWinBJ}; ${buildApiDetail(meta, { page, returned: list.length, hasNext, dbOk, dbFailed, durationMs: Date.now() - startedAt })}; API返回累计=${apiReturned}; 主表upsert=${receipts}; 明细upsert=${receiptItems}; 首条io_date=${firstIoDate ?? "-"}; 末条io_date=${lastIoDate ?? "-"}`,
      });
      if (!hasNext || list.length === 0) break;
      page++;
    }
    finalized = true;
    const writeFailed = apiReturned > 0 && receipts === 0;
    const finalStatus: "success" | "failed" = writeFailed ? "failed" : "success";
    const summary = [
      `[入库] 窗口=${reqWinBJ}`,
      `请求字段=modified_begin/modified_end`,
      `API返回数=${apiReturned}`,
      `主表upsert=${receipts}`,
      `明细upsert=${receiptItems}`,
      `失败=${dbFailed}`,
      `首条io_date=${firstIoDate ?? "-"} modified=${firstModified ?? "-"}`,
      `末条io_date=${lastIoDate ?? "-"} modified=${lastModified ?? "-"}`,
      `耗时=${Math.round((Date.now() - startedAt) / 1000)}s`,
    ].join("; ");
    await finishSegmentLog(segId, finalStatus, {
      fetched_receipts_count: receipts,
      fetched_items_count: receiptItems,
      message: writeFailed ? `⚠️ API 返回 ${apiReturned} 条但数据库写入 0 条,请检查 error_detail。${summary}` : summary,
      error_detail: writeFailed ? `API_returned=${apiReturned} but db_written=0; check upsert path` : null,
    });
    return { receipts, pages };
  } catch (e) {
    finalized = true;
    const msg = sanitizeMsg((e as Error).message ?? "未知错误");
    await finishSegmentLog(segId, "failed", {
      fetched_receipts_count: receipts,
      fetched_items_count: receiptItems,
      message: `[入库] 段失败 窗口=${reqWinBJ} page=${page} API返回=${apiReturned} 主表upsert=${receipts} 明细upsert=${receiptItems} 失败=${dbFailed} 耗时=${Math.round((Date.now() - startedAt) / 1000)}s`,
      error_detail: msg.slice(0, 1000),
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

type SyncScope = "purchase_orders" | "purchase_inbound_orders" | "both";

async function syncRange(
  fromIso: string,
  toIso: string,
  logId: string,
  scope: SyncScope = "both",
) {
  const doPO = scope === "purchase_orders" || scope === "both";
  const doIN = scope === "purchase_inbound_orders" || scope === "both";
  let ordersCount = 0, itemsCount = 0, receiptsCount = 0;
  const errors: string[] = [];
  let lastSuccessfulTo: string | null = null;

  const windows = buildJstTimeWindows(new Date(fromIso), new Date(toIso));
  const totalDays = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86400_000);
  await admin.from("jst_sync_logs").update({
    message: `开始同步 scope=${scope} 范围=${fromIso} → ${toIso} (≈${totalDays}天) 自动拆分为 ${windows.length} 个不超过7天的窗口`,
  }).eq("id", logId);

  let winIdx = 0;
  for (const [winFrom, winTo] of windows) {
    winIdx++;
    const segAffected = new Set<string>();
    let poOk = !doPO, inOk = !doIN;
    if (doPO) {
      try {
        const r = await syncPurchaseOrdersSegment(winFrom, winTo, logId, segAffected);
        ordersCount += r.orders; itemsCount += r.items;
        poOk = true;
      } catch (e) {
        errors.push(`PO 窗口${winIdx}/${windows.length} ${fmt(winFrom)}~${fmt(winTo)}: ${(e as Error).message}`);
      }
    }
    if (doIN) {
      try {
        const r = await syncPurchaseInSegment(winFrom, winTo, logId, segAffected);
        receiptsCount += r.receipts;
        inOk = true;
      } catch (e) {
        errors.push(`IN 窗口${winIdx}/${windows.length} ${fmt(winFrom)}~${fmt(winTo)}: ${(e as Error).message}`);
      }
    }

    // 每段结束后立即对本段涉及的 PO 做聚合刷新,避免主表 total_* 字段长期为 0
    for (const poId of segAffected) {
      try {
        await admin.rpc("recalc_purchase_order_aggregates", { _po_id: poId });
      } catch (e) {
        console.error(`recalc PO ${poId} 失败:`, (e as Error).message);
      }
    }

    // 每段成功后立即推进游标,避免下次重跑已完成的日期
    // 不同 scope 使用独立游标,避免互相覆盖
    // 注意:手动指定 start_date 的回补任务也会推进游标,这是预期行为(已经覆盖到该时间)
    if (poOk && inOk) {
      lastSuccessfulTo = winTo.toISOString();
      const stateKey = scope === "purchase_orders"
        ? "purchase_orders_last_sync"
        : scope === "purchase_inbound_orders"
          ? "purchase_inbound_orders_last_sync"
          : "purchase_orders_last_sync";
      try {
        await admin.from("jst_sync_state").upsert({
          key: stateKey,
          value: { last_modified_at: lastSuccessfulTo },
          updated_at: new Date().toISOString(),
        });
      } catch (e) {
        console.error("update jst_sync_state 失败:", (e as Error).message);
      }
    }
  }

  const status = errors.length === 0 ? "success" : (ordersCount + receiptsCount > 0 ? "partial_failed" : "failed");
  const summaryParts: string[] = [];
  if (doPO) summaryParts.push(`采购单 ${ordersCount}、明细 ${itemsCount}`);
  if (doIN) summaryParts.push(`入库单 ${receiptsCount}`);
  await admin.from("jst_sync_logs").update({
    status,
    ended_at: new Date().toISOString(),
    fetched_orders_count: ordersCount,
    fetched_items_count: itemsCount,
    fetched_receipts_count: receiptsCount,
    message: `${errors.length ? "部分成功 / 部分失败。" : "全部同步成功。"}scope=${scope};总范围=${fromIso}→${toIso};自动拆分=${windows.length}段;汇总:${summaryParts.join("、")}${errors.length ? `,失败段 ${errors.length}` : ""}${lastSuccessfulTo ? `;游标推进至 ${lastSuccessfulTo}` : ""}`,
    error_detail: errors.length ? sanitizeMsg(errors.join(" | ")).slice(0, 1500) : null,
  }).eq("id", logId);

  return { ordersCount, itemsCount, receiptsCount, lastSuccessfulTo, windowCount: windows.length };
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

// ====================================================================
// 断点续跑同步任务 (purchase_inbound_orders)
// 设计目标:
//  - 每次 Edge Function 调用最多处理 maxPagesPerRun 页 / timeBudgetSeconds 秒
//  - 每页处理完都写 heartbeat + 累计 + jst_sync_log_details
//  - 任务永远不会停在 status='running' 没有 ended_at
//  - 时间窗口拆得更小 (入库默认 3 天) 避免单窗口数据过大
// ====================================================================
const INBOUND_JOB_CONFIG = {
  maxWindowDays: 3,
  pageSize: 50,
  maxPagesPerRun: 3,
  timeBudgetSeconds: 45,
  staleMs: 2 * 60_000, // 2 分钟无心跳判定为 stalled
};

function buildInboundWindows(from: Date, to: Date, maxDays: number) {
  const stepMs = maxDays * 86400_000 - 60_000; // 安全边界
  const out: Array<{ from: string; to: string }> = [];
  let cur = from.getTime();
  const end = to.getTime();
  if (end <= cur) {
    out.push({ from: new Date(cur).toISOString(), to: new Date(cur + 60_000).toISOString() });
    return out;
  }
  while (cur < end) {
    const next = Math.min(cur + stepMs, end);
    out.push({ from: new Date(cur).toISOString(), to: new Date(next).toISOString() });
    cur = next;
  }
  return out;
}

async function markStaleInboundJobs() {
  const cutoff = new Date(Date.now() - INBOUND_JOB_CONFIG.staleMs).toISOString();
  const { data, error } = await admin
    .from("jst_sync_jobs")
    .update({
      status: "stalled",
      ended_at: null,
      message: "任务超过 2 分钟无心跳,已标记为 stalled,可点击「继续同步」从断点恢复",
      error_detail: "stalled: heartbeat exceeded threshold",
    })
    .in("status", ["running", "pending"])
    .lt("heartbeat_at", cutoff)
    .select("id");
  if (error) console.error("markStaleInboundJobs error", error.message);
  return data?.length ?? 0;
}

async function createInboundJob(opts: {
  fromIso: string;
  toIso: string;
  triggerType: string;
  requestedRange: string;
  createdBy: string | null;
}) {
  const windows = buildInboundWindows(
    new Date(opts.fromIso),
    new Date(opts.toIso),
    INBOUND_JOB_CONFIG.maxWindowDays,
  );
  // 父日志,沿用 jst_sync_logs 老界面
  const { data: log, error: logErr } = await admin.from("jst_sync_logs").insert({
    sync_type: "purchase_inbound_orders",
    status: "running",
    cursor_from: opts.fromIso,
    cursor_to: opts.toIso,
    heartbeat_at: new Date().toISOString(),
    message: `[断点同步] 范围=${opts.fromIso} → ${opts.toIso}; 拆分=${windows.length} 段 (≤${INBOUND_JOB_CONFIG.maxWindowDays}天/段); 每次最多 ${INBOUND_JOB_CONFIG.maxPagesPerRun} 页 / ${INBOUND_JOB_CONFIG.timeBudgetSeconds}s`,
  }).select("id").single();
  if (logErr) throw logErr;

  const { data: job, error: jobErr } = await admin.from("jst_sync_jobs").insert({
    parent_log_id: log.id,
    sync_type: "purchase_inbound_orders",
    status: "pending",
    trigger_type: opts.triggerType,
    requested_range: opts.requestedRange,
    requested_from: opts.fromIso,
    requested_to: opts.toIso,
    total_windows: windows.length,
    current_window_index: 0,
    current_window_from: windows[0]?.from ?? null,
    current_window_to: windows[0]?.to ?? null,
    current_page_index: 0,
    next_page_index: 1,
    page_size: INBOUND_JOB_CONFIG.pageSize,
    has_next: true,
    max_window_days: INBOUND_JOB_CONFIG.maxWindowDays,
    max_pages_per_run: INBOUND_JOB_CONFIG.maxPagesPerRun,
    time_budget_seconds: INBOUND_JOB_CONFIG.timeBudgetSeconds,
    windows,
    created_by: opts.createdBy,
    heartbeat_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    message: "任务已创建,等待第一次 tick",
  }).select().single();
  if (jobErr) throw jobErr;

  // 把 job_id 回写到父日志
  await admin.from("jst_sync_logs").update({ job_id: job.id }).eq("id", log.id);

  return job;
}

async function updateJobProgress(jobId: string, patch: Record<string, unknown>) {
  const normalizedPatch = {
    ...patch,
    message: patch.message ?? "",
    error_detail: patch.error_detail ?? "",
    heartbeat_at: new Date().toISOString(),
  };
  const { error } = await admin
    .from("jst_sync_jobs")
    .update(normalizedPatch)
    .eq("id", jobId);
  if (error) console.error("updateJobProgress error", error.message);
}

async function writeLogDetail(row: Record<string, unknown>) {
  const { error } = await admin.from("jst_sync_log_details").insert(row);
  if (error) console.error("writeLogDetail error", error.message);
}

// 处理一页入库单数据
async function processInboundPage(args: {
  job: any;
  windowIndex: number;
  windowFrom: Date;
  windowTo: Date;
  pageIndex: number;
}) {
  const { job, windowIndex, windowFrom, windowTo, pageIndex } = args;
  const pageStart = Date.now();
  const affectedPoIds = new Set<string>();
  const reqBody = {
    page_index: pageIndex,
    page_size: job.page_size ?? 50,
    modified_begin: fmt(windowFrom),
    modified_end: fmt(windowTo),
  };

  let apiCount = 0, mainUpserted = 0, itemUpserted = 0, failed = 0;
  let hasNext = false;
  let firstIo: string | null = null, lastIo: string | null = null;
  let firstMod: string | null = null, lastMod: string | null = null;
  let respCode: string | null = null, respMsg: string | null = null;
  let errorDetail = "";

  try {
    await sleep(RATE_DELAY_MS);
    const { data, meta } = await callJushuitan("purchasein.query", reqBody);
    respCode = String(meta.code ?? "");
    respMsg = sanitizeMsg(meta.msg ?? "").slice(0, 500);
    const list: any[] = data.datas ?? data.list ?? [];
    apiCount = list.length;
    hasNext = parseHasNext(data.has_next ?? data.hasNext, list.length === (job.page_size ?? 50));
    if (list.length > 0) {
      firstIo = parseJstBeijingDateTime(list[0].io_date);
      firstMod = parseJstBeijingDateTime(list[0].modified);
      lastIo = parseJstBeijingDateTime(list[list.length - 1].io_date);
      lastMod = parseJstBeijingDateTime(list[list.length - 1].modified);
    }

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
          io_date: parseJstBeijingDateTime(io.io_date),
          status: io.status ?? "",
          jst_modified_at: parseJstBeijingDateTime(io.modified),
          remark: io.remark ?? "", raw: io,
        };
        const { data: upRec, error: recErr } = await admin.from("purchase_receipts")
          .upsert(recRow, { onConflict: "external_io_id" }).select("id").single();
        if (recErr) throw recErr;
        mainUpserted++;
        const receiptId = upRec.id as string;
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
          itemUpserted++;
        }
      } catch (writeErr) {
        failed++;
        errorDetail = sanitizeMsg((writeErr as Error).message ?? "").slice(0, 500);
      }
    }
  } catch (apiErr) {
    errorDetail = sanitizeMsg((apiErr as Error).message ?? "").slice(0, 500);
    failed++;
    throw new Error(errorDetail);
  } finally {
    // 永远写一条页级日志,方便排查每一页
    await writeLogDetail({
      job_id: job.id,
      log_id: job.parent_log_id,
      sync_type: "purchase_inbound_orders",
      window_index: windowIndex,
      window_from: windowFrom.toISOString(),
      window_to: windowTo.toISOString(),
      page_index: pageIndex,
      page_size: job.page_size ?? 50,
      api_count: apiCount,
      has_next: hasNext,
      main_upserted: mainUpserted,
      item_upserted: itemUpserted,
      failed_count: failed,
      first_io_date: firstIo,
      last_io_date: lastIo,
      first_modified_at: firstMod,
      last_modified_at: lastMod,
      request_body: reqBody,
      response_code: respCode,
      response_msg: respMsg,
      duration_ms: Date.now() - pageStart,
      error_detail: errorDetail,
    });
  }

  // 按段聚合刷新 PO,避免 total_* 长期为 0
  for (const poId of affectedPoIds) {
    try { await admin.rpc("recalc_purchase_order_aggregates", { _po_id: poId }); }
    catch (_) { /* ignore */ }
  }

  return { apiCount, mainUpserted, itemUpserted, failed, hasNext };
}

async function tickInboundJob(jobId: string) {
  const tickStart = Date.now();
  await markStaleInboundJobs();
  const { data: job, error: loadErr } = await admin
    .from("jst_sync_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (loadErr) throw loadErr;
  if (!job) throw new Error("任务不存在");
  if (["success", "cancelled"].includes(job.status)) {
    return { status: job.status, job };
  }
  const heartbeatAt = job.heartbeat_at ? new Date(job.heartbeat_at).getTime() : 0;
  const staleRunning = job.status === "running" && (!heartbeatAt || Date.now() - heartbeatAt > INBOUND_JOB_CONFIG.staleMs);
  if (job.status === "running" && !staleRunning) {
    return { status: "running", job };
  }
  if (job.status === "failed" && !job.has_next && !(job.next_page_index > 0)) {
    return { status: job.status, job };
  }

  const windows: Array<{ from: string; to: string }> = Array.isArray(job.windows) ? job.windows : [];
  if (windows.length === 0) {
    await updateJobProgress(jobId, {
      status: "success",
      ended_at: new Date().toISOString(),
      message: "范围为空,无需同步",
    });
    return { status: "success", job };
  }

  await updateJobProgress(jobId, {
    status: "running",
    ended_at: null,
    message: `开始处理,当前窗口 ${(job.current_window_index ?? 0) + 1}/${windows.length}`,
  });

  const budgetMs = (job.time_budget_seconds ?? INBOUND_JOB_CONFIG.timeBudgetSeconds) * 1000;
  const maxPages = job.max_pages_per_run ?? INBOUND_JOB_CONFIG.maxPagesPerRun;

  let windowIndex = job.current_window_index ?? 0;
  let pageIndex = job.next_page_index || 1;
  let totalApi = job.total_api_count ?? 0;
  let totalMain = job.total_order_upserted ?? 0;
  let totalItem = job.total_item_upserted ?? 0;
  let totalFailed = job.total_failed ?? 0;
  let pagesThisRun = 0;
  let lastError = "";

  while (windowIndex < windows.length) {
    if (Date.now() - tickStart > budgetMs) break;
    if (pagesThisRun >= maxPages) break;

    const win = windows[windowIndex];
    const winFrom = new Date(win.from);
    const winTo = new Date(win.to);

    try {
      const result = await processInboundPage({
        job, windowIndex, windowFrom: winFrom, windowTo: winTo, pageIndex,
      });
      pagesThisRun++;
      totalApi += result.apiCount;
      totalMain += result.mainUpserted;
      totalItem += result.itemUpserted;
      totalFailed += result.failed;

      const movedNext = !result.hasNext || result.apiCount === 0;
      const newWindowIndex = movedNext ? windowIndex + 1 : windowIndex;
      const newPageIndex = movedNext ? 1 : pageIndex + 1;
      const moreAfterThisPage = !(movedNext && newWindowIndex >= windows.length);
      const shouldPauseAfterThisPage = moreAfterThisPage && (
        pagesThisRun >= maxPages || Date.now() - tickStart > Math.max(0, budgetMs - 5000)
      );

      await updateJobProgress(jobId, {
        status: moreAfterThisPage ? (shouldPauseAfterThisPage ? "partial" : "running") : "success",
        ended_at: moreAfterThisPage ? null : new Date().toISOString(),
        current_window_index: newWindowIndex,
        current_window_from: windows[newWindowIndex]?.from ?? win.from,
        current_window_to: windows[newWindowIndex]?.to ?? win.to,
        current_page_index: pageIndex,
        next_page_index: newPageIndex,
        has_next: moreAfterThisPage,
        total_api_count: totalApi,
        total_order_upserted: totalMain,
        total_item_upserted: totalItem,
        total_failed: totalFailed,
        last_success_at: new Date().toISOString(),
        message: `窗口 ${windowIndex + 1}/${windows.length} 第 ${pageIndex} 页完成 (本页 ${result.apiCount} 条,主表+${result.mainUpserted},明细+${result.itemUpserted}${result.hasNext ? ",还有下一页" : ",本窗口结束"})`,
      });

      windowIndex = newWindowIndex;
      pageIndex = newPageIndex;
      if (shouldPauseAfterThisPage) break;
    } catch (err) {
      lastError = sanitizeMsg((err as Error).message ?? "").slice(0, 500);
      totalFailed++;
      await updateJobProgress(jobId, {
        total_failed: totalFailed,
        error_detail: lastError,
        message: `窗口 ${windowIndex + 1}/${windows.length} 第 ${pageIndex} 页失败: ${lastError}`,
      });
      break;
    }
  }

  // 收尾状态
  const allDone = windowIndex >= windows.length;
  const finalStatus = allDone ? (lastError ? "failed" : "success") : (lastError ? "failed" : "partial");
  const tail = {
    status: finalStatus,
    ended_at: allDone || lastError ? new Date().toISOString() : null,
    total_api_count: totalApi,
    total_order_upserted: totalMain,
    total_item_upserted: totalItem,
    total_failed: totalFailed,
    current_window_index: Math.min(windowIndex, windows.length - 1),
    current_window_from: windows[Math.min(windowIndex, windows.length - 1)]?.from ?? null,
    current_window_to: windows[Math.min(windowIndex, windows.length - 1)]?.to ?? null,
    next_page_index: pageIndex,
    message: allDone
      ? `全部完成 · 窗口 ${windows.length} 个 · 入库单 ${totalMain} · 明细 ${totalItem}${lastError ? ` · 末次错误: ${lastError}` : ""}`
      : lastError
        ? `任务失败 · 窗口 ${windowIndex + 1}/${windows.length} 第 ${pageIndex} 页 · ${lastError}`
        : `本次 tick 已处理 ${pagesThisRun} 页,等待继续 · 当前窗口 ${windowIndex + 1}/${windows.length} 下一页=${pageIndex}`,
    error_detail: lastError || "",
  };
  await updateJobProgress(jobId, tail);

  // 同步更新父日志,保持老界面不被卡死
  await admin.from("jst_sync_logs").update({
    status: finalStatus,
    ended_at: tail.ended_at,
    fetched_receipts_count: totalMain,
    fetched_items_count: totalItem,
    heartbeat_at: new Date().toISOString(),
    message: tail.message,
    error_detail: lastError || "",
  }).eq("id", job.parent_log_id);

  return { status: finalStatus, job: { ...job, ...tail } };
}

// ---------- auth ----------
async function resolveCaller(req: Request): Promise<{ isAdmin: boolean; uid: string | null }> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return { isAdmin: false, uid: null };
  const token = auth.slice(7);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data, error } = await userClient.auth.getClaims(token);
  if (error || !data?.claims?.sub) return { isAdmin: false, uid: null };
  const uid = data.claims.sub as string;
  const { data: hasAdmin } = await admin.rpc("has_ops_role", { _uid: uid, _code: "admin" });
  return { isAdmin: !!hasAdmin, uid };
}

async function isAdminCaller(req: Request): Promise<boolean> {
  return (await resolveCaller(req)).isAdmin;
}

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const cronSecret = req.headers.get("x-cron-secret") ?? "";
    const okCron = !!CRON_SECRET && cronSecret === CRON_SECRET;
    const caller = okCron ? { isAdmin: false, uid: null } : await resolveCaller(req);
    const okAdmin = caller.isAdmin;
    if (!okCron && !okAdmin) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action: string = body.action ?? "sync";

    // 自愈:把超时无心跳的旧任务标记为 failed/stalled,避免页面一直显示在跑
    const cleanedStale = await markStaleRunningAsFailed();
    const cleanedStaleJobs = await markStaleInboundJobs();

    if (action === "cleanup_stale") {
      return new Response(JSON.stringify({ ok: true, cleaned: cleanedStale, cleaned_jobs: cleanedStaleJobs }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ===== 入库单断点续跑相关 action =====
    if (action === "start_inbound_job") {
      const days = Number(body.days ?? 7);
      const requestedRange = body.requested_range ?? (days <= 1 ? "1d" : days <= 7 ? "7d" : days <= 30 ? "30d" : "custom");
      const to = body.end_date ? new Date(body.end_date) : new Date();
      const from = body.start_date ? new Date(body.start_date) : new Date(to.getTime() - days * 86400_000);
      const job = await createInboundJob({
        fromIso: from.toISOString(),
        toIso: to.toISOString(),
        triggerType: body.trigger_type ?? "manual",
        requestedRange,
        createdBy: caller.uid,
      });
      return new Response(JSON.stringify({ ok: true, job_id: job.id, parent_log_id: job.parent_log_id, total_windows: job.total_windows }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "tick_inbound_job") {
      const jobId = String(body.job_id ?? "");
      if (!jobId) throw new Error("缺少 job_id");
      // 同步执行一次 tick；若未完成必须落库为 partial，由前端加锁后触发下一次 tick
      const result = await tickInboundJob(jobId);
      return new Response(JSON.stringify({ ok: true, status: result.status, job: result.job }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "cancel_inbound_job") {
      const jobId = String(body.job_id ?? "");
      if (!jobId) throw new Error("缺少 job_id");
      await admin.from("jst_sync_jobs").update({
        status: "cancelled",
        ended_at: new Date().toISOString(),
        message: "用户已取消",
      }).eq("id", jobId);
      return new Response(JSON.stringify({ ok: true }), {
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
    const mode: string = String(body.mode ?? "").toLowerCase();
    const forceBackfill = mode === "force_backfill";

    // scope 决定本次同步是采购单 / 入库单 / 两者(向后兼容)
    const rawScope = String(body.scope ?? "both").toLowerCase();
    const scope: SyncScope =
      rawScope === "purchase_orders" ? "purchase_orders"
      : rawScope === "purchase_inbound_orders" || rawScope === "purchase_in" || rawScope === "inbound" ? "purchase_inbound_orders"
      : "both";
    const parentSyncType =
      scope === "purchase_orders" ? "purchase_orders"
      : scope === "purchase_inbound_orders" ? "purchase_inbound_orders"
      : "purchase_orders"; // 兼容历史:both 仍记到 purchase_orders 父日志
    const stateKey =
      scope === "purchase_inbound_orders" ? "purchase_inbound_orders_last_sync"
      : "purchase_orders_last_sync";

    let fromIso: string;
    let toIso: string = new Date().toISOString();
    if (explicitFrom) {
      fromIso = new Date(explicitFrom).toISOString();
      if (explicitTo) toIso = new Date(explicitTo).toISOString();
    } else if (forceBackfill) {
      // force_backfill 必须传 start_date,否则报错
      throw new Error("force_backfill 模式必须传 start_date");
    } else {
      const { data: st } = await admin
        .from("jst_sync_state")
        .select("value")
        .eq("key", stateKey)
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
        sync_type: parentSyncType,
        status: "running",
        cursor_from: fromIso,
        cursor_to: toIso,
        message: `开始同步 mode=${JST_AUTH_MODE} scope=${scope}${forceBackfill ? " force_backfill" : ""}`,
      })
      .select("id")
      .single();
    if (logErr) throw logErr;

    // 后台执行,避免 Edge Function CPU/wall-time 超限
    const runBackground = async () => {
      try {
        await syncRange(fromIso, toIso, log.id, scope);
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
