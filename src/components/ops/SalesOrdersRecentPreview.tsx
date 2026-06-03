import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const fmtDT = (s: any) => {
  if (!s) return "-";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString("zh-CN", { hour12: false });
};
const fmtAmt = (n: any) => (n == null ? "-" : Number(n).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function SalesOrdersRecentPreview() {
  const q = useQuery({
    queryKey: ["jst_sales_orders_recent"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data: orders, error } = await supabase
        .from("jst_sales_orders")
        .select("id, jst_o_id, so_id, shop_name, status, created_time, modified_time, paid_amount, io_id, l_id")
        .order("modified_time", { ascending: false })
        .limit(50);
      if (error) throw error;
      const ids = (orders ?? []).map((o) => o.id);
      let countMap = new Map<string, number>();
      if (ids.length > 0) {
        const { data: items } = await supabase
          .from("jst_sales_order_items")
          .select("sales_order_id")
          .in("sales_order_id", ids);
        (items ?? []).forEach((it: any) => {
          countMap.set(it.sales_order_id, (countMap.get(it.sales_order_id) ?? 0) + 1);
        });
      }
      return (orders ?? []).map((o) => ({ ...o, itemCount: countMap.get(o.id) ?? 0 }));
    },
  });

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">订单同步结果预览</div>
            <div className="text-xs text-muted-foreground">最近 50 条 jst_sales_orders（按修改时间倒序，15 秒自动刷新）</div>
          </div>
          <Badge variant="secondary">{q.data?.length ?? 0} 条</Badge>
        </div>
        <div className="max-h-[500px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>线上订单号</TableHead>
                <TableHead>聚水潭内部单号</TableHead>
                <TableHead>店铺</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>修改时间</TableHead>
                <TableHead className="text-right">实付金额</TableHead>
                <TableHead className="text-right">商品件数</TableHead>
                <TableHead>出库单号</TableHead>
                <TableHead>物流单号</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading && (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">加载中…</TableCell></TableRow>
              )}
              {!q.isLoading && (q.data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">暂无数据，先点上方按钮发起一次同步。</TableCell></TableRow>
              )}
              {(q.data ?? []).map((o: any) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-xs">{o.so_id ?? "-"}</TableCell>
                  <TableCell className="font-mono text-xs">{o.jst_o_id}</TableCell>
                  <TableCell className="text-xs">{o.shop_name ?? o.shop_id ?? "-"}</TableCell>
                  <TableCell className="text-xs">{o.status ?? "-"}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmtDT(o.created_time)}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{fmtDT(o.modified_time)}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{fmtAmt(o.paid_amount)}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{o.itemCount}</TableCell>
                  <TableCell className="font-mono text-xs">{o.io_id ?? "-"}</TableCell>
                  <TableCell className="font-mono text-xs">{o.l_id ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export default SalesOrdersRecentPreview;
