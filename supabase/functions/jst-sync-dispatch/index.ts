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
  // 单次 60s 超时（之前 30s，suppliers/query 命中 abort）
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  let text: string;
  try {
    const resp = await proxyFetch(url, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(), signal: ctrl.signal,
    });
    text = await resp.text();
  } catch (e: any) {
    clearTimeout(timer);
    const errMsg = String(e?.message ?? e);
    // fetch abort / network 错误：自动重试一次
    if (attempt === 1 && /abort|aborted|timeout|fetch|ECONN|network/i.test(errMsg)) {
      await sleep(1000);
      return await callOpenweb(path, biz, 2);
    }
    throw new Error(`JST ${path} 网络异常: ${errMsg}`);
  } finally { clearTimeout(timer); }
  let json: any;
  try { json = JSON.parse(text); }
  catch { throw new Error(`JST ${path} 返回非 JSON: ${String(text).slice(0,200)}`); }
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

const SENSITIVE_KEY_RE = /(access[_-]?token|refresh[_-]?token|app[_-]?secret|secret|token|password|passwd|pass|proxy[_-]?pass|sign)/i;
function maskSensitive(value: any, depth = 0): any {
  if (value === null || value === undefined) return value;
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 3).map((v) => maskSensitive(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY_RE.test(k) ? "***MASKED***" : maskSensitive(v, depth + 1);
    return out;
  }
  return value;
}
const keysOf = (v: any) => v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v) : [];
function getPath(obj: any, path: string) {
  return path.split(".").reduce((cur, key) => cur?.[key], obj);
}
function detectListPayload(raw: any) {
  const paths = ["data.shops", "data.datas", "data.list", "data.rows", "data.data", "data.items", "shops", "datas", "list", "rows", "items"];
  const candidates = paths.map((path) => {
    const value = getPath(raw, path);
    return { path, exists: value !== undefined, is_array: Array.isArray(value), count: Array.isArray(value) ? value.length : null };
  });
  if (Array.isArray(raw?.data)) candidates.unshift({ path: "data", exists: true, is_array: true, count: raw.data.length });
  const hit = candidates.find((c) => c.is_array);
  const list = hit ? getPath(raw, hit.path) : [];
  return {
    list: Array.isArray(list) ? list : [],
    path: hit?.path ?? "",
    candidates,
    rootKeys: keysOf(raw),
    dataKeys: keysOf(raw?.data),
    fieldPresence: {
      root: ["data", "datas", "shops", "list", "rows", "items"].filter((k) => raw && Object.prototype.hasOwnProperty.call(raw, k)),
      data: ["data", "datas", "shops", "list", "rows", "items"].filter((k) => raw?.data && Object.prototype.hasOwnProperty.call(raw.data, k)),
    },
  };
}
async function callOpenwebDiagnostic(path: string, biz: Record<string, unknown>, attempt = 1): Promise<any> {
  const accessToken = await getValidAccessToken();
  const ts = String(Math.floor(Date.now() / 1000));
  const params: Record<string, string> = { access_token: accessToken, app_key: JST_APP_KEY, biz: JSON.stringify(biz), charset: "utf-8", timestamp: ts, version: "2" };
  params.sign = signOpenweb(params, JST_APP_SECRET);
  const endpoint = `/open/${path.replace(/^\/+/, "")}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  let httpStatus = 0, text = "", json: any = null, parseError = "";
  try {
    const resp = await proxyFetch(`${OPENWEB_BASE}${endpoint}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(), signal: ctrl.signal,
    });
    httpStatus = resp.status;
    text = await resp.text();
  } finally { clearTimeout(timer); }
  try { json = JSON.parse(text); } catch (e: any) { parseError = String(e?.message ?? e); json = {}; }
  const code = json?.code ?? json?.errCode;
  const msg = json?.msg ?? json?.message ?? "";
  const isApiOk = code === 0 || code === "0" || json?.issuccess === true;
  if (!isApiOk && attempt === 1 && /token|授权|access_token|令牌/i.test(String(msg))) {
    const seed = (await loadToken())?.refreshToken || JST_REFRESH_TOKEN_SEED;
    if (seed) {
      await refreshAccessToken(seed);
      const retry = await callOpenwebDiagnostic(path, biz, 2);
      return { ...retry, diagnostics: { ...retry.diagnostics, retried_after_token_refresh: true } };
    }
  }
  const detected = detectListPayload(json);
  const diagnostics = {
    request_endpoint: endpoint,
    request_params_summary: {
      biz,
      app_key: JST_APP_KEY ? "***CONFIGURED***" : "missing",
      access_token: accessToken ? "***CONFIGURED***" : "missing",
      charset: "utf-8",
      version: "2",
      timestamp_present: true,
      sign_present: true,
      proxy_enabled: !!JST_PROXY_URL,
      proxy_auth_configured: !!(JST_PROXY_USER && JST_PROXY_PASS),
    },
    http_status: httpStatus,
    response_code: code ?? null,
    response_msg: msg || null,
    response_root_keys: detected.rootKeys,
    response_data_keys: detected.dataKeys,
    response_field_presence: detected.fieldPresence,
    candidate_list_paths: detected.candidates,
    detected_list_path: detected.path || null,
    detected_record_count: detected.list.length,
    first_record_sample: detected.list[0] ? maskSensitive(detected.list[0]) : null,
    parse_error: parseError || null,
  };
  console.log("JST connection_test diagnostic", diagnostics);
  return { ok: httpStatus >= 200 && httpStatus < 300 && isApiOk, httpStatus, code, msg, json: maskSensitive(json), list: detected.list, diagnostics };
}
async function resolveOldCredentialErrors(resolvedAt: string) {
  const { data } = await admin.from("jst_sync_errors").select("id,error_message,module_key").neq("status", "resolved");
  const ids = (data ?? []).filter((r: any) => /credential_missing|missing secret|缺少.*JST_|缺少.*凭证|缺少必要凭证|Token 种子|JST_APP_KEY|JST_APP_SECRET|JST_ACCESS_TOKEN|JST_REFRESH_TOKEN/i.test(String(r.error_message ?? ""))).map((r: any) => r.id);
  if (ids.length) await admin.from("jst_sync_errors").update({ status: "resolved", resolved_at: resolvedAt }).in("id", ids);
}
function classifyConnectionError(msg: string, code?: unknown) {
  const text = `${String(code ?? "")} ${msg}`;
  if (/权限|permission|forbidden|无权|access denied/i.test(text)) return "shops/query 无接口权限";
  if (/ip|白名单|whitelist/i.test(text)) return "聚水潭 IP 白名单拒绝";
  if (/token|授权|access_token|令牌|invalid_grant/i.test(text)) return "token 无效或已过期";
  if (/proxy|ECONN|timeout|abort|network|fetch/i.test(text)) return "代理连接失败或网络超时";
  return "其他 API 错误";
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

      // 3) Upsert 到统一 shops 表（以 jst_shop_id 为唯一键），不覆盖人工字段
      const { data: existingShop } = await admin.from("shops")
        .select("id, platform_id")
        .eq("jst_shop_id", jstShopId)
        .is("deleted_at", null)
        .maybeSingle();

      // 自动解析 / 创建 platform_id（仅展示和筛选用）
      let platformId: string | null = null;
      if (platformType) {
        const { data: pf } = await admin.from("platforms")
          .select("id").eq("name", platformType).is("deleted_at", null).maybeSingle();
        if (pf) platformId = pf.id;
        else {
          const code = platformType.toLowerCase().replace(/\s+/g, "_");
          const { data: ins } = await admin.from("platforms")
            .insert({ code, name: platformType, status: "active" })
            .select("id").maybeSingle();
          if (ins) platformId = ins.id;
        }
      }

      const jstFields: Record<string, unknown> = {
        name: jstShopName || "未命名店铺",
        platform_type: platformType || null,
        auth_status: authStatus || null,
        shop_status_raw: shopStatus || null,
        raw_jst_json: r,
        last_synced_at: nowIso,
        updated_at: nowIso,
      };

      if (existingShop) {
        if (!existingShop.platform_id && platformId) jstFields.platform_id = platformId;
        await admin.from("shops").update(jstFields).eq("id", existingShop.id);
        shopsUpdated++;
      } else {
        await admin.from("shops").insert({
          jst_shop_id: jstShopId,
          ...jstFields,
          platform_id: platformId,
          status: "active",
          is_ignored: mappingStatus === "ignored",
        });
        shopsUpdated++;
      }

      if (mappingStatus === "unmapped") unmapped++;
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

// 已通过权限：/open/supplier/query （采购 API - 供应商查询）
const SUPPLIERS_ENDPOINT = "supplier/query";

async function syncSuppliers() {
  const PAGE_SIZE = 100;
  const MAX_PAGES = 200;
  let page = 1;
  let apiTotal = 0;          // API 返回总条数
  let parsed = 0;            // 成功解析（jstId+name 齐全）
  let inserted = 0, updated = 0, skipped = 0;
  const skipReasons: string[] = [];
  const parsedSamples: Array<{ jst_supplier_id: string; supplier_name: string; supplier_code: string; status: string; written: "inserted" | "updated" | "skipped"; reason?: string }> = [];
  const diagnostics: any[] = [];

  while (page <= MAX_PAGES) {
    const bizParams = { page_index: page, page_size: PAGE_SIZE };
    const diag = await callOpenwebDiagnostic(SUPPLIERS_ENDPOINT, bizParams);
    const code = diag.json?.code ?? diag.json?.errCode;
    const isOk = code === 0 || code === "0" || diag.json?.issuccess === true;
    // NOTE: diag.json is masked (arrays truncated to 3 by maskSensitive).
    // Use diag.list (unmasked, already-detected by detectListPayload which prefers data.datas) for actual records.
    // Scalar pagination fields survive masking, so we can still read them from diag.json.
    const dataNode = diag.json?.data ?? diag.json ?? {};
    const list: any[] = Array.isArray(diag.list) ? diag.list : [];
    const detectedPath = diag.diagnostics?.detected_list_path || "";
    const candidates = diag.diagnostics?.candidate_list_paths || [];
    const pagination = {
      page_index: dataNode.page_index ?? null,
      page_size: dataNode.page_size ?? null,
      page_count: dataNode.page_count ?? null,
      data_count: dataNode.data_count ?? null,
      has_next: dataNode.has_next ?? null,
    };
    // Sanity check: if pagination.data_count >> detected count and a deeper data.* candidate exists,
    // prefer it. (Defense-in-depth — diag.list normally already handles this.)
    let finalList = list;
    let finalPath = detectedPath;
    const dataCount = Number(pagination.data_count ?? 0);
    if (dataCount > finalList.length + 5 && Array.isArray(candidates)) {
      const deep = candidates.find((c: any) => c?.is_array && typeof c.path === "string" && c.path.startsWith("data.") && (c.count ?? 0) > finalList.length);
      if (deep) {
        const v = getPath(diag.json, deep.path);
        if (Array.isArray(v) && v.length > finalList.length) {
          finalList = v;
          finalPath = deep.path;
        }
      }
    }
    const firstSample = page === 1 && finalList[0] ? maskSensitive(finalList[0]) : undefined;
    diagnostics.push({
      page,
      request_endpoint: `/open/${SUPPLIERS_ENDPOINT}`,
      request_params_summary: bizParams,
      http_status: diag.httpStatus,
      response_code: code ?? null,
      response_msg: diag.json?.msg ?? diag.json?.message ?? "",
      response_root_keys: keysOf(diag.json),
      response_data_keys: keysOf(dataNode),
      detected_list_path: finalPath,
      detected_record_count: finalList.length,
      pagination,
      ...(firstSample !== undefined ? { first_record_sample: firstSample } : {}),
      ...(page === 1 ? { list_path_candidates: candidates } : {}),
    });
    if (!isOk) {
      const msg = diag.json?.msg ?? diag.json?.message ?? "";
      const err = new Error(`JST ${SUPPLIERS_ENDPOINT} 失败 code=${code} msg=${msg}`);
      (err as any).diagnostics = diagnostics;
      throw err;
    }
    apiTotal += finalList.length;
    if (finalList.length === 0) break;

    for (const r of finalList) {
      const jstId = pickStr(r.supplier_id, r.supplierId, r.supplier_co_id, r.co_id, r.id);
      const name = pickStr(r.name, r.supplier_name, r.co_name, r.full_name);
      const supplierCode = pickStr(r.supplier_code, r.code, r.co_code);
      const enabledFlag = r.enabled;
      const statusStr = enabledFlag === false ? "disabled" : (enabledFlag === true ? "active" : pickStr(r.status) || "active");

      // 1) 先 upsert 到 jst_suppliers_raw（保底，不丢字段）
      let rawId: string | null = null;
      if (jstId) {
        const { data: rawExisting } = await admin.from("jst_suppliers_raw").select("id")
          .eq("jst_supplier_id", jstId).maybeSingle();
        const rawRow = {
          jst_supplier_id: jstId,
          supplier_name: name || "",
          supplier_code: supplierCode || "",
          status: statusStr,
          raw_json: r,
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (rawExisting) {
          await admin.from("jst_suppliers_raw").update(rawRow).eq("id", rawExisting.id);
          rawId = rawExisting.id;
        } else {
          const { data: ins } = await admin.from("jst_suppliers_raw").insert(rawRow).select("id").single();
          rawId = ins?.id ?? null;
        }
      }

      // 2) 解析校验
      if (!jstId || !name) {
        skipped++;
        const reason = !jstId ? "缺少 supplier_id" : "缺少 name";
        skipReasons.push(reason);
        parsedSamples.push({
          jst_supplier_id: jstId || "", supplier_name: name || "", supplier_code: supplierCode || "",
          status: statusStr, written: "skipped", reason,
        });
        if (rawId) await admin.from("jst_suppliers_raw").update({ skip_reason: reason }).eq("id", rawId);
        continue;
      }
      parsed++;

      // 3) 映射到 ops_suppliers
      const { data: existing } = await admin.from("ops_suppliers").select("id")
        .eq("jst_supplier_id", jstId).maybeSingle();
      const row = {
        jst_supplier_id: jstId,
        name,
        code: supplierCode || jstId,
        contact: pickStr(r.contacts, r.contact, r.contact_name, r.linkman),
        phone: pickStr(r.mobile, r.phone, r.tel),
        email: pickStr(r.email),
        address: pickStr(r.address),
        raw_jst_json: r,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      let written: "inserted" | "updated" = "updated";
      let opsId: string | null = null;
      if (existing) {
        // 仅更新聚水潭侧字段。confirm_status / confirmed_* / archived_* 由人工维护，sync 永不动。
        await admin.from("ops_suppliers").update({ ...row, status: statusStr }).eq("id", existing.id);
        opsId = existing.id;
        updated++;
        written = "updated";
      } else {
        // 新建供应商默认 confirm_status='unconfirmed'（由数据库默认值控制），等待人工确认。
        const { data: ins } = await admin.from("ops_suppliers")
          .insert({ ...row, status: statusStr }).select("id").single();
        opsId = ins?.id ?? null;
        inserted++;
        written = "inserted";
      }
      if (rawId && opsId) {
        await admin.from("jst_suppliers_raw").update({ matched_ops_supplier_id: opsId, skip_reason: "" }).eq("id", rawId);
      }
      parsedSamples.push({
        jst_supplier_id: jstId, supplier_name: name, supplier_code: supplierCode || "", status: statusStr, written,
      });
    }

    const hasNext = pagination.has_next === true || pagination.has_next === "true";
    const pageCount = Number(pagination.page_count ?? 0);
    // 结束条件：has_next=false 且（无 page_count 或已到末页）
    if (!hasNext && (pageCount === 0 || page >= pageCount)) break;
    page++;
    await sleep(RATE_DELAY_MS);
  }

  console.log("[syncSuppliers diagnostics]", JSON.stringify(diagnostics));
  console.log("[syncSuppliers parsed list]", JSON.stringify(parsedSamples));

  const reasonsTxt = skipped > 0 ? `（跳过原因：${[...new Set(skipReasons)].join("/")}）` : "";
  const summary = `API 返回 ${apiTotal} 条，成功解析 ${parsed} 条，新增 ${inserted}，更新 ${updated}，跳过 ${skipped}${reasonsTxt}`;
  return {
    total: apiTotal, parsed, inserted, updated, skipped,
    summary,
    diagnostics,
    parsed_samples: parsedSamples,
    skip_reasons: skipReasons,
  };
}

function detectSupplierList(raw: any) {
  // Prefer deeper data.* paths first (聚水潭 v2 标准结构是 data.datas)
  const paths = [
    "data.datas", "data.list", "data.suppliers", "data.channels", "data.rows", "data.items",
    "datas", "list", "suppliers", "channels", "rows", "items", "data",
  ];
  const candidates = paths.map((path) => {
    const value = getPath(raw, path);
    return { path, exists: value !== undefined, is_array: Array.isArray(value), count: Array.isArray(value) ? value.length : null };
  });
  const hit = candidates.find((c) => c.is_array);
  const list = hit ? getPath(raw, hit.path) : [];
  return { list: Array.isArray(list) ? list : [], path: hit?.path ?? "", candidates };
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
// 规则:仅"待处理 (unmapped/pending)"店铺会阻塞正式销售汇总;
// 已忽略 (ignored) 视为业务上已处理 (历史废弃 / 个体户已注销),不阻塞;
// 无主体 / 无平台 / 重复绑定的检查仅针对"已映射 (mapped)"店铺。
async function shopMappingPrecheck() {
  const { data } = await admin.from("jst_shop_mappings")
    .select("matched_shop_id, matched_business_entity_id, matched_platform_id, mapping_status");
  const rows = (data ?? []) as any[];
  const total = rows.length;
  const mappedRows = rows.filter(r => r.mapping_status === "mapped");
  const ignored = rows.filter(r => r.mapping_status === "ignored").length;
  const pending = total - mappedRows.length - ignored;
  const noEntity = mappedRows.filter(r => !r.matched_business_entity_id).length;
  const noPlatform = mappedRows.filter(r => !r.matched_platform_id).length;
  const shopCount = new Map<string, number>();
  mappedRows.forEach(r => { if (r.matched_shop_id) shopCount.set(r.matched_shop_id, (shopCount.get(r.matched_shop_id) ?? 0) + 1); });
  const dupCount = Array.from(shopCount.values()).filter(n => n > 1).length;
  const blocking = pending > 0 || noEntity > 0 || noPlatform > 0 || dupCount > 0;
  return {
    blocking, pending, unmapped: pending, ignored, mapped: mappedRows.length, total,
    noEntity, noPlatform, dupCount,
    summary: `共 ${total},已映射 ${mappedRows.length},已忽略 ${ignored},待处理 ${pending};已映射中无主体 ${noEntity},无平台 ${noPlatform},重复 ${dupCount}`,
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
    const action = String(body.action ?? "sync");
    const moduleKey = String(body.module_key ?? "");
    const triggerType = String(body.trigger_type ?? "manual");
    const scope = body.scope as string[] | undefined;
    const days = Math.max(1, Math.min(60, Number(body.days ?? 7)));

    // ============ connection_test ============
    if (action === "connection_test") {
      const present = {
        JST_APP_KEY: !!JST_APP_KEY,
        JST_APP_SECRET: !!JST_APP_SECRET,
        JST_ACCESS_TOKEN: !!JST_ACCESS_TOKEN_SEED,
        JST_REFRESH_TOKEN: !!JST_REFRESH_TOKEN_SEED,
        JST_PROXY_URL: !!JST_PROXY_URL,
        JST_PROXY_USER: !!JST_PROXY_USER,
        JST_PROXY_PASS: !!JST_PROXY_PASS,
      };
      console.log("JST connection_test env presence (masked):", present);
      const missing = ["JST_APP_KEY", "JST_APP_SECRET"].filter((k) => !(present as any)[k]);
      const tokRow = await loadToken();
      const hasTokenSource = !!(JST_ACCESS_TOKEN_SEED || JST_REFRESH_TOKEN_SEED || tokRow?.accessToken);
      console.log("JST connection_test token source:", { env_access: !!JST_ACCESS_TOKEN_SEED, env_refresh: !!JST_REFRESH_TOKEN_SEED, db_token: !!tokRow?.accessToken });
      const checkedAt = new Date().toISOString();

      const createConnectionRun = async (status: "ok" | "warn" | "error", summary: string, durationMs?: number, errorMessage = "") => {
        await admin.from("jst_sync_runs").insert({
          module_key: "connection", trigger_type: "manual", status,
          started_at: checkedAt, finished_at: new Date().toISOString(), duration_ms: durationMs,
          current_total_summary: summary, error_message: errorMessage, created_by: user.id,
        });
      };
      if (missing.length || !hasTokenSource) {
        const reason = missing.length
          ? `缺少必要凭证: ${missing.join(", ")}`
          : "缺少 JST_ACCESS_TOKEN 或 JST_REFRESH_TOKEN（任意其一作为初始种子）";
        await createConnectionRun("error", "连接检测失败", undefined, reason);
        await admin.from("jst_sync_errors").insert({
          module_key: "connection", error_level: "error", status: "open",
          error_message: reason, first_seen_at: checkedAt, last_seen_at: checkedAt,
        });
        return respJson({ ok: false, status: "error", present, checked_at: checkedAt, error: reason });
      }
      await resolveOldCredentialErrors(checkedAt);
      const t0 = Date.now();
      try {
        const probe = await callOpenwebDiagnostic("shops/query", { page_index: 1, page_size: 10 });
        const durationMs = Date.now() - t0;
        if (!probe.ok) {
          const reason = classifyConnectionError(String(probe.msg ?? ""), probe.code);
          const errMsg = `${reason}: shops/query 接口错误 code=${probe.code ?? ""} msg=${probe.msg ?? ""}`.trim();
          await createConnectionRun("error", "连接检测失败", durationMs, errMsg);
          await admin.from("jst_sync_errors").insert({
            module_key: "connection", error_level: "error", status: "open",
            error_message: errMsg, first_seen_at: checkedAt, last_seen_at: checkedAt,
          });
          return respJson({ ok: false, status: "error", present, checked_at: checkedAt, duration_ms: durationMs, error: errMsg, diagnostics: probe.diagnostics, sanitized_response: probe.json });
        }
        const shopCount = probe.list.length;
        if (shopCount === 0) {
          const warning = probe.diagnostics.detected_list_path
            ? `shops/query 返回空列表，读取路径 ${probe.diagnostics.detected_list_path}`
            : "shops/query 返回结构无法识别，未找到 shops/list/rows/datas 数组";
          await createConnectionRun("warn", "连接可达，但未获取到店铺数据", durationMs, warning);
          await admin.from("jst_sync_errors").insert({
            module_key: "connection", error_level: "warn", status: "open",
            error_message: warning, first_seen_at: checkedAt, last_seen_at: checkedAt,
          });
          return respJson({
            ok: false, status: "warning", present, checked_at: checkedAt, duration_ms: durationMs,
            sample_shop_count: 0, message: "连接可达，但未获取到店铺数据", error: warning,
            hint: "可能是 shops/query 权限不足、请求参数不符合该 App 要求、账号确实未返回店铺，或返回结构需要调整解析。请查看脱敏响应诊断。",
            diagnostics: probe.diagnostics, sanitized_response: probe.json,
          });
        }
        await createConnectionRun("ok", `聚水潭 API 连接正常，样本店铺 ${shopCount} 条`, durationMs);
        return respJson({
          ok: true, status: "success", present, checked_at: checkedAt,
          duration_ms: durationMs,
          sample_shop_count: shopCount,
          message: "聚水潭 API 连接正常",
          diagnostics: probe.diagnostics,
          sanitized_response: probe.json,
        });
      } catch (e: any) {
        const errMsg = String(e?.message ?? e);
        const durationMs = Date.now() - t0;
        const reason = classifyConnectionError(errMsg);
        const fullErrMsg = `${reason}: ${errMsg}`;
        await createConnectionRun("error", "连接检测失败", durationMs, fullErrMsg);
        await admin.from("jst_sync_errors").insert({
          module_key: "connection", error_level: "error", status: "open",
          error_message: `连接检测失败: ${fullErrMsg}`, first_seen_at: checkedAt, last_seen_at: checkedAt,
        });
        return respJson({
          ok: false, status: "error", present, checked_at: checkedAt,
          duration_ms: durationMs, error: fullErrMsg,
          hint: /timeout|abort|fetch|proxy|ECONN|network/i.test(errMsg)
            ? "可能为网络/代理/IP 白名单问题，请检查 JST_PROXY_URL 与聚水潭白名单"
            : "请检查凭证是否正确，或 Access Token 是否过期",
        });
      }
    }

    // 凭证前置校验
    if (moduleKey === "sales_refund" || moduleKey === "base_archive") {
      let credErr: string | null = null;
      if (!JST_APP_KEY || !JST_APP_SECRET) {
        credErr = "缺少聚水潭 API 凭证，请先在 Edge Function Secrets 中配置 JST_APP_KEY / JST_APP_SECRET";
      } else if (!JST_ACCESS_TOKEN_SEED && !JST_REFRESH_TOKEN_SEED) {
        const tok = await loadToken();
        if (!tok?.accessToken) {
          credErr = "缺少聚水潭 Token 种子，请配置 JST_ACCESS_TOKEN 或 JST_REFRESH_TOKEN";
        }
      }
      if (credErr) {
        await admin.from("jst_sync_errors").insert({
          module_key: moduleKey, error_level: "error", status: "open",
          error_message: credErr,
        });
        return respJson({ ok: false, error: credErr }, 400);
      }
    }

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

    // 子任务隔离执行：单个失败不影响其它子任务，最终聚合状态
    const subResults: Record<string, { status: "ok" | "error" | "skipped"; summary: string; inserted: number; updated: number; error?: string; extra?: any }> = {
      shops: { status: "skipped", summary: "未执行", inserted: 0, updated: 0 },
      suppliers: { status: "skipped", summary: "未执行", inserted: 0, updated: 0 },
      warehouses: { status: "skipped", summary: "未执行", inserted: 0, updated: 0 },
    };
    let shopStats: any = null;
    let runFinalized = false;

    try {
      for (const t of targets) {
        try {
          if (t === "shops") {
            const r = await syncShops();
            subResults.shops = { status: "ok", summary: r.summary, inserted: r.mappingInserted, updated: r.mappingUpdated + r.shopsUpdated };
            shopStats = r;
          } else if (t === "suppliers") {
            const r = await syncSuppliers();
            subResults.suppliers = { status: "ok", summary: r.summary, inserted: r.inserted, updated: r.updated, extra: { api_total: r.total, parsed: r.parsed, skipped: r.skipped, skip_reasons: r.skip_reasons, diagnostics: r.diagnostics, parsed_samples: r.parsed_samples } } as any;
          } else if (t === "warehouses") {
            const r = await syncWarehouses();
            subResults.warehouses = { status: "ok", summary: r.summary, inserted: r.inserted, updated: r.updated };
          }
        } catch (subErr: any) {
          const em = String(subErr?.message ?? subErr);
          subResults[t] = { status: "error", summary: `${t} 同步失败`, inserted: 0, updated: 0, error: em };
          // 写入子任务错误，便于页面区分
          await admin.from("jst_sync_errors").insert({
            module_key: `base_archive:${t}`, error_level: "error", status: "open",
            error_message: `[${t}] ${em}`,
          });
        }
      }

      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - t0;
      const executed = targets.filter((t) => subResults[t]?.status !== "skipped");
      const okSubs = executed.filter((t) => subResults[t].status === "ok");
      const failSubs = executed.filter((t) => subResults[t].status === "error");
      const inserted = executed.reduce((s, t) => s + subResults[t].inserted, 0);
      const updated = executed.reduce((s, t) => s + subResults[t].updated, 0);
      const summaryParts = executed.map((t) =>
        subResults[t].status === "ok"
          ? subResults[t].summary
          : `${t}: 失败(${subResults[t].error?.slice(0, 80) ?? ""})`
      );
      const summary = summaryParts.join("；");
      const overallStatus =
        failSubs.length === 0 ? "ok" :
        okSubs.length === 0 ? "error" : "partial";
      const nextSync = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      await admin.from("jst_sync_runs").update({
        status: overallStatus === "partial" ? "ok" : overallStatus, // run 表只支持 ok/error/aborted，partial 计为 ok
        finished_at: finishedAt, duration_ms: durationMs,
        inserted_count: inserted, updated_count: updated,
        failed_count: failSubs.length,
        current_total_summary: overallStatus === "partial" ? `部分成功：${summary}` : summary,
        error_message: failSubs.length ? failSubs.map((t) => `[${t}] ${subResults[t].error}`).join(" | ") : "",
      }).eq("id", runId);
      runFinalized = true;

      await admin.from("jst_sync_modules").update({
        status: overallStatus === "ok" ? "ok" : (overallStatus === "partial" ? "partial" : "error"),
        last_sync_at: finishedAt, next_sync_at: nextSync,
        last_result_summary: summary.slice(0, 400),
        retry_count: 0,
      }).eq("module_key", "base_archive");

      // 仅在该子任务成功时清理对应子任务旧错误；不要全清
      for (const t of okSubs) {
        await admin.from("jst_sync_errors").update({ status: "resolved", resolved_at: finishedAt })
          .eq("module_key", `base_archive:${t}`).neq("status", "resolved");
      }
      // 全部成功才清 base_archive 父键错误
      if (overallStatus === "ok") {
        await admin.from("jst_sync_errors").update({ status: "resolved", resolved_at: finishedAt })
          .eq("module_key", "base_archive").neq("status", "resolved");
      }

      await admin.from("jst_sync_metrics").upsert({
        metric_key: "base_archive_summary",
        metric_name: "基础档案",
        metric_value: summary,
        metric_extra: {
          parts: summaryParts, inserted, updated,
          sub_results: subResults,
          overall_status: overallStatus,
          executed,
        },
        time_range_label: "全量快照",
        data_source_label: "聚水潭基础档案",
        last_sync_at: finishedAt,
        updated_at: finishedAt,
      }, { onConflict: "metric_key" });

      if (shopStats) {
        const { data: allMaps } = await admin.from("jst_shop_mappings").select("mapping_status");
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

      return respJson({ ok: failSubs.length === 0, run_id: runId, status: overallStatus, summary, inserted, updated, duration_ms: durationMs, sub_results: subResults, shopStats });

    } catch (e: any) {
      // 兜底：理论上不会到这里（子任务已 try/catch），但只要发生就保证 run 收尾
      const finishedAt = new Date().toISOString();
      const errMsg = String(e?.message ?? e);
      await admin.from("jst_sync_runs").update({
        status: "error", finished_at: finishedAt, duration_ms: Date.now() - t0,
        error_message: errMsg, current_total_summary: "同步失败（dispatcher 异常）",
      }).eq("id", runId);
      runFinalized = true;
      await admin.from("jst_sync_errors").insert({
        module_key: "base_archive", error_level: "error", status: "open",
        error_message: errMsg,
      });
      await admin.from("jst_sync_modules").update({
        status: "error", last_result_summary: errMsg.slice(0, 200),
        last_sync_at: finishedAt,
      }).eq("module_key", "base_archive");
      return respJson({ ok: false, run_id: runId, error: errMsg }, 200);
    } finally {
      // ★ 终极兜底：无论如何，确保 run 不会停留在 running
      if (!runFinalized) {
        const finishedAt = new Date().toISOString();
        await admin.from("jst_sync_runs").update({
          status: "aborted", finished_at: finishedAt, duration_ms: Date.now() - t0,
          error_message: "Edge Function 未正常返回（可能为 timeout / OOM / 进程终止），由 finally 兜底标记 aborted",
          current_total_summary: "同步中断（finally 兜底）",
        }).eq("id", runId).eq("status", "running");
      }
    }
  } catch (e: any) {
    return respJson({ error: String(e?.message ?? e) }, 500);
  }
});
