import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ParsedData {
  transaction_direction: string;
  occurred_date: string | null;
  amount: number | null;
  payer_name: string | null;
  payer_account: string | null;
  payer_bank: string | null;
  payee_name: string | null;
  payee_account: string | null;
  payee_bank: string | null;
  counterparty_name: string | null;
  counterparty_account: string | null;
  transaction_serial_no: string | null;
  bank_transaction_time: string | null;
  memo: string | null;
  raw_text: string | null;
}

const SYSTEM_PROMPT = `你是一个银行回单 OCR 与信息抽取助手。用户会上传一张银行回单图片（电子回单 / 转账截图 / 网银截图等）。请严格识别其中的关键字段，并以 JSON 格式返回。

字段说明：
- transaction_direction: 仅返回 "expense"(我方付款) / "income"(我方收款) / "internal_transfer"(内部转账) / "unknown"
- occurred_date: 交易日期，格式 YYYY-MM-DD
- amount: 金额，数字（人民币元，去掉千分位）
- payer_name / payer_account / payer_bank: 付款方户名/账号/开户行
- payee_name / payee_account / payee_bank: 收款方户名/账号/开户行
- counterparty_name / counterparty_account: 对方户名/账号（相对回单视角的对方，可留 null 由前端推断）
- transaction_serial_no: 银行流水号 / 回单编号 / 业务参考号
- bank_transaction_time: 交易时间 YYYY-MM-DD HH:mm:ss
- memo: 用途 / 附言 / 摘要 / 备注
- raw_text: 你识别出的回单原始可读文本

只返回严格的 JSON 对象，无注释、无多余文字。未识别字段返回 null。`;

async function callLovableAI(imageDataUrl: string): Promise<ParsedData> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY 未配置");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "请识别这张银行回单并按 JSON 返回所有字段。" },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (res.status === 429) throw new Error("AI 调用频率超限，请稍后重试");
  if (res.status === 402) throw new Error("AI 额度已耗尽，请联系管理员充值");
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`AI 调用失败 (${res.status}): ${txt.slice(0, 300)}`);
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content) as ParsedData;
  } catch {
    // Try extract JSON
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("AI 返回内容不是有效 JSON");
  }
}

function norm(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, "").toLowerCase();
}

function normalizeAccountNo(s: string | null | undefined): string {
  return (s ?? "").replace(/[\s\-*]/g, "");
}

function similarity(a: string, b: string): number {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  // simple token overlap
  const sa = new Set(x);
  const sb = new Set(y);
  let inter = 0;
  sa.forEach((c) => { if (sb.has(c)) inter++; });
  return inter / Math.max(sa.size, sb.size);
}

interface MatchContext {
  entities: any[];
  banks: any[];
  suppliers: any[];
  categories: any[];
}

