import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Upload, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type {
  BankAccount, BusinessEntity, CashTransaction, CashTxCategory,
  CashDirection, Shop,
} from "@/lib/finance";

type SupplierLite = { id: string; name: string };

export type CashflowDrawerProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: CashTransaction | null;
  entities: BusinessEntity[];
  accounts: BankAccount[];
  categories: CashTxCategory[];
  shops: Shop[];
  suppliers: SupplierLite[];
  onSaved: () => void;
};

const directions: { v: CashDirection; label: string; tone: string }[] = [
  { v: "out", label: "支出 (-)", tone: "border-rose-300 bg-rose-50 text-rose-700" },
  { v: "in", label: "收入 (+)", tone: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  { v: "transfer", label: "内部转账", tone: "border-violet-300 bg-violet-50 text-violet-700" },
];

export function CashflowDrawer({
  open, onOpenChange, initial, entities, accounts, categories, shops, suppliers, onSaved,
}: CashflowDrawerProps) {
  const [dir, setDir] = useState<CashDirection>("out");
  const [entityId, setEntityId] = useState<string>("");
  const [bankId, setBankId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [occurredAt, setOccurredAt] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState<string>("");
  const [shopId, setShopId] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [counterparty, setCounterparty] = useState("");
  const [summary, setSummary] = useState("");
  const [remark, setRemark] = useState("");
  const [attachmentPath, setAttachmentPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setDir(initial.direction);
      setEntityId(initial.entity_id);
      setBankId(initial.bank_account_id);
      setAmount(String(initial.amount));
      setOccurredAt(initial.occurred_at.slice(0, 10));
      setCategoryId(initial.category_id ?? "");
      setShopId(initial.shop_id ?? "");
      setSupplierId(initial.supplier_id ?? "");
      setCounterparty(initial.counterparty ?? "");
      setSummary(initial.summary ?? "");
      setRemark(initial.remark ?? "");
      setAttachmentPath(initial.attachment_path);
    } else {
      setDir("out"); setEntityId(entities[0]?.id ?? ""); setBankId("");
      setAmount(""); setOccurredAt(new Date().toISOString().slice(0, 10));
      setCategoryId(""); setShopId(""); setSupplierId("");
      setCounterparty(""); setSummary(""); setRemark(""); setAttachmentPath(null);
    }
  }, [open, initial, entities]);

  const filteredAccounts = useMemo(
    () => accounts.filter(a => !entityId || a.entity_id === entityId),
    [accounts, entityId],
  );
  const filteredCategories = useMemo(
    () => categories.filter(c => c.direction === dir),
    [categories, dir],
  );
  const filteredShops = useMemo(
    () => shops.filter(s => !entityId || s.entity_id === entityId),
    [shops, entityId],
  );

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("cash-tx-attachments").upload(path, file);
      if (error) throw error;
      setAttachmentPath(path);
      toast({ title: "凭证已上传" });
    } catch (e: any) {
      toast({ title: "上传失败", description: e.message, variant: "destructive" });
    } finally { setUploading(false); }
  };

  const handleSave = async () => {
    if (!entityId || !bankId || !amount || !summary) {
      toast({ title: "请填写主体、银行账户、金额、摘要", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      entity_id: entityId,
      bank_account_id: bankId,
      direction: dir,
      amount: Number(amount),
      occurred_at: new Date(occurredAt).toISOString(),
      category_id: categoryId || null,
      shop_id: shopId || null,
      supplier_id: supplierId || null,
      counterparty: counterparty || null,
      summary,
      remark: remark || null,
      attachment_path: attachmentPath,
      status: "confirmed",
    };
    const res = initial
      ? await supabase.from("cash_transactions").update(payload).eq("id", initial.id)
      : await supabase.from("cash_transactions").insert(payload);
    setSaving(false);
    if (res.error) {
      toast({ title: "保存失败", description: res.error.message, variant: "destructive" });
      return;
    }
    toast({ title: initial ? "已更新" : "已新增" });
    onSaved();
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <div className="px-6 py-4 border-b flex items-start justify-between">
          <div>
            <h2 className="text-[15px] font-semibold">{initial ? "编辑资金流水" : "登记资金流水"}</h2>
            <p className="text-[12px] text-muted-foreground mt-1">收入 / 支出 / 内部转账</p>
          </div>
          <button onClick={() => onOpenChange(false)} className="w-8 h-8 rounded-md hover:bg-muted flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <Field label="收支方向 *">
            <div className="grid grid-cols-3 gap-2">
              {directions.map(d => (
                <button key={d.v} type="button" onClick={() => { setDir(d.v); setCategoryId(""); }}
                  className={`h-10 rounded-md border text-[13px] font-medium transition ${
                    dir === d.v ? d.tone : "border-border bg-white text-muted-foreground hover:bg-muted"
                  }`}>
                  {d.label}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="发生日期 *">
              <Input type="date" value={occurredAt} onChange={e => setOccurredAt(e.target.value)} className="h-10" />
            </Field>
            <Field label="金额 *">
              <Input type="number" step="0.01" placeholder="0.00" value={amount}
                onChange={e => setAmount(e.target.value)} className="h-10 font-mono" />
            </Field>
          </div>

          <Field label="经营主体 *">
            <Select value={entityId} onChange={v => { setEntityId(v); setBankId(""); setShopId(""); }}
              options={[{ value: "", label: "-- 选择主体 --" },
                ...entities.map(e => ({ value: e.id, label: e.name }))]} />
          </Field>

          <Field label="银行 / 资金账户 *">
            <Select value={bankId} onChange={setBankId}
              options={[{ value: "", label: "-- 选择账户 --" },
                ...filteredAccounts.map(a => ({ value: a.id, label: `${a.account_name}${a.bank_name ? " · " + a.bank_name : ""}` }))]} />
          </Field>

          <Field label="收支分类">
            <Select value={categoryId} onChange={setCategoryId}
              options={[{ value: "", label: "-- 未分类 --" },
                ...filteredCategories.map(c => ({ value: c.id, label: c.name }))]} />
          </Field>

          {dir === "in" && (
            <Field label="关联店铺">
              <Select value={shopId} onChange={setShopId}
                options={[{ value: "", label: "-- 无 --" },
                  ...filteredShops.map(s => ({ value: s.id, label: s.name }))]} />
            </Field>
          )}

          {dir === "out" && (
            <Field label="关联供应商">
              <Select value={supplierId} onChange={setSupplierId}
                options={[{ value: "", label: "-- 无 --" },
                  ...suppliers.map(s => ({ value: s.id, label: s.name }))]} />
            </Field>
          )}

          <Field label="对方户名 / 交易对象">
            <Input value={counterparty} onChange={e => setCounterparty(e.target.value)}
              placeholder="对方公司 / 员工 / 平台" className="h-10" />
          </Field>

          <Field label="摘要 *">
            <Textarea rows={2} value={summary} onChange={e => setSummary(e.target.value)} placeholder="本次资金往来用途简述" />
          </Field>

          <Field label="备注">
            <Textarea rows={2} value={remark} onChange={e => setRemark(e.target.value)} placeholder="选填" />
          </Field>

          <Field label="凭证附件">
            <div className="flex items-center gap-2">
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-border bg-white text-[12.5px] hover:bg-muted">
                <Upload className="w-3.5 h-3.5" />
                {uploading ? "上传中..." : "上传凭证"}
                <input type="file" className="hidden" disabled={uploading}
                  onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} />
              </label>
              {attachmentPath && (
                <div className="flex items-center gap-1.5 text-[12px] text-sky-700">
                  <FileText className="w-3.5 h-3.5" />
                  <span className="truncate max-w-[180px]">{attachmentPath}</span>
                  <button type="button" onClick={() => setAttachmentPath(null)} className="text-rose-500">移除</button>
                </div>
              )}
            </div>
          </Field>
        </div>

        <div className="px-6 py-3 border-t bg-muted/30 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "保存中..." : "保存"}</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] text-foreground/80 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="h-10 w-full rounded-md border border-border bg-white px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-sky-500/30">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
