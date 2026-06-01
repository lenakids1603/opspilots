import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Pencil, Trash2, Paperclip, TrendingUp, TrendingDown, Wallet, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { CashflowDrawer } from "@/components/ops/CashflowDrawers";
import {
  CashTransaction, BusinessEntity, BankAccount, CashTxCategory, Shop,
  CashDirection, DIRECTION_LABEL, DIRECTION_COLOR, fmtMoney,
} from "@/lib/finance";

type SupplierLite = { id: string; name: string };

export default function CashflowPage() {
  const [rows, setRows] = useState<CashTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  const [entities, setEntities] = useState<BusinessEntity[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [categories, setCategories] = useState<CashTxCategory[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([]);

  // Filters
  const [keyword, setKeyword] = useState("");
  const [fEntity, setFEntity] = useState("");
  const [fBank, setFBank] = useState("");
  const [fDir, setFDir] = useState<"" | CashDirection>("");
  const [fCategory, setFCategory] = useState("");
  const [fSupplier, setFSupplier] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<CashTransaction | null>(null);

  const loadMasterData = useCallback(async () => {
    const [e, a, c, s, sup] = await Promise.all([
      supabase.from("business_entities").select("*").is("deleted_at", null).order("name"),
      supabase.from("bank_accounts").select("*").is("deleted_at", null).order("account_name"),
      supabase.from("cash_tx_categories").select("*").is("deleted_at", null).order("sort_order"),
      supabase.from("shops").select("*").is("deleted_at", null).order("name"),
      supabase.from("ops_suppliers").select("id,name").order("name"),
    ]);
    if (e.data) setEntities(e.data as any);
    if (a.data) setAccounts(a.data as any);
    if (c.data) setCategories(c.data as any);
    if (s.data) setShops(s.data as any);
    if (sup.data) setSuppliers(sup.data as any);
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("cash_transactions").select("*").is("deleted_at", null)
      .order("occurred_at", { ascending: false }).limit(500);
    if (fEntity) q = q.eq("entity_id", fEntity);
    if (fBank) q = q.eq("bank_account_id", fBank);
    if (fDir) q = q.eq("direction", fDir);
    if (fCategory) q = q.eq("category_id", fCategory);
    if (fSupplier) q = q.eq("supplier_id", fSupplier);
    if (fFrom) q = q.gte("occurred_at", new Date(fFrom).toISOString());
    if (fTo) q = q.lte("occurred_at", new Date(fTo + "T23:59:59").toISOString());
    const { data, error } = await q;
    setLoading(false);
    if (error) { toast({ title: "查询失败", description: error.message, variant: "destructive" }); return; }
    let list = (data ?? []) as CashTransaction[];
    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      list = list.filter(r =>
        (r.summary ?? "").toLowerCase().includes(kw)
        || (r.counterparty ?? "").toLowerCase().includes(kw)
        || (r.remark ?? "").toLowerCase().includes(kw),
      );
    }
    setRows(list);
  }, [fEntity, fBank, fDir, fCategory, fSupplier, fFrom, fTo, keyword]);

  useEffect(() => { loadMasterData(); }, [loadMasterData]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const accountMap = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
  const entityMap = useMemo(() => new Map(entities.map(e => [e.id, e])), [entities]);
  const catMap = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);
  const supMap = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers]);

  const totalIn = rows.filter(r => r.direction === "in").reduce((a, b) => a + Number(b.amount), 0);
  const totalOut = rows.filter(r => r.direction === "out").reduce((a, b) => a + Number(b.amount), 0);
  const net = totalIn - totalOut;

  const handleDelete = async (r: CashTransaction) => {
    if (!confirm(`确认删除流水「${r.summary ?? r.id}」？`)) return;
    const { error } = await supabase.from("cash_transactions")
      .update({ deleted_at: new Date().toISOString() }).eq("id", r.id);
    if (error) { toast({ title: "删除失败", description: error.message, variant: "destructive" }); return; }
    toast({ title: "已删除" });
    loadRows();
  };

  const openAttachment = async (path: string) => {
    const { data, error } = await supabase.storage.from("cash-tx-attachments").createSignedUrl(path, 300);
    if (error) { toast({ title: "无法打开附件", description: error.message, variant: "destructive" }); return; }
    window.open(data.signedUrl, "_blank");
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">公司资金流水</h1>
          <p className="text-[12px] text-muted-foreground mt-1">登记收入、支出、内部转账，关联店铺与供应商</p>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setDrawerOpen(true); }}>
          <Plus className="w-4 h-4 mr-1" /> 新增流水
        </Button>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Input placeholder="搜索摘要 / 对方 / 备注" value={keyword} onChange={e => setKeyword(e.target.value)} className="h-9" />
          <FilterSelect value={fEntity} onChange={setFEntity} placeholder="全部主体"
            options={entities.map(e => ({ value: e.id, label: e.name }))} />
          <FilterSelect value={fBank} onChange={setFBank} placeholder="全部账户"
            options={accounts.map(a => ({ value: a.id, label: a.account_name }))} />
          <FilterSelect value={fDir} onChange={v => setFDir(v as any)} placeholder="全部方向"
            options={[{ value: "in", label: "收入" }, { value: "out", label: "支出" }, { value: "transfer", label: "内部转账" }]} />
          <FilterSelect value={fCategory} onChange={setFCategory} placeholder="全部分类"
            options={categories.map(c => ({ value: c.id, label: c.name }))} />
          <FilterSelect value={fSupplier} onChange={setFSupplier} placeholder="全部供应商"
            options={suppliers.map(s => ({ value: s.id, label: s.name }))} />
          <Input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} className="h-9" />
          <Input type="date" value={fTo} onChange={e => setFTo(e.target.value)} className="h-9" />
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="outline" size="sm" onClick={() => {
            setKeyword(""); setFEntity(""); setFBank(""); setFDir(""); setFCategory(""); setFSupplier(""); setFFrom(""); setFTo("");
          }}>清空</Button>
          <Button size="sm" onClick={loadRows}><Search className="w-3.5 h-3.5 mr-1" /> 查询</Button>
        </div>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SummaryTile label="收入合计" value={fmtMoney(totalIn)} icon={<TrendingUp className="w-4 h-4" />} tone="emerald" />
        <SummaryTile label="支出合计" value={fmtMoney(totalOut)} icon={<TrendingDown className="w-4 h-4" />} tone="rose" />
        <SummaryTile label="净现金流" value={(net >= 0 ? "+" : "") + fmtMoney(net)} icon={<Wallet className="w-4 h-4" />} tone="sky" />
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr className="text-left">
                <Th>日期</Th><Th>主体</Th><Th>账户</Th><Th>方向</Th>
                <Th className="text-right">金额</Th><Th>分类</Th><Th>对方</Th>
                <Th>摘要</Th><Th>凭证</Th><Th className="text-right">操作</Th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10} className="text-center py-8 text-muted-foreground">加载中...</td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={10} className="text-center py-12 text-muted-foreground">
                  暂无数据。点击右上角"新增流水"开始登记。
                </td></tr>
              )}
              {rows.map(r => {
                const acc = accountMap.get(r.bank_account_id);
                const ent = entityMap.get(r.entity_id);
                const cat = r.category_id ? catMap.get(r.category_id) : null;
                const sup = r.supplier_id ? supMap.get(r.supplier_id) : null;
                return (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <Td className="font-mono text-[12px]">{r.occurred_at.slice(0, 10)}</Td>
                    <Td>{ent?.name ?? "-"}</Td>
                    <Td>{acc?.account_name ?? "-"}</Td>
                    <Td><span className={`font-medium ${DIRECTION_COLOR[r.direction]}`}>{DIRECTION_LABEL[r.direction]}</span></Td>
                    <Td className={`text-right font-mono font-semibold ${DIRECTION_COLOR[r.direction]}`}>
                      {fmtMoney(Number(r.amount))}
                    </Td>
                    <Td className="text-muted-foreground">{cat?.name ?? "-"}</Td>
                    <Td>{sup?.name ?? r.counterparty ?? "-"}</Td>
                    <Td className="max-w-[260px] truncate" title={r.summary ?? ""}>{r.summary}</Td>
                    <Td>
                      {r.attachment_path ? (
                        <button onClick={() => openAttachment(r.attachment_path!)} className="text-sky-600 inline-flex items-center gap-1">
                          <Paperclip className="w-3.5 h-3.5" /> 查看
                        </button>
                      ) : <span className="text-muted-foreground/50">—</span>}
                    </Td>
                    <Td className="text-right">
                      <button onClick={() => { setEditing(r); setDrawerOpen(true); }} className="w-7 h-7 rounded-md hover:bg-muted inline-flex items-center justify-center">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(r)} className="w-7 h-7 rounded-md hover:bg-muted text-rose-500 inline-flex items-center justify-center">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-[12px] text-muted-foreground border-t">共 {rows.length} 条</div>
      </Card>

      <CashflowDrawer open={drawerOpen} onOpenChange={setDrawerOpen} initial={editing}
        entities={entities} accounts={accounts} categories={categories} shops={shops} suppliers={suppliers}
        onSaved={loadRows} />

      {entities.length === 0 && (
        <Card className="p-4 bg-amber-50 border-amber-200 text-[13px] text-amber-800">
          <div className="flex items-start gap-2">
            <FileText className="w-4 h-4 mt-0.5" />
            <div>
              还没有创建经营主体。请先到 <a href="/finance/master-data" className="underline font-medium">财务基础资料</a> 创建主体和银行账户。
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 font-normal ${className}`}>{children}</th>;
}
function Td({ children, className = "", title }: { children: React.ReactNode; className?: string; title?: string }) {
  return <td className={`px-3 py-2.5 ${className}`} title={title}>{children}</td>;
}

function FilterSelect({ value, onChange, placeholder, options }: {
  value: string; onChange: (v: string) => void; placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-border bg-white px-3 text-[13px]">
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function SummaryTile({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: "emerald" | "rose" | "sky" }) {
  const map = {
    emerald: { bg: "bg-emerald-50/60 border-emerald-200", text: "text-emerald-700", pill: "bg-emerald-100 text-emerald-600" },
    rose: { bg: "bg-rose-50/60 border-rose-200", text: "text-rose-700", pill: "bg-rose-100 text-rose-600" },
    sky: { bg: "bg-sky-50/60 border-sky-200", text: "text-sky-700", pill: "bg-sky-100 text-sky-600" },
  }[tone];
  return (
    <Card className={`p-4 ${map.bg}`}>
      <div className="flex items-start justify-between">
        <div className="text-[12px] text-muted-foreground">{label}</div>
        <span className={`w-7 h-7 rounded-full flex items-center justify-center ${map.pill}`}>{icon}</span>
      </div>
      <div className={`text-2xl font-bold font-mono mt-2 ${map.text}`}>{value}</div>
    </Card>
  );
}
