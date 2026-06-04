// Shared 聚水潭 openweb client for aftersale edge functions.
// Implements: proxy fetch, MD5 sign, access token cache+refresh, callOpenweb.
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHash } from "node:crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENWEB_BASE = "https://openapi.jushuitan.com";

const JST_APP_KEY = Deno.env.get("JST_APP_KEY") ?? "";
const JST_APP_SECRET = Deno.env.get("JST_APP_SECRET") ?? "";
const JST_ACCESS_TOKEN_SEED = Deno.env.get("JST_ACCESS_TOKEN") ?? "";
const JST_REFRESH_TOKEN_SEED = Deno.env.get("JST_REFRESH_TOKEN") ?? "";

const JST_PROXY_URL = Deno.env.get("JST_PROXY_URL") ?? "";
const JST_PROXY_USER = Deno.env.get("JST_PROXY_USER") ?? "";
const JST_PROXY_PASS = Deno.env.get("JST_PROXY_PASS") ?? "";

export const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

let _proxyClient: Deno.HttpClient | null = null;
function getProxyClient(): Deno.HttpClient {
  if (_proxyClient) return _proxyClient;
  if (!JST_PROXY_URL || !JST_PROXY_USER || !JST_PROXY_PASS) {
    throw new Error("缺少代理环境变量 JST_PROXY_URL / JST_PROXY_USER / JST_PROXY_PASS");
  }
  // @ts-ignore unstable but available
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

function md5(s: string) {
  return createHash("md5").update(s).digest("hex");
}

export function fmtBJ(d: Date) {
  return d.toLocaleString("sv-SE", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export function parseJstBeijingDateTime(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d+))?)?)?$/);
  if (!m) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const [, y, mo, da, hh = "0", mm = "0", ss = "0", ms = "0"] = m;
  const utcMs = Date.UTC(+y, +mo - 1, +da, +hh - 8, +mm, +ss, +(ms.padEnd(3, "0").slice(0, 3) || 0));
  const d = new Date(utcMs);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function signOpenweb(params: Record<string, string>, appSecret: string) {
  const keys = Object.keys(params).filter((k) => k !== "sign").sort();
  let src = appSecret;
  for (const k of keys) {
    const v = params[k];
    if (v !== undefined && v !== null && v !== "") src += k + v;
  }
  return md5(src);
}

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
    refreshToken: (data.refresh_token ?? "") as string,
    expiresAt: data.expires_at ? new Date(data.expires_at) : null,
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
    app_key: JST_APP_KEY,
    charset: "utf-8",
    grant_type: "refresh_token",
    refresh_token: currentRefreshToken,
    scope: "all",
    timestamp: ts,
  };
  params.sign = signOpenweb(params, JST_APP_SECRET);
  const body = new URLSearchParams(params).toString();
  const resp = await proxyFetch(`${OPENWEB_BASE}/openWeb/auth/refreshToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await resp.text();
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`刷新 token 返回非 JSON: ${text.slice(0, 200)}`); }
  const code = json.code ?? json.errCode;
  if (code !== 0 && code !== "0" && json.issuccess !== true) {
    throw new Error(`刷新 token 失败 code=${code} msg=${json.msg ?? text.slice(0, 200)}`);
  }
  const d = json.data ?? json;
  const accessToken = d.access_token ?? d.accessToken;
  const refreshToken = d.refresh_token ?? d.refreshToken ?? currentRefreshToken;
  const expiresIn = Number(d.expires_in ?? d.expiresIn ?? 7200);
  if (!accessToken) throw new Error("刷新 token 响应缺少 access_token");
  await saveToken(accessToken, refreshToken, expiresIn);
  return accessToken as string;
}

async function getValidAccessToken(): Promise<string> {
  const tok = await loadToken();
  if (!tok) {
    if (!JST_ACCESS_TOKEN_SEED) throw new Error("缺少 JST_ACCESS_TOKEN 种子");
    return JST_ACCESS_TOKEN_SEED;
  }
  if (tok.expiresAt && tok.expiresAt.getTime() - Date.now() > 5 * 60 * 1000) return tok.accessToken;
  const refreshSeed = tok.refreshToken || JST_REFRESH_TOKEN_SEED;
  if (!refreshSeed) return tok.accessToken;
  try { return await refreshAccessToken(refreshSeed); } catch { return tok.accessToken; }
}

export async function callOpenweb(
  methodPath: string,
  biz: Record<string, unknown>,
  optionsOrAttempt: { timeoutMs?: number; attempt?: number } | number = {},
): Promise<any> {
  const opts = typeof optionsOrAttempt === "number" ? { attempt: optionsOrAttempt } : optionsOrAttempt;
  const timeoutMs = Math.max(5_000, Math.min(opts.timeoutMs ?? 60_000, 90_000));
  const attempt = opts.attempt ?? 1;
  if (!JST_APP_KEY || !JST_APP_SECRET) throw new Error("缺少 JST_APP_KEY / JST_APP_SECRET");
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
  const body = new URLSearchParams(params).toString();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await proxyFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: ctrl.signal,
    });
  } catch (e) {
    const name = (e as Error).name;
    const msg = (e as Error).message ?? String(e);
    if (name === "AbortError" || /abort/i.test(msg)) {
      const err: any = new Error(`聚水潭 ${methodPath} 请求超时(${Math.round(timeoutMs / 1000)}s)被中断 url=${url}`);
      err.code = "ABORTED"; err.aborted = true; err.path = methodPath;
      err.transient = true; err.errorType = "timeout";
      throw err;
    }
    if (/network|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket/i.test(msg)) {
      (e as any).transient = true;
      (e as any).errorType = "network";
    }
    throw e;
  } finally { clearTimeout(timer); }
  if (resp.status === 429 || resp.status >= 500) {
    const errText = await resp.text().catch(() => "");
    const err: any = new Error(`聚水潭 ${methodPath} HTTP ${resp.status}: ${errText.slice(0, 200)}`);
    err.code = String(resp.status); err.path = methodPath;
    err.transient = true; err.errorType = resp.status === 429 ? "rate_limited" : "http_5xx";
    throw err;
  }
  const text = await resp.text();
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`聚水潭 ${methodPath} 返回非 JSON: ${text.slice(0, 200)}`); }
  const code = json.code ?? json.errCode;
  const msg = json.msg ?? json.message ?? "";
  const isOk = code === 0 || code === "0" || json.issuccess === true;
  if (!isOk && attempt === 1 && /token|授权|access_token|令牌/i.test(String(msg))) {
    const seed = (await loadToken())?.refreshToken || JST_REFRESH_TOKEN_SEED;
    if (seed) await refreshAccessToken(seed);
    return await callOpenweb(methodPath, biz, { ...opts, attempt: 2 });
  }
  if (!isOk) {
    const codeStr = String(code ?? "");
    const msgStr = String(msg ?? "");
    let hint = "";
    if (codeStr === "190" || /权限|API权限|permission|forbidden|未授权|无权访问/i.test(msgStr)) {
      hint = "（疑似聚水潭 App 未授权该接口，请到聚水潭开放平台为本 App 申请此 API 的权限）";
    } else if (/ip|白名单|whitelist/i.test(msgStr)) {
      hint = "（疑似 IP 白名单未配置，请确认代理出口 IP 已在聚水潭后台加入白名单）";
    } else if (codeStr === "10004" || /频率|限流|rate/i.test(msgStr)) {
      hint = "（接口被限流，请降低同步频率或拉长窗口）";
    }
    const err: any = new Error(`聚水潭 ${methodPath} 失败 code=${codeStr} msg=${msgStr || text.slice(0, 200)}${hint}`);
    err.code = code; err.apiMsg = msg; err.path = methodPath; err.url = url;
    err.requestId = json.request_id ?? json.requestId ?? null;
    err.hint = hint;
    if (codeStr === "10004" || /频率|限流|rate/i.test(msgStr)) {
      err.transient = true; err.errorType = "rate_limited";
    }
    throw err;
  }
  return json.data ?? json;
}

// ===== List / pagination helpers (兼容多种聚水潭返回结构) =====
const LIST_KEYS = [
  "orders", "refunds", "refund_list", "after_sales", "aftersales",
  "receiveds", "datas", "list", "rows", "items",
];
export function pickList(data: any, extraKeys: string[] = []): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  const keys = [...extraKeys, ...LIST_KEYS];
  for (const k of keys) {
    const v = data?.[k];
    if (Array.isArray(v)) return v;
  }
  const inner = data?.data;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    for (const k of keys) {
      const v = inner?.[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

export function pickItemsArray(o: any, extraKeys: string[] = []): any[] {
  if (!o || typeof o !== "object") return [];
  const keys = [
    ...extraKeys,
    "items", "order_items", "orderitems", "refund_items", "received_items",
    "skus", "details", "item_list",
  ];
  for (const k of keys) {
    const v = o?.[k];
    if (Array.isArray(v) && v.length > 0) return v;
  }
  return [];
}

export function computeHasNext(data: any, fetched: number, pageSize: number, pageIndex: number): boolean {
  if (!data || typeof data !== "object") return false;
  const hn = data.has_next ?? data.hasNext;
  if (typeof hn === "boolean") return hn;
  if (typeof hn === "string") return ["true", "1", "yes", "y"].includes(hn.toLowerCase());
  if (typeof hn === "number") return hn > 0;
  const totalPage = Number(data.page_count ?? data.pageCount ?? data.total_page ?? data.totalPage ?? 0);
  if (totalPage > 0) return pageIndex < totalPage;
  const totalCount = Number(data.data_count ?? data.dataCount ?? data.total_count ?? data.total ?? 0);
  if (totalCount > 0 && pageSize > 0) return pageIndex * pageSize < totalCount;
  return fetched >= pageSize;
}

export async function resolveCaller(req: Request) {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return { isAdmin: false, uid: null as string | null };
  const token = auth.slice(7);
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: auth } },
  });
  const { data, error } = await userClient.auth.getClaims(token);
  if (error || !data?.claims?.sub) return { isAdmin: false, uid: null };
  const uid = data.claims.sub as string;
  const { data: hasAdmin } = await admin.rpc("has_ops_role", { _uid: uid, _code: "admin" });
  return { isAdmin: !!hasAdmin, uid };
}

export function parseHasNext(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") return ["true", "1", "yes", "y"].includes(value.toLowerCase());
  return fallback;
}

export const RATE_DELAY_MS = 260;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const MAX_PAGE_NO = 200;

// Resolve aftersale time window. Priority: explicit start/end > minutes > hours > days > default 1 day.
export function resolveWindow(body: any): { from: Date; to: Date } {
  const to = body.end_time ? new Date(body.end_time) : new Date();
  let from: Date;
  if (body.start_time) {
    from = new Date(body.start_time);
  } else if (body.minutes != null) {
    const minutes = Number(body.minutes);
    from = new Date(to.getTime() - Math.max(1, minutes) * 60_000);
  } else if (body.hours != null) {
    const hours = Number(body.hours);
    from = new Date(to.getTime() - Math.max(1, hours) * 3600_000);
  } else {
    const days = Number(body.days ?? 1);
    from = new Date(to.getTime() - Math.max(1, days) * 86400_000);
  }
  return { from, to };
}
