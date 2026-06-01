import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Upload, FileText, Sparkles, Loader2, RefreshCw, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
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

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"];

type ParseStatus = "idle" | "uploading" | "parsing" | "success" | "failed";

interface AiResultData {
  transaction_direction: string;
  occurred_date: string | null;
  amount: number | null;
  counterparty_name: string | null;
  counterparty_account: string | null;
  counterparty_bank: string | null;
  transaction_serial_no: string | null;
  bank_transaction_time: string | null;
  memo: string | null;
  raw_text: string | null;
}

interface AiResult {
  data: AiResultData;
  match_result: {
    business_entity_id: string | null;
    bank_account_id: string | null;
    supplier_id: string | null;
    category_id: string | null;
  };
  confidence: Record<string, number>;
  warnings: string[];
  duplicates: Array<{ id: string; tx_no: string | null; amount: number; occurred_at: string; summary: string | null; counterparty: string | null }>;
}

function dirToDb(d: string): CashDirection {
  if (d === "expense") return "out";
  if (d === "income") return "in";
  if (d === "internal_transfer") return "transfer";
  return "out";
}

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
  const [counterpartyAccount, setCounterpartyAccount] = useState("");
  const [counterpartyBank, setCounterpartyBank] = useState("");
  const [serialNo, setSerialNo] = useState("");
  const [summary, setSummary] = useState("");
  const [remark, setRemark] = useState("");
  const [attachmentPath, setAttachmentPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // AI receipt state
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<{ name: string; type: string; size: number } | null>(null);
  const [parseStatus, setParseStatus] = useState<ParseStatus>("idle");
  const [parseError, setParseError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [pendingDataUrl, setPendingDataUrl] = useState<string | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const resetReceipt = useCallback(() => {
    setFilePreviewUrl(null);
    setFileMeta(null);
    setParseStatus("idle");
    setParseError(null);
    setAiResult(null);
    setPendingDataUrl(null);
  }, []);

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
      setCounterpartyAccount((initial as any).counterparty_account ?? "");
      setCounterpartyBank((initial as any).counterparty_bank ?? "");
      setSerialNo((initial as any).transaction_serial_no ?? "");
      setSummary(initial.summary ?? "");
      setRemark(initial.remark ?? "");
      setAttachmentPath(initial.attachment_path);
    } else {
      setDir("out"); setEntityId(entities[0]?.id ?? ""); setBankId("");
      setAmount(""); setOccurredAt(new Date().toISOString().slice(0, 10));
      setCategoryId(""); setShopId(""); setSupplierId("");
      setCounterparty(""); setCounterpartyAccount(""); setCounterpartyBank("");
      setSerialNo(""); setSummary(""); setRemark(""); setAttachmentPath(null);
    }
    resetReceipt();
  }, [open, initial, entities, resetReceipt]);

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

  // ===== Receipt handling =====
  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });

  const applyAiResult = (r: AiResult) => {
    const d = r.data;
    const newDir = dirToDb(d.transaction_direction);
    setDir(newDir);
    if (d.occurred_date) setOccurredAt(d.occurred_date);
    if (d.amount != null) setAmount(String(d.amount));
    if (r.match_result.business_entity_id) setEntityId(r.match_result.business_entity_id);
    if (r.match_result.bank_account_id) setBankId(r.match_result.bank_account_id);
    if (r.match_result.category_id) setCategoryId(r.match_result.category_id);
    if (r.match_result.supplier_id) setSupplierId(r.match_result.supplier_id);
    if (d.counterparty_name) setCounterparty(d.counterparty_name);
    if (d.counterparty_account) setCounterpartyAccount(d.counterparty_account);
    if (d.counterparty_bank) setCounterpartyBank(d.counterparty_bank);
    if (d.transaction_serial_no) setSerialNo(d.transaction_serial_no);
    if (d.memo) setSummary(d.memo);
    if (d.raw_text) setRemark(prev => prev || `识别原文：\n${d.raw_text}`);
  };

  const runRecognition = async (dataUrl: string) => {
    setParseStatus("parsing");
    setParseError(null);
    setAiResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("parse-bank-receipt", {
        body: { image_data_url: dataUrl },
      });
      if (error) throw new Error(error.message || "调用识别服务失败");
      if (!data?.success) throw new Error(data?.error || "识别失败");
      const result = data as AiResult;
      setAiResult(result);
      applyAiResult(result);
      setParseStatus("success");
      toast({ title: "识别完成", description: "请核对识别结果后保存" });
    } catch (e: any) {
      setParseStatus("failed");
      setParseError(e.message || "识别失败");
      toast({ title: "识别失败", description: e.message, variant: "destructive" });
    }
  };

  const handleFile = async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast({ title: "不支持的文件类型", description: "请上传 png/jpg/webp/pdf", variant: "destructive" });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast({ title: "文件过大", description: "请控制在 10MB 以内", variant: "destructive" });
      return;
    }
    setFileMeta({ name: file.name, type: file.type, size: file.size });

    // Upload to storage in parallel with AI parsing
    setParseStatus("uploading");
    try {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `cash-transactions/${yyyy}/${mm}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("cash-tx-attachments").upload(path, file);
      if (upErr) throw upErr;
      setAttachmentPath(path);
    } catch (e: any) {
      toast({ title: "凭证上传失败", description: e.message, variant: "destructive" });
      setParseStatus("idle");
      return;
    }

    const dataUrl = await fileToDataUrl(file);
    setFilePreviewUrl(dataUrl);
    setPendingDataUrl(dataUrl);

    if (file.type === "application/pdf") {
      setParseStatus("failed");
      setParseError("当前版本暂不支持 PDF 自动识别，请截图后上传。凭证文件已保存。");
      return;
    }

    await runRecognition(dataUrl);
  };

  // Paste handler
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of Array.from(items)) {
        if (it.kind === "file") {
          const f = it.getAsFile();
          if (f) { handleFile(f); break; }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const handleSave = async () => {
    if (!entityId || !bankId || !amount || !summary) {
      toast({ title: "请填写主体、银行账户、金额、摘要", variant: "destructive" });
      return;
    }

    // Duplicate check at save time
    if (!initial) {
      let dupQ = supabase.from("cash_transactions").select("id,tx_no,occurred_at,amount,summary").is("deleted_at", null).limit(3);
      if (serialNo.trim()) {
        dupQ = dupQ.eq("transaction_serial_no", serialNo.trim());
      } else {
        const day = occurredAt;
        dupQ = dupQ
          .eq("amount", Number(amount))
          .eq("bank_account_id", bankId)
          .gte("occurred_at", new Date(day + "T00:00:00").toISOString())
          .lte("occurred_at", new Date(day + "T23:59:59").toISOString());
      }
      const { data: dups } = await dupQ;
      if (dups && dups.length > 0) {
        const list = dups.map((d: any) => `· ${d.occurred_at?.slice(0,10)} ¥${d.amount} ${d.summary ?? ""}`).join("\n");
        if (!confirm(`系统检测到 ${dups.length} 条疑似重复流水：\n${list}\n\n是否继续保存？`)) return;
      }
    }

    setSaving(true);
    const payload: any = {
      entity_id: entityId,
      bank_account_id: bankId,
      direction: dir,
      amount: Number(amount),
      occurred_at: new Date(occurredAt).toISOString(),
      category_id: categoryId || null,
      shop_id: shopId || null,
      supplier_id: supplierId || null,
      counterparty: counterparty || null,
      counterparty_account: counterpartyAccount || null,
      counterparty_bank: counterpartyBank || null,
      transaction_serial_no: serialNo.trim() || null,
      summary,
      remark: remark || null,
      attachment_path: attachmentPath,
      status: "confirmed",
    };
    if (aiResult) {
      payload.receipt_raw_text = aiResult.data.raw_text ?? null;
      payload.receipt_parsed_json = aiResult.data;
      payload.receipt_ai_confidence = aiResult.confidence;
      payload.ai_matched = true;
      payload.ai_match_warnings = aiResult.warnings;
    }
    const res = initial
      ? await supabase.from("cash_transactions").update(payload).eq("id", initial.id)
      : await supabase.from("cash_transactions").insert(payload);
    setSaving(false);
    if (res.error) {
      const msg = res.error.message.includes("cash_transactions_serial_no_uidx")
        ? "该银行流水号已存在，疑似重复登记"
        : res.error.message;
      toast({ title: "保存失败", description: msg, variant: "destructive" });
      return;
    }
    toast({ title: initial ? "已更新" : "已新增" });
    onSaved();
    onOpenChange(false);
  };

  const lowConfFields = aiResult
    ? Object.entries(aiResult.confidence).filter(([, v]) => v > 0 && v < 0.85).map(([k]) => k)
    : [];

  const accountLabel = (a: BankAccount) => `${a.account_name}${a.bank_name ? " · " + a.bank_name : ""}${a.account_no_masked ? " (" + a.account_no_masked.slice(-4) + ")" : ""}`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
        <div className="px-6 py-4 border-b flex items-start justify-between">
          <div>
            <h2 className="text-[15px] font-semibold">{initial ? "编辑资金流水" : "登记资金流水"}</h2>
            <p className="text-[12px] text-muted-foreground mt-1">收入 / 支出 / 内部转账 · 支持 AI 识别银行回单</p>
          </div>
          <button onClick={() => onOpenChange(false)} className="w-8 h-8 rounded-md hover:bg-muted flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* AI Receipt Section */}
          <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-sky-600" />
              <div className="text-[13px] font-semibold text-sky-900">智能识别银行回单</div>
            </div>
            <p className="text-[11.5px] text-sky-800/80 mb-3">
              粘贴银行回单截图（Ctrl/Cmd+V）、拖拽图片/PDF 到下方，或点击选择文件。系统会自动识别金额、日期、账户、对方信息并回填表单。
            </p>

            {!filePreviewUrl && parseStatus === "idle" && (
              <div
                ref={dropRef}
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                className="border-2 border-dashed border-sky-300 rounded-md py-6 px-4 flex flex-col items-center justify-center gap-2 hover:bg-sky-100/40 transition"
              >
                <Upload className="w-5 h-5 text-sky-600" />
                <div className="text-[12.5px] text-sky-900">拖拽文件到这里，或点击选择</div>
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-sky-400 bg-white text-[12.5px] text-sky-700 hover:bg-sky-50">
                  选择文件
                  <input type="file" className="hidden" accept=".png,.jpg,.jpeg,.webp,.pdf,image/*,application/pdf"
                    onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
                </label>
                <div className="text-[10.5px] text-sky-700/60">支持 png/jpg/webp/pdf · 最大 10MB</div>
              </div>
            )}

            {(filePreviewUrl || parseStatus !== "idle") && (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-24 h-24 rounded-md overflow-hidden bg-white border flex items-center justify-center flex-shrink-0">
                    {filePreviewUrl && fileMeta?.type !== "application/pdf" ? (
                      <img src={filePreviewUrl} alt="回单预览" className="w-full h-full object-cover" />
                    ) : (
                      <FileText className="w-8 h-8 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium truncate">{fileMeta?.name ?? "凭证文件"}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {fileMeta ? `${(fileMeta.size / 1024).toFixed(1)} KB` : ""}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      {parseStatus === "uploading" && (
                        <span className="inline-flex items-center gap-1 text-[11.5px] text-sky-700">
                          <Loader2 className="w-3 h-3 animate-spin" /> 正在上传凭证...
                        </span>
                      )}
                      {parseStatus === "parsing" && (
                        <span className="inline-flex items-center gap-1 text-[11.5px] text-sky-700">
                          <Loader2 className="w-3 h-3 animate-spin" /> AI 正在识别回单...
                        </span>
                      )}
                      {parseStatus === "success" && (
                        <span className="inline-flex items-center gap-1 text-[11.5px] text-emerald-700">
                          <CheckCircle2 className="w-3 h-3" /> 识别完成，请核对
                        </span>
                      )}
                      {parseStatus === "failed" && (
                        <span className="inline-flex items-center gap-1 text-[11.5px] text-rose-700">
                          <AlertTriangle className="w-3 h-3" /> {parseError || "识别失败"}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      {pendingDataUrl && parseStatus !== "parsing" && parseStatus !== "uploading" && (
                        <button type="button" onClick={() => runRecognition(pendingDataUrl)}
                          className="inline-flex items-center gap-1 text-[11.5px] text-sky-700 hover:underline">
                          <RefreshCw className="w-3 h-3" /> 重新识别
                        </button>
                      )}
                      <button type="button" onClick={resetReceipt}
                        className="inline-flex items-center gap-1 text-[11.5px] text-rose-600 hover:underline">
                        <Trash2 className="w-3 h-3" /> 清除凭证
                      </button>
                    </div>
                  </div>
                </div>

                {aiResult && parseStatus === "success" && (
                  <div className="rounded-md border border-sky-200 bg-white p-3 space-y-1.5 text-[12px]">
                    <div className="font-semibold text-sky-900 mb-1">识别结果摘要</div>
                    <div>方向：<b>{aiResult.data.transaction_direction === "expense" ? "支出" : aiResult.data.transaction_direction === "income" ? "收入" : aiResult.data.transaction_direction === "internal_transfer" ? "内部转账" : "未知"}</b></div>
                    <div>金额：<b className="font-mono">{aiResult.data.amount != null ? `¥${aiResult.data.amount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}` : "—"}</b></div>
                    <div>日期：{aiResult.data.occurred_date ?? "—"}</div>
                    <div>对方户名：{aiResult.data.counterparty_name ?? "—"}</div>
                    <div>对方账号：{aiResult.data.counterparty_account ?? "—"}</div>
                    <div>银行流水号：{aiResult.data.transaction_serial_no ?? "—"}</div>
                    {lowConfFields.length > 0 && (
                      <div className="mt-2 px-2 py-1.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[11.5px]">
                        ⚠ 以下字段置信度较低，请人工确认：{lowConfFields.join("、")}
                      </div>
                    )}
                    {aiResult.warnings.length > 0 && (
                      <ul className="mt-2 space-y-0.5">
                        {aiResult.warnings.map((w, i) => (
                          <li key={i} className="text-[11.5px] text-amber-700">⚠ {w}</li>
                        ))}
                      </ul>
                    )}
                    {aiResult.duplicates.length > 0 && (
                      <div className="mt-2 px-2 py-1.5 rounded bg-rose-50 border border-rose-200 text-rose-800 text-[11.5px]">
                        ⚠ 检测到 {aiResult.duplicates.length} 条疑似重复流水（保存时将再次提醒）
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

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
                ...filteredAccounts.map(a => ({ value: a.id, label: accountLabel(a) }))]} />
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

          <div className="grid grid-cols-2 gap-3">
            <Field label="对方户名 / 交易对象">
              <Input value={counterparty} onChange={e => setCounterparty(e.target.value)}
                placeholder="对方公司 / 员工 / 平台" className="h-10" />
            </Field>
            <Field label="对方账号">
              <Input value={counterpartyAccount} onChange={e => setCounterpartyAccount(e.target.value)}
                placeholder="选填" className="h-10 font-mono text-[12.5px]" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="对方开户行">
              <Input value={counterpartyBank} onChange={e => setCounterpartyBank(e.target.value)}
                placeholder="选填" className="h-10" />
            </Field>
            <Field label="银行流水号">
              <Input value={serialNo} onChange={e => setSerialNo(e.target.value)}
                placeholder="用于防重" className="h-10 font-mono text-[12.5px]" />
            </Field>
          </div>

          <Field label="摘要 *">
            <Textarea rows={2} value={summary} onChange={e => setSummary(e.target.value)} placeholder="本次资金往来用途简述" />
          </Field>

          <Field label="备注">
            <Textarea rows={2} value={remark} onChange={e => setRemark(e.target.value)} placeholder="选填" />
          </Field>

          {attachmentPath && (
            <div className="flex items-center gap-1.5 text-[12px] text-sky-700">
              <FileText className="w-3.5 h-3.5" />
              <span className="truncate max-w-[300px]">凭证：{attachmentPath}</span>
              <button type="button" onClick={() => setAttachmentPath(null)} className="text-rose-500">移除</button>
            </div>
          )}
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
