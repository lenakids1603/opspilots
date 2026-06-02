import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Power, X, Download, Upload, FileSpreadsheet, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { fmtMoney } from "@/lib/finance";
import { parseAccountWorkbook, downloadTemplate, exportRowsToXlsx, downloadErrorReport, exportAllMasterData, type ImportPreview, type PreviewRow } from "@/lib/financeImport";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type AnyRow = Record<string, any>;
type FieldDef = {
  key: string;
  label: string;
  type?: "text" | "number" | "select" | "textarea" | "checkbox";
  required?: boolean;
  options?: { value: string; label: string }[];
  default?: any;
  hint?: string;
};

const fmt = (n: number) => Number(n ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const ENTITY_TYPE_LABEL: Record<string, string> = { individual: "个体户", company: "运营公司" };
const PAGE_SIZES = [20, 50, 100];

export default function FinanceMasterDataPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const triggerRefresh = () => setRefreshKey(k => k + 1);
  const tab = searchParams.get("tab") ?? "entities";
  const filter = searchParams.get("filter") ?? "";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">财务基础资料</h1>
          <p className="text-[12px] text-muted-foreground mt-1">维护经营主体、银行账户、店铺、收支分类</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={downloadTemplate}><Download className="w-4 h-4 mr-1.5" />下载模板</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-1.5" />导出</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={async () => { try { await exportAllMasterData(); toast({ title: "已导出全部基础资料" }); } catch (e: any) { toast({ title: "导出失败", description: String(e?.message ?? e), variant: "destructive" }); } }}>导出全部基础资料</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload className="w-4 h-4 mr-1.5" />导入表格</Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => { const sp = new URLSearchParams(searchParams); sp.set("tab", v); setSearchParams(sp); }}>
        <TabsList>
          <TabsTrigger value="entities">经营主体</TabsTrigger>
          <TabsTrigger value="banks">银行账户</TabsTrigger>
          <TabsTrigger value="shops">店铺</TabsTrigger>
          <TabsTrigger value="categories">收支分类</TabsTrigger>
        </TabsList>

        <TabsContent value="entities"><EntitiesTab key={`e${refreshKey}`} /></TabsContent>
        <TabsContent value="banks"><BanksTab key={`b${refreshKey}`} /></TabsContent>
        <TabsContent value="shops"><ShopsTab key={`s${refreshKey}-${filter}`} initialFilter={filter} /></TabsContent>
        <TabsContent value="categories"><CategoriesTab key={`c${refreshKey}`} /></TabsContent>
      </Tabs>


      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={triggerRefresh} />
    </div>
  );
}

/* ============================== Shared ============================== */

function FilterRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b bg-muted/20">{children}</div>;
}
function EmptyHint({ msg }: { msg: string }) {
  return (
    <div className="py-16 flex flex-col items-center text-muted-foreground text-[13px]">
      <FileSpreadsheet className="w-8 h-8 mb-2 opacity-40" />
      <div>{msg}</div>
    </div>
  );
}
function StatusPill({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center px-2 h-5 rounded-full text-[11px] ${active ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
      {active ? "启用" : "停用"}
    </span>
  );
}

function Pager({ page, pageSize, total, onPageChange, onPageSizeChange }: {
  page: number; pageSize: number; total: number;
  onPageChange: (p: number) => void; onPageSizeChange: (s: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, totalPages);
  const pages: number[] = [];
  const start = Math.max(1, cur - 2), end = Math.min(totalPages, start + 4);
  for (let i = Math.max(1, end - 4); i <= end; i++) pages.push(i);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t bg-muted/10 text-[12px]">
      <div className="text-muted-foreground">共 {total} 条 · 第 {cur} / {totalPages} 页</div>
      <div className="flex items-center gap-1">
        <select value={pageSize} onChange={e => onPageSizeChange(Number(e.target.value))}
          className="h-8 rounded-md border px-2 text-[12px] mr-2">
          {PAGE_SIZES.map(s => <option key={s} value={s}>{s} 条/页</option>)}
        </select>
        <button onClick={() => onPageChange(cur - 1)} disabled={cur <= 1}
          className="h-8 w-8 rounded-md border inline-flex items-center justify-center disabled:opacity-40">
          <ChevronLeft className="w-4 h-4" />
        </button>
        {pages.map(p => (
          <button key={p} onClick={() => onPageChange(p)}
            className={`h-8 min-w-8 px-2 rounded-md border text-[12px] ${p === cur ? "bg-primary text-primary-foreground border-primary" : ""}`}>{p}</button>
        ))}
        <button onClick={() => onPageChange(cur + 1)} disabled={cur >= totalPages}
          className="h-8 w-8 rounded-md border inline-flex items-center justify-center disabled:opacity-40">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function EditDrawer({
  open, onOpenChange, table, fields, initial, title, onSaved, extraDefaults, validateDup,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  table: string; fields: FieldDef[]; initial: AnyRow | null; title: string; onSaved: () => void;
  extraDefaults?: AnyRow;
  validateDup?: (form: AnyRow, isEdit: boolean, id?: string) => Promise<string | null>;
}) {
  const [form, setForm] = useState<AnyRow>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) setForm({ ...initial });
    else {
      const init: AnyRow = { ...(extraDefaults ?? {}) };
      fields.forEach(f => { if (init[f.key] === undefined) init[f.key] = f.default ?? (f.type === "checkbox" ? false : ""); });
      setForm(init);
    }
  }, [open, initial, fields, extraDefaults]);

  const handleSave = async () => {
    for (const f of fields) {
      if (f.required && (form[f.key] === "" || form[f.key] == null)) {
        toast({ title: `${f.label} 必填`, variant: "destructive" }); return;
      }
    }
    setSaving(true);
    if (validateDup) {
      const err = await validateDup(form, !!initial, initial?.id);
      if (err) { setSaving(false); toast({ title: "重复校验失败", description: err, variant: "destructive" }); return; }
    }
    const payload: AnyRow = {};
    fields.forEach(f => {
      let v = form[f.key];
      if (f.type === "number") v = v === "" || v == null ? null : Number(v);
      if (f.type === "checkbox") v = !!v;
      if (v === "") v = null;
      payload[f.key] = v;
    });
    const res = initial
      ? await supabase.from(table as any).update(payload).eq("id", initial.id)
      : await supabase.from(table as any).insert(payload);
    setSaving(false);
    if (res.error) {
      const friendly = res.error.message.includes("duplicate key") ? "该记录已存在，请勿重复添加" : res.error.message;
      toast({ title: "保存失败", description: friendly, variant: "destructive" }); return;
    }
    toast({ title: initial ? "已更新" : "已新增" });
    onSaved(); onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <div className="px-6 py-4 border-b flex justify-between items-start">
          <h2 className="text-[15px] font-semibold">{initial ? "编辑" : "新增"} · {title}</h2>
          <button onClick={() => onOpenChange(false)} className="w-8 h-8 rounded-md hover:bg-muted flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {fields.map(f => (
            <div key={f.key}>
              <label className="block text-[12px] text-foreground/80 mb-1.5">
                {f.label}{f.required && <span className="text-rose-500 ml-0.5">*</span>}
              </label>
              {f.type === "select" ? (
                <select value={form[f.key] ?? ""} onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value }))}
                  className="h-10 w-full rounded-md border border-border bg-white px-3 text-[13px]">
                  <option value="">-- 选择 --</option>
                  {f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === "textarea" ? (
                <textarea value={form[f.key] ?? ""} onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value }))}
                  rows={3} className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px]" />
              ) : f.type === "checkbox" ? (
                <label className="inline-flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={!!form[f.key]} onChange={e => setForm(s => ({ ...s, [f.key]: e.target.checked }))} />
                  <span className="text-muted-foreground">{f.hint ?? "是"}</span>
                </label>
              ) : (
                <Input type={f.type === "number" ? "number" : "text"} value={form[f.key] ?? ""}
                  onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value }))} className="h-10" />
              )}
              {f.hint && f.type !== "checkbox" && <div className="text-[11px] text-muted-foreground mt-1">{f.hint}</div>}
            </div>
          ))}
        </div>
        <div className="px-6 py-3 border-t bg-muted/30 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "保存中..." : "保存"}</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* small helper to reset to page 1 when filters change */
function useDebouncedReset(deps: any[], setPage: (n: number) => void) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/* ============================== 经营主体 ============================== */

