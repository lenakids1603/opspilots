import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ShoppingCart, Warehouse, AlertTriangle, PackageX, Search, Filter, Download, Eye,
  Shirt, Package, Box, Layers,
} from "lucide-react";

/* ---------- KPI top cards ---------- */
const PURCHASE = { qty: "12,860", amount: "¥746,280" };
const INBOUND = { qty: "9,420", amount: "¥546,360" };
const OVERDUE = { qty: "32", penalty: "¥3,200" };
const REJECT = { qty: "48", penalty: "¥1,680" };

/* ---------- Timeline ---------- */
type PO = { no: string; qty: number };
type Node = {
  date: string;
  tone?: "overdue" | "abnormal" | "ready" | "today" | "merge" | "ok";
  pos?: PO[];
};
function generateDays(): Node[] {
  const days: Node[] = [];
  const today = new Date();
  for (let i = -5; i <= 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const month = d.getMonth() + 1;
    const date = d.getDate();
    days.push({ date: `${month}/${date}` });
  }
  const special: Record<number, Partial<Node>> = {
    3:  { tone: "overdue", pos: [{ no: "323470", qty: 120 }, { no: "323471", qty: 80 }, { no: "323472", qty: 100 }] },
    4:  { pos: [{ no: "323480", qty: 60 }, { no: "323481", qty: 90 }] },
    5:  { tone: "today", pos: [{ no: "323490", qty: 150 }, { no: "323491", qty: 200 }, { no: "323492", qty: 120 }, { no: "323493", qty: 80 }, { no: "323494", qty: 90 }, { no: "323495", qty: 60 }] },
    6:  { pos: [{ no: "323500", qty: 200 }, { no: "323501", qty: 180 }] },
    7:  { tone: "abnormal", pos: [{ no: "323510", qty: 180 }, { no: "323511", qty: 60 }] },
    8:  { pos: [{ no: "323520", qty: 120 }] },
    9:  { tone: "merge", pos: [{ no: "323530", qty: 300 }, { no: "323531", qty: 250 }, { no: "323532", qty: 200 }, { no: "323533", qty: 150 }] },
    11: { pos: [{ no: "323550", qty: 90 }] },
    12: { tone: "ready", pos: [{ no: "323560", qty: 280 }, { no: "323561", qty: 220 }] },
    14: { pos: [{ no: "323580", qty: 140 }] },
    16: { pos: [{ no: "323600", qty: 110 }, { no: "323601", qty: 90 }, { no: "323602", qty: 70 }] },
    17: { tone: "ready", pos: [{ no: "323610", qty: 800 }, { no: "323611", qty: 700 }] },
    19: { pos: [{ no: "323630", qty: 200 }] },
  };
  for (const [idx, data] of Object.entries(special)) {
    days[Number(idx)] = { ...days[Number(idx)], ...data };
  }
  return days;
}
const days = generateDays();


/* ---------- Pending deliveries ---------- */
const PENDING = [
  {
    icon: Shirt, tint: "bg-rose-50 text-rose-500",
    code: "LN-2026-W01-PK-66", name: "女童泡泡袖花边加压连衣裙·经典款",
    qty: 1200, recv: 900, rate: 75, pending: 300, amount: "¥18,450.00", due: "2026-05-25",
    status: "已超期", tone: "overdue",
  },
  {
    icon: Package, tint: "bg-amber-50 text-amber-600",
    code: "LN-2026-W01-YL-80", name: "女童法式好看古朝棉沙衣裙·打褶款",
    qty: 800, recv: 620, rate: 78, pending: 180, amount: "¥12,240.00", due: "2026-05-29",
    status: "生产中", tone: "warning",
  },
  {
    icon: Box, tint: "bg-sky-50 text-sky-600",
    code: "LN-2026-W02-BL-90", name: "童装连帽外风保暖运动外套·孔雀蓝",
    qty: 2500, recv: 2000, rate: 80, pending: 500, amount: "¥34,500.00", due: "2026-06-03",
    status: "部分入库", tone: "info",
  },
  {
    icon: Layers, tint: "bg-emerald-50 text-emerald-600",
    code: "LN-2026-W03-GY-10", name: "精美舒柔时尚束脚运动裤·灰灰色",
    qty: 1500, recv: 0, rate: 0, pending: 1500, amount: "¥22,500.00", due: "2026-06-15",
    status: "即将交付", tone: "ok",
  },
];

