// 采购单详情接口
// GET ?id=<uuid>
// RLS 强制隔离，供应商只能看到自己的采购单。

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: claims, error: authErr } = await supabase.auth.getClaims(auth.slice(7));
  if (authErr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return json({ error: "Missing id" }, 400);

  try {
    const { data: po, error: poErr } = await supabase
      .from("purchase_orders")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (poErr) throw poErr;
    if (!po) return json({ error: "Not found" }, 404);

    const [{ data: items }, { data: receipts }] = await Promise.all([
      supabase.from("purchase_order_items").select("*").eq("purchase_order_id", id),
      supabase
        .from("purchase_receipts")
        .select("*, purchase_receipt_items(*)")
        .eq("purchase_order_id", id)
        .order("io_date", { ascending: false }),
    ]);

    return json({ purchase_order: po, items: items ?? [], receipts: receipts ?? [] });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
