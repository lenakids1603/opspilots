import { PageHeader } from "@/components/ops/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus, Upload, Scale, BookOpenCheck, Download, Wallet, TrendingUp, CreditCard,
  ChevronRight, AlertTriangle, FileText, Clock,
  ShieldAlert, Bell, AlarmClock,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

/* ---------- helpers ---------- */
const fmtCNY = (n: number | null | undefined) => {
  const v = Number(n ?? 0);
  const sign = v < 0 ? "-" : "";
  return `${sign}¥${Math.abs(v).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
};
const pct1 = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;

function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <Card className={`p-5 border border-border bg-white rounded-xl shadow-sm ${className}`}>{children}</Card>;
}

function StatRow({ items }: { items: { color: string; label: string; amount: number }[] }) {
  const total = items.reduce((s, i) => s + i.amount, 0);
  if (total <= 0) return <div className="text-[11px] text-muted-foreground">暂无分类数据</div>;
  return (
    <>
      <div className="flex h-2 rounded-full overflow-hidden bg-muted">
        {items.map((it, i) => (
          <div key={i} style={{ width: `${(it.amount / total) * 100}%`, backgroundColor: it.color }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-[11px] text-muted-foreground">
        {items.map((it, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: it.color }} />
            {it.label} <span className="text-foreground/70">({pct1((it.amount / total) * 100)})</span>
          </span>
        ))}
      </div>
    </>
  );
}

const PALETTE = ["#10b981", "#06b6d4", "#0ea5e9", "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#ef4444"];

/* ---------- range helpers ---------- */
type RangeKey = "today" | "yesterday" | "this_month" | "last_month" | "custom";
function getRange(key: RangeKey, customStart?: string, customEnd?: string): { start: Date; end: Date } {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  switch (key) {
    case "today": return { start: startOfDay(now), end: endOfDay(now) };
    case "yesterday": {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      return { start: startOfDay(y), end: endOfDay(y) };
    }
    case "last_month": {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { start: s, end: e };
    }
    case "custom":
      if (customStart && customEnd) return { start: new Date(customStart), end: endOfDay(new Date(customEnd)) };
      // fall-through
    case "this_month":
    default: {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: s, end: endOfDay(now) };
    }
  }
}

const RANGE_TABS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "今日" },
  { key: "yesterday", label: "昨日" },
  { key: "this_month", label: "本月" },
  { key: "last_month", label: "上月" },
  { key: "custom", label: "自定义" },
];

/* ---------- types ---------- */
type Tx = {
  id: string;
  amount: number;
  direction: "income" | "expense";
  occurred_at: string;
  category_id: string | null;
  entity_id: string;
  bank_account_id: string;
  shop_id: string | null;
  supplier_id: string | null;
  attachment_path: string | null;
  summary: string | null;
  counterparty: string | null;
};

/* ---------- page ---------- */
export default function FinanceOverviewPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>("this_month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [platformId, setPlatformId] = useState<string>("all");
  const [shopId, setShopId] = useState<string>("all");
  const [entityId, setEntityId] = useState<string>("all");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [platforms, setPlatforms] = useState<{ id: string; name: string }[]>([]);
  const [shops, setShops] = useState<{ id: string; name: string; platform_id: string | null }[]>([]);
  const [entities, setEntities] = useState<{ id: string; name: string; annual_flow_limit: number; status: string }[]>([]);
  const [bankAccounts, setBankAccounts] = useState<{ id: string; entity_id: string; current_balance: number; status: string }[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string; direction: "income" | "expense" }[]>([]);

  const [txInPeriod, setTxInPeriod] = useState<Tx[]>([]);
  const [incomeBeforePeriod, setIncomeBeforePeriod] = useState(0);
  const [expenseBeforePeriod, setExpenseBeforePeriod] = useState(0);
  const [yearEntityInflow, setYearEntityInflow] = useState<Record<string, number>>({});
  const [supplierBillsCount, setSupplierBillsCount] = useState(0);

  // Load static dimensions once
  useEffect(() => {
    (async () => {
      const [p, s, e, b, c, bills] = await Promise.all([
        supabase.from("platforms").select("id,name").is("deleted_at", null).eq("status", "active"),
        supabase.from("shops").select("id,name,platform_id").is("deleted_at", null),
        supabase.from("business_entities").select("id,name,annual_flow_limit,status").is("deleted_at", null),
        supabase.from("bank_accounts").select("id,entity_id,current_balance,status").is("deleted_at", null),
        supabase.from("cash_tx_categories").select("id,name,direction").is("deleted_at", null),
        supabase.from("ops_supplier_bills").select("id", { count: "exact", head: true }),
      ]);
      if (p.data) setPlatforms(p.data as any);
      if (s.data) setShops(s.data as any);
      if (e.data) setEntities(e.data as any);
      if (b.data) setBankAccounts(b.data as any);
      if (c.data) setCategories(c.data as any);
      setSupplierBillsCount(bills.count ?? 0);
    })();
  }, []);

  const filteredShops = useMemo(
    () => platformId === "all" ? shops : shops.filter(s => s.platform_id === platformId),
    [shops, platformId]
  );

  // Load period-dependent data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { start, end } = getRange(rangeKey, customStart, customEnd);
        const yearStart = new Date(new Date().getFullYear(), 0, 1);

        // Resolve shop filter (platform implies shops)
        let shopIdFilter: string[] | null = null;
        if (shopId !== "all") shopIdFilter = [shopId];
        else if (platformId !== "all") {
          shopIdFilter = shops.filter(s => s.platform_id === platformId).map(s => s.id);
          if (shopIdFilter.length === 0) shopIdFilter = ["__none__"];
        }

        const applyFilters = (q: any) => {
          if (entityId !== "all") q = q.eq("entity_id", entityId);
          if (shopIdFilter) q = q.in("shop_id", shopIdFilter);
          return q;
        };

        // Period transactions
        let q1: any = supabase.from("cash_transactions")
          .select("id,amount,direction,occurred_at,category_id,entity_id,bank_account_id,shop_id,supplier_id,attachment_path,summary,counterparty")
          .is("deleted_at", null)
          .neq("status", "cancelled")
          .gte("occurred_at", start.toISOString())
          .lte("occurred_at", end.toISOString());
        q1 = applyFilters(q1).order("occurred_at", { ascending: false }).limit(1000);

        // Pre-period aggregates (for opening balance)
        let q2In: any = supabase.from("cash_transactions").select("amount.sum()")
          .is("deleted_at", null).neq("status", "cancelled")
          .lt("occurred_at", start.toISOString()).eq("direction", "income");
        let q2Out: any = supabase.from("cash_transactions").select("amount.sum()")
          .is("deleted_at", null).neq("status", "cancelled")
          .lt("occurred_at", start.toISOString()).eq("direction", "expense");
        q2In = applyFilters(q2In);
        q2Out = applyFilters(q2Out);

        // YTD income per entity (for quota monitor — always all entities, not filtered)
        const qYear = supabase.from("cash_transactions")
          .select("entity_id,amount")
          .is("deleted_at", null).neq("status", "cancelled")
          .eq("direction", "income")
          .gte("occurred_at", yearStart.toISOString())
          .limit(10000);

        const [r1, r2In, r2Out, rYear] = await Promise.all([q1, q2In, q2Out, qYear]);
        if (cancelled) return;
        if (r1.error) throw r1.error;
        if (rYear.error) throw rYear.error;

        setTxInPeriod((r1.data as Tx[]) || []);
        setIncomeBeforePeriod(Number((r2In.data as any)?.[0]?.sum) || 0);
        setExpenseBeforePeriod(Number((r2Out.data as any)?.[0]?.sum) || 0);

        const yMap: Record<string, number> = {};
        for (const row of (rYear.data as { entity_id: string; amount: number }[]) || []) {
          yMap[row.entity_id] = (yMap[row.entity_id] || 0) + Number(row.amount || 0);
        }
        setYearEntityInflow(yMap);
      } catch (err: any) {
        setError(err?.message || "加载失败");
        toast({ title: "财务总览加载失败", description: err?.message, variant: "destructive" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rangeKey, customStart, customEnd, platformId, shopId, entityId, shops]);

  /* ---------- derived ---------- */
  const periodIncome = useMemo(() => txInPeriod.filter(t => t.direction === "income").reduce((s, t) => s + Number(t.amount), 0), [txInPeriod]);
  const periodExpense = useMemo(() => txInPeriod.filter(t => t.direction === "expense").reduce((s, t) => s + Number(t.amount), 0), [txInPeriod]);
  const periodNet = periodIncome - periodExpense;

  // Current balance: aggregate from bank_accounts.current_balance (filtered by entity if selected)
  // Note: opening balance = current_balance - (incomeBeforePeriod + periodIncome) + (expenseBeforePeriod + periodExpense) is an alt;
  // We use the simpler model: 期初 = sum(current_balance) - 期间净变动 (assumes current_balance is up-to-date)
  const currentBalance = useMemo(() => {
    const accs = entityId === "all" ? bankAccounts : bankAccounts.filter(b => b.entity_id === entityId);
    return accs.filter(a => a.status === "active").reduce((s, a) => s + Number(a.current_balance || 0), 0);
  }, [bankAccounts, entityId]);
  // Opening = current balance - net change during period
  const openingBalance = currentBalance - periodNet;

  const inflowByCategory = useMemo(() => {
    const map = new Map<string, number>();
    txInPeriod.filter(t => t.direction === "income").forEach(t => {
      const k = t.category_id || "__uncat__";
      map.set(k, (map.get(k) || 0) + Number(t.amount));
    });
    return Array.from(map.entries()).map(([id, amount], i) => ({
      color: PALETTE[i % PALETTE.length],
      label: id === "__uncat__" ? "未分类" : (categories.find(c => c.id === id)?.name || "未分类"),
      amount,
    })).sort((a, b) => b.amount - a.amount).slice(0, 6);
  }, [txInPeriod, categories]);

  const outflowByCategory = useMemo(() => {
    const map = new Map<string, number>();
    txInPeriod.filter(t => t.direction === "expense").forEach(t => {
      const k = t.category_id || "__uncat__";
      map.set(k, (map.get(k) || 0) + Number(t.amount));
    });
    return Array.from(map.entries()).map(([id, amount], i) => ({
      color: ["#ef4444", "#f59e0b", "#8b5cf6", "#ec4899", "#6366f1", "#06b6d4"][i % 6],
      label: id === "__uncat__" ? "未分类" : (categories.find(c => c.id === id)?.name || "未分类"),
      amount,
    })).sort((a, b) => b.amount - a.amount).slice(0, 6);
  }, [txInPeriod, categories]);

  // Entity quota rows (always show all entities, not affected by entity filter)
  const entityRows = useMemo(() => {
    return entities.map(e => {
      const inflow = yearEntityInflow[e.id] || 0;
      const limit = Number(e.annual_flow_limit || 5000000);
      const usage = limit > 0 ? (inflow / limit) * 100 : 0;
      let status = "正常", statusClass = "bg-emerald-100 text-emerald-700";
      if (usage >= 100) { status = "已超额"; statusClass = "bg-rose-100 text-rose-700"; }
      else if (usage >= 95) { status = "高风险"; statusClass = "bg-rose-100 text-rose-700"; }
      else if (usage >= 80) { status = "预警"; statusClass = "bg-amber-100 text-amber-700"; }
      return { id: e.id, name: e.name, inflow, limit, usage, status, statusClass };
    }).sort((a, b) => b.usage - a.usage);
  }, [entities, yearEntityInflow]);

  const quotaStats = useMemo(() => {
    let normal = 0, warn = 0, high = 0;
    entityRows.forEach(r => {
      if (r.usage >= 95) high++;
      else if (r.usage >= 80) warn++;
      else normal++;
    });
    return { total: entityRows.length, normal, warn, high };
  }, [entityRows]);

  // Alerts: derived from real data
  const alerts = useMemo(() => {
    type Alert = { tag: string; tagClass: string; icon: any; iconClass: string; title: string; desc: string; amount: string; time: string };
    const out: Alert[] = [];
    // 1) Entities near quota
    entityRows.filter(r => r.usage >= 80).slice(0, 3).forEach(r => {
      const high = r.usage >= 95;
      out.push({
        tag: high ? "高风险" : "预警",
        tagClass: high ? "bg-rose-50 text-rose-700 border-rose-200" : "bg-amber-50 text-amber-700 border-amber-200",
        icon: ShieldAlert, iconClass: high ? "text-rose-500" : "text-amber-500",
        title: `额度告警：${r.name} 年度流入已达 ${pct1(r.usage)}`,
        desc: `年度限额 ${fmtCNY(r.limit)}，请评估是否暂停收款。`,
        amount: fmtCNY(r.inflow), time: "实时",
      });
    });
    // 2) Large tx without attachment (>= 50000)
    txInPeriod.filter(t => Number(t.amount) >= 50000 && !t.attachment_path).slice(0, 3).forEach(t => {
      out.push({
        tag: "中", tagClass: "bg-amber-50 text-amber-700 border-amber-200",
        icon: FileText, iconClass: "text-amber-500",
        title: `大额流水缺少凭证：${t.summary || t.counterparty || "未命名"}`,
        desc: "金额 ≥ ¥50,000 但未上传银行回单/凭证，请尽快补全。",
        amount: fmtCNY(t.amount), time: new Date(t.occurred_at).toLocaleDateString("zh-CN"),
      });
    });
    // 3) Tx missing category
    txInPeriod.filter(t => !t.category_id).slice(0, 2).forEach(t => {
      out.push({
        tag: "低", tagClass: "bg-sky-50 text-sky-700 border-sky-200",
        icon: Bell, iconClass: "text-sky-500",
        title: `流水缺少分类：${t.summary || t.counterparty || "未命名"}`,
        desc: "请在资金流水页面补充收支分类，便于报表统计。",
        amount: fmtCNY(t.amount), time: new Date(t.occurred_at).toLocaleDateString("zh-CN"),
      });
    });
    // 4) Suspected duplicates: same day + same amount + same bank_account + same direction
    const dupMap = new Map<string, Tx[]>();
    txInPeriod.forEach(t => {
      const k = `${t.occurred_at.slice(0,10)}|${t.bank_account_id}|${t.amount}|${t.direction}`;
      const arr = dupMap.get(k) || []; arr.push(t); dupMap.set(k, arr);
    });
    Array.from(dupMap.values()).filter(arr => arr.length >= 2).slice(0, 2).forEach(arr => {
      out.push({
        tag: "中", tagClass: "bg-amber-50 text-amber-700 border-amber-200",
        icon: AlarmClock, iconClass: "text-amber-500",
        title: `疑似重复流水 ×${arr.length}：${arr[0].summary || arr[0].counterparty || "未命名"}`,
        desc: "同日、同账户、同金额、同方向，请人工复核。",
        amount: fmtCNY(arr[0].amount), time: new Date(arr[0].occurred_at).toLocaleDateString("zh-CN"),
      });
    });
    // 5) Supplier payment without supplier_id
    txInPeriod.filter(t => t.direction === "expense" && !t.supplier_id && /供应商|货款|采购/.test(t.summary || "")).slice(0, 2).forEach(t => {
      out.push({
        tag: "低", tagClass: "bg-sky-50 text-sky-700 border-sky-200",
        icon: Bell, iconClass: "text-sky-500",
        title: `供应商付款未关联供应商：${t.summary}`,
        desc: "建议在流水详情中绑定具体供应商，便于核销与对账。",
        amount: fmtCNY(t.amount), time: new Date(t.occurred_at).toLocaleDateString("zh-CN"),
      });
    });
    return out;
  }, [entityRows, txInPeriod]);

  /* ---------- render ---------- */
  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={["财税系统", "财务总览"]}
        title="财务总览"
        description="实时查看公司现金流、供应商应付、个体户额度与财务异常"
        actions={
          <>
            <Button size="sm" className="gap-1.5" asChild><Link to="/finance/cashflow"><Plus className="w-4 h-4" />新增流水</Link></Button>
            <Button size="sm" variant="outline" className="gap-1.5" asChild><Link to="/finance/cashflow"><Upload className="w-4 h-4" />导入流水</Link></Button>
            <Button size="sm" variant="outline" className="gap-1.5" asChild><Link to="/finance/master-data"><BookOpenCheck className="w-4 h-4" />基础资料</Link></Button>
            <Button size="sm" variant="outline" className="gap-1.5" disabled><Scale className="w-4 h-4" />资金对账</Button>
            <Button size="sm" variant="outline" className="gap-1.5" disabled><Download className="w-4 h-4" />导出简报</Button>
          </>
        }
      />

      {/* Range + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-white p-1">
          {RANGE_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setRangeKey(t.key)}
              className={`px-3.5 py-1.5 text-[12.5px] rounded-md transition ${
                rangeKey === t.key ? "bg-foreground text-background font-medium" : "text-muted-foreground hover:text-foreground"
              }`}
            >{t.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
          {rangeKey === "custom" && (
            <>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                className="h-8 rounded-md border border-border bg-white px-2 text-foreground" />
              <span>至</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                className="h-8 rounded-md border border-border bg-white px-2 text-foreground" />
            </>
          )}
          <label className="flex items-center gap-2">平台
            <select value={platformId} onChange={e => { setPlatformId(e.target.value); setShopId("all"); }}
              className="h-8 rounded-md border border-border bg-white px-2 text-foreground">
              <option value="all">全部平台</option>
              {platforms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">店铺
            <select value={shopId} onChange={e => setShopId(e.target.value)}
              className="h-8 rounded-md border border-border bg-white px-2 text-foreground">
              <option value="all">全部店铺</option>
              {filteredShops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">主体
            <select value={entityId} onChange={e => setEntityId(e.target.value)}
              className="h-8 rounded-md border border-border bg-white px-2 text-foreground">
              <option value="all">全部主体</option>
              {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      {error && (
        <Card className="p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm">加载失败：{error}</Card>
      )}

      {/* Row 1: 3 balance cards
          口径说明：
          - 当前公司账面资金 = sum(bank_accounts.current_balance) 在主体筛选下的子集
          - 期间总净变动 = 期间收入 - 期间支出
          - 初始财务资金 = 当前账面 - 期间净变动 (因 bank_accounts 当前无 opening_balance 字段) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Section>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center"><Clock className="w-5 h-5" /></div>
            <div className="flex-1">
              <div className="text-xs text-muted-foreground">初始财务资金</div>
              <div className="text-2xl font-bold mt-1 font-mono">{loading ? <Skeleton className="h-7 w-40" /> : fmtCNY(openingBalance)}</div>
              <div className="text-[11px] text-muted-foreground mt-1">期初 = 当前账面 - 期间净变动</div>
            </div>
          </div>
        </Section>
        <Section>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><TrendingUp className="w-5 h-5" /></div>
            <div className="flex-1">
              <div className="text-xs text-muted-foreground">期间总净变动</div>
              <div className={`text-2xl font-bold mt-1 font-mono flex items-center gap-2 ${periodNet >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {loading ? <Skeleton className="h-7 w-40" /> : `${periodNet >= 0 ? "+" : ""}${fmtCNY(periodNet)}`}
                {!loading && (
                  <Badge variant="outline" className={`text-[10px] ${periodNet >= 0 ? "border-emerald-200 text-emerald-700 bg-emerald-50" : "border-rose-200 text-rose-700 bg-rose-50"}`}>
                    {periodNet >= 0 ? "顺差" : "逆差"}
                  </Badge>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">期间流入 {fmtCNY(periodIncome)} | 流出 {fmtCNY(periodExpense)}</div>
            </div>
          </div>
        </Section>
        <Section>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center"><Wallet className="w-5 h-5" /></div>
            <div className="flex-1">
              <div className="text-xs text-muted-foreground">当前公司账面资金</div>
              <div className="text-2xl font-bold mt-1 font-mono">{loading ? <Skeleton className="h-7 w-40" /> : fmtCNY(currentBalance)}</div>
              <div className="text-[11px] text-muted-foreground mt-1">来自银行账户 current_balance 合计</div>
            </div>
          </div>
        </Section>
      </div>

      {/* Row 2: inflow / outflow */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section>
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-medium flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />期间累计收入</div>
            <Badge variant="outline" className="bg-emerald-50 border-emerald-200 text-emerald-700 text-[11px]">来自 cash_transactions</Badge>
          </div>
          <div className="text-[11px] text-muted-foreground mt-3">核算总金额 (人民币)</div>
          <div className="flex items-end gap-3 mt-1">
            <div className="text-3xl font-bold font-mono text-emerald-600">{loading ? <Skeleton className="h-9 w-48" /> : fmtCNY(periodIncome)}</div>
            <Link to="/finance/cashflow?direction=income" className="text-[12px] text-emerald-700 hover:underline pb-1.5 flex items-center gap-0.5">
              进入流水簿 <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-[11px] text-muted-foreground mb-1.5">
              <span>收入分类结构</span>
              <span>{inflowByCategory.length} 个分类</span>
            </div>
            {loading ? <Skeleton className="h-6 w-full" /> : <StatRow items={inflowByCategory} />}
          </div>
        </Section>
        <Section>
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-medium flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-rose-500" />期间累计支出</div>
            <Badge variant="outline" className="bg-amber-50 border-amber-200 text-amber-700 text-[11px]">来自 cash_transactions</Badge>
          </div>
          <div className="text-[11px] text-muted-foreground mt-3">核算总金额 (人民币)</div>
          <div className="flex items-end gap-3 mt-1">
            <div className="text-3xl font-bold font-mono text-rose-600">{loading ? <Skeleton className="h-9 w-48" /> : fmtCNY(periodExpense)}</div>
            <Link to="/finance/cashflow?direction=expense" className="text-[12px] text-rose-700 hover:underline pb-1.5 flex items-center gap-0.5">
              进入流水簿 <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-[11px] text-muted-foreground mb-1.5">
              <span>支出分类结构</span>
              <span className="text-foreground/70">净变动: <span className="font-mono">{periodNet >= 0 ? "+" : ""}{fmtCNY(periodNet)}</span></span>
            </div>
            {loading ? <Skeleton className="h-6 w-full" /> : <StatRow items={outflowByCategory} />}
          </div>
        </Section>
      </div>

      {/* Row 3: invoice / payment status — 待接入 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Section>
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="flex items-center gap-2 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-sky-500" />可开票金额</span>
            <FileText className="w-4 h-4 text-muted-foreground/60" />
          </div>
          <div className="text-[11px] text-muted-foreground mt-2">待开票总额</div>
          <div className="text-2xl font-bold font-mono mt-1 text-muted-foreground">待接入</div>
          <div className="flex items-center justify-between text-[11px] mt-3">
            <span className="text-muted-foreground">需接入开票/票务登记表</span>
          </div>
        </Section>
        <Section>
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="flex items-center gap-2 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />已开票金额</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-2">开票审核已通过</div>
          <div className="text-2xl font-bold font-mono mt-1 text-muted-foreground">待接入</div>
          <div className="flex items-center justify-between text-[11px] mt-3">
            <span className="text-muted-foreground">需接入 invoices 表</span>
          </div>
        </Section>
        <Section>
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="flex items-center gap-2 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />供应商已付款</span>
            <CreditCard className="w-4 h-4 text-muted-foreground/60" />
          </div>
          <div className="text-[11px] text-muted-foreground mt-2">期间 direction=expense 且 supplier_id 不为空</div>
          <div className="text-2xl font-bold font-mono mt-1">{loading ? <Skeleton className="h-7 w-36" /> : fmtCNY(txInPeriod.filter(t => t.direction === "expense" && t.supplier_id).reduce((s, t) => s + Number(t.amount), 0))}</div>
          <div className="flex items-center justify-between text-[11px] mt-3">
            <Link to="/finance/cashflow?direction=expense" className="text-sky-700 hover:underline">查看已打款明细 →</Link>
          </div>
        </Section>
      </div>

      {/* Row 4: alerts */}
      <Section className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <AlertTriangle className="w-4 h-4 text-amber-500" /> 财务异常预警
          </div>
          <span className="text-[11px] text-muted-foreground">{alerts.length} 条未决预警</span>
        </div>
        {loading ? (
          <div className="p-5"><Skeleton className="h-20 w-full" /></div>
        ) : alerts.length === 0 ? (
          <div className="p-8 text-center text-[12.5px] text-muted-foreground">当前周期暂无预警</div>
        ) : (
          <ul className="divide-y divide-border">
            {alerts.map((a, i) => {
              const Icon = a.icon;
              return (
                <li key={i} className="px-5 py-3.5 flex items-center gap-4 hover:bg-muted/30 transition">
                  <div className="w-20 flex justify-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] border ${a.tagClass}`}>
                      <Icon className={`w-3 h-3 ${a.iconClass}`} />{a.tag}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-foreground truncate">{a.title}</div>
                    <div className="text-[11.5px] text-muted-foreground mt-0.5 truncate">{a.desc}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[13px] font-mono font-semibold">{a.amount}</div>
                    <div className="text-[10.5px] text-muted-foreground mt-0.5 flex items-center justify-end gap-1"><Clock className="w-3 h-3" />{a.time}</div>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0" asChild><Link to="/finance/cashflow">查看</Link></Button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Row 5: two tables */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Section className="p-0">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div>
              <div className="text-[13px] font-medium">个体户年度额度监控</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">监控经营主体 500 万年度流水使用情况（按自然年）</div>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <Badge variant="outline" className="bg-slate-50">{quotaStats.total} 总主体</Badge>
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">{quotaStats.normal} 正常</Badge>
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">{quotaStats.warn} 预警</Badge>
              <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">{quotaStats.high} 高风险</Badge>
            </div>
          </div>
          {loading ? (
            <div className="p-5"><Skeleton className="h-32 w-full" /></div>
          ) : entityRows.length === 0 ? (
            <div className="p-8 text-center text-[12.5px] text-muted-foreground">暂无经营主体数据</div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left font-normal px-5 py-2">主体名称</th>
                  <th className="text-right font-normal px-3 py-2">年度累计流入</th>
                  <th className="text-left font-normal px-3 py-2 w-44">额度进度</th>
                  <th className="text-right font-normal px-5 py-2">状态</th>
                </tr>
              </thead>
              <tbody>
                {entityRows.slice(0, 10).map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-5 py-2.5">{r.name}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{fmtCNY(r.inflow)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full ${r.usage >= 95 ? "bg-rose-500" : r.usage >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(r.usage, 100)}%` }} />
                        </div>
                        <span className="text-[11px] font-mono w-12 text-right">{pct1(r.usage)}</span>
                      </div>
                    </td>
                    <td className="px-5 py-2.5 text-right"><span className={`px-2 py-0.5 rounded text-[11px] ${r.statusClass}`}>{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section className="p-0">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div>
              <div className="text-[13px] font-medium">供应商账款与核销</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">应付 = 已确认到货金额 - 已付款金额（待接入正式结算表）</div>
            </div>
          </div>
          <div className="p-8 text-center text-[12.5px] text-muted-foreground">
            {supplierBillsCount === 0
              ? "待接入：尚无供应商结算账单（ops_supplier_bills 为空）"
              : `已检测到 ${supplierBillsCount} 条结算记录，明细看板待接入`}
            <div className="mt-2 text-[11px]">应付金额计算需结合采购单、入库与付款流水，建议后续补建结算视图</div>
          </div>
        </Section>
      </div>
    </div>
  );
}