const tone = (t?: string) => {
  switch (t) {
    case "overdue": return "bg-rose-50 text-rose-600 border-rose-200";
    case "warning": return "bg-amber-50 text-amber-700 border-amber-200";
    case "info":    return "bg-sky-50 text-sky-700 border-sky-200";
    case "ok":      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    default:        return "bg-muted text-foreground border-border";
  }
};

/* ---------- KPI Card ---------- */
function StatPanel({
  icon: Icon, iconTint, title, kicker, left, leftLabel, right, rightLabel, footer, illustration,
}: any) {
  return (
    <Card className="p-5 relative overflow-hidden">
      <div className="flex items-center gap-2 mb-4">
        <span className={`w-2 h-2 rounded-full ${iconTint}`} />
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        {kicker && <span className="text-[11px] text-muted-foreground ml-1">{kicker}</span>}
      </div>
      <div className="flex items-end gap-8 relative z-10">
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">{leftLabel}</div>
          <div className="text-2xl font-bold tracking-tight">{left}<span className="text-xs font-normal text-muted-foreground ml-1">件</span></div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">{rightLabel}</div>
          <div className="text-2xl font-bold tracking-tight text-emerald-700">{right}</div>
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground/80 mt-4">{footer}</div>
      {illustration && (
        <Icon className="absolute right-4 bottom-3 w-20 h-20 text-foreground/5" strokeWidth={1.2} />
      )}
    </Card>
  );
}

function MiniPenaltyCard({ icon: Icon, iconTint, title, qty, label, amount, amountLabel }: any) {
  return (
    <Card className="p-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconTint}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1">
        <div className="text-[12px] text-muted-foreground">{title}</div>
        <div className="text-xl font-bold mt-0.5">{qty}<span className="text-[11px] font-normal text-muted-foreground ml-1">件</span></div>
      </div>
      <div className="text-right">
        <div className="text-[11px] text-muted-foreground">{amountLabel}</div>
        <div className="text-base font-semibold text-rose-600">{amount}</div>
      </div>
    </Card>
  );
}

/* ---------- Timeline chevron segment ---------- */
type Zone = "past" | "soon" | "future" | "today";
function zoneOf(idx: number, todayIdx: number): Zone {
  if (idx === todayIdx) return "today";
  if (idx < todayIdx) return "past";
  if (idx <= todayIdx + 3) return "soon";
  return "future";
}
const ZONE_STYLE: Record<Zone, { fill: string; text: string; soft: string; label: string; dot: string }> = {
  past:   { fill: "bg-rose-500",    text: "text-white", soft: "text-rose-600",    label: "已超期",   dot: "bg-rose-500" },
  today:  { fill: "bg-violet-600",  text: "text-white", soft: "text-violet-600",  label: "今日",     dot: "bg-violet-600" },
  soon:   { fill: "bg-amber-500",   text: "text-white", soft: "text-amber-600",   label: "临近交期", dot: "bg-amber-500" },
  future: { fill: "bg-emerald-500", text: "text-white", soft: "text-emerald-600", label: "充裕",     dot: "bg-emerald-500" },
};

// Chevron arrow shape (points LEFT). Tip on the left, notch on the right.
const CHEVRON_CLIP = "polygon(10px 0, 100% 0, calc(100% - 10px) 50%, 100% 100%, 10px 100%, 0 50%)";

const MAX_PO_ROWS = 4;

