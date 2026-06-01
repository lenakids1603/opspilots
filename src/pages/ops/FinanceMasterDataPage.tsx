import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { parseAccountWorkbook, downloadTemplate, exportRowsToXlsx, downloadErrorReport, type ImportPreview, type PreviewRow } from "@/lib/financeImport";

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
  const triggerRefresh = () => setRefreshKey(k => k + 1);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">财务基础资料</h1>
          <p className="text-[12px] text-muted-foreground mt-1">维护经营主体、银行账户、店铺、收支分类</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={downloadTemplate}><Download className="w-4 h-4 mr-1.5" />下载模板</Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload className="w-4 h-4 mr-1.5" />导入表格</Button>
        </div>
      </div>

      <Tabs defaultValue="entities">
        <TabsList>
          <TabsTrigger value="entities">经营主体</TabsTrigger>
          <TabsTrigger value="banks">银行账户</TabsTrigger>
          <TabsTrigger value="shops">店铺</TabsTrigger>
          <TabsTrigger value="categories">收支分类</TabsTrigger>
        </TabsList>

        <TabsContent value="entities"><EntitiesTab key={`e${refreshKey}`} /></TabsContent>
        <TabsContent value="banks"><BanksTab key={`b${refreshKey}`} /></TabsContent>
        <TabsContent value="shops"><ShopsTab key={`s${refreshKey}`} /></TabsContent>
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

