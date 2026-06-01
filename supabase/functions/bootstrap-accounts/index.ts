// Bootstrap helper: creates / repairs the lena (admin) and mmz (supplier) accounts.
// Idempotent: re-running just resets passwords + roles.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Spec = {
  email: string;
  username: string;
  password: string;
  full_name: string;
  account_type: "internal" | "supplier";
  user_type: "internal" | "supplier";
  ops_role: "admin" | "supplier";
  supplier_code?: string;
};

const SPECS: Spec[] = [
  {
    email: "lena@lenakids.local",
    username: "lena",
    password: "Lena@2026",
    full_name: "Lena 管理员",
    account_type: "internal",
    user_type: "internal",
    ops_role: "admin",
  },
  {
    email: "mmz@supplier.local",
    username: "mmz",
    password: "Mmz@2026",
    full_name: "MMZ 供应商",
    account_type: "supplier",
    user_type: "supplier",
    ops_role: "supplier",
    supplier_code: "MMZ",
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const results: Array<Record<string, unknown>> = [];

  for (const spec of SPECS) {
    try {
      // Find existing by email or username
      let uid: string | null = null;
      const { data: byUsername } = await admin
        .from("profiles").select("id").eq("username", spec.username).maybeSingle();
      if (byUsername) uid = byUsername.id;
      if (!uid) {
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const exist = list?.users?.find((u: any) => u.email?.toLowerCase() === spec.email);
        if (exist) uid = exist.id;
      }

      if (uid) {
        const { error: upErr } = await admin.auth.admin.updateUserById(uid, {
          email: spec.email,
          password: spec.password,
          email_confirm: true,
          user_metadata: {
            username: spec.username, full_name: spec.full_name,
            user_type: spec.user_type, account_type: spec.account_type,
          },
        });
        if (upErr) throw upErr;
      } else {
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email: spec.email,
          password: spec.password,
          email_confirm: true,
          user_metadata: {
            username: spec.username, full_name: spec.full_name,
            user_type: spec.user_type, account_type: spec.account_type,
          },
        });
        if (cErr) throw cErr;
        uid = created.user!.id;
      }

      // Resolve supplier_id for mmz
      let supplier_id: string | null = null;
      if (spec.supplier_code) {
        const { data: sup } = await admin.from("ops_suppliers")
          .select("id").eq("code", spec.supplier_code).maybeSingle();
        if (sup) supplier_id = sup.id;
        else {
          const { data: ins, error: sErr } = await admin.from("ops_suppliers")
            .insert({ code: spec.supplier_code, name: "MMZ 测试供应商", status: "active", confirm_status: "confirmed", confirmed_at: new Date().toISOString() })
            .select("id").single();
          if (sErr) throw sErr;
          supplier_id = ins.id;
        }
      }

      // Upsert profile
      const { error: pErr } = await admin.from("profiles").upsert({
        id: uid,
        username: spec.username,
        full_name: spec.full_name,
        department: spec.account_type === "supplier" ? "供应商" : "管理层",
        account_type: spec.account_type,
        user_type: spec.user_type,
        supplier_id,
      } as any, { onConflict: "id" });
      if (pErr) throw pErr;

      // Upsert ops role
      const { error: rErr } = await admin.from("ops_user_roles").upsert(
        { user_id: uid, role_code: spec.ops_role } as any,
        { onConflict: "user_id,role_code" },
      );
      if (rErr) throw rErr;

      results.push({ username: spec.username, id: uid, ok: true, password: spec.password });
    } catch (e) {
      results.push({ username: spec.username, ok: false, error: (e as Error).message });
    }
  }

  return json({ results });
});
