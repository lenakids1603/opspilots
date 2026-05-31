import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, RefreshCcw,
  AlertCircle, AlertTriangle, BarChart3, LineChart as LineIcon, Clock,
  Layers, ShieldAlert,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar,
} from "recharts";

/* ---------- KPI ---------- */
type Kpi = {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "up" | "down" | "neutral";
  sub?: string;
  hint?: string;
  accent?: "default" | "warning" | "danger";
};

const KPIS_ROW1: Kpi[] = [
  { label: "今日销售额 (GMV)", value: "¥1,384,500", delta: "+12.4%", deltaTone: "up", sub: "已支付 8,920 单", hint: "抖音占比 91.2%" },
  { label: "今日退款额", value: "¥927,600", delta: "+5.1%", deltaTone: "down", sub: "退款率约 67%", hint: "主要为尺码与色差" },
  { label: "今日净销售额 (GSV)", value: "¥456,900", delta: "+18.2%", deltaTone: "up", sub: "实际结算计入", hint: "年度目标完成度 28%" },
  { label: "今日利润预估", value: "¥68,500", delta: "+11.3%", deltaTone: "up", sub: "预估毛利率 15%", hint: "已扣除推广及退货成本" },
];

const KPIS_ROW2: Kpi[] = [
  { label: "今日 / 本月现金收入", value: "¥432,000", sub: "本月: ¥13,820,000", hint: "公账对私确认计算" },
  { label: "今日 / 本月现金支出", value: "¥315,000", sub: "本月: ¥11,140,500", hint: "采购付货款占 65%" },
  { label: "净现金流 (本月)", value: "+¥2,679,500", delta: "+37.4%", deltaTone: "up", sub: "上月: +¥1,950,000", hint: "现金回流健康度良好" },
  { label: "现金账面余额", value: "¥18,348,000", sub: "32 个体户合计", hint: "其中中央调配 ¥2,400,000" },
];

const KPIS_ROW3: Kpi[] = [
  { label: "应付供应商款", value: "¥5,820,000", accent: "warning", sub: "涉及 18 家主力厂商", hint: "本周到期 ¥1,240,000" },
  { label: "个体户额度预警", value: "4 个超标 / 告急", accent: "danger", sub: "限额 500 万/年", hint: "3 个超 90%, 1 个超 100%" },
  { label: "订单超时未发货", value: "148 单", accent: "warning", sub: "超过 48 小时未履约", hint: "聚水潭同步时间点合规库存数" },
  { label: "异常退款商品数", value: "8 款高退", accent: "danger", sub: "退款率超过 85%", hint: "主要集中在面料与颜色色差" },
];

/* ---------- Charts data ---------- */
const SALES_DATA = Array.from({ length: 16 }, (_, i) => {
  const hour = 8 + i;
  return {
    time: `${String(hour).padStart(2, "0")}:00`,
    gmv: 500000 + Math.round(Math.sin(i / 2) * 300000 + i * 80000 + Math.random() * 100000),
    refund: 200000 + Math.round(Math.cos(i / 2) * 100000 + i * 30000 + Math.random() * 50000),
  };
});

const WEEKLY_DATA = [
  { w: "W1 周期", income: 1200, expense: 950, net: 250 },
  { w: "W2 周期", income: 1400, expense: 1100, net: 300 },
  { w: "W3 周期", income: 1800, expense: 1250, net: 550 },
  { w: "W4 周期", income: 2050, expense: 1400, net: 650 },
  { w: "当前 W5 周期", income: 1700, expense: 1200, net: 500 },
];

/* ---------- Tables data ---------- */
const ARRIVAL_DELAY = [
  { id: "0-910283", shop: "抖音 · 莉惠童装旗舰店", overdue: "52小时", sku: "2026KS08-粉色-120", status: "缺货中", statusTone: "danger", partner: "海宁贝贝服饰" },
  { id: "0-910304", shop: "淘宝 - LenaKids小铺", overdue: "49小时", sku: "2026KS12-粉花五分裤-130", status: "备货中", statusTone: "warning", partner: "织里隆达童装" },
  { id: "0-910398", shop: "抖音 - LenaKids精选店", overdue: "48.5小时", sku: "2026KS15-甘照狗喘衣-110", status: "面料延误", statusTone: "warning", partner: "温州丰比服饰" },
];

