import { useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { X, Lightbulb } from "lucide-react";

type Direction = "支出" | "收入" | "内部划拨";

export function NewCashflowDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [dir, setDir] = useState<Direction>("支出");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <DrawerHeader title="单本手工增补资金流水" subtitle="登入财务借贷科目、资金账户以及上传凭证单据用于校对" onClose={() => onOpenChange(false)} />

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <Field label="流水日期" required>
            <Input type="date" defaultValue="2026-05-29" className="h-10" />
          </Field>

          <Field label="财务借贷收支属性" required>
            <div className="grid grid-cols-3 gap-2">
              {(["支出", "收入", "内部划拨"] as Direction[]).map(d => {
                const active = dir === d;
                const tone = d === "支出" ? "rose" : d === "收入" ? "emerald" : "violet";
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDir(d)}
                    className={`h-11 rounded-md border text-[13px] font-medium transition ${
                      active
                        ? tone === "rose" ? "border-rose-300 bg-rose-50 text-rose-700"
                        : tone === "emerald" ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-violet-300 bg-violet-50 text-violet-700"
                        : "border-border bg-white text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {d} {d === "支出" ? "(-)" : d === "收入" ? "(+)" : "(•)"}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="核算资金账户" required>
            <Select options={["-- 选择对应科目账户 --", "公司建设银行", "公司工商银行", "公司支付宝", "公司微信", "现金账户"]} />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="记账金额" required>
              <Input type="number" placeholder="¥ 0.00" className="h-10 font-mono" />
            </Field>
            <Field label="账户科目类别" required>
              <Select options={["-- 科目归档 --", "销售收入", "供应商付款", "工资支出", "广告推广", "办公费用", "物流费用", "退款退回", "账户内部转账"]} />
            </Field>
          </div>

          <Field label="往来交易对象 (户名)">
            <Input placeholder="对方企业（如：盛大织造）、员工姓名、运载货运商等" className="h-10" />
          </Field>

          <Field label="核算业务摘要" required>
            <Textarea rows={3} placeholder="在此录入详尽简要：例「预付某某面料商定金30%、月度快递协议结算」等" />
          </Field>

          <Field label="备注补充细则">
            <Textarea rows={2} placeholder="追加其他核实依据或特殊说明事项（可空）" />
          </Field>

          <label className="flex items-center gap-2 h-11 px-3 rounded-md border border-border text-[12.5px] text-muted-foreground">
            <Checkbox /> 已贴附电子记账发票凭证附件 / 单据底单
          </label>
        </div>

        <DrawerFooter
          left={<Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>}
          right={
            <>
              <Button variant="ghost" className="text-muted-foreground">保存为草稿</Button>
              <Button onClick={() => onOpenChange(false)}>✓ 保存并确认过账</Button>
            </>
          }
        />
      </SheetContent>
    </Sheet>
  );
}

/* ---------- Grid batch drawer ---------- */
type Row = { date: string; account: string; dir: Direction; amount: string; category: string; party: string; summary: string; remark: string; voucher: boolean };
const EMPTY: Row = { date: "2026-05-29", account: "", dir: "支出", amount: "", category: "", party: "", summary: "", remark: "", voucher: false };

export function BatchCashflowDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 5 }, () => ({ ...EMPTY })));

  const update = (i: number, patch: Partial<Row>) =>
    setRows(rs => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows(rs => rs.filter((_, idx) => idx !== i));
  const addRow = () => setRows(rs => [...rs, { ...EMPTY }]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-none p-0 flex flex-col" style={{ width: "min(1480px, 92vw)", maxWidth: "92vw" }}>
        <DrawerHeader title="在线仿 Excel 式批量对账凭证录入" subtitle="支持快速添加或批量移除多重账目。财税系统将一次性过账写入内存以保留审计线索" onClose={() => onOpenChange(false)} />

        {/* Tip strip */}
        <div className="mx-6 mt-4 px-4 py-2.5 rounded-md bg-sky-50 border border-sky-200 text-[12.5px] text-sky-800 flex items-start gap-2">
          <Lightbulb className="w-4 h-4 mt-0.5 shrink-0 text-sky-600" />
          <div>
            <span className="font-semibold">高效率批量小记：</span>
            由于安全机制，本沙盒目前通过电子表单元格交互核算。可点击「添加新行」灵活插入记账记录。
            <span className="font-semibold ml-1">后续上线版本将开放直接粘贴 Excel 列数据自动识别的功能。</span>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr className="text-left">
                  <Th className="w-12 text-center">序号</Th>
                  <Th>发生日期 *</Th>
                  <Th>资金账户 *</Th>
                  <Th>收支方向 *</Th>
                  <Th>交易金额 *</Th>
                  <Th>账目科目分类 *</Th>
                  <Th>往来对象</Th>
                  <Th>核算摘要 *</Th>
                  <Th>备注</Th>
                  <Th className="w-20 text-center">凭证附件</Th>
                  <Th className="w-14 text-center">操作</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-border align-middle">
                    <Td className="text-center text-muted-foreground">{i + 1}</Td>
                    <Td><Input type="date" value={r.date} onChange={e => update(i, { date: e.target.value })} className="h-8" /></Td>
                    <Td>
                      <CellSelect value={r.account} onChange={v => update(i, { account: v })}
                        options={["-- 选择账户 --", "公司建设银行", "公司工商银行", "公司支付宝", "公司微信", "现金账户"]} />
                    </Td>
                    <Td>
                      <CellSelect value={r.dir} onChange={v => update(i, { dir: v as Direction })}
                        options={["支出 (-)", "收入 (+)", "内部划拨 (•)"]} />
                    </Td>
                    <Td><Input type="number" placeholder="¥ 0.00" value={r.amount} onChange={e => update(i, { amount: e.target.value })} className="h-8 font-mono text-right" /></Td>
                    <Td>
                      <CellSelect value={r.category} onChange={v => update(i, { category: v })}
                        options={["-- 选择科目 --", "销售收入", "供应商付款", "工资支出", "广告推广", "办公费用", "物流费用", "退款退回", "账户内部转账"]} />
                    </Td>
                    <Td><Input placeholder="往来对手" value={r.party} onChange={e => update(i, { party: e.target.value })} className="h-8" /></Td>
                    <Td><Input placeholder="主要业务背景描述" value={r.summary} onChange={e => update(i, { summary: e.target.value })} className="h-8" /></Td>
                    <Td><Input placeholder="内部备忘（选填）" value={r.remark} onChange={e => update(i, { remark: e.target.value })} className="h-8" /></Td>
                    <Td className="text-center"><Checkbox checked={r.voucher} onCheckedChange={v => update(i, { voucher: !!v })} /></Td>
                    <Td className="text-center">
                      <button onClick={() => remove(i)} className="text-rose-500 hover:text-rose-700" aria-label="删除行">
                        <X className="w-4 h-4 inline" />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <DrawerFooter
          left={<Button variant="outline" onClick={addRow}>+ 添加空行</Button>}
          right={
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
              <Button variant="outline">保存为草稿记录 (批量)</Button>
              <Button onClick={() => onOpenChange(false)}>✓ 保存并确认过账 (批量)</Button>
            </>
          }
        />
      </SheetContent>
    </Sheet>
  );
}

/* ---------- shared atoms ---------- */
function DrawerHeader({ title, subtitle, onClose }: { title: string; subtitle: string; onClose: () => void }) {
  return (
    <div className="px-6 py-4 border-b border-border flex items-start justify-between gap-4">
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
        <p className="text-[12px] text-muted-foreground mt-1">{subtitle}</p>
      </div>
      <button onClick={onClose} className="w-8 h-8 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground" aria-label="关闭">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function DrawerFooter({ left, right }: { left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="px-6 py-3 border-t border-border bg-muted/30 flex items-center justify-between gap-2">
      <div>{left}</div>
      <div className="flex items-center gap-2">{right}</div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] text-foreground/80 mb-1.5">
        {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function Select({ options }: { options: string[] }) {
  return (
    <select className="h-10 w-full rounded-md border border-border bg-white px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-sky-500/30">
      {options.map(o => <option key={o}>{o}</option>)}
    </select>
  );
}

function CellSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="h-8 w-full rounded border border-border bg-white px-2 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-sky-500/40">
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-2.5 py-2 font-normal text-[11.5px] ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 ${className}`}>{children}</td>;
}
