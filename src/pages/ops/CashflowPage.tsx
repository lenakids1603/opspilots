import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Plus, Grid3x3, FileSpreadsheet, FileDown, Search, RotateCcw,
  Filter, Eye, Pencil, Lock, Trash2, Paperclip, TrendingUp, TrendingDown,
  ChevronLeft, ChevronRight, Building2, ChevronDown, Activity, Wallet,
} from "lucide-react";
import { NewCashflowDrawer, BatchCashflowDrawer } from "@/components/ops/CashflowDrawers";

/* ---------- data ---------- */
type Row = {
  date: string;
  account: string;
  direction: "支出" | "收入" | "内部转账";
  amount: number;
  category: string;
  party: string;
  summary: string;
  hasAttach?: boolean;
  status: "已归档锁定" | "已确认" | "草稿" | "异常";
  operator: string;
};

const ROWS: Row[] = [
  { date: "2026-05-23", account: "公司建设银行", direction: "支出", amount: -18500, category: "供应商付款", party: "盛大商科织造厂", summary: "给盛大预付2026早秋弹力梭织面料款", hasAttach: true, status: "已归档锁定", operator: "陈瑞园" },
  { date: "2026-05-22", account: "公司支付宝", direction: "收入", amount: 128450, category: "销售收入", party: "天猫基础流结算", summary: "5月21日天猫直营店货款结算自动归集", status: "已确认", operator: "财务结算系统" },
  { date: "2026-05-21", account: "公司工商银行", direction: "支出", amount: -12000, category: "工资支出", party: "技术研发组李明等5人", summary: "发放2026年4月份外流技术顾问研发包资", hasAttach: true, status: "已确认", operator: "李泽宁" },
  { date: "2026-05-21", account: "公司微信", direction: "收入", amount: 1250, category: "退款退回", party: "顺丰速运物流公司", summary: "4月份超量退款退赔费用结算回账", status: "已确认", operator: "王海玲" },
  { date: "2026-05-20", account: "公司微信", direction: "支出", amount: -450, category: "办公费用", party: "京东自营办公耗材", summary: "采购办公室A4复印纸与晨光考试性签备件", status: "草稿", operator: "黄琼" },
  { date: "2026-05-19", account: "公司支付宝", direction: "支出", amount: -8000, category: "广告推广", party: "宁节晓动千川广告", summary: "抖音巨量盘鞋千川引流知视频推广充值", hasAttach: true, status: "异常", operator: "赵丹妮" },
  { date: "2026-05-18", account: "现金账户", direction: "内部转账", amount: 5000, category: "账户内部转账", party: "日常综合行政备用金", summary: "从工商银行提取备用金至办公室现钞提管箱", hasAttach: true, status: "已确认", operator: "丁海玲" },
  { date: "2026-05-18", account: "公司建设银行", direction: "支出", amount: -32000, category: "物流费用", party: "极兔速递集团", summary: "2026年4月份江浙沪华中区运费回结算", hasAttach: true, status: "已归档锁定", operator: "陈瑞园" },
];

const STATUS_STYLE: Record<Row["status"], string> = {
  "已归档锁定": "bg-sky-50 text-sky-700 border-sky-200",
  "已确认": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "草稿": "bg-slate-100 text-slate-600 border-slate-200",
  "异常": "bg-rose-50 text-rose-700 border-rose-200",
};

const DIR_STYLE: Record<Row["direction"], string> = {
  "支出": "text-rose-600",
  "收入": "text-emerald-600",
  "内部转账": "text-violet-600",
};

