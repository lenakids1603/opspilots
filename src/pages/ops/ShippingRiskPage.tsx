import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ops/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  AlertTriangle, RefreshCcw, Search, Eye, Clock, Package, AlertOctagon,
  CheckCircle2, Timer, TrendingUp, ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip as RTooltip, CartesianGrid,
} from "recharts";

/* ============================================================
 * 订单超时预警看板（前端 Mock 阶段）
 * 数据均为 mock，待 staging 真实数据接通后替换。
 * 占位字段（今日已处理 / 平均到货延迟 / 标记跟进）已标注。
 * ========================================================== */

type RiskLevel = "timeout" | "high" | "medium" | "low";
type Stage =
  | "no_po"           // 未下采购单
  | "po_pending"      // 已下采购单,待入库
  | "partial"         // 部分入库
  | "received"        // 已入库,待发货
  | "overdue";        // 协议已超

type Row = {
  id: string;
  o_id: string;
  shop: string;
  supplier: string;
  sku: string;
  style_no: string;
  product: string;
  qty: number;
  order_at: string;
  pay_at: string;
  remaining_h: number;       // 负数即超时
  risk: RiskLevel;
  stage: Stage;
  agreement_date: string | null;
  is_timeout: boolean;
  follow_up: boolean;
};

const SHOPS = ["LenaKids 抖音旗舰店", "LenaKids 天猫旗舰店", "Lena 童装淘宝店", "LenaKids 快手小店", "Lena 小红书店"];
const SUPPLIERS = ["杭州悦尚服饰", "广州童趣实业", "深圳明诚制衣", "佛山小蜜蜂服饰", "上海织梦坊", "待匹配"];
const PRODUCTS = [
  ["LK2406-红", "公主蕾丝连衣裙"],
  ["LK2412-蓝", "卡通卫衣套装"],
  ["LK2418-粉", "夏季纯棉短袖T"],
  ["LK2422-黄", "牛仔背带裤"],
  ["LK2431-白", "亮片纱裙演出服"],
  ["LK2440-绿", "薄款防晒外套"],
  ["LK2455-紫", "针织开衫毛衣"],
  ["LK2467-灰", "校园风百褶裙"],
];

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}
const rand = seededRandom(20260609);

function riskOf(h: number): RiskLevel {
  if (h < 0) return "timeout";
  if (h <= 24) return "high";
  if (h <= 48) return "medium";
  return "low";
}
function stageOf(r: number): Stage {
  if (r < 0.18) return "overdue";
  if (r < 0.36) return "no_po";
  if (r < 0.62) return "po_pending";
  if (r < 0.82) return "partial";
  return "received";
}

const MOCK_ROWS: Row[] = Array.from({ length: 140 }).map((_, i) => {
  const h = Math.round((rand() * 200 - 60) * 10) / 10; // -60h ~ 140h
  const [sku, prod] = PRODUCTS[Math.floor(rand() * PRODUCTS.length)];
  const shop = SHOPS[Math.floor(rand() * SHOPS.length)];
  const supplier = SUPPLIERS[Math.floor(rand() * SUPPLIERS.length)];
  const order = new Date(Date.now() - (rand() * 7 + 0.5) * 86400000);
  const pay = new Date(order.getTime() + rand() * 3600 * 1000 * 6);
  const agree = new Date(Date.now() + (h + (rand() * 24 - 12)) * 3600 * 1000);
  const stage = stageOf(rand());
  return {
    id: `mock-${i}`,
    o_id: `SO${(20260000 + i).toString()}`,
    shop,
    supplier,
    sku,
    style_no: sku.split("-")[0],
    product: prod,
    qty: Math.ceil(rand() * 12),
    order_at: order.toISOString(),
    pay_at: pay.toISOString(),
    remaining_h: h,
    risk: riskOf(h),
    stage: h < 0 ? "overdue" : stage,
    agreement_date: stage === "no_po" ? null : agree.toISOString(),
    is_timeout: h < 0,
    follow_up: rand() < 0.18,
  };
});