const HIGH_REFUND = [
  { code: "2026KS08", name: "女宽防蚊裤 (碧欧冰丝)", rate: "89.2%", count: "420 件", reason: "面料勾丝严重、克重不符", supplier: "海宁贝贝服饰", action: "紧急切换中" },
  { code: "2026KS12", name: "法式抽抽裙公主裙 (两件套)", rate: "86.5%", count: "280 件", reason: "洗后严重缩水、领口偏小", supplier: "织里老沈印染", action: "图照改版中" },
  { code: "2026KS19", name: "莫代尔空调短袖套装", rate: "85.8%", count: "190 件", reason: "袖腰偏短过紧袖肚子", supplier: "常熟中染服饰", action: "到货监控中" },
];

const SUPPLIER_TOP = [
  { name: "海宁贝贝服饰", code: "S-001", due: "¥1,420,000", days: "T+30", status: "待付款", tone: "warning" },
  { name: "织里隆达童装", code: "S-008", due: "¥980,500", days: "T+45", status: "已审核", tone: "info" },
  { name: "温州丰比服饰", code: "S-014", due: "¥860,200", days: "T+30", status: "待付款", tone: "warning" },
  { name: "常熟中染服饰", code: "S-021", due: "¥720,800", days: "T+60", status: "异议中", tone: "danger" },
];

const ENTITIES = [
  { name: "杭州莉乐贸易有限公司", code: "E-LK01", flow: "¥4,820,000", rate: 96, status: "超线", tone: "danger" },
  { name: "义乌琳达服装商行", code: "E-LK04", flow: "¥4,610,500", rate: 92, status: "告急", tone: "warning" },
  { name: "宁波莉星电商工作室", code: "E-LK07", flow: "¥4,250,000", rate: 85, status: "正常", tone: "info" },
  { name: "嘉兴 LenaKids 优选商行", code: "E-LK11", flow: "¥3,980,000", rate: 80, status: "正常", tone: "info" },
];

/* ---------- Helpers ---------- */
const toneClass = (t?: string) => {
  switch (t) {
    case "danger": return "bg-rose-50 text-rose-600 border border-rose-200";
    case "warning": return "bg-amber-50 text-amber-700 border border-amber-200";
    case "info": return "bg-sky-50 text-sky-700 border border-sky-200";
    default: return "bg-muted text-foreground";
  }
};