function EntitiesTab() {
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [usage, setUsage] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AnyRow | null>(null);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useDebouncedReset([q, typeFilter, statusFilter, pageSize], setPage);

  const load = useCallback(async () => {
    setLoading(true);
    let qry = supabase.from("business_entities").select("*", { count: "exact" })
      .is("deleted_at", null)
      .order("status", { ascending: true })
      .order("created_at", { ascending: false });
    const qq = q.trim();
    if (qq) qry = qry.or(`name.ilike.%${qq}%,legal_person.ilike.%${qq}%,code.ilike.%${qq}%`);
    if (typeFilter) qry = qry.eq("entity_type", typeFilter as "individual" | "company");
    if (statusFilter) qry = qry.eq("status", statusFilter);
    const from = (page - 1) * pageSize;
    const { data, count, error } = await qry.range(from, from + pageSize - 1);
    if (error) { toast({ title: "加载失败", description: error.message, variant: "destructive" }); setLoading(false); return; }
    setRows(data ?? []); setTotal(count ?? 0);

    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
    const ids = (data ?? []).map((r: any) => r.id);
    if (ids.length) {
      const { data: tx } = await supabase.from("cash_transactions").select("entity_id,amount,direction")
        .is("deleted_at", null).gte("occurred_at", yearStart).eq("direction", "in").in("entity_id", ids);
      const map = new Map<string, number>();
      (tx ?? []).forEach((t: any) => map.set(t.entity_id, (map.get(t.entity_id) ?? 0) + Number(t.amount || 0)));
      setUsage(map);
    } else setUsage(new Map());
    setLoading(false);
  }, [q, typeFilter, statusFilter, page, pageSize]);
  useEffect(() => { load(); }, [load]);

  const toggleStatus = async (r: AnyRow) => {
    const next = r.status === "active" ? "disabled" : "active";
    const { error } = await supabase.from("business_entities").update({ status: next }).eq("id", r.id);
    if (error) toast({ title: "操作失败", description: error.message, variant: "destructive" });
    else { toast({ title: next === "active" ? "已启用" : "已停用" }); load(); }
  };

  const handleExport = async () => {
    const { data } = await supabase.from("business_entities").select("*").is("deleted_at", null);
    const out = (data ?? []).map((r: any) => {
      const used = usage.get(r.id) ?? 0;
      const limit = Number(r.annual_flow_limit ?? 0);
      return {
        主体名称: r.name, 编码: r.code, 主体类型: ENTITY_TYPE_LABEL[r.entity_type] ?? r.entity_type,
        法人: r.legal_person, 年度流水额度: limit, 年度已用流水: used,
        剩余额度: Math.max(0, limit - used),
        使用率: limit > 0 ? `${((used / limit) * 100).toFixed(1)}%` : "-",
        状态: r.status === "active" ? "启用" : "停用", 备注: r.remark,
      };
    });
    exportRowsToXlsx(`经营主体_${new Date().toISOString().slice(0, 10)}.xlsx`, "经营主体", out);
    toast({ title: "已导出" });
  };

  const validateDup = async (form: AnyRow, isEdit: boolean, id?: string) => {
    const name = String(form.name || "").trim();
    if (!name) return null;
    let q2 = supabase.from("business_entities").select("id").is("deleted_at", null)
      .ilike("name", name).eq("entity_type", form.entity_type);
    if (isEdit && id) q2 = q2.neq("id", id);
    const { data } = await q2.limit(1);
    if (data && data.length) return "该经营主体已存在（相同名称和类型）";
    if (form.code) {
      let q3 = supabase.from("business_entities").select("id").is("deleted_at", null).eq("code", form.code);
      if (isEdit && id) q3 = q3.neq("id", id);
      const { data: d2 } = await q3.limit(1);
      if (d2 && d2.length) return "该主体编码已存在";
    }
    return null;
  };

  const fields: FieldDef[] = [
    { key: "name", label: "主体名称", required: true },
    { key: "code", label: "主体简称/编码" },
    { key: "entity_type", label: "主体类型", type: "select", required: true, default: "individual",
      options: [{ value: "individual", label: "个体户" }, { value: "company", label: "运营公司 / 其他" }] },
    { key: "legal_person", label: "法人 / 法人代表" },
    { key: "annual_flow_limit", label: "年度流水额度", type: "number", default: 5000000 },
    { key: "registration_no", label: "注册号" },
    { key: "tax_no", label: "税号" },
    { key: "status", label: "状态", type: "select", default: "active",
      options: [{ value: "active", label: "启用" }, { value: "disabled", label: "停用" }] },
    { key: "remark", label: "备注", type: "textarea" },
  ];

  return (
    <Card className="overflow-hidden mt-4">
      <FilterRow>
        <Input placeholder="搜索主体 / 法人 / 编码" value={q} onChange={e => setQ(e.target.value)} className="h-9 w-60" />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="h-9 rounded-md border px-2 text-[13px]">
          <option value="">全部类型</option><option value="individual">个体户</option><option value="company">运营公司 / 其他</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="h-9 rounded-md border px-2 text-[13px]">
          <option value="">全部状态</option><option value="active">启用</option><option value="disabled">停用</option>
        </select>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-3.5 h-3.5 mr-1" />导出</Button>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="w-4 h-4 mr-1" />新增</Button>
      </FilterRow>

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              {["主体名称", "类型", "法人", "年度流水额度", "已用", "剩余", "使用率", "状态", "操作"].map(h => <th key={h} className="px-3 py-2.5 font-normal">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">加载中...</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={9}><EmptyHint msg="暂无经营主体" /></td></tr>}
            {rows.map(r => {
              const used = usage.get(r.id) ?? 0;
              const limit = Number(r.annual_flow_limit ?? 0);
              const rate = limit > 0 ? used / limit : 0;
              const rateColor = rate >= 0.9 ? "text-rose-600 bg-rose-50" : rate >= 0.8 ? "text-amber-600 bg-amber-50" : "text-emerald-700 bg-emerald-50";
              return (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2.5"><div className="font-medium">{r.name}</div>{r.code && <div className="text-[11px] text-muted-foreground">{r.code}</div>}</td>
                  <td className="px-3 py-2.5">{ENTITY_TYPE_LABEL[r.entity_type] ?? r.entity_type}</td>
                  <td className="px-3 py-2.5">{r.legal_person || "-"}</td>
                  <td className="px-3 py-2.5">¥{fmt(limit)}</td>
                  <td className="px-3 py-2.5">¥{fmt(used)}</td>
                  <td className="px-3 py-2.5">¥{fmt(Math.max(0, limit - used))}</td>
                  <td className="px-3 py-2.5"><span className={`inline-flex px-2 h-5 items-center rounded text-[11px] ${rateColor}`}>{limit > 0 ? `${(rate * 100).toFixed(1)}%` : "-"}</span></td>
                  <td className="px-3 py-2.5"><StatusPill active={r.status === "active"} /></td>
                  <td className="px-3 py-2.5">
                    <button onClick={() => { setEditing(r); setOpen(true); }} className="w-7 h-7 rounded-md hover:bg-muted inline-flex items-center justify-center"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => toggleStatus(r)} className="w-7 h-7 rounded-md hover:bg-muted inline-flex items-center justify-center"><Power className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />

      <EditDrawer open={open} onOpenChange={setOpen} table="business_entities" fields={fields}
        initial={editing} title="经营主体" onSaved={load} validateDup={validateDup} />
    </Card>
  );
}

/* ============================== 银行账户 ============================== */

const USAGE_LABEL: Record<string, string> = {
  collection: "收款", payment: "付款", ads: "投流",
  operation_fee: "运营服务费", backup: "备用", other: "其他",
};
const ACCOUNT_TYPE_LABEL: Record<string, string> = { corporate: "对公账户", personal: "个人账户" };

function BanksTab() {
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [entities, setEntities] = useState<AnyRow[]>([]);
  const [bindingCounts, setBindingCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AnyRow | null>(null);
  const [q, setQ] = useState("");
  const [acctTypeFilter, setAcctTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useDebouncedReset([q, acctTypeFilter, statusFilter, pageSize], setPage);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: es } = await supabase.from("business_entities").select("id,name,entity_type").is("deleted_at", null).order("name");
    setEntities(es ?? []);
    let qry = supabase.from("bank_accounts").select("*", { count: "exact" }).is("deleted_at", null)
      .order("is_default", { ascending: false })
      .order("status", { ascending: true })
      .order("created_at", { ascending: false });
    const qq = q.trim();
    if (qq) qry = qry.or(`account_holder_name.ilike.%${qq}%,account_name.ilike.%${qq}%,bank_name.ilike.%${qq}%,account_number.ilike.%${qq}%,account_no_masked.ilike.%${qq}%`);
    if (acctTypeFilter) qry = qry.eq("account_type", acctTypeFilter);
    if (statusFilter) qry = qry.eq("status", statusFilter);
    const from = (page - 1) * pageSize;
    const { data, count, error } = await qry.range(from, from + pageSize - 1);
    setLoading(false);
    if (error) { toast({ title: "加载失败", description: error.message, variant: "destructive" }); return; }
    setRows(data ?? []); setTotal(count ?? 0);

    const ids = (data ?? []).map((r: any) => r.id);
    if (ids.length) {
      const { data: bnd } = await supabase.from("shop_bank_account_bindings")
        .select("bank_account_id").in("bank_account_id", ids).eq("status", "active");
      const m = new Map<string, number>();
      (bnd ?? []).forEach((b: any) => m.set(b.bank_account_id, (m.get(b.bank_account_id) ?? 0) + 1));
      setBindingCounts(m);
    } else setBindingCounts(new Map());
  }, [q, acctTypeFilter, statusFilter, page, pageSize]);
  useEffect(() => { load(); }, [load]);

  const entityMap = useMemo(() => new Map(entities.map(e => [e.id, e])), [entities]);

  const toggleStatus = async (r: AnyRow) => {
    const next = r.status === "active" ? "disabled" : "active";
    const { error } = await supabase.from("bank_accounts").update({ status: next }).eq("id", r.id);
    if (error) toast({ title: "操作失败", description: error.message, variant: "destructive" });
    else { toast({ title: next === "active" ? "已启用" : "已停用" }); load(); }
  };

  const handleExport = async () => {
    const { data } = await supabase.from("bank_accounts").select("*").is("deleted_at", null);
    const ids = (data ?? []).map((r: any) => r.id);
    const cntMap = new Map<string, number>();
    if (ids.length) {
      const { data: bnd } = await supabase.from("shop_bank_account_bindings")
        .select("bank_account_id").in("bank_account_id", ids).eq("status", "active");
      (bnd ?? []).forEach((b: any) => cntMap.set(b.bank_account_id, (cntMap.get(b.bank_account_id) ?? 0) + 1));
    }
    const out = (data ?? []).map((r: any) => ({
      开户名: r.account_holder_name || r.account_name || "",
      账户类型: ACCOUNT_TYPE_LABEL[r.account_type] ?? r.account_type ?? "",
      开户银行: r.bank_name || "",
      银行账号: r.account_number || r.account_no_masked || "",
      绑定店铺数: cntMap.get(r.id) ?? 0,
      当前余额: r.current_balance,
      状态: r.status === "active" ? "启用" : "停用",
      备注: r.remark,
    }));
    exportRowsToXlsx(`银行账户_${new Date().toISOString().slice(0, 10)}.xlsx`, "银行账户", out);
    toast({ title: "已导出" });
  };

  const validateDup = async (form: AnyRow, isEdit: boolean, id?: string) => {
    const acc = String(form.account_number || form.account_no_masked || "").replace(/\s+/g, "");
    if (!acc) return null;
    const { data } = await supabase.from("bank_accounts").select("id,account_number,account_no_masked").is("deleted_at", null);
    const dup = (data ?? []).find((b: any) => {
      const v = String(b.account_number || b.account_no_masked || "").replace(/\s+/g, "");
      return v === acc && (!isEdit || b.id !== id);
    });
    if (dup) return "该银行账号已存在，请勿重复添加";
    return null;
  };

  const isPersonal = (editing?.account_type ?? "corporate") === "personal";
  const fields: FieldDef[] = [
    { key: "account_type", label: "账户类型", type: "select", required: true, default: "corporate",
      options: [{ value: "corporate", label: "对公账户" }, { value: "personal", label: "个人账户" }] },
    { key: "account_holder_name", label: "开户名", required: true, hint: "对公账户填主体名称，个人账户填持卡人姓名；保存时若开户名能匹配到经营主体会自动建立归属关系" },
    { key: "bank_name", label: "开户银行", required: true },
    { key: "account_number", label: "银行账号", required: true },
    { key: "current_balance", label: "当前余额", type: "number", default: 0 },
    { key: "status", label: "状态", type: "select", default: "active",
      options: [{ value: "active", label: "启用" }, { value: "disabled", label: "停用" }] },
    { key: "remark", label: "备注", type: "textarea" },
  ];
  void isPersonal;

  return (
    <Card className="overflow-hidden mt-4">
      <div className="px-4 py-3 border-b bg-muted/10 text-[12px] text-muted-foreground">
        银行账户与店铺通过"绑定关系"维护（一个账户可绑定多个店铺，一个店铺也可绑定多个账户）。账户用途不在档案中固定，具体业务在资金流水的收支分类里区分。
      </div>
      <FilterRow>
        <Input placeholder="搜索开户名 / 开户银行 / 银行账号" value={q} onChange={e => setQ(e.target.value)} className="h-9 w-72" />
        <select value={acctTypeFilter} onChange={e => setAcctTypeFilter(e.target.value)} className="h-9 rounded-md border px-2 text-[13px]">
          <option value="">全部账户类型</option>
          <option value="corporate">对公账户</option>
          <option value="personal">个人账户</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="h-9 rounded-md border px-2 text-[13px]">
          <option value="">全部状态</option><option value="active">启用</option><option value="disabled">停用</option>
        </select>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-3.5 h-3.5 mr-1" />导出</Button>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="w-4 h-4 mr-1" />新增</Button>
      </FilterRow>

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              {["开户名", "账户类型", "开户银行", "银行账号", "绑定店铺数", "当前余额", "状态", "操作"]
                .map(h => <th key={h} className="px-3 py-2.5 font-normal whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">加载中...</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={8}><EmptyHint msg="暂无银行账户" /></td></tr>}
            {rows.map(r => {
              const isPer = r.account_type === "personal";
              const cnt = bindingCounts.get(r.id) ?? 0;
              return (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{r.account_holder_name || r.account_name || "-"}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[11px] px-1.5 py-0.5 rounded ${isPer ? "bg-violet-50 text-violet-700" : "bg-sky-50 text-sky-700"}`}>
                      {ACCOUNT_TYPE_LABEL[r.account_type] ?? r.account_type}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">{r.bank_name || "-"}</td>
                  <td className="px-3 py-2.5 font-mono text-[12px]">{r.account_number || r.account_no_masked || "-"}</td>
                  <td className="px-3 py-2.5 text-center">{cnt > 0 ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">{cnt}</span> : <span className="text-muted-foreground">0</span>}</td>
                  <td className="px-3 py-2.5 font-mono">{fmtMoney(Number(r.current_balance ?? 0))}</td>
                  <td className="px-3 py-2.5"><StatusPill active={r.status === "active"} /></td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <button onClick={() => { setEditing(r); setOpen(true); }} className="w-7 h-7 rounded-md hover:bg-muted inline-flex items-center justify-center"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => toggleStatus(r)} className="w-7 h-7 rounded-md hover:bg-muted inline-flex items-center justify-center"><Power className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />

      <EditDrawer open={open} onOpenChange={setOpen} table="bank_accounts" fields={fields}
        initial={editing} title="银行账户" onSaved={load} validateDup={validateDup} />
    </Card>
  );
}

/* ============================== 店铺 ============================== */

function ShopsTab({ initialFilter = "" }: { initialFilter?: string }) {
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [entities, setEntities] = useState<AnyRow[]>([]);
  const [platforms, setPlatforms] = useState<AnyRow[]>([]);
  const [banks, setBanks] = useState<AnyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [pf, setPf] = useState("");
  const [ent, setEnt] = useState("");
  const [stf, setStf] = useState("");
  const [bindState, setBindState] = useState(initialFilter || "");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortKey, setSortKey] = useState<string>("jst_shop_id");
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [bindOpen, setBindOpen] = useState(false);
  const [bindShop, setBindShop] = useState<AnyRow | null>(null);
  useDebouncedReset([q, pf, ent, stf, bindState, pageSize], setPage);

  const [bindingsByShop, setBindingsByShop] = useState<Map<string, AnyRow[]>>(new Map());
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [accountsShop, setAccountsShop] = useState<AnyRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: es }, { data: ps }, { data: bs }] = await Promise.all([
      supabase.from("business_entities").select("id,name,entity_type").is("deleted_at", null).order("name"),
      supabase.from("platforms").select("id,name,code").is("deleted_at", null).order("name"),
      supabase.from("bank_accounts").select("id,account_holder_name,account_name,bank_name,account_number,account_no_masked,account_type,usage_type,is_default,owner_entity_id,related_entity_id").is("deleted_at", null),
    ]);
    setEntities(es ?? []); setPlatforms(ps ?? []); setBanks(bs ?? []);

    let qry = supabase.from("shops").select("*", { count: "exact" }).is("deleted_at", null)
      .order(sortKey, { ascending: sortAsc, nullsFirst: false });
    const qq = q.trim();
    if (qq) qry = (qry as any).or(`name.ilike.%${qq}%,jst_shop_id.ilike.%${qq}%`);
    if (pf) qry = qry.eq("platform_id", pf);
    if (ent) qry = qry.eq("entity_id", ent);
    if (stf) qry = qry.eq("status", stf);
    if (bindState === "bound") qry = qry.not("entity_id", "is", null);
    else if (bindState === "unbound" || bindState === "missing_entity") qry = qry.is("entity_id", null);
    else if (bindState === "missing_platform") qry = qry.is("platform_id", null);
    const from = (page - 1) * pageSize;
    const { data, count, error } = await qry.range(from, from + pageSize - 1);
    setLoading(false);
    if (error) { toast({ title: "加载失败", description: error.message, variant: "destructive" }); return; }
    setRows(data ?? []); setTotal(count ?? 0);

    const ids = (data ?? []).map((r: any) => r.id);
    if (ids.length) {
      const { data: bnd } = await supabase.from("shop_bank_account_bindings")
        .select("*").in("shop_id", ids).eq("status", "active");
      const m = new Map<string, AnyRow[]>();
      (bnd ?? []).forEach((b: any) => {
        const arr = m.get(b.shop_id) ?? [];
        arr.push(b); m.set(b.shop_id, arr);
      });
      setBindingsByShop(m);
    } else setBindingsByShop(new Map());
  }, [q, pf, ent, stf, bindState, page, pageSize, sortKey, sortAsc]);
  useEffect(() => { load(); }, [load]);

  const entityMap = useMemo(() => new Map(entities.map(e => [e.id, e])), [entities]);
  const platformMap = useMemo(() => new Map(platforms.map(p => [p.id, p])), [platforms]);
  const bankMap = useMemo(() => new Map(banks.map(b => [b.id, b])), [banks]);
  const banksByEntity = useMemo(() => {
    const m = new Map<string, AnyRow[]>();
    banks.forEach(b => {
      const key = b.owner_entity_id || b.related_entity_id;
      if (!key) return;
      const arr = m.get(key) ?? [];
      arr.push(b); m.set(key, arr);
    });
    return m;
  }, [banks]);

  const handleExport = async () => {
    const { data } = await supabase.from("shops").select("*").is("deleted_at", null);
    const out = (data ?? []).map((r: any) => ({
      店铺名称: r.name,
      JST店铺ID: r.jst_shop_id ?? "",
      平台: r.platform_type ?? platformMap.get(r.platform_id)?.name ?? "",
      所属经营主体: entityMap.get(r.entity_id)?.name ?? "",
      授权状态: r.auth_status ?? "",
      店铺状态: r.shop_status_raw ?? "",
      最后同步时间: r.last_synced_at ? new Date(r.last_synced_at).toLocaleString("zh-CN") : "",
    }));
    exportRowsToXlsx(`店铺_${new Date().toISOString().slice(0, 10)}.xlsx`, "店铺", out);
    toast({ title: "已导出" });
  };

  const openBind = (r: AnyRow) => { setBindShop(r); setBindOpen(true); };
  const openAccounts = (r: AnyRow) => { setAccountsShop(r); setAccountsOpen(true); };
  const unbind = async (r: AnyRow) => {
    const { error } = await supabase.from("shops").update({ entity_id: null }).eq("id", r.id);
    if (error) toast({ title: "解除失败", description: error.message, variant: "destructive" });
    else { toast({ title: "已解除经营主体绑定" }); load(); }
  };

  return (
    <Card className="overflow-hidden mt-4">
      <div className="px-4 py-3 border-b bg-muted/10 text-[12px] text-muted-foreground">
        店铺资料来自聚水潭同步。本页维护店铺对应的经营主体，以及店铺与银行账户的绑定关系（一个店铺可绑定多个账户，账户与店铺为多对多）。
      </div>
      <FilterRow>
        <Input placeholder="搜索店铺名 / JST 店铺ID" value={q} onChange={e => setQ(e.target.value)} className="h-9 w-64" />
        <select value={pf} onChange={e => setPf(e.target.value)} className="h-9 rounded-md border px-2 text-[13px]">
          <option value="">全部平台</option>{platforms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={ent} onChange={e => setEnt(e.target.value)} className="h-9 rounded-md border px-2 text-[13px] max-w-[180px]">
          <option value="">全部主体</option>{entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={bindState} onChange={e => setBindState(e.target.value)} className="h-9 rounded-md border px-2 text-[13px]">
          <option value="">全部绑定状态</option>
          <option value="bound">已绑定主体</option>
          <option value="unbound">未绑定主体</option>
          <option value="missing_entity">缺主体（待补）</option>
          <option value="missing_platform">缺平台（待补）</option>
        </select>
        <select value={stf} onChange={e => setStf(e.target.value)} className="h-9 rounded-md border px-2 text-[13px]">
          <option value="">全部状态</option><option value="active">运营中</option><option value="disabled">停用</option>
        </select>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-3.5 h-3.5 mr-1" />导出</Button>
      </FilterRow>

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              {(["店铺名称","平台","经营主体","默认收款账户","状态","操作"]).map(h =>
                <th key={h} className="px-3 py-2.5 font-normal whitespace-nowrap">{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">加载中...</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6}>
                <EmptyHint msg="暂无店铺数据。请先在【数据中心 / 聚水潭数据接入详情】同步店铺资料。" />
              </td></tr>
            )}
            {rows.map(r => {
              const entity = r.entity_id ? entityMap.get(r.entity_id) : null;
              const shopBindings = bindingsByShop.get(r.id) ?? [];
              const defaultCollection = shopBindings.find(b => b.binding_type === "collection" && b.is_default)
                ?? shopBindings.find(b => b.binding_type === "collection");
              const defBank = defaultCollection ? bankMap.get(defaultCollection.bank_account_id) : null;
              const platformName = r.platform_type || platformMap.get(r.platform_id)?.name || "-";
              return (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">{r.jst_shop_id ?? ""}</div>
                  </td>
                  <td className="px-3 py-2.5">{platformName}</td>
                  <td className="px-3 py-2.5">{entity ? entity.name : <span className="text-amber-600">未绑定</span>}</td>
                  <td className="px-3 py-2.5 text-[12px]">
                    {defBank ? (
                      <div>
                        <div>{defBank.account_holder_name || defBank.account_name}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">{defBank.bank_name} · {defBank.account_number || defBank.account_no_masked}</div>
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2.5">{r.shop_status_raw || "-"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <button onClick={() => openAccounts(r)} className="text-[12px] text-primary hover:underline mr-3">
                      {shopBindings.length > 0 ? "查看/管理账户" : "绑定账户"}
                    </button>
                    <button onClick={() => openBind(r)} className="text-[12px] text-muted-foreground hover:underline mr-3">
                      {r.entity_id ? "更换主体" : "绑定主体"}
                    </button>
                    {r.entity_id && (
                      <button onClick={() => unbind(r)} className="text-[12px] text-muted-foreground hover:underline">解除主体</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />

      <BindEntityDrawer
        open={bindOpen}
        onOpenChange={setBindOpen}
        shop={bindShop}
        entities={entities}
        banksByEntity={banksByEntity}
        onSaved={load}
      />
      <ShopBankBindingsDrawer
        open={accountsOpen}
        onOpenChange={setAccountsOpen}
        shop={accountsShop}
        banks={banks}
        onSaved={load}
      />
    </Card>
  );
}

function BindEntityDrawer({
  open, onOpenChange, shop, entities, banksByEntity, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  shop: AnyRow | null;
  entities: AnyRow[];
  banksByEntity: Map<string, AnyRow[]>;
  onSaved: () => void;
}) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && shop) {
      setSelectedId(shop.entity_id ?? "");
      setSearch(""); setTypeFilter("");
    }
  }, [open, shop]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return entities.filter(e =>
      (!typeFilter || e.entity_type === typeFilter) &&
      (!s || String(e.name ?? "").toLowerCase().includes(s))
    );
  }, [entities, search, typeFilter]);

  const selectedBanks = selectedId ? (banksByEntity.get(selectedId) ?? []) : [];

  const save = async () => {
    if (!shop) return;
    setSaving(true);
    const { error } = await supabase.from("shops")
      .update({ entity_id: selectedId || null })
      .eq("id", shop.id);
    setSaving(false);
    if (error) { toast({ title: "保存失败", description: error.message, variant: "destructive" }); return; }
    toast({ title: selectedId ? "已绑定经营主体" : "已解除绑定" });
    onOpenChange(false);
    onSaved();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        {shop && (
          <div className="space-y-5 pt-2">
            <div>
              <div className="text-base font-semibold">绑定经营主体</div>
              <div className="text-[12px] text-muted-foreground mt-1">为聚水潭店铺指定对应的内部经营主体</div>
            </div>

            <div className="rounded-md border bg-muted/20 p-3 space-y-1.5 text-[12.5px]">
              <div className="flex justify-between"><span className="text-muted-foreground">店铺名称</span><span className="font-medium">{shop.name}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">JST 店铺 ID</span><span className="font-mono text-[11.5px]">{shop.jst_shop_id ?? "-"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">平台</span><span>{shop.platform_type ?? "-"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">授权状态</span><span>{shop.auth_status || "-"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">店铺状态</span><span>{shop.shop_status_raw || "-"}</span></div>
            </div>

            <div className="space-y-2">
              <div className="text-[12px] text-muted-foreground">选择经营主体</div>
              <div className="flex gap-2">
                <Input placeholder="搜索主体名称" value={search} onChange={e => setSearch(e.target.value)} className="h-9 flex-1" />
                <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="h-9 rounded-md border px-2 text-[13px]">
                  <option value="">全部类型</option>
                  <option value="individual">个体户</option>
                  <option value="company">运营公司</option>
                </select>
              </div>
              <div className="border rounded-md max-h-64 overflow-y-auto divide-y">
                <label className="flex items-center gap-2 px-3 py-2 text-[12.5px] hover:bg-muted/40 cursor-pointer">
                  <input type="radio" name="ent" checked={selectedId === ""} onChange={() => setSelectedId("")} />
                  <span className="text-muted-foreground">不绑定 / 解除现有绑定</span>
                </label>
                {filtered.map(e => (
                  <label key={e.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[12.5px] hover:bg-muted/40 cursor-pointer">
                    <div className="flex items-center gap-2">
                      <input type="radio" name="ent" checked={selectedId === e.id} onChange={() => setSelectedId(e.id)} />
                      <span>{e.name}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">{ENTITY_TYPE_LABEL[e.entity_type] ?? e.entity_type}</span>
                  </label>
                ))}
                {filtered.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-muted-foreground">没有匹配的主体</div>}
              </div>
            </div>

            {selectedId && (
              <div className="space-y-1.5">
                <div className="text-[12px] text-muted-foreground">该主体下的银行账户</div>
                <div className="border rounded-md p-2 space-y-1 text-[12px]">
                  {selectedBanks.length === 0 && <div className="text-muted-foreground px-1 py-1">暂无银行账户</div>}
                  {selectedBanks.map(b => (
                    <div key={b.id} className="flex justify-between px-1 py-0.5">
                      <span>{b.bank_name ?? "-"} · {b.account_no_masked ?? ""}</span>
                      <span className="text-muted-foreground">{b.purpose ?? ""}{b.is_default ? " · 默认" : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
              <Button size="sm" onClick={save} disabled={saving}>{saving ? "保存中..." : "保存"}</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ============================== 店铺账户绑定抽屉 ============================== */

const BINDING_TYPE_LABEL: Record<string, string> = {
  collection: "收款", payment: "付款", ads: "投流", backup: "备用", other: "其他",
};

function ShopBankBindingsDrawer({
  open, onOpenChange, shop, banks, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  shop: AnyRow | null;
  banks: AnyRow[];
  onSaved: () => void;
}) {
  const [bindings, setBindings] = useState<AnyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<AnyRow>({
    bank_account_id: "", binding_type: "collection", is_default: false,
    effective_from: new Date().toISOString().slice(0, 10), effective_to: "", remark: "",
  });

  const reload = useCallback(async () => {
    if (!shop) return;
    setLoading(true);
    const { data } = await supabase.from("shop_bank_account_bindings")
      .select("*").eq("shop_id", shop.id).order("status").order("is_default", { ascending: false }).order("created_at", { ascending: false });
    setLoading(false);
    setBindings(data ?? []);
  }, [shop]);

  useEffect(() => { if (open) { reload(); setAdding(false); } }, [open, reload]);

  const bankMap = useMemo(() => new Map(banks.map(b => [b.id, b])), [banks]);

  const save = async () => {
    if (!shop) return;
    if (!form.bank_account_id) { toast({ title: "请选择银行账户", variant: "destructive" }); return; }
    const payload: any = {
      shop_id: shop.id,
      bank_account_id: form.bank_account_id,
      binding_type: form.binding_type,
      is_default: !!form.is_default,
      effective_from: form.effective_from || new Date().toISOString().slice(0, 10),
      effective_to: form.effective_to || null,
      status: "active",
      remark: form.remark || "",
      platform_id: shop.platform_id ?? null,
    };
    // If this is set as default, demote other defaults of same binding_type for this shop
    if (payload.is_default) {
      await supabase.from("shop_bank_account_bindings")
        .update({ is_default: false })
        .eq("shop_id", shop.id).eq("binding_type", payload.binding_type).eq("status", "active");
    }
    const { error } = await supabase.from("shop_bank_account_bindings").insert(payload);
    if (error) { toast({ title: "保存失败", description: error.message, variant: "destructive" }); return; }
    toast({ title: "已添加绑定" });
    setAdding(false);
    setForm({ bank_account_id: "", binding_type: "collection", is_default: false,
      effective_from: new Date().toISOString().slice(0, 10), effective_to: "", remark: "" });
    await reload();
    onSaved();
  };

  const toggleStatus = async (b: AnyRow) => {
    const next = b.status === "active" ? "inactive" : "active";
    const { error } = await supabase.from("shop_bank_account_bindings")
      .update({ status: next, ...(next === "inactive" ? { is_default: false } : {}) })
      .eq("id", b.id);
    if (error) toast({ title: "操作失败", description: error.message, variant: "destructive" });
    else { toast({ title: next === "active" ? "已启用" : "已停用" }); await reload(); onSaved(); }
  };

  const setDefault = async (b: AnyRow) => {
    if (!shop) return;
    await supabase.from("shop_bank_account_bindings")
      .update({ is_default: false })
      .eq("shop_id", shop.id).eq("binding_type", b.binding_type).eq("status", "active");
    const { error } = await supabase.from("shop_bank_account_bindings")
      .update({ is_default: true }).eq("id", b.id);
    if (error) toast({ title: "设置失败", description: error.message, variant: "destructive" });
    else { toast({ title: "已设为默认" }); await reload(); onSaved(); }
  };

  const removeBinding = async (b: AnyRow) => {
    if (!confirm("确认删除该绑定？")) return;
    const { error } = await supabase.from("shop_bank_account_bindings").delete().eq("id", b.id);
    if (error) toast({ title: "删除失败", description: error.message, variant: "destructive" });
    else { toast({ title: "已删除" }); await reload(); onSaved(); }
  };

  const availableBanks = banks.filter(b => b.status !== "disabled");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        {shop && (
          <div className="space-y-5 pt-2">
            <div>
              <div className="text-base font-semibold">店铺绑定银行账户</div>
              <div className="text-[12px] text-muted-foreground mt-1">维护该店铺关联的银行账户。一个店铺可绑定多个账户，每种绑定类型同时只能有一个默认账户。</div>
            </div>

            <div className="rounded-md border bg-muted/20 p-3 space-y-1.5 text-[12.5px]">
              <div className="flex justify-between"><span className="text-muted-foreground">店铺</span><span className="font-medium">{shop.name}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">JST ID</span><span className="font-mono text-[11.5px]">{shop.jst_shop_id ?? "-"}</span></div>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-[12px] font-medium">已绑定账户（{bindings.length}）</div>
              {!adding && <Button size="sm" onClick={() => setAdding(true)}><Plus className="w-3.5 h-3.5 mr-1" />新增绑定</Button>}
            </div>

            {adding && (
              <div className="border rounded-md p-3 space-y-2.5 bg-muted/10">
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="block">
                    <div className="text-[11px] text-muted-foreground mb-1">银行账户*</div>
                    <select value={form.bank_account_id}
                      onChange={e => setForm({ ...form, bank_account_id: e.target.value })}
                      className="h-9 w-full rounded-md border px-2 text-[13px]">
                      <option value="">请选择</option>
                      {availableBanks.map(b => (
                        <option key={b.id} value={b.id}>
                          {(b.account_holder_name || b.account_name)} · {b.bank_name} · {b.account_number || b.account_no_masked}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <div className="text-[11px] text-muted-foreground mb-1">绑定类型*</div>
                    <select value={form.binding_type}
                      onChange={e => setForm({ ...form, binding_type: e.target.value })}
                      className="h-9 w-full rounded-md border px-2 text-[13px]">
                      {Object.entries(BINDING_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <div className="text-[11px] text-muted-foreground mb-1">生效日期</div>
                    <Input type="date" value={form.effective_from}
                      onChange={e => setForm({ ...form, effective_from: e.target.value })} className="h-9" />
                  </label>
                  <label className="block">
                    <div className="text-[11px] text-muted-foreground mb-1">失效日期（可空）</div>
                    <Input type="date" value={form.effective_to}
                      onChange={e => setForm({ ...form, effective_to: e.target.value })} className="h-9" />
                  </label>
                </div>
                <label className="flex items-center gap-2 text-[12.5px]">
                  <input type="checkbox" checked={!!form.is_default}
                    onChange={e => setForm({ ...form, is_default: e.target.checked })} />
                  设为该绑定类型下的默认账户
                </label>
                <Input placeholder="备注（可空）" value={form.remark}
                  onChange={e => setForm({ ...form, remark: e.target.value })} className="h-9" />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setAdding(false)}>取消</Button>
                  <Button size="sm" onClick={save}>保存</Button>
                </div>
              </div>
            )}

            <div className="border rounded-md overflow-hidden">
              {loading && <div className="py-6 text-center text-[12px] text-muted-foreground">加载中...</div>}
              {!loading && bindings.length === 0 && <div className="py-6 text-center text-[12px] text-muted-foreground">暂无绑定账户</div>}
              {bindings.map(b => {
                const bank = bankMap.get(b.bank_account_id);
                return (
                  <div key={b.id} className={`border-t first:border-t-0 px-3 py-2.5 text-[12.5px] ${b.status !== "active" ? "opacity-60" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{bank?.account_holder_name || bank?.account_name || "-"}</div>
                        <div className="text-[11.5px] text-muted-foreground font-mono">{bank?.bank_name} · {bank?.account_number || bank?.account_no_masked}</div>
                        <div className="flex items-center gap-2 mt-1 text-[11px]">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{BINDING_TYPE_LABEL[b.binding_type]}</span>
                          {b.is_default && <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">默认</span>}
                          <span className="text-muted-foreground">{b.effective_from} → {b.effective_to ?? "—"}</span>
                          {b.status !== "active" && <span className="px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">已停用</span>}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 text-[11.5px]">
                        {b.status === "active" && !b.is_default && (
                          <button onClick={() => setDefault(b)} className="text-primary hover:underline">设为默认</button>
                        )}
                        <button onClick={() => toggleStatus(b)} className="text-muted-foreground hover:underline">
                          {b.status === "active" ? "停用" : "启用"}
                        </button>
                        <button onClick={() => removeBinding(b)} className="text-rose-600 hover:underline">删除</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>关闭</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}



/* ============================== 收支分类 ============================== */

function CategoriesTab() {
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AnyRow | null>(null);
  const [q, setQ] = useState("");
  const [dir, setDir] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useDebouncedReset([q, dir, pageSize], setPage);

  const load = useCallback(async () => {
    setLoading(true);
    let qry = supabase.from("cash_tx_categories").select("*", { count: "exact" }).is("deleted_at", null)
      .order("direction").order("sort_order");
    const qq = q.trim();
    if (qq) qry = qry.or(`name.ilike.%${qq}%,code.ilike.%${qq}%`);
    if (dir) qry = qry.eq("direction", dir as "in" | "out" | "transfer");
    const from = (page - 1) * pageSize;
    const { data, count, error } = await qry.range(from, from + pageSize - 1);
    setLoading(false);
    if (error) { toast({ title: "加载失败", description: error.message, variant: "destructive" }); return; }
    setRows(data ?? []); setTotal(count ?? 0);
  }, [q, dir, page, pageSize]);
  useEffect(() => { load(); }, [load]);

  const parentMap = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows]);

  const toggleStatus = async (r: AnyRow) => {
    const next = r.status === "active" ? "disabled" : "active";
    const { error } = await supabase.from("cash_tx_categories").update({ status: next }).eq("id", r.id);
    if (error) toast({ title: "操作失败", description: error.message, variant: "destructive" });
    else { toast({ title: next === "active" ? "已启用" : "已停用" }); load(); }
  };

  const handleExport = async () => {
    const { data } = await supabase.from("cash_tx_categories").select("*").is("deleted_at", null);
    const out = (data ?? []).map((r: any) => ({
      代码: r.code, 名称: r.name,
      方向: r.direction === "in" ? "收入" : r.direction === "out" ? "支出" : "内部转账",
      排序: r.sort_order, 状态: r.status === "active" ? "启用" : "停用", 备注: r.remark,
    }));
    exportRowsToXlsx(`收支分类_${new Date().toISOString().slice(0, 10)}.xlsx`, "收支分类", out);
    toast({ title: "已导出" });
  };

  const validateDup = async (form: AnyRow, isEdit: boolean, id?: string) => {
    const name = String(form.name || "").trim();
    if (!name || !form.direction) return null;
    let q2 = supabase.from("cash_tx_categories").select("id").is("deleted_at", null).eq("direction", form.direction).ilike("name", name);
    if (isEdit && id) q2 = q2.neq("id", id);
    const { data } = await q2.limit(1);
    if (data && data.length) return "该方向下已存在同名分类";
    return null;
  };

  const fields: FieldDef[] = [
    { key: "code", label: "代码", required: true },
    { key: "name", label: "名称", required: true },
    { key: "direction", label: "方向", type: "select", required: true, default: "out",
      options: [{ value: "in", label: "收入" }, { value: "out", label: "支出" }, { value: "transfer", label: "内部转账" }] },
    { key: "parent_id", label: "上级分类", type: "select", options: rows.filter(r => !r.parent_id).map(r => ({ value: r.id, label: r.name })) },
    { key: "sort_order", label: "排序", type: "number", default: 100 },
    { key: "status", label: "状态", type: "select", default: "active",
      options: [{ value: "active", label: "启用" }, { value: "disabled", label: "停用" }] },
    { key: "remark", label: "备注", type: "textarea" },
  ];

  return (
    <Card className="overflow-hidden mt-4">
      <FilterRow>
        <Input placeholder="搜索分类" value={q} onChange={e => setQ(e.target.value)} className="h-9 w-60" />
        <select value={dir} onChange={e => setDir(e.target.value)} className="h-9 rounded-md border px-2 text-[13px]">
          <option value="">全部方向</option><option value="in">收入</option><option value="out">支出</option><option value="transfer">内部转账</option>
        </select>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-3.5 h-3.5 mr-1" />导出</Button>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="w-4 h-4 mr-1" />新增</Button>
      </FilterRow>

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              {["名称", "代码", "方向", "上级", "排序", "状态", "操作"].map(h => <th key={h} className="px-3 py-2.5 font-normal">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">加载中...</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={7}><EmptyHint msg="暂无收支分类" /></td></tr>}
            {rows.map(r => (
              <tr key={r.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2.5 font-medium">{r.name}</td>
                <td className="px-3 py-2.5">{r.code}</td>
                <td className="px-3 py-2.5">{r.direction === "in" ? "收入" : r.direction === "out" ? "支出" : "内部转账"}</td>
                <td className="px-3 py-2.5">{r.parent_id ? parentMap.get(r.parent_id)?.name ?? "-" : "-"}</td>
                <td className="px-3 py-2.5">{r.sort_order}</td>
                <td className="px-3 py-2.5"><StatusPill active={r.status === "active"} /></td>
                <td className="px-3 py-2.5">
                  <button onClick={() => { setEditing(r); setOpen(true); }} className="w-7 h-7 rounded-md hover:bg-muted inline-flex items-center justify-center"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => toggleStatus(r)} className="w-7 h-7 rounded-md hover:bg-muted inline-flex items-center justify-center"><Power className="w-3.5 h-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />

      <EditDrawer open={open} onOpenChange={setOpen} table="cash_tx_categories" fields={fields}
        initial={editing} title="收支分类" onSaved={load} validateDup={validateDup} />
    </Card>
  );
}

/* ============================== Import Dialog ============================== */

type ImportError = { sheet: string; rowNum: number; field?: string; message: string; raw?: any; result?: string };

function ImportDialog({
  open, onOpenChange, onImported,
}: { open: boolean; onOpenChange: (v: boolean) => void; onImported: () => void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [lastErrors, setLastErrors] = useState<ImportError[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!open) { setPreview(null); setLastErrors([]); } }, [open]);

  const handleFile = async (file: File) => {
    setParsing(true);
    setLastErrors([]);
    try {
      // Fetch ALL existing rows (paged) so dedup works across the entire dataset
      const fetchAll = async (table: string, cols: string) => {
        const out: any[] = [];
        let from = 0; const step = 1000;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { data, error } = await supabase.from(table as any).select(cols).is("deleted_at", null).range(from, from + step - 1);
          if (error) throw error;
          out.push(...(data ?? []));
          if (!data || data.length < step) break;
          from += step;
        }
        return out;
      };
      const [ents, bks, shs, pls, cats, bnds] = await Promise.all([
        fetchAll("business_entities", "id,name,code,legal_person,entity_type"),
        fetchAll("bank_accounts", "id,account_number,account_no_masked,bank_name,account_holder_name"),
        fetchAll("shops", "id,name,platform_id,entity_id"),
        fetchAll("platforms", "id,name,code"),
        fetchAll("cash_tx_categories", "id,direction,name"),
        (async () => {
          const out: any[] = []; let from = 0; const step = 1000;
          while (true) {
            const { data, error } = await supabase.from("shop_bank_account_bindings").select("id,shop_id,bank_account_id,binding_type").range(from, from + step - 1);
            if (error) throw error;
            out.push(...(data ?? []));
            if (!data || data.length < step) break;
            from += step;
          }
          return out;
        })(),
      ]);
      const buf = await file.arrayBuffer();
      const p = parseAccountWorkbook(buf, {
        entities: ents as any, banks: bks as any, shops: shs as any, platforms: pls as any, categories: cats as any, bindings: bnds as any,
      });
      const total = p.entities.length + p.banks.length + p.shops.length + p.bindings.length + p.categories.length;
      if (total === 0) {
        toast({ title: "未识别到任何数据", description: "请检查 Sheet 名是否为：经营主体 / 银行账户 / 店铺 / 店铺账户绑定 / 收支分类", variant: "destructive" });
      }
      setPreview(p);
    } catch (e: any) {
      toast({ title: "解析失败", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  const setBankAcctType = (rowIdx: number, val: "corporate" | "personal") => {
    if (!preview) return;
    const next = { ...preview, banks: preview.banks.slice() };
    const r = { ...next.banks[rowIdx] };
    const d = { ...r.data };
    d.account_type = val;
    // Adjust holder defaults if previously pending
    if (val === "corporate") {
      d.account_holder_name = d.account_holder_name || d.owner_entity_name || "";
    } else {
      d.account_holder_name = d.related_person_name || d.account_holder_name || "";
    }
    r.data = d;
    r.needsAccountType = false;
    next.banks[rowIdx] = r;
    setPreview(next);
  };

  const bulkSetAcctType = (val: "corporate" | "personal") => {
    if (!preview) return;
    const banks = preview.banks.map(r => {
      if (!r.needsAccountType) return r;
      const d: any = { ...r.data, account_type: val };
      if (val === "corporate") d.account_holder_name = d.account_holder_name || d.owner_entity_name || "";
      else d.account_holder_name = d.related_person_name || d.account_holder_name || "";
      return { ...r, data: d, needsAccountType: false };
    });
    setPreview({ ...preview, banks });
  };

  const pendingAcctCount = preview?.banks.filter(r => r.needsAccountType).length ?? 0;

  const commit = async () => {
    if (!preview) return;
    if (pendingAcctCount > 0) {
      toast({ title: "请先确认账户类型", description: `还有 ${pendingAcctCount} 行未选择账户类型`, variant: "destructive" });
      return;
    }
    setCommitting(true);
    const errors: ImportError[] = [];
    let nCount = 0, uCount = 0, sCount = 0;
    const pushErr = (r: PreviewRow, msg: string, result = "失败") =>
      errors.push({ sheet: r.sheet, rowNum: r.rowNum, message: msg, raw: r.raw, result });

    try {
      const processRows = async (rows: PreviewRow[], table: string, transform: (data: any) => any) => {
        for (const r of rows) {
          if (r.status === "error") { pushErr(r, r.message ?? "解析错误"); continue; }
          if (r.status === "skip") { sCount++; pushErr(r, r.message ?? "已跳过", "跳过"); continue; }
          const payload = transform(r.data);
          if (payload === null) continue;
          const { __id, ...body } = payload;
          const res = r.status === "update"
            ? await supabase.from(table as any).update(body).eq("id", __id)
            : await supabase.from(table as any).insert(body);
          if (res.error) {
            const msg = res.error.message.includes("duplicate key") ? "数据库已存在同样的记录（被唯一约束拦截）" : res.error.message;
            pushErr(r, `${r.status === "update" ? "更新" : "新增"}失败: ${msg}`);
          } else {
            if (r.status === "update") uCount++; else nCount++;
          }
        }
      };

      // 1) entities
      await processRows(preview.entities, "business_entities", (d: any) => d);

      // refetch entities for FK resolution
      const { data: allEnts } = await supabase.from("business_entities").select("id,name").is("deleted_at", null);
      const entIdByName = new Map<string, string>((allEnts ?? []).map((e: any) => [String(e.name).trim().toLowerCase(), e.id]));
      const resolveEnt = (name?: string | null) => name ? (entIdByName.get(String(name).trim().toLowerCase()) ?? null) : null;

      // 2) banks
      await processRows(preview.banks, "bank_accounts", (d: any) => {
        const owner_entity_id = resolveEnt(d.owner_entity_name);
        const related_entity_id = resolveEnt(d.related_entity_name);
        if (d.account_type === "corporate" && !owner_entity_id) return null;
        const { owner_entity_name, related_entity_name, ...rest } = d;
        return {
          ...rest,
          owner_entity_id,
          related_entity_id,
          entity_id: owner_entity_id ?? related_entity_id ?? null, // legacy mirror
          account_name: d.account_holder_name, // legacy mirror
          __id: d.__id,
        };
      });
      preview.banks.forEach(r => {
        if ((r.status === "new" || r.status === "update") && r.data.account_type === "corporate") {
          if (!resolveEnt(r.data.owner_entity_name)) pushErr(r, `归属主体【${r.data.owner_entity_name ?? ""}】未找到`);
        }
      });

      // refetch banks for binding resolution
      const { data: allBanks } = await supabase.from("bank_accounts").select("id,account_number,account_no_masked").is("deleted_at", null);
      const bankIdByAcc = new Map<string, string>();
      (allBanks ?? []).forEach((b: any) => {
        const a = String(b.account_number || b.account_no_masked || "").replace(/\s+/g, "");
        if (a) bankIdByAcc.set(a, b.id);
      });

      // 3) shops
      await processRows(preview.shops, "shops", (d: any) => {
        const { entityName, platformName, ...rest } = d;
        const eid = resolveEnt(entityName);
        if (!eid) return null;
        return { ...rest, entity_id: eid, __id: d.__id };
      });

      // refetch shops for binding resolution
      const { data: allShops } = await supabase.from("shops").select("id,name,platform_id").is("deleted_at", null);
      const shopIdByKey = new Map<string, string>();
      (allShops ?? []).forEach((s: any) => shopIdByKey.set(`${s.platform_id}|${String(s.name).trim().toLowerCase()}`, s.id));

      // 4) bindings (upsert by shop_id+bank_account_id+binding_type)
      const { data: allBindings } = await supabase.from("shop_bank_account_bindings").select("id,shop_id,bank_account_id,binding_type");
      const bindByKey = new Map<string, string>();
      (allBindings ?? []).forEach((b: any) => bindByKey.set(`${b.shop_id}|${b.bank_account_id}|${b.binding_type}`, b.id));

      for (const r of preview.bindings) {
        if (r.status === "error") { pushErr(r, r.message ?? "解析错误"); continue; }
        if (r.status === "skip") { sCount++; pushErr(r, r.message ?? "已跳过", "跳过"); continue; }
        const d = r.data;
        const shop_id = shopIdByKey.get(`${d.platform_id}|${String(d.shopName).trim().toLowerCase()}`);
        const bank_account_id = bankIdByAcc.get(String(d.accountNo).replace(/\s+/g, ""));
        if (!shop_id) { pushErr(r, `找不到店铺【${d.shopName}】`); continue; }
        if (!bank_account_id) { pushErr(r, `找不到银行账号【${d.accountNo}】`); continue; }
        const key = `${shop_id}|${bank_account_id}|${d.binding_type}`;
        const existingId = bindByKey.get(key);
        // If is_default, clear other defaults for same shop+binding_type first
        if (d.is_default) {
          await supabase.from("shop_bank_account_bindings")
            .update({ is_default: false })
            .eq("shop_id", shop_id).eq("binding_type", d.binding_type);
        }
        const body: any = {
          shop_id, bank_account_id, platform_id: d.platform_id,
          binding_type: d.binding_type, is_default: d.is_default,
          status: d.status, remark: d.remark ?? "",
        };
        if (d.effective_from) body.effective_from = d.effective_from;
        if (d.effective_to) body.effective_to = d.effective_to;
        const res = existingId
          ? await supabase.from("shop_bank_account_bindings").update(body).eq("id", existingId)
          : await supabase.from("shop_bank_account_bindings").insert(body);
        if (res.error) pushErr(r, `${existingId ? "更新" : "新增"}失败: ${res.error.message}`);
        else { if (existingId) uCount++; else nCount++; }
      }

      // 5) categories
      await processRows(preview.categories, "cash_tx_categories", (d: any) => d);

      setLastErrors(errors);
      const failedCount = errors.filter(e => e.result !== "跳过").length;
      toast({
        title: "导入完成",
        description: `新增 ${nCount} 条，更新 ${uCount} 条，跳过 ${sCount} 条，失败 ${failedCount} 条`,
        variant: failedCount > 0 ? "destructive" : "default",
      });
      onImported();
      if (failedCount === 0 && errors.length === 0) onOpenChange(false);
    } catch (e: any) {
      toast({ title: "导入异常", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setCommitting(false);
    }
  };

  const stat = (rows: PreviewRow[]) => ({
    n: rows.filter(r => r.status === "new").length,
    u: rows.filter(r => r.status === "update").length,
    s: rows.filter(r => r.status === "skip").length,
    e: rows.filter(r => r.status === "error").length,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle>导入财务基础资料</DialogTitle></DialogHeader>

        {!preview && (
          <div className="py-6 space-y-3">
            <div className="text-[13px] text-muted-foreground space-y-1">
              <div>请使用【下载模板】生成的 .xlsx，支持 Sheet：经营主体 / 银行账户 / 店铺 / 店铺账户绑定 / 收支分类。</div>
              <div>兼容旧账户明细表 Sheet1（个体户/店铺/银行账户/绑定）与 Sheet2（运营公司/投流账户）。</div>
              <div>解析后会展示新增 / 更新 / 跳过 / 错误预览，点击【确认导入】才会写入数据库。</div>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              className="block w-full text-[13px] file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground" />
            {parsing && <div className="text-[12px] text-muted-foreground">解析中...</div>}
          </div>
        )}

        {preview && (
          <div className="space-y-4">
            {pendingAcctCount > 0 && (
              <div className="border border-amber-300 bg-amber-50 rounded-md p-3 text-[12px] text-amber-800 flex items-center justify-between gap-3">
                <div>检测到 {pendingAcctCount} 个银行账户未确定账户类型（来自旧账户明细表）。请逐行选择，或批量设置。</div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => bulkSetAcctType("corporate")}>全部按对公账户</Button>
                  <Button size="sm" variant="outline" onClick={() => bulkSetAcctType("personal")}>全部按个人账户</Button>
                </div>
              </div>
            )}
            <PreviewSection title="经营主体" rows={preview.entities} stat={stat(preview.entities)} />
            <PreviewSection title="银行账户" rows={preview.banks} stat={stat(preview.banks)} onSetAcctType={setBankAcctType} />
            <PreviewSection title="店铺" rows={preview.shops} stat={stat(preview.shops)} />
            <PreviewSection title="店铺账户绑定" rows={preview.bindings} stat={stat(preview.bindings)} />
            <PreviewSection title="收支分类" rows={preview.categories} stat={stat(preview.categories)} />
            {lastErrors.length > 0 && (
              <div className="border border-rose-200 bg-rose-50 rounded-md p-3 text-[12px] text-rose-700">
                上次提交：{lastErrors.length} 条有失败或跳过。
                <button onClick={() => downloadErrorReport(lastErrors)} className="ml-2 underline">下载错误报告</button>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {preview && (
            <>
              <Button variant="ghost" onClick={() => { setPreview(null); setLastErrors([]); if (fileRef.current) fileRef.current.value = ""; }}>重新选择</Button>
              <Button onClick={commit} disabled={committing || pendingAcctCount > 0}>
                {committing ? "导入中..." : pendingAcctCount > 0 ? `请先确认 ${pendingAcctCount} 行账户类型` : "确认导入"}
              </Button>
            </>
          )}
          {!preview && <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewSection({ title, rows, stat, onSetAcctType }: {
  title: string; rows: PreviewRow[]; stat: { n: number; u: number; s: number; e: number };
  onSetAcctType?: (rowIdx: number, val: "corporate" | "personal") => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="border rounded-md overflow-hidden">
      <div className="px-3 py-2 bg-muted/40 flex items-center justify-between">
        <div className="font-medium text-[13px]">{title} · {rows.length} 行</div>
        <div className="flex gap-3 text-[12px]">
          <span className="text-emerald-600">新增 {stat.n}</span>
          <span className="text-blue-600">更新 {stat.u}</span>
          <span className="text-amber-600">跳过 {stat.s}</span>
          <span className="text-rose-600">错误 {stat.e}</span>
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto">
        <table className="w-full text-[12px]">
          <tbody>
            {rows.slice(0, 200).map((r, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-1.5 w-16 align-top">
                  <span className={`text-[11px] px-1.5 py-0.5 rounded ${
                    r.status === "new" ? "bg-emerald-50 text-emerald-700"
                    : r.status === "update" ? "bg-blue-50 text-blue-700"
                    : r.status === "skip" ? "bg-amber-50 text-amber-700"
                    : "bg-rose-50 text-rose-700"
                  }`}>
                    {r.status === "new" ? "新增" : r.status === "update" ? "更新" : r.status === "skip" ? "跳过" : "错误"}
                  </span>
                </td>
                <td className="px-3 py-1.5 w-28 text-muted-foreground align-top">{r.sheet} · 第 {r.rowNum} 行</td>
                {onSetAcctType && (
                  <td className="px-3 py-1.5 w-36 align-top">
                    {r.status === "error" || r.status === "skip" ? <span className="text-muted-foreground">-</span> : (
                      <select
                        className={`text-[11px] border rounded px-1.5 py-0.5 ${r.needsAccountType ? "border-amber-400 bg-amber-50" : ""}`}
                        value={r.needsAccountType ? "" : (r.data.account_type ?? "")}
                        onChange={(e) => onSetAcctType(i, e.target.value as "corporate" | "personal")}
                      >
                        {r.needsAccountType && <option value="">请选择</option>}
                        <option value="corporate">对公账户</option>
                        <option value="personal">个人账户</option>
                      </select>
                    )}
                  </td>
                )}
                <td className="px-3 py-1.5 align-top text-[11px] text-muted-foreground">{r.message ?? ""}</td>
                <td className="px-3 py-1.5 align-top truncate max-w-md text-[11px]">{JSON.stringify(r.raw)}</td>
              </tr>
            ))}
            {rows.length > 200 && (
              <tr><td colSpan={5} className="px-3 py-2 text-[11px] text-muted-foreground">仅显示前 200 行（共 {rows.length} 行）</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
