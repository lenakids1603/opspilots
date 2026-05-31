// 管理员管理供应商登录账号（service role）
// 仅 ops admin 可调用
// 操作：list / create / update / set_password / set_status
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function emailOf(username: string) {
  return `${username.trim().toLowerCase()}@supplier.local`;
}

const WEAK_PASSWORDS = new Set([
  "123456","12345678","password","password123","qwerty123",
  "admin123","gys123","jz123456","88888888","11111111",
]);

function isWeakPasswordError(msg: string) {
  return /weak|easy to guess|Password is known to be weak/i.test(msg);
}

function normalizeAuthError(error: unknown) {
  const message = (error as Error)?.message ?? "操作失败";
  if (isWeakPasswordError(message)) {
    return { message: "密码强度太低，请换一个更复杂的密码，例如：Jz2026@Kids!", status: 400 };
  }
  if (/already registered|already exists|User already/i.test(message)) {
    return { message: "登录账号已存在，系统已尝试修复，请刷新后重试或直接修改密码", status: 400 };
  }
  return { message, status: 500 };
}

function validatePassword(password: string) {
  if (!password || password.length < 8) return "密码强度太低，请使用至少8位，并包含大小写字母、数字和特殊符号";
  if (WEAK_PASSWORDS.has(password)) return "密码强度太低，请换一个更复杂的密码";
  if (!/[A-Z]/.test(password)) return "密码强度太低，请使用至少8位，并包含大小写字母、数字和特殊符号";
  if (!/[a-z]/.test(password)) return "密码强度太低，请使用至少8位，并包含大小写字母、数字和特殊符号";
  if (!/[0-9]/.test(password)) return "密码强度太低，请使用至少8位，并包含大小写字母、数字和特殊符号";
  if (!/[!@#$%^&*?_\-+=().,;:]/.test(password)) return "密码强度太低，请使用至少8位，并包含大小写字母、数字和特殊符号";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return json({ error: "Missing authorization token" }, 401);
  }

  // 校验调用方
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData, error: uerr } = await userClient.auth.getUser();
  if (uerr || !userData?.user) {
    return json({ error: "Invalid or expired session" }, 401);
  }
  const uid = userData.user.id;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // 必须是内部员工
  const { data: prof } = await admin
    .from("profiles").select("account_type").eq("id", uid).maybeSingle();
  if (!prof || prof.account_type !== "internal") {
    return json({ error: "Forbidden: internal staff only" }, 403);
  }

  try {
    if (req.method === "GET") {
      const { data: profiles, error } = await admin
        .from("profiles")
        .select("id, username, full_name, phone, supplier_id, account_type")
        .eq("account_type", "supplier")
        .order("username", { ascending: true });
      if (error) throw error;

      const { data: suppliers } = await admin
        .from("ops_suppliers").select("id, name");
      const sMap = new Map((suppliers ?? []).map((s: any) => [s.id, s.name]));

      const rows = [];
      for (const p of profiles ?? []) {
        const { data: au } = await admin.auth.admin.getUserById(p.id);
        const u = au?.user;
        rows.push({
          id: p.id,
          username: p.username ?? "",
          email: u?.email ?? null,
          supplier_id: p.supplier_id,
          supplier_name: p.supplier_id ? sMap.get(p.supplier_id) ?? "" : "",
          contact_name: p.full_name ?? "",
          contact_phone: p.phone ?? "",
          remark: (u?.user_metadata as any)?.remark ?? "",
          status: u?.banned_until && new Date(u.banned_until) > new Date() ? "disabled" : "active",
          last_login_at: u?.last_sign_in_at ?? null,
          created_at: u?.created_at ?? null,
        });
      }
      return json({ rows });
    }

    const body = await req.json();
    const action = body.action as string;

    if (action === "create") {
      const username = String(body.username ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const supplier_id = body.supplier_id || null;
      const contact_name = String(body.contact_name ?? "");
      const contact_phone = String(body.contact_phone ?? "");
      const remark = String(body.remark ?? "");
      if (!username) return json({ error: "登录账号必填" }, 400);
      const pwdError = validatePassword(password);
      if (pwdError) return json({ error: pwdError }, 400);
      if (!supplier_id) return json({ error: "请选择供应商" }, 400);

      // 幂等创建：复用已有 profile / auth 用户
      let newUid: string | null = null;
      const email = emailOf(username);

      const { data: dupProf } = await admin
        .from("profiles").select("id").eq("username", username).maybeSingle();
      if (dupProf) newUid = dupProf.id;

      if (!newUid) {
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const exist = list?.users?.find((u: any) => u.email?.toLowerCase() === email);
        if (exist) newUid = exist.id;
      }

      if (newUid) {
        const { error: upErr } = await admin.auth.admin.updateUserById(newUid, {
          password, email, email_confirm: true,
          user_metadata: { username, full_name: contact_name, phone: contact_phone, account_type: "supplier", user_type: "supplier", remark },
        });
        if (upErr) {
          const n = normalizeAuthError(upErr);
          return json({ error: n.message }, n.status);
        }
      } else {
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email, password, email_confirm: true,
          user_metadata: { username, full_name: contact_name, phone: contact_phone, account_type: "supplier", user_type: "supplier", remark },
        });
        if (cErr) {
          const n = normalizeAuthError(cErr);
          return json({ error: n.message }, n.status);
        }
        newUid = created.user!.id;
      }

      // 写入 profile（必须检查 error）
      const { error: profileErr } = await admin.from("profiles").upsert({
        id: newUid,
        username,
        full_name: contact_name,
        phone: contact_phone,
        supplier_id,
        account_type: "supplier",
        user_type: "supplier",
        department: "供应商",
      } as any, { onConflict: "id" });
      if (profileErr) {
        return json({ error: "写入供应商 profile 失败：" + profileErr.message }, 500);
      }

      // 写入角色（必须检查 error）
      const { error: roleErr } = await admin
        .from("ops_user_roles")
        .upsert({ user_id: newUid, role_code: "supplier" } as any, { onConflict: "user_id,role_code" });
      if (roleErr) {
        return json({ error: "写入供应商角色失败：" + roleErr.message }, 500);
      }

      // 验证：确保 profile 已落库并且类型正确
      const { data: verify, error: vErr } = await admin
        .from("profiles")
        .select("id, account_type, user_type, supplier_id")
        .eq("id", newUid).maybeSingle();
      if (vErr || !verify) {
        return json({ error: "创建后无法读取 profile，请刷新重试" }, 500);
      }
      if (verify.account_type !== "supplier" || verify.user_type !== "supplier" || !verify.supplier_id) {
        return json({
          error: `供应商账号类型写入异常：account_type=${verify.account_type}, user_type=${verify.user_type}, supplier_id=${verify.supplier_id ?? "null"}`,
        }, 500);
      }

      return json({ ok: true, id: newUid });
    }

    if (action === "update") {
      const id = String(body.id);
      const supplier_id = body.supplier_id || null;
      const contact_name = String(body.contact_name ?? "");
      const contact_phone = String(body.contact_phone ?? "");
      const remark = String(body.remark ?? "");
      const { error: pErr } = await admin.from("profiles").update({
        supplier_id, full_name: contact_name, phone: contact_phone,
      }).eq("id", id);
      if (pErr) return json({ error: "更新供应商 profile 失败：" + pErr.message }, 500);
      const { error: uErr } = await admin.auth.admin.updateUserById(id, { user_metadata: { remark } });
      if (uErr) return json({ error: "更新供应商账号失败：" + uErr.message }, 500);
      return json({ ok: true });
    }

    if (action === "set_password") {
      const id = String(body.id);
      const password = String(body.password ?? "");
      const pwdError = validatePassword(password);
      if (pwdError) return json({ error: pwdError }, 400);
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) {
        const n = normalizeAuthError(error);
        return json({ error: n.status === 400 ? n.message : "重置密码失败：" + error.message }, n.status);
      }
      return json({ ok: true });
    }

    if (action === "set_status") {
      const id = String(body.id);
      const disabled = !!body.disabled;
      const { error } = await admin.auth.admin.updateUserById(id, {
        ban_duration: disabled ? "876000h" : "none",
      } as any);
      if (error) return json({ error: "更新账号状态失败：" + error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "未知操作" }, 400);
  } catch (e) {
    console.error(e);
    const normalized = normalizeAuthError(e);
    return json({ error: normalized.message }, normalized.status);
  }
});