function KpiCard({ k }: { k: Kpi }) {
  const accentBar =
    k.accent === "danger" ? "bg-rose-500" :
    k.accent === "warning" ? "bg-amber-500" :
    "bg-ops-sky";
  return (
    <Card className="p-4 relative overflow-hidden">
      <div className={`absolute left-0 top-0 h-full w-0.5 ${accentBar}`} />
      <div className="flex items-start justify-between">
        <span className="text-[12px] text-muted-foreground">{k.label}</span>
        {k.accent === "danger" && <AlertCircle className="w-4 h-4 text-rose-500" />}
        {k.accent === "warning" && <AlertTriangle className="w-4 h-4 text-amber-500" />}
      </div>
      <div className="mt-2 flex items-baseline gap-2 flex-wrap">
        <span className="text-[22px] font-bold text-foreground tracking-tight">{k.value}</span>
        {k.delta && (
          <span className={`text-[11px] font-semibold flex items-center ${
            k.deltaTone === "up" ? "text-emerald-600" : k.deltaTone === "down" ? "text-rose-600" : "text-muted-foreground"
          }`}>
            {k.deltaTone === "up" ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {k.delta}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{k.sub}</span>
        <span className="text-muted-foreground/80">{k.hint}</span>
      </div>
    </Card>
  );
}

export default function OverviewPage() {
  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">经营数据工作台</h1>
          <p className="text-sm text-muted-foreground mt-1">
            实时汇聚抖音、淘宝等多主体数据，核心反馈 30+ 独立个体户流水、采购账期与超时异常
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">最后更新于：2026-05-25 11:00:00 (自动)</span>
          <Button size="sm" variant="outline" className="h-8 gap-1.5">
            <RefreshCcw className="w-3.5 h-3.5" />
            重新加载
          </Button>
        </div>
      </div>

      {/* KPI rows */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {KPIS_ROW1.map(k => <KpiCard key={k.label} k={k} />)}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {KPIS_ROW2.map(k => <KpiCard key={k.label} k={k} />)}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {KPIS_ROW3.map(k => <KpiCard key={k.label} k={k} />)}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <LineIcon className="w-4 h-4 text-ops-sky" />
              今日销售额与退款额趋势图 (实时每小时)
            </h3>
          </div>
          <p className="text-[11px] text-muted-foreground mb-3">主数据集中在 19:30-23:30 黄金抖音达人直播时间段</p>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={SALES_DATA} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `¥${(v/1000000).toFixed(1)}M`} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="gmv" name="Today GMV" stroke="#2563eb" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="refund" name="Today Refund" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-ops-sky" />
              本月每周收入 / 支出 / 净现金流趋势图
            </h3>
          </div>
          <p className="text-[11px] text-muted-foreground mb-3">本周累计到周实发到货款、低虚拟支预，纯真实交款</p>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={WEEKLY_DATA} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="w" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${v}K`} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="income" name="收入" fill="#10b981" radius={[3,3,0,0]} />
                <Bar dataKey="expense" name="支出" fill="#f43f5e" radius={[3,3,0,0]} />
                <Bar dataKey="net" name="净流入" fill="#0ea5e9" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              聚水潭订单未发货超时预警 (已超 48H)
            </h3>
            <span className="text-[11px] text-muted-foreground">未发货总计: <span className="font-semibold text-foreground">342 单</span></span>
          </div>
          <p className="text-[11px] text-muted-foreground mb-3">需要客服员立即推送供应商快速发货或安排仓库提前</p>
          <table className="w-full text-[12px]">
            <thead className="text-muted-foreground border-b border-border">
              <tr className="text-left">
                <th className="py-2 font-normal">平台订单号</th>
                <th className="py-2 font-normal">绑定主体/店铺</th>
                <th className="py-2 font-normal">超时时长</th>
                <th className="py-2 font-normal">款号及SKU</th>
                <th className="py-2 font-normal">异常状态</th>
                <th className="py-2 font-normal">合作商</th>
              </tr>
            </thead>
            <tbody>
              {ARRIVAL_DELAY.map(r => (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2.5 font-mono">{r.id}</td>
                  <td className="py-2.5">{r.shop}</td>
                  <td className="py-2.5 text-rose-600 font-semibold">{r.overdue}</td>
                  <td className="py-2.5">{r.sku}</td>
                  <td className="py-2.5"><span className={`px-2 py-0.5 rounded text-[11px] ${toneClass(r.statusTone)}`}>{r.status}</span></td>
                  <td className="py-2.5 text-muted-foreground">{r.partner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-500" />
              异常退款商品监控 (单款退款率 &gt; 85%)
            </h3>
            <span className="text-[11px] text-muted-foreground">警报触发量: <span className="font-semibold text-foreground">88%</span></span>
          </div>
          <p className="text-[11px] text-muted-foreground mb-3">退货原因多为面料勾丝与色差，决定本月对涉事供应商额停或限售</p>
          <table className="w-full text-[12px]">
            <thead className="text-muted-foreground border-b border-border">
              <tr className="text-left">
                <th className="py-2 font-normal">款号及品名</th>
                <th className="py-2 font-normal">退款率</th>
                <th className="py-2 font-normal">退货件数</th>
                <th className="py-2 font-normal">核心客诉成因</th>
                <th className="py-2 font-normal">代工及主供</th>
                <th className="py-2 font-normal">处置结果</th>
              </tr>
            </thead>
            <tbody>
              {HIGH_REFUND.map(r => (
                <tr key={r.code} className="border-b border-border/60 last:border-0">
                  <td className="py-2.5">
                    <div className="font-medium">{r.code}</div>
                    <div className="text-[11px] text-muted-foreground">{r.name}</div>
                  </td>
                  <td className="py-2.5 text-rose-600 font-semibold">{r.rate}</td>
                  <td className="py-2.5">{r.count}</td>
                  <td className="py-2.5 text-muted-foreground">{r.reason}</td>
                  <td className="py-2.5">{r.supplier}</td>
                  <td className="py-2.5"><Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">{r.action}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Layers className="w-4 h-4 text-ops-sky" />
              供应商应付款大额排行 (应付款 Top 4)
            </h3>
            <span className="text-[11px] text-muted-foreground">本月待收票合计: <span className="font-semibold text-foreground">¥4.6M</span></span>
          </div>
          <p className="text-[11px] text-muted-foreground mb-3">客单未发货宁贝与温州长比对账，应付货款偏大</p>
          <table className="w-full text-[12px]">
            <thead className="text-muted-foreground border-b border-border">
              <tr className="text-left">
                <th className="py-2 font-normal">供应商名称</th>
                <th className="py-2 font-normal">编码</th>
                <th className="py-2 font-normal">当期应付</th>
                <th className="py-2 font-normal">账期</th>
                <th className="py-2 font-normal">状态</th>
              </tr>
            </thead>
            <tbody>
              {SUPPLIER_TOP.map(r => (
                <tr key={r.code} className="border-b border-border/60 last:border-0">
                  <td className="py-2.5 font-medium">{r.name}</td>
                  <td className="py-2.5 text-muted-foreground font-mono">{r.code}</td>
                  <td className="py-2.5 font-semibold text-foreground">{r.due}</td>
                  <td className="py-2.5">{r.days}</td>
                  <td className="py-2.5"><span className={`px-2 py-0.5 rounded text-[11px] ${toneClass(r.tone)}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-rose-500" />
              年报 500 万流水红线主体监控 (个体户)
            </h3>
            <span className="text-[11px] text-rose-600 font-semibold">30+ 个体户统一并联对账</span>
          </div>
          <p className="text-[11px] text-muted-foreground mb-3">控制在单家 500 万人民币/年，超限会被认定为一般纳税人并查税</p>
          <table className="w-full text-[12px]">
            <thead className="text-muted-foreground border-b border-border">
              <tr className="text-left">
                <th className="py-2 font-normal">个体户实体</th>
                <th className="py-2 font-normal">绑定店铺</th>
                <th className="py-2 font-normal">年度累计流水</th>
                <th className="py-2 font-normal">使用比例</th>
                <th className="py-2 font-normal">流水分配预警</th>
              </tr>
            </thead>
            <tbody>
              {ENTITIES.map(r => (
                <tr key={r.code} className="border-b border-border/60 last:border-0">
                  <td className="py-2.5">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">{r.code}</div>
                  </td>
                  <td className="py-2.5 text-muted-foreground">抖音 / 淘宝</td>
                  <td className="py-2.5 font-semibold">{r.flow}</td>
                  <td className="py-2.5 w-[120px]">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded">
                        <div
                          className={`h-full rounded ${r.rate >= 95 ? "bg-rose-500" : r.rate >= 90 ? "bg-amber-500" : "bg-emerald-500"}`}
                          style={{ width: `${r.rate}%` }}
                        />
                      </div>
                      <span className="text-[11px]">{r.rate}%</span>
                    </div>
                  </td>
                  <td className="py-2.5"><span className={`px-2 py-0.5 rounded text-[11px] ${toneClass(r.tone)}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