function ChevronSegment({
  n, zone, isToday,
}: { n: Node; zone: Zone; isToday: boolean }) {
  const z = ZONE_STYLE[zone];
  const pos = n.pos ?? [];
  const totalQty = pos.reduce((s, p) => s + p.qty, 0);
  const visible = pos.slice(0, MAX_PO_ROWS);
  const extra = pos.length - visible.length;

  return (
    <div className="flex flex-col items-stretch flex-1 min-w-0">
      {/* PO list above — fixed height for alignment */}
      <div className="h-[88px] px-0.5 flex flex-col justify-end items-center gap-0.5">
        {visible.map((p) => (
          <div
            key={p.no}
            className={`text-[10px] font-mono tabular-nums leading-tight truncate w-full text-center ${z.soft}`}
            title={`${p.no} · ${p.qty}件`}
          >
            {p.no}
          </div>
        ))}
        {extra > 0 && (
          <div className="text-[9px] text-muted-foreground leading-tight">+{extra} 单</div>
        )}
      </div>

      {/* Connector line */}
      <div className="h-1.5 flex justify-center">
        {pos.length > 0 && <div className={`w-px h-full ${z.dot}`} />}
      </div>

      {/* Chevron (left-pointing) */}
      <div
        className={`h-8 ${z.fill} ${z.text} flex items-center justify-center text-[11px] font-semibold tabular-nums relative ${isToday ? "ring-2 ring-foreground ring-offset-2 ring-offset-background z-10" : ""}`}
        style={{ clipPath: CHEVRON_CLIP, marginRight: -10 }}
      >
        {isToday ? "今天" : n.date}
      </div>

      {/* Total pending qty below */}
      <div className="h-8 flex flex-col items-center justify-start pt-1">
        {totalQty > 0 ? (
          <>
            <div className={`text-[11px] font-bold tabular-nums leading-none ${z.soft}`}>
              {totalQty.toLocaleString()}
            </div>
            <div className="text-[9px] text-muted-foreground leading-tight mt-0.5">未入库</div>
          </>
        ) : (
          <div className="text-[10px] text-muted-foreground/50">—</div>
        )}
      </div>
    </div>
  );
}




