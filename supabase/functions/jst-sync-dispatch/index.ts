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
  let page = 1, total = 0, updated = 0, skipped = 0;
  while (true) {
    const data = await callOpenweb("shops/query", { page_index: page, page_size: 100 });
    const list: any[] = data.shops ?? data.datas ?? data.list ?? [];
    if (list.length === 0) break;
    for (const r of list) {
      const externalId = pickStr(r.shop_id, r.shopId, r.id);
      const name = pickStr(r.shop_name, r.name, r.nick);
      if (!externalId) continue;
      total++;
      // 仅更新已存在的店铺（entity_id / platform_id 必须由人工预先建立映射）
      const { data: existing } = await admin.from("shops").select("id")
        .eq("external_shop_id", externalId).is("deleted_at", null).maybeSingle();
      if (existing) {
        await admin.from("shops").update({ name, updated_at: new Date().toISOString() }).eq("id", existing.id);
        updated++;
      } else {
        skipped++;
      }
    }
    if (list.length < 100) break;
    page++;
    await sleep(RATE_DELAY_MS);
  }
  return { total, updated, skipped, summary: `店铺 ${total} 条（更新 ${updated}，待建实体映射 ${skipped}）` };
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
    const scope = body.scope as string[] | undefined; // 可选: ["shops","suppliers","warehouses"]

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
      for (const t of targets) {
        if (t === "shops") {
          const r = await syncShops();
          parts.push(r.summary);
          updated += r.updated;
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

      // 解决该模块下的开放异常
      await admin.from("jst_sync_errors").update({ status: "resolved", resolved_at: finishedAt })
        .eq("module_key", "base_archive").neq("status", "resolved");

      // 更新指标
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

      return respJson({ ok: true, run_id: runId, summary, inserted, updated, duration_ms: durationMs });
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
