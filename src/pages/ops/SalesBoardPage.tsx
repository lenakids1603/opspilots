import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ops/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { Info } from "lucide-react";
import { todayCN } from "@/lib/datetime";

const fmtMoney = (n: number | null | undefined) =>
  "¥" + Number(n ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const fmtInt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 });

function useToday() {
  const today = todayCN();
  return useQuery({
    queryKey: ["sales_board_today", today],
    queryFn: async () => {
      const [daily, hourly, shipping] = await Promise.all([
        (supabase as any).from("sales_daily_summary")
          .select("pay_order_count,pay_qty,pay_amount,estimated_cost_amount,estimated_gross_profit")
          .eq("summary_date", today).limit(500),
        (supabase as any).from("sales_hourly_summary")
          .select("summary_hour,pay_amount,pay_qty,pay_order_count")
          .eq("summary_date", today).limit(2000),
        (supabase as any).from("shipping_risk_orders")
          .select("risk_level,is_timeout").limit(2000),
      ]);
      const dailyRows = (daily.data ?? []) as any[];
      const hourlyRows = (hourly.data ?? []) as any[];
      const riskRows = (shipping.data ?? []) as any[];

      const sum = (k: string) => dailyRows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
      const todayOrders = sum("pay_order_count");
      const todayQty = sum("pay_qty");
      const todayAmount = sum("pay_amount");
      const todayCost = sum("estimated_cost_amount");
      const todayProfit = sum("estimated_gross_profit");

      const byHour = new Map<number, { amount: number; qty: number; orders: number }>();
      for (let h = 0; h < 24; h++) byHour.set(h, { amount: 0, qty: 0, orders: 0 });
      for (const r of hourlyRows) {
        const h = Number(r.summary_hour ?? 0);
        const cur = byHour.get(h) ?? { amount: 0, qty: 0, orders: 0 };
        cur.amount += Number(r.pay_amount ?? 0);
        cur.qty += Number(r.pay_qty ?? 0);
        cur.orders += Number(r.pay_order_count ?? 0);
        byHour.set(h, cur);
      }
      const hourlyChart = Array.from(byHour.entries()).map(([h, v]) => ({
        hour: `${String(h).padStart(2, "0")}:00`,
        amount: Math.round(v.amount),
        qty: v.qty,
      }));

      const riskTimeout = riskRows.filter(r => r.is_timeout).length;
      const riskHigh = riskRows.filter(r => r.risk_level === "high").length;
      const riskTotal = riskRows.length;

      return {
        hasData: dailyRows.length > 0 || hourlyRows.length > 0,
        todayOrders, todayQty, todayAmount, todayCost, todayProfit,
        hourlyChart,
        riskTimeout, riskHigh, riskTotal,
      };
    },
    retry: false,
  });
}