function BanksTab() {
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [entities, setEntities] = useState<AnyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AnyRow | null>(null);
  const [q, setQ] = useState("");
  const [entFilter, setEntFilter] = useState("");
  const [purposeFilter, setPurposeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useDebouncedReset([q, entFilter, purposeFilter, statusFilter, pageSize], setPage);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: es } = await supabase.from("business_entities").select("id,name,entity_type").is("deleted_at", null).order("name");
    setEntities(es ?? []);
    let qry = supabase.from("bank_accounts").select("*", { count: "exact" }).is("deleted_at", null)
      .order("is_default", { ascending: false })
      .order("status", { ascending: true })
      .order("created_at", { ascending: false });
    const qq = q.trim();
    if (qq) qry = qry.or(`account_name.ilike.%${qq}%,bank_name.ilike.%${qq}%,account_no_masked.ilike.%${qq}%`);
    if (entFilter) qry = qry.eq("entity_id", entFilter);
    if (purposeFilter) qry = qry.eq("purpose", purposeFilter);
    if (statusFilter) qry = qry.eq("status", statusFilter);
    const from = (page - 1) * pageSize;
    const { data, count, error } = await qry.range(from, from + pageSize - 1);
    setLoading(false);
    if (error) { toast({ title: "加载失败", description: error.message, variant: "destructive" }); return; }
    setRows(data ?? []); setTotal(count ?? 0);
  }, [q, entFilter, purposeFilter, statusFilter, page, pageSize]);
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
    const out = (data ?? []).map((r: any) => {
      const e = entityMap.get(r.entity_id);
      return {
        所属主体: e?.name, 主体类型: ENTITY_TYPE_LABEL[e?.entity_type] ?? e?.entity_type,
        开户银行: r.bank_name, 银行账号: r.account_no_masked, 账户用途: r.purpose,
        是否默认: r.is_default ? "是" : "否",
        当前余额: r.current_balance, 状态: r.status === "active" ? "启用" : "停用", 备注: r.remark,
      };
    });
    exportRowsToXlsx(`银行账户_${new Date().toISOString().slice(0, 10)}.xlsx`, "银行账户", out);
    toast({ title: "已导出" });
  };

  const validateDup = async (form: AnyRow, isEdit: boolean, id?: string) => {
    const acc = String(form.account_no_masked || "").replace(/\s+/g, "");
    if (!acc) return null;
    const { data } = await supabase.from("bank_accounts").select("id,account_no_masked").is("deleted_at", null);
    const dup = (data ?? []).find((b: any) =>
      String(b.account_no_masked || "").replace(/\s+/g, "") === acc && (!isEdit || b.id !== id));
    if (dup) return "该银行账号已存在，请勿重复添加";
    return null;
  };

  const fields: FieldDef[] = [
    { key: "entity_id", label: "所属主体", type: "select", required: true, options: entities.map(e => ({ value: e.id, label: e.name })) },
    { key: "account_name", label: "账户名", required: true },
    { key: "bank_name", label: "开户银行" },
    { key: "account_no_masked", label: "银行账号", required: true },
    { key: "purpose", label: "账户用途", type: "select", default: "收款",
      options: ["收款", "付款", "投流", "备用", "其他"].map(v => ({ value: v, label: v })) },
    { key: "account_type", label: "账户类型", type: "select", default: "bank",
      options: [{ value: "bank", label: "银行" }, { value: "alipay", label: "支付宝" }, { value: "wechat", label: "微信" }, { value: "cash", label: "现金" }] },
    { key: "is_default", label: "默认账户", type: "checkbox", hint: "设为该主体的默认收/付款账户" },
    { key: "currency", label: "币种", default: "CNY" },
    { key: "current_balance", label: "当前余额", type: "number", default: 0 },
    { key: "status", label: "状态", type: "select", default: "active",
      options: [{ value: "active", label: "启用" }, { value: "disabled", label: "停用" }] },
    { key: "remark", label: "备注", type: "textarea" },
  ];

  return (
    <Card className="overflow-hidden mt-4">
      <FilterRow>
        <Input placeholder="搜索账户 / 银行 / 账号" value={q} onChange={e => setQ(e.target.value)} className="h-9 w-60" />
        <select value={entFilter} onChange={e => setEntFilter(e.target.value)} className="h-9 rounded-md border px-2 text-[13px] max-w-[180px]">
          <option value="">全部主体</option>{entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={purposeFilter} onChange={e => setPurposeFilter(e.target.value)} className="h-9 rounded-md border px-2 text-[13px]">
          <option value="">全部用途</option>{["收款", "付款", "投流", "备用", "其他"].map(v => <option key={v} value={v}>{v}</option>)}
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
              {["所属主体", "开户银行", "银行账号", "用途", "默认", "余额", "状态", "操作"].map(h => <th key={h} className="px-3 py-2.5 font-normal">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">加载中...</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={8}><EmptyHint msg="暂无银行账户" /></td></tr>}
            {rows.map(r => {
              const e = entityMap.get(r.entity_id);
              return (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2.5"><div className="font-medium">{e?.name || "-"}</div><div className="text-[11px] text-muted-foreground">{ENTITY_TYPE_LABEL[e?.entity_type] ?? ""}</div></td>
                  <td className="px-3 py-2.5">{r.bank_name || "-"}</td>
                  <td className="px-3 py-2.5 font-mono text-[12px]">{r.account_no_masked || "-"}</td>
                  <td className="px-3 py-2.5">{r.purpose || "-"}</td>
                  <td className="px-3 py-2.5">{r.is_default ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">默认</span> : "-"}</td>
                  <td className="px-3 py-2.5">{fmtMoney(Number(r.current_balance ?? 0))}</td>
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

      <EditDrawer open={open} onOpenChange={setOpen} table="bank_accounts" fields={fields}
        initial={editing} title="银行账户" onSaved={load} validateDup={validateDup} />
    </Card>
  );
}

/* ============================== 店铺 ============================== */

function ShopsTab() {
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [entities, setEntities] = useState<AnyRow[]>([]);
  const [platforms, setPlatforms] = useState<AnyRow[]>([]);
  const [banks, setBanks] = useState<AnyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AnyRow | null>(null);
  const [q, setQ] = useState("");
  const [pf, setPf] = useState("");
  const [ent, setEnt] = useState("");
  const [stf, setStf] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useDebouncedReset([q, pf, ent, stf, pageSize], setPage);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: es }, { data: ps }, { data: bs }] = await Promise.all([
      supabase.from("business_entities").select("id,name,entity_type").is("deleted_at", null).order("name"),
      supabase.from("platforms").select("id,name,code").is("deleted_at", null).order("name"),
      supabase.from("bank_accounts").select("id,entity_id,bank_name,account_no_masked").is("deleted_at", null),
    ]);
    setEntities(es ?? []); setPlatforms(ps ?? []); setBanks(bs ?? []);

    let qry = supabase.from("shops").select("*", { count: "exact" }).is("deleted_at", null)
      .order("status", { ascending: true })
      .order("platform_id", { ascending: true })
      .order("name", { ascending: true });
    const qq = q.trim();
    if (qq) qry = qry.or(`name.ilike.%${qq}%,code.ilike.%${qq}%`);
    if (pf) qry = qry.eq("platform_id", pf);
    if (ent) qry = qry.eq("entity_id", ent);
    if (stf) qry = qry.eq("status", stf);
    const from = (page - 1) * pageSize;
    const { data, count, error } = await qry.range(from, from + pageSize - 1);
    setLoading(false);
    if (error) { toast({ title: "加载失败", description: error.message, variant: "destructive" }); return; }
    setRows(data ?? []); setTotal(count ?? 0);
  }, [q, pf, ent, stf, page, pageSize]);
  useEffect(() => { load(); }, [load]);

  const entityMap = useMemo(() => new Map(entities.map(e => [e.id, e])), [entities]);
  const platformMap = useMemo(() => new Map(platforms.map(p => [p.id, p])), [platforms]);
  const bankMap = useMemo(() => new Map(banks.map(b => [b.id, b])), [banks]);

  const toggleStatus = async (r: AnyRow) => {
    const next = r.status === "active" ? "disabled" : "active";
    const { error } = await supabase.from("shops").update({ status: next }).eq("id", r.id);
    if (error) toast({ title: "操作失败", description: error.message, variant: "destructive" });
    else { toast({ title: next === "active" ? "已启用" : "已停用" }); load(); }
  };

  const handleExport = async () => {
    const { data } = await supabase.from("shops").select("*").is("deleted_at", null);
    const out = (data ?? []).map((r: any) => ({
      店铺名称: r.name, 平台: platformMap.get(r.platform_id)?.name, 所属主体: entityMap.get(r.entity_id)?.name,
      默认收款账户: r.default_bank_account_id ? `${bankMap.get(r.default_bank_account_id)?.bank_name ?? ""} ${bankMap.get(r.default_bank_account_id)?.account_no_masked ?? ""}` : "",
      状态: r.status === "active" ? "启用" : "停用", 备注: r.remark,
    }));
    exportRowsToXlsx(`店铺_${new Date().toISOString().slice(0, 10)}.xlsx`, "店铺", out);
    toast({ title: "已导出" });
  };

  const validateDup = async (form: AnyRow, isEdit: boolean, id?: string) => {
    const name = String(form.name || "").trim();
    if (!name || !form.platform_id) return null;
    let q2 = supabase.from("shops").select("id,name").is("deleted_at", null).eq("platform_id", form.platform_id).ilike("name", name);
    if (isEdit && id) q2 = q2.neq("id", id);
    const { data } = await q2.limit(1);
    if (data && data.length) return "该平台下已存在同名店铺";
    return null;
  };

  const [formEntity] = useState<string>("");
  const bankOptions = useMemo(() => {
    const eid = editing?.entity_id ?? formEntity;
    return banks.filter(b => !eid || b.entity_id === eid).map(b => ({
      value: b.id, label: `${b.bank_name ?? ""} ${b.account_no_masked ?? ""}`.trim(),
    }));
  }, [banks, editing, formEntity]);

  const fields: FieldDef[] = [
    { key: "name", label: "店铺名称", required: true },
    { key: "platform_id", label: "平台", type: "select", required: true, options: platforms.map(p => ({ value: p.id, label: p.name })) },
    { key: "entity_id", label: "所属主体", type: "select", required: true, options: entities.map(e => ({ value: e.id, label: e.name })) },
    { key: "code", label: "店铺编码" },
    { key: "external_shop_id", label: "外部店铺 ID" },
    { key: "default_bank_account_id", label: "默认收款银行账户", type: "select", options: bankOptions },
    { key: "status", label: "状态", type: "select", default: "active",
      options: [{ value: "active", label: "运营中" }, { value: "disabled", label: "停用" }] },
    { key: "remark", label: "备注", type: "textarea" },
  ];

  return (
    <Card className="overflow-hidden mt-4">
      <FilterRow>
        <Input placeholder="搜索店铺名" value={q} onChange={e => setQ(e.target.value)} className="h-9 w-60" />
        <select value={pf} onChange={e => setPf(e.target.value)} className="h-9 rounded-md border px-2 text-[13px]">
          <option value="">全部平台</option>{platforms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={ent} onChange={e => setEnt(e.target.value)} className="h-9 rounded-md border px-2 text-[13px] max-w-[180px]">
          <option value="">全部主体</option>{entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={stf} onChange={e => setStf(e.target.value)} className="h-9 rounded-md border px-2 text-[13px]">
          <option value="">全部状态</option><option value="active">运营中</option><option value="disabled">停用</option>
        </select>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-3.5 h-3.5 mr-1" />导出</Button>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="w-4 h-4 mr-1" />新增</Button>
      </FilterRow>

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              {["店铺名称", "平台", "所属主体", "默认收款账户", "状态", "操作"].map(h => <th key={h} className="px-3 py-2.5 font-normal">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">加载中...</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={6}><EmptyHint msg="暂无店铺" /></td></tr>}
            {rows.map(r => {
              const b = r.default_bank_account_id ? bankMap.get(r.default_bank_account_id) : null;
              return (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2.5"><div className="font-medium">{r.name}</div>{r.code && <div className="text-[11px] text-muted-foreground">{r.code}</div>}</td>
                  <td className="px-3 py-2.5">{platformMap.get(r.platform_id)?.name || "-"}</td>
                  <td className="px-3 py-2.5">{entityMap.get(r.entity_id)?.name || "-"}</td>
                  <td className="px-3 py-2.5 text-[12px]">{b ? `${b.bank_name ?? ""} · ${b.account_no_masked ?? ""}` : "-"}</td>
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

      <EditDrawer open={open} onOpenChange={setOpen} table="shops" fields={fields}
        initial={editing} title="店铺" onSaved={load} validateDup={validateDup} />
    </Card>
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
      const [ents, bks, shs, pls, cats] = await Promise.all([
        fetchAll("business_entities", "id,name,code,legal_person,entity_type"),
        fetchAll("bank_accounts", "id,entity_id,account_no_masked,bank_name"),
        fetchAll("shops", "id,name,platform_id,entity_id"),
        fetchAll("platforms", "id,name,code"),
        fetchAll("cash_tx_categories", "id,direction,name"),
      ]);
      const buf = await file.arrayBuffer();
      const p = parseAccountWorkbook(buf, {
        entities: ents as any, banks: bks as any, shops: shs as any, platforms: pls as any, categories: cats as any,
      });
      const total = p.entities.length + p.banks.length + p.shops.length + p.categories.length;
      if (total === 0) {
        toast({ title: "未识别到任何数据", description: "请检查 Sheet 名是否为：经营主体 / 银行账户 / 店铺 / 收支分类", variant: "destructive" });
      }
      setPreview(p);
    } catch (e: any) {
      toast({ title: "解析失败", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setCommitting(true);
    const errors: ImportError[] = [];
    let nCount = 0, uCount = 0, sCount = 0;

    const pushErr = (r: PreviewRow, msg: string, result = "失败") =>
      errors.push({ sheet: r.sheet, rowNum: r.rowNum, message: msg, raw: r.raw, result });

    try {
      const processRows = async (
        rows: PreviewRow[],
        table: string,
        transform: (data: any) => any,
      ) => {
        for (const r of rows) {
          if (r.status === "error") { pushErr(r, r.message ?? "解析错误"); continue; }
          if (r.status === "skip") { sCount++; pushErr(r, r.message ?? "已跳过", "跳过"); continue; }
          const payload = transform(r.data);
          if (payload === null) continue; // skipped due to unresolved fk
          const { __id, ...body } = payload;
          const res = r.status === "update"
            ? await supabase.from(table as any).update(body).eq("id", __id)
            : await supabase.from(table as any).insert(body);
          if (res.error) {
            const msg = res.error.message.includes("duplicate key")
              ? "数据库已存在同样的记录（被唯一约束拦截）" : res.error.message;
            pushErr(r, `${r.status === "update" ? "更新" : "新增"}失败: ${msg}`);
          } else {
            if (r.status === "update") uCount++; else nCount++;
          }
        }
      };

      // 1) entities
      await processRows(preview.entities, "business_entities", (d: any) => d);

      // refetch entities/banks for FK resolution
      const { data: allEnts } = await supabase.from("business_entities").select("id,name").is("deleted_at", null);
      const entIdByName = new Map<string, string>((allEnts ?? []).map((e: any) => [String(e.name).trim().toLowerCase(), e.id]));

      // 2) banks
      await processRows(preview.banks, "bank_accounts", (d: any) => {
        const { entityName, ...rest } = d;
        const eid = entIdByName.get(String(entityName).trim().toLowerCase());
        if (!eid) { return null; }
        return { ...rest, entity_id: eid, __id: d.__id };
      });
      // log fk-fail rows
      preview.banks.forEach(r => {
        if (r.status === "new" || r.status === "update") {
          const eid = entIdByName.get(String(r.data.entityName).trim().toLowerCase());
          if (!eid) pushErr(r, `经营主体【${r.data.entityName}】未找到`);
        }
      });

      const { data: allBanks } = await supabase.from("bank_accounts").select("id,account_no_masked").is("deleted_at", null);
      const bankIdByAcc = new Map<string, string>();
      (allBanks ?? []).forEach((b: any) => { if (b.account_no_masked) bankIdByAcc.set(String(b.account_no_masked).replace(/\s+/g, ""), b.id); });

      // 3) shops
      await processRows(preview.shops, "shops", (d: any) => {
        const { entityName, platformName, defaultAccountNo, ...rest } = d;
        const eid = entIdByName.get(String(entityName).trim().toLowerCase());
        if (!eid) return null;
        const default_bank_account_id = defaultAccountNo ? bankIdByAcc.get(String(defaultAccountNo).replace(/\s+/g, "")) ?? null : null;
        return { ...rest, entity_id: eid, default_bank_account_id, __id: d.__id };
      });

      // 4) categories
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
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>导入财务基础资料</DialogTitle></DialogHeader>

        {!preview && (
          <div className="py-6 space-y-3">
            <div className="text-[13px] text-muted-foreground space-y-1">
              <div>请使用【下载模板】生成的 .xlsx 文件，包含 Sheet：经营主体 / 银行账户 / 店铺 / 收支分类。</div>
              <div>导入会自动识别已有数据并去重：相同主体名称+类型 / 银行账号 / 平台+店铺名 / 方向+分类名 视为同一条。</div>
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
            <PreviewSection title="经营主体" rows={preview.entities} stat={stat(preview.entities)} />
            <PreviewSection title="银行账户" rows={preview.banks} stat={stat(preview.banks)} />
            <PreviewSection title="店铺" rows={preview.shops} stat={stat(preview.shops)} />
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
              <Button onClick={commit} disabled={committing}>{committing ? "导入中..." : "确认导入"}</Button>
            </>
          )}
          {!preview && <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewSection({ title, rows, stat }: { title: string; rows: PreviewRow[]; stat: { n: number; u: number; s: number; e: number } }) {
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
      <div className="max-h-56 overflow-y-auto">
        <table className="w-full text-[12px]">
          <tbody>
            {rows.slice(0, 100).map((r, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-1.5 w-20 align-top">
                  <span className={`text-[11px] px-1.5 py-0.5 rounded ${
                    r.status === "new" ? "bg-emerald-50 text-emerald-700"
                    : r.status === "update" ? "bg-blue-50 text-blue-700"
                    : r.status === "skip" ? "bg-amber-50 text-amber-700"
                    : "bg-rose-50 text-rose-700"
                  }`}>
                    {r.status === "new" ? "新增" : r.status === "update" ? "更新" : r.status === "skip" ? "跳过" : "错误"}
                  </span>
                </td>
                <td className="px-3 py-1.5 w-32 text-muted-foreground align-top">{r.sheet} · 第 {r.rowNum} 行</td>
                <td className="px-3 py-1.5 align-top text-[11px] text-muted-foreground">{r.message ?? ""}</td>
                <td className="px-3 py-1.5 align-top truncate max-w-md text-[11px]">{JSON.stringify(r.raw)}</td>
              </tr>
            ))}
            {rows.length > 100 && (
              <tr><td colSpan={4} className="px-3 py-2 text-[11px] text-muted-foreground">仅显示前 100 行（共 {rows.length} 行）</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