const fmt = (n: number) => (n < 0 ? "-" : "") + "¥" + Math.abs(n).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---------- page ---------- */
export default function CashflowPage() {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const allChecked = selected.size === ROWS.length;
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(ROWS.map((_, i) => i)));
  const toggleOne = (i: number) => {
    const next = new Set(selected);
    next.has(i) ? next.delete(i) : next.add(i);
    setSelected(next);
  };

  const totalIn = ROWS.filter(r => r.amount > 0 && r.direction !== "内部转账").reduce((s, r) => s + r.amount, 0);
  const totalOut = ROWS.filter(r => r.amount < 0).reduce((s, r) => s + r.amount, 0);
  const net = totalIn + totalOut;

  const [newOpen, setNewOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);



  return (
    <div className="space-y-5">
      {/* Top header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-ops-navy/5 text-ops-navy flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">公司资金流水对账系统</h1>
            <p className="text-[12px] text-muted-foreground mt-1">
              精细化核算及记录公司银行卡、支付宝、微信以及现钞等全渠道账户核销结算明细，提供批量过账审计支持。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="gap-1.5" onClick={() => setNewOpen(true)}><Plus className="w-4 h-4" />登记新流水</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setBatchOpen(true)}><Grid3x3 className="w-4 h-4" />网格式批量录入</Button>
          <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"><FileSpreadsheet className="w-4 h-4" />导入账单表格</Button>
          <Button size="sm" variant="outline" className="gap-1.5"><FileDown className="w-4 h-4" />审计导出</Button>
        </div>
      </div>

      {/* Filter card */}
      <Card className="p-5 border border-border bg-white rounded-xl shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <Filter className="w-4 h-4 text-sky-600" /> 资金流水精细化全局检索
          </div>
          <button className="text-[12px] text-muted-foreground hover:text-foreground flex items-center gap-1">
            基本收起 <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <Field label="关键词综合模糊匹配">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="检索摘要、内部备注、批号…" className="h-9 pl-8" />
            </div>
          </Field>
          <Field label="结算资金收发账户">
            <SelectBox defaultValue="全部资金账户" options={["全部资金账户", "公司建设银行", "公司工商银行", "公司支付宝", "公司微信", "现金账户"]} />
          </Field>
          <Field label="收支运作方向">
            <SelectBox defaultValue="全部运作方向" options={["全部运作方向", "收入 (+)", "支出 (-)", "内部转账"]} />
          </Field>
          <Field label="流水科目归类">
            <SelectBox defaultValue="全部科目分类" options={["全部科目分类", "销售收入", "供应商付款", "工资支出", "广告推广", "办公费用", "物流费用", "退款退回", "账户内部转账"]} />
          </Field>

          <Field label="交易对象 / 对方户名">
            <Input placeholder="对方公司、员工或承运商…" className="h-9" />
          </Field>
          <Field label="财务入账对账状态">
            <SelectBox defaultValue="全部状态" options={["全部状态", "已归档锁定", "已确认", "草稿", "异常"]} />
          </Field>
          <Field label="流水发生区间">
            <div className="flex items-center gap-2">
              <Input type="date" className="h-9 flex-1" />
              <span className="text-xs text-muted-foreground">至</span>
              <Input type="date" className="h-9 flex-1" />
            </div>
          </Field>
          <Field label=" ">
            <label className="flex items-center gap-2 h-9 text-[12.5px] text-muted-foreground">
              <Checkbox /> 仅筛选含电子凭证附件
            </label>
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-border">
          <Button size="sm" variant="outline" className="gap-1.5"><RotateCcw className="w-3.5 h-3.5" />清空参数</Button>
          <Button size="sm" className="gap-1.5 bg-ops-navy hover:bg-ops-navy/90"><Search className="w-3.5 h-3.5" />快速查询</Button>
        </div>
      </Card>

      {/* Table card */}
      <Card className="border border-border bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="text-[12.5px]">
            <span className="text-muted-foreground">已检索出账金流水</span>
            <span className="font-semibold mx-1.5">{ROWS.length}</span>
            <span className="text-muted-foreground">笔明细</span>
          </div>
          <div className="text-[11px] text-muted-foreground font-mono tracking-wider">PRESET_UTC: 2026-05-23</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr className="text-left">
                <th className="px-4 py-2.5 w-10"><Checkbox checked={allChecked} onCheckedChange={toggleAll} /></th>
                <th className="px-3 py-2.5 font-normal">发生日期</th>
                <th className="px-3 py-2.5 font-normal">资金账户</th>
                <th className="px-3 py-2.5 font-normal">收支方向</th>
                <th className="px-3 py-2.5 font-normal text-right">交易金额</th>
                <th className="px-3 py-2.5 font-normal">账户科目分类</th>
                <th className="px-3 py-2.5 font-normal">来往交易对象</th>
                <th className="px-3 py-2.5 font-normal">摘要摘要</th>
                <th className="px-3 py-2.5 font-normal text-center">凭证</th>
                <th className="px-3 py-2.5 font-normal">入账状态</th>
                <th className="px-3 py-2.5 font-normal">经办人</th>
                <th className="px-4 py-2.5 font-normal text-right">操作指令列</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r, i) => {
                const isSel = selected.has(i);
                return (
                  <tr key={i} className={`border-t border-border transition ${isSel ? "bg-sky-50/40" : "hover:bg-muted/30"}`}>
                    <td className="px-4 py-3"><Checkbox checked={isSel} onCheckedChange={() => toggleOne(i)} /></td>
                    <td className="px-3 py-3 font-mono text-[12px] text-muted-foreground">{r.date}</td>
                    <td className="px-3 py-3 font-medium">{r.account}</td>
                    <td className="px-3 py-3">
                      <span className={`text-[12px] font-medium ${DIR_STYLE[r.direction]}`}>
                        {r.direction} {r.direction === "支出" ? "(-)" : r.direction === "收入" ? "(+)" : "(=)"}
                      </span>
                    </td>
                    <td className={`px-3 py-3 text-right font-mono font-semibold ${r.amount < 0 ? "text-rose-600" : r.direction === "内部转账" ? "text-violet-600" : "text-emerald-600"}`}>
                      {r.amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{r.category}</td>
                    <td className="px-3 py-3">{r.party}</td>
                    <td className="px-3 py-3 text-muted-foreground max-w-[260px] truncate" title={r.summary}>{r.summary}</td>
                    <td className="px-3 py-3 text-center">
                      {r.hasAttach ? <Paperclip className="w-3.5 h-3.5 inline text-sky-600" /> : <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] border ${STATUS_STYLE[r.status]}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          r.status === "已确认" ? "bg-emerald-500" :
                          r.status === "已归档锁定" ? "bg-sky-500" :
                          r.status === "异常" ? "bg-rose-500" : "bg-slate-400"
                        }`} />
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{r.operator}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5 text-muted-foreground">
                        <IconBtn><Eye className="w-3.5 h-3.5" /></IconBtn>
                        <IconBtn><Pencil className="w-3.5 h-3.5" /></IconBtn>
                        <IconBtn><Lock className="w-3.5 h-3.5" /></IconBtn>
                        <IconBtn className="hover:text-rose-600"><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-border text-[12px] text-muted-foreground">
          <div className="flex items-center gap-2">
            每页行数：
            <select className="h-7 rounded-md border border-border bg-white px-2 text-foreground">
              <option>20 条</option><option>50 条</option><option>100 条</option>
            </select>
            <span className="ml-2">共 {ROWS.length} 条记录</span>
          </div>
          <div className="flex items-center gap-2">
            <IconBtn><ChevronLeft className="w-3.5 h-3.5" /></IconBtn>
            <span className="text-foreground">1 / 1 页</span>
            <IconBtn><ChevronRight className="w-3.5 h-3.5" /></IconBtn>
          </div>
        </div>
      </Card>

      {/* Summary card */}
      <Card className="border border-border bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div>
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <Activity className="w-4 h-4 text-sky-600" /> 等值流水数据核算统计 (当前列表)
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              数据基于当前筛选器检索出的 {ROWS.length} 笔流水细项进行智能实时归集核算
            </div>
          </div>
          <Badge variant="outline" className="bg-slate-900 text-white border-slate-900 font-mono text-[10px] tracking-widest">LIVE DATA SUMMARY</Badge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 p-5">
          <SummaryTile
            tone="emerald"
            label="累计总收入 (+)"
            value={fmt(totalIn)}
            sub={`共 ${ROWS.filter(r => r.amount > 0 && r.direction !== "内部转账").length} 笔收入 · 平均单笔 ${fmt(totalIn / Math.max(1, ROWS.filter(r => r.amount > 0 && r.direction !== "内部转账").length))}`}
            icon={<TrendingUp className="w-4 h-4" />}
          />
          <SummaryTile
            tone="rose"
            label="累计总支出 (-)"
            value={fmt(totalOut)}
            sub={`共 ${ROWS.filter(r => r.amount < 0).length} 笔支出 · 平均单笔 ${fmt(totalOut / Math.max(1, ROWS.filter(r => r.amount < 0).length))}`}
            icon={<TrendingDown className="w-4 h-4" />}
          />
          <SummaryTile
            tone="sky"
            label="区间收支差额 / 盈余"
            value={(net >= 0 ? "+" : "") + fmt(net)}
            sub={`累计内部转账 ${ROWS.filter(r => r.direction === "内部转账").length} 笔`}
            icon={<Wallet className="w-4 h-4" />}
          />
          <div className="rounded-lg border border-border p-4">
            <div className="text-[11.5px] text-muted-foreground mb-3">入账对账状态归集</div>
            {(["已确认", "已归档锁定", "草稿", "异常"] as Row["status"][]).map(s => {
              const list = ROWS.filter(r => r.status === s);
              const sum = list.reduce((a, b) => a + Math.abs(b.amount), 0);
              return (
                <div key={s} className="flex items-center justify-between text-[12px] py-1">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      s === "已确认" ? "bg-emerald-500" :
                      s === "已归档锁定" ? "bg-sky-500" :
                      s === "异常" ? "bg-rose-500" : "bg-slate-400"
                    }`} />
                    {s}
                  </span>
                  <span className="font-mono text-foreground/80">{list.length} 笔 <span className="text-muted-foreground">({fmt(sum)})</span></span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <NewCashflowDrawer open={newOpen} onOpenChange={setNewOpen} />
      <BatchCashflowDrawer open={batchOpen} onOpenChange={setBatchOpen} />
    </div>
  );
}

