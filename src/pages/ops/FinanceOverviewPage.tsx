import { PageHeader } from "@/components/ops/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus, Upload, Scale, BookOpenCheck, Download, Wallet, TrendingUp, CreditCard,
  ChevronRight, AlertTriangle, FileText, CheckCircle2, Send, Clock, Pencil,
  ShieldAlert, RefreshCcw, Bell, AlarmClock,
} from "lucide-react";
import { useState } from "react";

/* ---------- helpers ---------- */
function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <Card className={`p-5 border border-border bg-white rounded-xl shadow-sm ${className}`}>{children}</Card>;
}

function StatRow({ items }: { items: { color: string; label: string; percent: number }[] }) {
  const total = items.reduce((s, i) => s + i.percent, 0) || 100;
  return (
    <>
      <div className="flex h-2 rounded-full overflow-hidden bg-muted">
        {items.map((it, i) => (
          <div key={i} style={{ width: `${(it.percent / total) * 100}%`, backgroundColor: it.color }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-[11px] text-muted-foreground">
        {items.map((it, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: it.color }} />
            {it.label} <span className="text-foreground/70">({it.percent}%)</span>
          </span>
        ))}
      </div>
    </>
  );
}

/* ---------- data ---------- */
const RANGE_TABS = ["今日", "昨日", "本月", "上月", "自定义"] as const;

const INFLOW_ITEMS = [
  { color: "#10b981", label: "打款", percent: 65 },
  { color: "#06b6d4", label: "改签", percent: 20 },
  { color: "#0ea5e9", label: "其他", percent: 15 },
];
const OUTFLOW_ITEMS = [
  { color: "#ef4444", label: "公账", percent: 60 },
  { color: "#f59e0b", label: "工资", percent: 15 },
  { color: "#8b5cf6", label: "退款/售后", percent: 25 },
];

const ALERTS = [
  {
    tag: "高风险", tagClass: "bg-rose-50 text-rose-700 border-rose-200",
    icon: ShieldAlert, iconClass: "text-rose-500",
    title: "额度告警：杭州心选服饰年度流入已达 482 万",
    desc: "系统已自动暂停该主体收款任务，请尽快启用新主体。",
    amount: "¥4,820,000", time: "10分前",
    action: { label: "立即处理", variant: "destructive" as const },
  },
  {
    tag: "异常", tagClass: "bg-amber-50 text-amber-700 border-amber-200",
    icon: RefreshCcw, iconClass: "text-amber-500",
    title: "同步失败：招商银行 (8923) 流水拉取异常",
    desc: "网银凭据已失效，最后成功同步：09:32:00",
    amount: "—", time: "2小时前",
    action: { label: "重试同步", variant: "outline" as const },
  },
  {
    tag: "提醒", tagClass: "bg-sky-50 text-sky-700 border-sky-200",
    icon: Bell, iconClass: "text-sky-500",
    title: "待支付供应商：亮亮童装面料商差异金额确认",
    desc: "到货金额与账单金额不一致 (+¥5,000)，需人工核对。",
    amount: "¥325,000", time: "今天 08:45",
    action: { label: "查看明细", variant: "outline" as const },
  },
  {
    tag: "逾期", tagClass: "bg-orange-50 text-orange-700 border-orange-200",
    icon: AlarmClock, iconClass: "text-orange-500",
    title: "逾期未付：织锦服饰加工厂 (Q3季度尾款)",
    desc: "已超过约定结算账期 5 天，可能影响后续供应优先级。",
    amount: "¥150,000", time: "5天前",
    action: { label: "去结算", variant: "outline" as const },
  },
];

const ENTITY_ROWS = [
  { name: "杭州心选服饰有限公司", inflow: "¥4,820,000", quota: 96, status: "停用", statusClass: "bg-rose-100 text-rose-700" },
  { name: "滨江区亮乐制衣厂", inflow: "¥4,150,000", quota: 83, status: "风险", statusClass: "bg-amber-100 text-amber-700" },
  { name: "余杭织锦服饰加工厂", inflow: "¥3,210,000", quota: 64, status: "正常", statusClass: "bg-emerald-100 text-emerald-700" },
  { name: "萧山童艺服装贸易商行", inflow: "¥1,860,000", quota: 37, status: "正常", statusClass: "bg-emerald-100 text-emerald-700" },
];

const SUPPLIER_ROWS = [
  { name: "织锦服饰加工厂", bill: "¥450,000", diff: "0", status: "已结清", statusClass: "bg-emerald-100 text-emerald-700" },
  { name: "亮亮童装面料商", bill: "¥325,000", diff: "+¥5,000", diffClass: "text-rose-600", status: "异常", statusClass: "bg-rose-100 text-rose-700" },
  { name: "杭州心选服饰", bill: "¥820,000", diff: "-¥1,200", diffClass: "text-amber-600", status: "待核对", statusClass: "bg-amber-100 text-amber-700" },
  { name: "亮乐制衣厂", bill: "¥1,240,000", diff: "0", status: "待打款", statusClass: "bg-sky-100 text-sky-700" },
];

/* ---------- page ---------- */
export default function FinanceOverviewPage() {
  const [range, setRange] = useState<(typeof RANGE_TABS)[number]>("本月");

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={["财税系统", "财务总览"]}
        title="财务总览"
        description="实时查看公司现金流、供应商应付、个体户额度与财务异常"
        actions={
          <>
            <Button size="sm" className="gap-1.5"><Plus className="w-4 h-4" />新增支出</Button>
            <Button size="sm" variant="outline" className="gap-1.5"><Upload className="w-4 h-4" />导入流水</Button>
            <Button size="sm" variant="outline" className="gap-1.5"><Scale className="w-4 h-4" />资金对账</Button>
            <Button size="sm" variant="outline" className="gap-1.5"><BookOpenCheck className="w-4 h-4" />供应商对账</Button>
            <Button size="sm" variant="outline" className="gap-1.5"><Download className="w-4 h-4" />导出简报</Button>
          </>
        }
      />

      {/* Range + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-white p-1">
          {RANGE_TABS.map(t => (
            <button
              key={t}
              onClick={() => setRange(t)}
              className={`px-3.5 py-1.5 text-[12.5px] rounded-md transition ${
                range === t ? "bg-foreground text-background font-medium" : "text-muted-foreground hover:text-foreground"
              }`}
            >{t}</button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
          <label className="flex items-center gap-2">平台
            <select className="h-8 rounded-md border border-border bg-white px-2 text-foreground">
              <option>全部平台</option><option>抖音</option><option>淘宝</option><option>天猫</option>
            </select>
          </label>
          <label className="flex items-center gap-2">店铺
            <select className="h-8 rounded-md border border-border bg-white px-2 text-foreground">
              <option>全部店铺</option>
            </select>
          </label>
        </div>
      </div>

      {/* Row 1: 3 balance cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Section>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center"><Clock className="w-5 h-5" /></div>
            <div className="flex-1">
              <div className="text-xs text-muted-foreground">初始动态资金</div>
              <div className="text-2xl font-bold mt-1 font-mono">¥11,070,000</div>
              <div className="text-[11px] text-muted-foreground mt-1">本月 1 号 00:00:00 账面起算资金</div>
            </div>
          </div>
        </Section>
        <Section>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><TrendingUp className="w-5 h-5" /></div>
            <div className="flex-1">
              <div className="text-xs text-muted-foreground">期间结余变动</div>
              <div className="text-2xl font-bold mt-1 font-mono text-emerald-600 flex items-center gap-2">
                +¥1,350,000 <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-700 bg-emerald-50">顺差</Badge>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">期间流入 ¥3,450,000 | 流出 ¥2,100,000</div>
            </div>
          </div>
        </Section>
        <Section>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center"><Wallet className="w-5 h-5" /></div>
            <div className="flex-1">
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">当前公司账面资金 <Pencil className="w-3 h-3 text-muted-foreground/60" /></div>
              <div className="text-2xl font-bold mt-1 font-mono">¥12,420,000</div>
              <div className="text-[11px] text-muted-foreground mt-1">公司全部银行账户及可用市场资金合计余额</div>
            </div>
          </div>
        </Section>
      </div>

      {/* Row 2: inflow / outflow */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section>
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-medium flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />本月累计流入</div>
            <Badge variant="outline" className="bg-emerald-50 border-emerald-200 text-emerald-700 text-[11px]">↗ +12.5%</Badge>
          </div>
          <div className="text-[11px] text-muted-foreground mt-3">核算总金额 (人民币)</div>
          <div className="flex items-end gap-3 mt-1">
            <div className="text-3xl font-bold font-mono text-emerald-600">¥3,450,000</div>
            <a className="text-[12px] text-emerald-700 hover:underline pb-1.5 flex items-center gap-0.5">进入流水簿 <ChevronRight className="w-3 h-3" /></a>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">对比上月同期 [+12.5%] | 本月预估净利润 ¥450,000</div>
          <div className="mt-4">
            <div className="flex justify-between text-[11px] text-muted-foreground mb-1.5">
              <span>主体与渠道分布预览</span>
              <span>全部平台 · 全部店铺</span>
            </div>
            <StatRow items={INFLOW_ITEMS} />
          </div>
        </Section>
        <Section>
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-medium flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-rose-500" />本月累计流出</div>
            <Badge variant="outline" className="bg-amber-50 border-amber-200 text-amber-700 text-[11px]">⚑ 限速监控中</Badge>
          </div>
          <div className="text-[11px] text-muted-foreground mt-3">核算总金额 (人民币)</div>
          <div className="flex items-end gap-3 mt-1">
            <div className="text-3xl font-bold font-mono text-rose-600">¥2,100,000</div>
            <a className="text-[12px] text-rose-700 hover:underline pb-1.5 flex items-center gap-0.5">进入流水簿 <ChevronRight className="w-3 h-3" /></a>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">供应商货款 126万 | 待付供应商 ¥1,580,000</div>
          <div className="mt-4">
            <div className="flex justify-between text-[11px] text-muted-foreground mb-1.5">
              <span>支出科目结构占比 (报数 / 运营 / 快递)</span>
              <span className="text-foreground/70">净流出: <span className="font-mono">-¥1,350,000</span></span>
            </div>
            <StatRow items={OUTFLOW_ITEMS} />
          </div>
        </Section>
      </div>

      {/* Row 3: invoice / payment status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Section>
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="flex items-center gap-2 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-sky-500" />可开票金额</span>
            <FileText className="w-4 h-4 text-muted-foreground/60" />
          </div>
          <div className="text-[11px] text-muted-foreground mt-2">待收票 / 待开票总额</div>
          <div className="text-2xl font-bold font-mono mt-1">¥2,950,000</div>
          <div className="flex items-center justify-between text-[11px] mt-3">
            <a className="text-sky-700 hover:underline">查看可开票账期明细 →</a>
            <span className="text-muted-foreground">额度充足</span>
          </div>
        </Section>
        <Section className="ring-1 ring-emerald-400 shadow-md">
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="flex items-center gap-2 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />已开票金额</span>
            <span className="flex items-center gap-1 text-[11px] text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" />查看明细</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-2">开票审核已通过</div>
          <div className="text-2xl font-bold font-mono mt-1 text-emerald-700">¥2,050,000</div>
          <div className="flex items-center justify-between text-[11px] mt-3">
            <a className="text-emerald-700 hover:underline">查看已开票明细 →</a>
            <span className="text-emerald-700 font-medium">100.0%</span>
          </div>
        </Section>
        <Section>
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="flex items-center gap-2 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />已打款金额</span>
            <CreditCard className="w-4 h-4 text-muted-foreground/60" />
          </div>
          <div className="text-[11px] text-muted-foreground mt-2">银行流水成功支付</div>
          <div className="text-2xl font-bold font-mono mt-1">¥1,850,050</div>
          <div className="flex items-center justify-between text-[11px] mt-3">
            <a className="text-sky-700 hover:underline">查看已打款明细 →</a>
            <span className="text-muted-foreground">网银直开</span>
          </div>
        </Section>
      </div>

      {/* Row 4: alerts */}
      <Section className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <AlertTriangle className="w-4 h-4 text-amber-500" /> 财务异常预警
          </div>
          <span className="text-[11px] text-muted-foreground">4 个未决预报文件</span>
        </div>
        <ul className="divide-y divide-border">
          {ALERTS.map((a, i) => {
            const Icon = a.icon;
            return (
              <li key={i} className="px-5 py-3.5 flex items-center gap-4 hover:bg-muted/30 transition">
                <div className="w-16 flex justify-center">
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
                <Button size="sm" variant={a.action.variant} className="shrink-0">{a.action.label}</Button>
              </li>
            );
          })}
        </ul>
      </Section>

      {/* Row 5: two tables */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Section className="p-0">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div>
              <div className="text-[13px] font-medium">个体户年度额度监控</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">监控个体商户 500 万免税额度使用情况</div>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <Badge variant="outline" className="bg-slate-50">128 总主体</Badge>
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">96 运行中</Badge>
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">12 高风险</Badge>
              <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">3 建议预留</Badge>
            </div>
          </div>
          <table className="w-full text-[12.5px]">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left font-normal px-5 py-2">主体名称</th>
                <th className="text-right font-normal px-3 py-2">年度累计流入</th>
                <th className="text-left font-normal px-3 py-2 w-44">额度进度 (5M)</th>
                <th className="text-right font-normal px-5 py-2">状态</th>
              </tr>
            </thead>
            <tbody>
              {ENTITY_ROWS.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-5 py-2.5">{r.name}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{r.inflow}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full ${r.quota >= 90 ? "bg-rose-500" : r.quota >= 70 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${r.quota}%` }} />
                      </div>
                      <span className="text-[11px] font-mono w-9 text-right">{r.quota}%</span>
                    </div>
                  </td>
                  <td className="px-5 py-2.5 text-right"><span className={`px-2 py-0.5 rounded text-[11px] ${r.statusClass}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section className="p-0">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div>
              <div className="text-[13px] font-medium">供应商账款与核销</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">管理本月应付货款、已结金额及差异</div>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">本月到账 ¥2.4M</Badge>
              <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200">已核销 ¥1.2M</Badge>
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">待核销 ¥0.8M</Badge>
            </div>
          </div>
          <table className="w-full text-[12.5px]">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left font-normal px-5 py-2">供应商</th>
                <th className="text-right font-normal px-3 py-2">账单金额</th>
                <th className="text-right font-normal px-3 py-2">差异金额</th>
                <th className="text-right font-normal px-5 py-2">状态</th>
              </tr>
            </thead>
            <tbody>
              {SUPPLIER_ROWS.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-5 py-2.5">{r.name}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{r.bill}</td>
                  <td className={`px-3 py-2.5 text-right font-mono ${r.diffClass ?? "text-muted-foreground"}`}>{r.diff}</td>
                  <td className="px-5 py-2.5 text-right"><span className={`px-2 py-0.5 rounded text-[11px] ${r.statusClass}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  );
}