function matchAll(parsed: ParsedData, ctx: MatchContext) {
  const warnings: string[] = [];
  const confidence: Record<string, number> = {};

  const payerAcct = normalizeAccountNo(parsed.payer_account);
  const payeeAcct = normalizeAccountNo(parsed.payee_account);

  // Helper: find our bank account by account number (with normalized field)
  const findOurBank = (acct: string) => {
    if (!acct) return null;
    return ctx.banks.find((b) => {
      const n = (b.normalized_account_no || normalizeAccountNo(b.account_no_masked));
      if (!n) return false;
      // Bank account may be masked. Compare last 4-8 digits.
      const tail = acct.slice(-6);
      return n === acct || n.endsWith(tail) || acct.endsWith(n.slice(-6));
    }) || null;
  };

  const payerOurs = findOurBank(payerAcct);
  const payeeOurs = findOurBank(payeeAcct);

  let direction = parsed.transaction_direction;
  let bankAcct: any = null;
  let counterpartyName = parsed.counterparty_name;
  let counterpartyAccount = parsed.counterparty_account;

  if (payerOurs && payeeOurs) {
    direction = "internal_transfer";
    bankAcct = payerOurs;
  } else if (payerOurs) {
    direction = "expense";
    bankAcct = payerOurs;
    counterpartyName = counterpartyName || parsed.payee_name;
    counterpartyAccount = counterpartyAccount || parsed.payee_account;
  } else if (payeeOurs) {
    direction = "income";
    bankAcct = payeeOurs;
    counterpartyName = counterpartyName || parsed.payer_name;
    counterpartyAccount = counterpartyAccount || parsed.payer_account;
  } else {
    // Try fuzzy by name
    const fuzzy = (name: string | null) => {
      if (!name) return null;
      let best: any = null, bestS = 0;
      for (const b of ctx.banks) {
        const s = Math.max(similarity(b.account_name, name), similarity(b.bank_name || "", name));
        if (s > bestS) { bestS = s; best = b; }
      }
      return bestS >= 0.7 ? { b: best, s: bestS } : null;
    };
    const fpayer = fuzzy(parsed.payer_name);
    const fpayee = fuzzy(parsed.payee_name);
    if (fpayer && (!fpayee || fpayer.s > fpayee.s)) {
      bankAcct = fpayer.b; direction = "expense";
      counterpartyName = counterpartyName || parsed.payee_name;
      counterpartyAccount = counterpartyAccount || parsed.payee_account;
      confidence.bank_account = fpayer.s;
    } else if (fpayee) {
      bankAcct = fpayee.b; direction = "income";
      counterpartyName = counterpartyName || parsed.payer_name;
      counterpartyAccount = counterpartyAccount || parsed.payer_account;
      confidence.bank_account = fpayee.s;
    }
  }

  if (!bankAcct) {
    warnings.push("未能匹配我方银行账户，请人工选择");
    confidence.bank_account = 0;
  } else {
    confidence.bank_account = confidence.bank_account ?? 0.95;
  }

  // Entity matching
  let entity: any = null;
  if (bankAcct) {
    entity = ctx.entities.find((e) => e.id === bankAcct.entity_id) || null;
    confidence.business_entity = entity ? 0.95 : 0;
  }
  if (!entity) warnings.push("未能匹配经营主体，请人工选择");

  // Supplier matching (only when expense)
  let supplier: any = null;
  if (direction === "expense" && counterpartyName) {
    let best: any = null, bestS = 0;
    for (const s of ctx.suppliers) {
      const sim = similarity(s.name, counterpartyName);
      if (sim > bestS) { bestS = sim; best = s; }
    }
    if (best && bestS >= 0.85) {
      supplier = best;
      confidence.supplier = bestS;
    } else if (best && bestS >= 0.65) {
      confidence.supplier = bestS;
      warnings.push(`疑似供应商「${best.name}」，置信度较低，请人工确认`);
    } else {
      confidence.supplier = 0;
    }
  }

  // Category matching
  let category: any = null;
  const dirMap: Record<string, "in" | "out" | "transfer"> = {
    expense: "out", income: "in", internal_transfer: "transfer",
  };
  const dbDir = dirMap[direction];
  if (dbDir && dbDir !== "transfer") {
    const memoText = `${parsed.memo ?? ""} ${counterpartyName ?? ""}`;
    if (supplier) {
      category = ctx.categories.find((c) => c.direction === "out" && /供应商|采购|货款/.test(c.name)) || null;
      if (category) confidence.category = 0.9;
    }
    if (!category) {
      const keywords: Array<[RegExp, string]> = [
        [/工资|薪资|薪酬/, "工资"],
        [/快递|物流|运费/, "快递"],
        [/广告|投流|推广/, "投流"],
        [/房租|租金/, "房租"],
        [/水电|电费|水费/, "水电"],
        [/办公/, "办公"],
        [/仓库|仓储/, "仓库"],
      ];
      for (const [re, key] of keywords) {
        if (re.test(memoText)) {
          category = ctx.categories.find((c) => c.direction === dbDir && c.name.includes(key));
          if (category) { confidence.category = 0.8; break; }
        }
      }
    }
    if (!category) confidence.category = 0;
  }

  // Amount / date confidence
  confidence.amount = parsed.amount != null ? 0.98 : 0;
  confidence.occurred_date = parsed.occurred_date ? 0.95 : 0;

  if (!parsed.amount) warnings.push("未识别到金额，请手动填写");
  if (!parsed.occurred_date) warnings.push("未识别到日期，请手动填写");

  return {
    direction,
    counterpartyName,
    counterpartyAccount,
    matched: {
      business_entity_id: entity?.id ?? null,
      bank_account_id: bankAcct?.id ?? null,
      supplier_id: supplier?.id ?? null,
      category_id: category?.id ?? null,
    },
    confidence,
    warnings,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabaseAuth.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Role gate: only admin/finance
    const { data: canWrite } = await admin.rpc("can_write_finance", { _uid: userId });
    if (!canWrite) {
      return new Response(JSON.stringify({ error: "Forbidden: requires admin/finance role" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const imageDataUrl: string | undefined = body.image_data_url;
    if (!imageDataUrl || !imageDataUrl.startsWith("data:")) {
      return new Response(JSON.stringify({ error: "缺少 image_data_url (data URL)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PDF rejection (model only handles images)
    if (imageDataUrl.startsWith("data:application/pdf")) {
      return new Response(JSON.stringify({
        success: false,
        error: "暂不支持 PDF 自动识别，请截图为图片后再上传",
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load master data
    const [entities, banks, suppliers, categories] = await Promise.all([
      admin.from("business_entities").select("id,name,entity_type").is("deleted_at", null),
      admin.from("bank_accounts").select("id,entity_id,account_name,bank_name,account_no_masked,normalized_account_no").is("deleted_at", null),
      admin.from("ops_suppliers").select("id,name").eq("status", "active"),
      admin.from("cash_tx_categories").select("id,name,direction").is("deleted_at", null),
    ]);

    const parsed = await callLovableAI(imageDataUrl);

    const ctx: MatchContext = {
      entities: entities.data ?? [],
      banks: banks.data ?? [],
      suppliers: suppliers.data ?? [],
      categories: categories.data ?? [],
    };

    const match = matchAll(parsed, ctx);

    // Duplicate check
    let duplicates: any[] = [];
    if (parsed.transaction_serial_no) {
      const { data } = await admin
        .from("cash_transactions")
        .select("id,tx_no,occurred_at,amount,summary,counterparty,transaction_serial_no")
        .eq("transaction_serial_no", parsed.transaction_serial_no)
        .is("deleted_at", null)
        .limit(5);
      duplicates = data ?? [];
    } else if (parsed.amount && parsed.occurred_date && match.matched.bank_account_id) {
      const day = parsed.occurred_date;
      const from = new Date(day + "T00:00:00").toISOString();
      const to = new Date(day + "T23:59:59").toISOString();
      const { data } = await admin
        .from("cash_transactions")
        .select("id,tx_no,occurred_at,amount,summary,counterparty")
        .eq("amount", parsed.amount)
        .eq("bank_account_id", match.matched.bank_account_id)
        .gte("occurred_at", from)
        .lte("occurred_at", to)
        .is("deleted_at", null)
        .limit(5);
      duplicates = data ?? [];
    }

    return new Response(JSON.stringify({
      success: true,
      data: {
        transaction_direction: match.direction,
        occurred_date: parsed.occurred_date,
        amount: parsed.amount,
        payer_name: parsed.payer_name,
        payer_account: parsed.payer_account,
        payer_bank: parsed.payer_bank,
        payee_name: parsed.payee_name,
        payee_account: parsed.payee_account,
        payee_bank: parsed.payee_bank,
        counterparty_name: match.counterpartyName,
        counterparty_account: match.counterpartyAccount,
        counterparty_bank: parsed.transaction_direction === "expense"
          ? parsed.payee_bank
          : parsed.payer_bank,
        transaction_serial_no: parsed.transaction_serial_no,
        bank_transaction_time: parsed.bank_transaction_time,
        memo: parsed.memo,
        raw_text: parsed.raw_text,
      },
      match_result: match.matched,
      confidence: match.confidence,
      warnings: match.warnings,
      duplicates,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("parse-bank-receipt error:", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