/* ---------- atoms ---------- */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11.5px] text-muted-foreground mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function SelectBox({ defaultValue, options }: { defaultValue: string; options: string[] }) {
  return (
    <select defaultValue={defaultValue} className="h-9 w-full rounded-md border border-border bg-white px-3 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/30">
      {options.map(o => <option key={o}>{o}</option>)}
    </select>
  );
}

function IconBtn({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <button className={`w-7 h-7 inline-flex items-center justify-center rounded-md hover:bg-muted hover:text-foreground transition ${className}`}>
      {children}
    </button>
  );
}

function SummaryTile({ tone, label, value, sub, icon }: { tone: "emerald" | "rose" | "sky"; label: string; value: string; sub: string; icon: React.ReactNode }) {
  const toneMap = {
    emerald: { bg: "bg-emerald-50/60 border-emerald-200", text: "text-emerald-700", pill: "bg-emerald-100 text-emerald-600" },
    rose: { bg: "bg-rose-50/60 border-rose-200", text: "text-rose-700", pill: "bg-rose-100 text-rose-600" },
    sky: { bg: "bg-sky-50/60 border-sky-200", text: "text-sky-700", pill: "bg-sky-100 text-sky-600" },
  }[tone];
  return (
    <div className={`rounded-lg border p-4 ${toneMap.bg}`}>
      <div className="flex items-start justify-between">
        <div className="text-[11.5px] text-muted-foreground">{label}</div>
        <span className={`w-7 h-7 rounded-full flex items-center justify-center ${toneMap.pill}`}>{icon}</span>
      </div>
      <div className={`text-2xl font-bold font-mono mt-2 ${toneMap.text}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground mt-1.5">{sub}</div>
    </div>
  );
}