const RISK_META: Record<RiskLevel, { label: string; color: string; bg: string; ring: string }> = {
  timeout: { label: "已超时", color: "text-rose-700", bg: "bg-rose-100", ring: "border-rose-200" },
  high:    { label: "高风险", color: "text-orange-700", bg: "bg-orange-100", ring: "border-orange-200" },
  medium:  { label: "中风险", color: "text-amber-700", bg: "bg-amber-100", ring: "border-amber-200" },
  low:     { label: "低风险", color: "text-sky-700", bg: "bg-sky-100", ring: "border-sky-200" },
};

const STAGE_META: Record<Stage, { label: string; color: string }> = {
  no_po:      { label: "未下采购单", color: "#ef4444" },
  po_pending: { label: "已下单待入库", color: "#f97316" },
  partial:    { label: "部分入库", color: "#eab308" },
  received:   { label: "已入库待发货", color: "#3b82f6" },
  overdue:    { label: "协议已超", color: "#dc2626" },
};

function fmtHours(h: number) {
  if (h < 0) return `已超 ${Math.abs(h).toFixed(1)}h`;
  return `${h.toFixed(1)}h`;
}
function fmtDate(s: string | null) {
  if (!s) return "-";
  const d = new Date(s);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ------------------------------ KPI card ------------------------------ */
function KpiCard({
  title, value, delta, icon: Icon, tone = "default", hint, onClick, active,
}: {
  title: string; value: string | number; delta?: { text: string; up?: boolean };
  icon: any; tone?: "danger" | "warn" | "info" | "success" | "default";
  hint?: string; onClick?: () => void; active?: boolean;
}) {
  const toneCls = {
    danger:  "from-rose-500/10 to-rose-50 border-rose-200 text-rose-700",
    warn:    "from-orange-500/10 to-orange-50 border-orange-200 text-orange-700",
    info:    "from-sky-500/10 to-sky-50 border-sky-200 text-sky-700",
    success: "from-emerald-500/10 to-emerald-50 border-emerald-200 text-emerald-700",
    default: "from-slate-500/10 to-slate-50 border-slate-200 text-slate-700",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative text-left rounded-xl border bg-gradient-to-br p-4 transition hover:shadow-md hover:-translate-y-0.5 ${toneCls} ${active ? "ring-2 ring-offset-1 ring-current" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium opacity-80">{title}</span>
        <Icon className="w-4 h-4 opacity-60" />
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-[11px]">
        {delta && (
          <span className={`inline-flex items-center gap-0.5 ${delta.up ? "text-rose-600" : "text-emerald-600"}`}>
            {delta.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {delta.text}
          </span>
        )}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </div>
    </button>
  );
}

/* ------------------------------ Rank list ------------------------------ */
function RankList({ title, items, unit = "单" }: {
  title: string; items: { name: string; count: number; sub?: string }[]; unit?: string;
}) {
  const max = Math.max(1, ...items.map(i => i.count));
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge variant="outline" className="text-[10px]">TOP {items.length}</Badge>
      </div>
      <ul className="space-y-2.5">
        {items.map((it, i) => (
          <li key={it.name} className="space-y-1">
            <div className="flex items-center gap-2 text-xs">
              <span className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold ${
                i === 0 ? "bg-rose-500 text-white"
                : i === 1 ? "bg-orange-400 text-white"
                : i === 2 ? "bg-amber-400 text-white"
                : "bg-slate-200 text-slate-700"
              }`}>{i + 1}</span>
              <span className="flex-1 truncate font-medium">{it.name}</span>
              <span className="tabular-nums font-semibold">{it.count}<span className="text-muted-foreground font-normal ml-0.5">{unit}</span></span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden ml-7">
              <div className="h-full bg-gradient-to-r from-rose-400 to-orange-400" style={{ width: `${(it.count / max) * 100}%` }} />
            </div>
            {it.sub && <div className="ml-7 text-[10px] text-muted-foreground">{it.sub}</div>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ============================ Page ============================ */
export default function ShippingRiskPage() {
  const [filters, setFilters] = useState({
    shop: "all", supplier: "all", sku: "", riskLevel: "all" as "all" | RiskLevel, stage: "all" as "all" | Stage,
  });
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 12;

  const filtered = useMemo(() => {
    return MOCK_ROWS.filter(r => {
      if (filters.shop !== "all" && r.shop !== filters.shop) return false;
      if (filters.supplier !== "all" && r.supplier !== filters.supplier) return false;
      if (filters.sku && !`${r.sku} ${r.style_no} ${r.product}`.toLowerCase().includes(filters.sku.toLowerCase())) return false;
      if (filters.riskLevel !== "all" && r.risk !== filters.riskLevel) return false;
      if (filters.stage !== "all" && r.stage !== filters.stage) return false;
      return true;
    }).sort((a, b) => Number(b.is_timeout) - Number(a.is_timeout) || a.remaining_h - b.remaining_h);
  }, [filters]);

  // KPI based on full dataset
  const kpi = useMemo(() => {
    const total = MOCK_ROWS.length;
    const timeout = MOCK_ROWS.filter(r => r.is_timeout).length;
    const high = MOCK_ROWS.filter(r => r.risk === "high").length;
    const avgRemain = MOCK_ROWS.filter(r => !r.is_timeout).reduce((a, b) => a + b.remaining_h, 0) /
      Math.max(1, MOCK_ROWS.filter(r => !r.is_timeout).length);
    const timeoutRate = (timeout / total) * 100;
    return {
      total, timeout,
      atRisk: timeout + high,
      high,
      handledToday: 17,        // 占位
      avgRemain: avgRemain.toFixed(1),
      timeoutRate: timeoutRate.toFixed(1),
    };
  }, []);

  const riskDistro = (["timeout", "high", "medium", "low"] as RiskLevel[]).map(k => ({
    name: RISK_META[k].label,
    value: MOCK_ROWS.filter(r => r.risk === k).length,
    fill: { timeout: "#dc2626", high: "#f97316", medium: "#eab308", low: "#3b82f6" }[k],
  }));

  const remainingBuckets = [
    { name: "已超时", count: MOCK_ROWS.filter(r => r.remaining_h < 0).length, fill: "#dc2626" },
    { name: "0-6h",   count: MOCK_ROWS.filter(r => r.remaining_h >= 0 && r.remaining_h <= 6).length, fill: "#f97316" },
    { name: "6-24h",  count: MOCK_ROWS.filter(r => r.remaining_h > 6 && r.remaining_h <= 24).length, fill: "#f59e0b" },
    { name: "24-48h", count: MOCK_ROWS.filter(r => r.remaining_h > 24 && r.remaining_h <= 48).length, fill: "#eab308" },
    { name: "48-72h", count: MOCK_ROWS.filter(r => r.remaining_h > 48 && r.remaining_h <= 72).length, fill: "#3b82f6" },
    { name: ">72h",   count: MOCK_ROWS.filter(r => r.remaining_h > 72).length, fill: "#0ea5e9" },
  ];

  const funnel = (["no_po", "po_pending", "partial", "received", "overdue"] as Stage[]).map(s => ({
    stage: s,
    label: STAGE_META[s].label,
    color: STAGE_META[s].color,
    count: MOCK_ROWS.filter(r => r.stage === s).length,
  }));
  const funnelMax = Math.max(...funnel.map(f => f.count));

  const topShops = Object.entries(MOCK_ROWS.reduce<Record<string, number>>((m, r) => {
    if (r.is_timeout || r.risk === "high") m[r.shop] = (m[r.shop] ?? 0) + 1;
    return m;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  const topSuppliers = Object.entries(MOCK_ROWS.reduce<Record<string, number>>((m, r) => {
    if (r.is_timeout || r.risk === "high") m[r.supplier] = (m[r.supplier] ?? 0) + 1;
    return m;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, count]) => ({ name, count, sub: name === "待匹配" ? "采购单未关联" : undefined }));

  const topSkus = Object.entries(MOCK_ROWS.reduce<Record<string, { c: number; p: string }>>((m, r) => {
    const k = r.sku;
    if (!m[k]) m[k] = { c: 0, p: r.product };
    m[k].c += 1;
    return m;
  }, {})).sort((a, b) => b[1].c - a[1].c).slice(0, 10)
    .map(([sku, v]) => ({ name: sku, count: v.c, sub: v.p }));

  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        breadcrumb={["运维系统", "订单超时预警"]}
        title="订单超时预警看板"
        description="高风险订单、卡点环节、店铺/供应商/SKU 维度排行一屏直达"
        actions={
          <Button size="sm" variant="outline" onClick={() => setFilters({ shop: "all", supplier: "all", sku: "", riskLevel: "all", stage: "all" })}>
            <RefreshCcw className="w-3.5 h-3.5 mr-1" />重置筛选
          </Button>
        }
      />

      <div className="mx-6 mb-4 rounded-md border border-sky-200 bg-sky-50/60 px-4 py-2.5 text-xs text-sky-800 flex items-start gap-2">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          当前页面为 <b>原型 / Mock 阶段</b>。卡片、图表、排行、表格均使用模拟数据；待 staging 同步真实订单 / 采购数据后切换。
          带 <i>近似口径</i> 标记的字段（今日已处理、平均到货延迟、标记跟进）后续由后端确认口径。
        </span>
      </div>

      <div className="px-6 space-y-4 pb-10">
        {/* A. KPI */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard title="待发货订单总数" value={kpi.total} icon={Package} tone="default" />
          <KpiCard title="超时风险订单" value={kpi.atRisk} icon={AlertOctagon} tone="warn"
            delta={{ text: "+12%", up: true }} hint="近 24h"
            onClick={() => setFilters(f => ({ ...f, riskLevel: f.riskLevel === "high" ? "all" : "high" }))}
            active={filters.riskLevel === "high"} />
          <KpiCard title="已超时" value={kpi.timeout} icon={AlertTriangle} tone="danger"
            delta={{ text: "+5", up: true }} hint="对比昨日"
            onClick={() => setFilters(f => ({ ...f, riskLevel: f.riskLevel === "timeout" ? "all" : "timeout" }))}
            active={filters.riskLevel === "timeout"} />
          <KpiCard title="今日已处理" value={kpi.handledToday} icon={CheckCircle2} tone="success"
            hint="近似口径" />
          <KpiCard title="平均剩余时间" value={`${kpi.avgRemain}h`} icon={Timer} tone="info"
            hint="非超时订单" />
          <KpiCard title="超时占比" value={`${kpi.timeoutRate}%`} icon={TrendingUp} tone="danger" />
        </div>

        {/* B. Visualizations */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">风险等级分布</h3>
            <div className="h-56">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={riskDistro} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {riskDistro.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Pie>
                  <RTooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              {riskDistro.map(d => (
                <div key={d.name} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: d.fill }} />
                  <span className="text-muted-foreground">{d.name}</span>
                  <span className="ml-auto font-semibold tabular-nums">{d.value}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">剩余发货时间分布</h3>
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={remainingBuckets} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <RTooltip />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {remainingBuckets.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">按订单距协议发货剩余时长分组</p>
          </Card>

          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">处理环节漏斗</h3>
            <div className="space-y-2.5 mt-2">
              {funnel.map(f => (
                <button
                  key={f.stage}
                  onClick={() => setFilters(fl => ({ ...fl, stage: fl.stage === f.stage ? "all" : f.stage }))}
                  className={`w-full text-left rounded-lg border p-2.5 transition hover:shadow-sm ${filters.stage === f.stage ? "ring-2 ring-offset-1" : ""}`}
                  style={{ borderColor: f.color + "40", background: f.color + "0d" }}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium" style={{ color: f.color }}>{f.label}</span>
                    <span className="tabular-nums font-bold" style={{ color: f.color }}>{f.count}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-white/60 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(f.count / funnelMax) * 100}%`, background: f.color }} />
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* C. Rankings */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <RankList title="高风险店铺 TOP5" items={topShops} />
          <RankList title="高风险供应商 TOP5" items={topSuppliers} />
          <RankList title="高风险款号 TOP10" items={topSkus} />
        </div>

        {/* D. Detail */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              风险订单明细
              <Badge variant="outline" className="text-[10px]">{filtered.length} 条</Badge>
            </h3>
            <div className="text-[11px] text-muted-foreground">默认按「已超时 + 剩余时间最短」排序</div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
            <Select value={filters.shop} onValueChange={v => { setFilters(f => ({ ...f, shop: v })); setPage(0); }}>
              <SelectTrigger><SelectValue placeholder="店铺" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部店铺</SelectItem>
                {SHOPS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.supplier} onValueChange={v => { setFilters(f => ({ ...f, supplier: v })); setPage(0); }}>
              <SelectTrigger><SelectValue placeholder="供应商" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部供应商</SelectItem>
                {SUPPLIERS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.riskLevel} onValueChange={v => { setFilters(f => ({ ...f, riskLevel: v as any })); setPage(0); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部风险等级</SelectItem>
                <SelectItem value="timeout">已超时</SelectItem>
                <SelectItem value="high">高风险</SelectItem>
                <SelectItem value="medium">中风险</SelectItem>
                <SelectItem value="low">低风险</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.stage} onValueChange={v => { setFilters(f => ({ ...f, stage: v as any })); setPage(0); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部环节</SelectItem>
                {(Object.keys(STAGE_META) as Stage[]).map(s => (
                  <SelectItem key={s} value={s}>{STAGE_META[s].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-7" placeholder="SKU / 款号 / 商品" value={filters.sku}
                onChange={e => { setFilters(f => ({ ...f, sku: e.target.value })); setPage(0); }} />
            </div>
          </div>

          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-[88px]">风险</TableHead>
                  <TableHead className="text-right w-[110px]">剩余</TableHead>
                  <TableHead>店铺</TableHead>
                  <TableHead>订单号</TableHead>
                  <TableHead>商品 / SKU</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                  <TableHead>供应商</TableHead>
                  <TableHead>处理环节</TableHead>
                  <TableHead>协议到货</TableHead>
                  <TableHead>下单时间</TableHead>
                  <TableHead className="w-[80px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.length === 0 && (
                  <TableRow><TableCell colSpan={11} className="text-center py-10 text-muted-foreground">暂无符合条件的订单</TableCell></TableRow>
                )}
                {pageRows.map(r => {
                  const meta = RISK_META[r.risk];
                  const stage = STAGE_META[r.stage];
                  return (
                    <TableRow key={r.id} className={r.is_timeout ? "bg-rose-50/40" : r.risk === "high" ? "bg-orange-50/30" : ""}>
                      <TableCell><Badge variant="outline" className={`${meta.bg} ${meta.color} ${meta.ring}`}>{meta.label}</Badge></TableCell>
                      <TableCell className={`text-right text-xs tabular-nums ${r.is_timeout ? "text-rose-600 font-semibold" : ""}`}>
                        <Clock className="w-3 h-3 inline mr-1 opacity-60" />{fmtHours(r.remaining_h)}
                      </TableCell>
                      <TableCell className="text-xs">{r.shop}</TableCell>
                      <TableCell className="font-mono text-xs">{r.o_id}</TableCell>
                      <TableCell className="text-xs">
                        <div className="font-medium truncate max-w-[200px]">{r.product}</div>
                        <div className="font-mono text-muted-foreground text-[10px]">{r.sku}</div>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{r.qty}</TableCell>
                      <TableCell className="text-xs">
                        {r.supplier === "待匹配"
                          ? <span className="text-muted-foreground italic">待匹配</span>
                          : r.supplier}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" style={{ color: stage.color, borderColor: stage.color + "60" }}>
                          {stage.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{fmtDate(r.agreement_date)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(r.order_at)}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" className="h-7 px-2">
                          <Eye className="w-3.5 h-3.5 mr-1" />详情
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {filtered.length > PAGE_SIZE && (
            <div className="flex items-center justify-end gap-2 mt-3 text-xs">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</Button>
              <span className="text-muted-foreground">{page + 1} / {totalPages}</span>
              <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