export default function SupplierDashboard() {
  const todayIdx = days.findIndex((d) => d.tone === "today");

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            工作台首页 <span className="text-muted-foreground font-medium text-base">Dashboard</span>
          </h1>
          <p className="text-[12px] text-muted-foreground mt-1">
            数据最后统计更新时间：<span className="font-mono text-foreground">2026-05-28 09:42 AM</span> (实时计算)
          </p>
        </div>
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-muted-foreground">指标区间筛选：</span>
          {["今日", "本月", "近30天", "今年", "自定义"].map((t, i) => (
            <Button key={t} size="sm" variant={i === 1 ? "default" : "outline"} className="h-7 text-[11px]">{t}</Button>
          ))}
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatPanel
          title="采购概况" iconTint="bg-emerald-500"
          leftLabel="采购件数" left={PURCHASE.qty}
          rightLabel="采购金额" right={PURCHASE.amount}
          footer="采购周期付款比例分析"
          icon={ShoppingCart} illustration
        />
        <StatPanel
          title="入库概况" iconTint="bg-sky-500"
          leftLabel="入库件数" left={INBOUND.qty}
          rightLabel="入库金额" right={INBOUND.amount}
          footer="已对账信息及结算供应反馈—"
          icon={Warehouse} illustration
        />
        <div className="grid grid-rows-2 gap-3">
          <MiniPenaltyCard
            icon={AlertTriangle} iconTint="bg-amber-100 text-amber-600"
            title="货期超时" qty="32" label="件" amount="¥3,200" amountLabel="货期扣款"
          />
          <MiniPenaltyCard
            icon={PackageX} iconTint="bg-rose-100 text-rose-600"
            title="质量退货" qty="48" label="件" amount="¥1,680" amountLabel="返单扣款"
          />
        </div>
      </div>

      {/* Timeline */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <span className="w-1 h-4 bg-emerald-500 rounded-sm" /> 货期时间轴
            <span className="text-[11px] font-normal text-muted-foreground ml-1">未来 20 天</span>
          </h3>
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500" /> 已超期</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-violet-600" /> 今日</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> 临近交期 <span className="text-muted-foreground/70">(3天内)</span></span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> 充裕</span>
          </div>
        </div>

        <div className="w-full">
          <div className="flex items-stretch w-full">

            {days.map((d, i) => {
              const zone = zoneOf(i, todayIdx);
              const isToday = i === todayIdx;
              return <ChevronSegment key={d.date} n={d} zone={zone} isToday={isToday} />;
            })}

          </div>
        </div>
      </Card>


      {/* Pending table */}

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <span className="w-1 h-4 bg-emerald-500 rounded" /> 待交付商品明细
          </h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="搜索款号、SKU或供应..." className="h-8 pl-8 w-[220px] text-[12px]" />
            </div>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]"><Filter className="w-3.5 h-3.5" /> 筛选</Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]"><Download className="w-3.5 h-3.5" /> 导出</Button>
          </div>
        </div>

        <table className="w-full text-[12px]">
          <thead className="text-muted-foreground border-b border-border">
            <tr className="text-left">
              <th className="py-2.5 font-normal w-12">商品</th>
              <th className="py-2.5 font-normal">款号与 SKU名称</th>
              <th className="py-2.5 font-normal text-right">采购数</th>
              <th className="py-2.5 font-normal text-right">已入库</th>
              <th className="py-2.5 font-normal text-right">待入库</th>
              <th className="py-2.5 font-normal text-right">采购金额</th>
              <th className="py-2.5 font-normal">交付日期</th>
              <th className="py-2.5 font-normal">交付状态</th>
              <th className="py-2.5 font-normal">操作</th>
            </tr>
          </thead>
          <tbody>
            {PENDING.map((r) => (
              <tr key={r.code} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                <td className="py-3">
                  <div className={`w-9 h-9 rounded-md flex items-center justify-center ${r.tint}`}>
                    <r.icon className="w-4 h-4" />
                  </div>
                </td>
                <td className="py-3">
                  <div className="font-medium font-mono">{r.code}</div>
                  <div className="text-[11px] text-muted-foreground">{r.name}</div>
                </td>
                <td className="py-3 text-right">{r.qty.toLocaleString()} <span className="text-muted-foreground">件</span></td>
                <td className="py-3 text-right">
                  {r.recv.toLocaleString()} <span className="text-muted-foreground">件</span>
                  <span className="text-muted-foreground"> / {r.rate}%</span>
                </td>
                <td className={`py-3 text-right font-semibold ${
                  r.tone === "overdue" ? "text-rose-600" : r.tone === "warning" ? "text-amber-600" : "text-foreground"
                }`}>
                  {r.pending.toLocaleString()} <span className="font-normal text-muted-foreground">件</span>
                </td>
                <td className="py-3 text-right font-semibold">{r.amount}</td>
                <td className="py-3 font-mono">{r.due}</td>
                <td className="py-3">
                  <span className={`px-2 py-0.5 rounded text-[11px] border ${tone(r.tone)}`}>{r.status}</span>
                </td>
                <td className="py-3">
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]">
                    <Eye className="w-3 h-3" /> 明细
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex items-center justify-between mt-4 text-[11px] text-muted-foreground">
          <span>显示 1 至 4 条数据（总共及过滤后）</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 text-[11px]">上一页</Button>
            <Button size="sm" className="h-7 w-7 p-0 text-[11px]">1</Button>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0 text-[11px]">2</Button>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0 text-[11px]">3</Button>
            <Button variant="outline" size="sm" className="h-7 text-[11px]">下一页</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