function useTop() {
  const today = todayCN();
  return useQuery({
    queryKey: ["sales_board_top", today],
    queryFn: async () => {
      const [sku, style] = await Promise.all([
        (supabase as any).from("sales_sku_daily_summary")
          .select("sku_code,sku_name,style_no,pay_qty,pay_amount,supplier_name")
          .eq("summary_date", today)
          .order("pay_amount", { ascending: false }).limit(10),
        (supabase as any).from("sales_style_daily_summary")
          .select("style_no,supplier_name,pay_sku_count,pay_qty,pay_amount")
          .eq("summary_date", today)
          .order("pay_amount", { ascending: false }).limit(10),
      ]);
      return {
        sku: (sku.data ?? []) as any[],
        style: (style.data ?? []) as any[],
      };
    },
    retry: false,
  });
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "default" | "warning" | "danger" }) {
  const bar = tone === "danger" ? "bg-rose-500" : tone === "warning" ? "bg-amber-500" : "bg-ops-sky";
  return (
    <Card className="p-4 relative overflow-hidden">
      <div className={`absolute left-0 top-0 h-full w-0.5 ${bar}`} />
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="mt-2 text-[22px] font-bold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}

export default function SalesBoardPage() {
  const today = useToday();
  const top = useTop();
  const empty = !today.isLoading && !today.data?.hasData;
  const err = today.error || top.error;

  return (
    <div>
      <PageHeader
        breadcrumb={["运维系统", "经营看板（轻量）"]}
        title="老板经营看板"
        description={"数据源：sales_daily_summary / sales_hourly_summary / sales_sku_daily_summary / sales_style_daily_summary / shipping_risk_orders（只读）"}
      />

      <div className="mx-6 mb-3 rounded-md border border-sky-300 bg-sky-50/60 px-4 py-2.5 text-xs text-sky-800 flex items-start gap-2">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          本看板只读轻量汇总表，不触发任何同步或回填。当前为页面骨架；汇总按下单时间（<code>order_created_at</code> → <code>pay_time</code>）聚合，由最近 10 分钟订单同步任务持续刷新。
          06-03 / 06-04 高峰历史数据仍在分批回填中，7 天 / 历史趋势以当前已回填范围为准。
        </span>
      </div>

      {err && (
        <div className="mx-6 mb-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          汇总数据读取异常：{String((err as any)?.message ?? err)}。可稍后刷新页面。
        </div>
      )}

      <div className="px-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="今日销售额 (下单)" value={fmtMoney(today.data?.todayAmount)} sub={`订单 ${fmtInt(today.data?.todayOrders)} / 件 ${fmtInt(today.data?.todayQty)}`} />
          <Kpi label="今日预估成本" value={fmtMoney(today.data?.todayCost)} sub="基于 SKU 成本估算" />
          <Kpi label="今日预估毛利" value={fmtMoney(today.data?.todayProfit)} sub="销售额 - 预估成本" />
          <Kpi
            label="未发货风险订单"
            value={fmtInt(today.data?.riskTotal)}
            sub={`超时 ${fmtInt(today.data?.riskTimeout)} / 高风险 ${fmtInt(today.data?.riskHigh)}`}
            tone={today.data && today.data.riskTimeout > 0 ? "danger" : today.data && today.data.riskHigh > 0 ? "warning" : "default"}
          />
        </div>

        {empty && (
          <Card className="p-10 text-center text-sm text-muted-foreground">
            暂无今日汇总数据。等待最近 10 分钟订单同步任务写入。
          </Card>
        )}

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3">今日小时销售趋势（按下单时间，Asia/Shanghai）</h2>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={today.data?.hourlyChart ?? []} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `¥${(v/10000).toFixed(1)}w`} />
                <Tooltip formatter={(v: any) => fmtMoney(Number(v))} />
                <Line type="monotone" dataKey="amount" name="下单金额" stroke="#2563eb" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold mb-3">SKU 销售 Top 10（今日下单金额）</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>款号</TableHead>
                  <TableHead>商品名</TableHead>
                  <TableHead className="text-right">件数</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(top.data?.sku ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">暂无汇总数据</TableCell></TableRow>
                )}
                {(top.data?.sku ?? []).map((r: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{r.sku_code ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.style_no ?? "-"}</TableCell>
                    <TableCell className="text-xs">{r.sku_name ?? "-"}</TableCell>
                    <TableCell className="text-right text-xs">{fmtInt(r.pay_qty)}</TableCell>
                    <TableCell className="text-right text-xs">{fmtMoney(r.pay_amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold mb-3">款号销售 Top 10（今日下单金额）</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>款号</TableHead>
                  <TableHead>供应商</TableHead>
                  <TableHead className="text-right">SKU 数</TableHead>
                  <TableHead className="text-right">件数</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(top.data?.style ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">暂无汇总数据</TableCell></TableRow>
                )}
                {(top.data?.style ?? []).map((r: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{r.style_no ?? "-"}</TableCell>
                    <TableCell className="text-xs">{r.supplier_name ?? "-"}</TableCell>
                    <TableCell className="text-right text-xs">{fmtInt(r.pay_sku_count)}</TableCell>
                    <TableCell className="text-right text-xs">{fmtInt(r.pay_qty)}</TableCell>
                    <TableCell className="text-right text-xs">{fmtMoney(r.pay_amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>
    </div>
  );
}
