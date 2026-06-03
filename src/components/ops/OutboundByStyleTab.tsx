import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Download } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { formatDateTimeCN, beijingDayRangeToUTC, todayCN } from "@/lib/datetime";

const PAGE_SIZE = 20;
const fmtInt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 });

export type OutboundByStyleFilters = {
  startDate: string; endDate: string; shop: string; warehouse: string;
  ioId: string; oId: string; lId: string; sku: string; status: string;
  hasItems: string; abnormal: string;
};

type AggItem = {
  outbound_order_id: string;
  io_id: string | null;
  sku_id: string | null;
  i_id: string | null;
  name: string | null;
  color: string | null;
  size: string | null;
  qty: number;
  _style: string;
};

type OrderMeta = {
  id: string; io_id: string | null; o_id: string | null;
  shop_name: string | null; warehouse: string | null; status: string | null;
  logistics_company: string | null; l_id: string | null;
  io_date: string | null; consign_time: string | null;
};

type StyleRow = {
  key: string; style_no: string; product_name: string; shop_name: string;
  qty: number;
  io_set: Set<string>; o_set: Set<string>; sku_set: Set<string>; wh_set: Set<string>;
  first_io: string | null; last_io: string | null;
};

function styleFallback(iid: string | null | undefined, sku: string | null | undefined, name: string | null | undefined) {
  const i = (iid ?? "").trim();
  if (i) return i;
  const s = (sku ?? "").trim();
  if (s) {
    const m = s.match(/^\d{6,12}/);
    if (m) return m[0];
    const seg = s.split(/[-_/\s]/)[0];
    if (seg) return seg;
  }
  return (name ?? "").trim() || "(未知款号)";
}

function applyOrderFilters(q: any, f: OutboundByStyleFilters) {
  if (f.startDate) { const r = beijingDayRangeToUTC(f.startDate); if (r) q = q.gte("io_date", r.gte); }
  if (f.endDate)   { const r = beijingDayRangeToUTC(f.endDate);   if (r) q = q.lte("io_date", r.lte); }
  if (f.shop) q = q.ilike("shop_name", `%${f.shop}%`);
  if (f.warehouse) q = q.ilike("warehouse", `%${f.warehouse}%`);
  if (f.ioId) q = q.ilike("io_id", `%${f.ioId}%`);
  if (f.oId) q = q.ilike("o_id", `%${f.oId}%`);
  if (f.lId) q = q.ilike("l_id", `%${f.lId}%`);
  if (f.status !== "all") q = q.eq("status", f.status);
  return q;
}

function useStyleAggregate(filters: OutboundByStyleFilters) {
  return useQuery({
    queryKey: ["outbound_by_style", filters],
    queryFn: async () => {
      let q = supabase.from("jst_outbound_orders")
        .select("id, io_id, o_id, shop_name, warehouse, status, logistics_company, l_id, io_date, consign_time")
        .limit(5000);
      q = applyOrderFilters(q, filters);
      const { data: recs, error } = await q;
      if (error) throw error;
      const orders = (recs ?? []) as OrderMeta[];
      const orderMap = new Map<string, OrderMeta>(orders.map(r => [r.id, r]));
      const ids = orders.map(r => r.id);
      if (!ids.length) return { rows: [] as StyleRow[], items: [] as AggItem[], orderMap };

      const allItems: AggItem[] = [];
      for (let i = 0; i < ids.length; i += 800) {
        const slice = ids.slice(i, i + 800);
        let iq = supabase.from("jst_outbound_order_items")
          .select("outbound_order_id, io_id, sku_id, i_id, name, color, size, qty")
          .in("outbound_order_id", slice);
        if (filters.sku) iq = iq.or(`sku_id.ilike.%${filters.sku}%,i_id.ilike.%${filters.sku}%`);
        const { data: items, error: itErr } = await iq;
        if (itErr) throw itErr;
        for (const it of items ?? []) {
          allItems.push({
            outbound_order_id: (it as any).outbound_order_id,
            io_id: (it as any).io_id,
            sku_id: (it as any).sku_id,
            i_id: (it as any).i_id,
            name: (it as any).name,
            color: (it as any).color,
            size: (it as any).size,
            qty: Number((it as any).qty ?? 0),
            _style: "",
          });
        }
      }
      for (const it of allItems) {
        it._style = styleFallback(it.i_id, it.sku_id, it.name);
      }

      const orderItemCount = new Map<string, number>();
      for (const it of allItems) {
        orderItemCount.set(it.outbound_order_id, (orderItemCount.get(it.outbound_order_id) ?? 0) + 1);
      }
      const allowed = new Set<string>();
      for (const r of orders) {
        const c = orderItemCount.get(r.id) ?? 0;
        if (filters.hasItems === "yes" && c === 0) continue;
        if (filters.hasItems === "no" && c > 0) continue;
        if (filters.abnormal === "yes" && c > 0) continue;
        if (filters.abnormal === "no" && c === 0) continue;
        allowed.add(r.id);
      }
      const filteredItems = allItems.filter(it => allowed.has(it.outbound_order_id));

      const styleMap = new Map<string, StyleRow>();
      for (const it of filteredItems) {
        const rec = orderMap.get(it.outbound_order_id);
        const shop = (rec?.shop_name ?? "").trim() || "(未知店铺)";
        const style = it._style;
        const key = `${style}__${shop}`;
        let row = styleMap.get(key);
        if (!row) {
          row = {
            key, style_no: style, product_name: it.name ?? "", shop_name: shop,
            qty: 0,
            io_set: new Set(), o_set: new Set(), sku_set: new Set(), wh_set: new Set(),
            first_io: null, last_io: null,
          };
          styleMap.set(key, row);
        }
        row.qty += it.qty;
        const ioNo = rec?.io_id ?? it.io_id ?? "";
        if (ioNo) row.io_set.add(ioNo);
        const oNo = rec?.o_id ?? "";
        if (oNo) row.o_set.add(oNo);
        const sk = it.sku_id || "";
        if (sk) row.sku_set.add(sk);
        const wh = rec?.warehouse ?? "";
        if (wh) row.wh_set.add(wh);
        const d = rec?.io_date ?? null;
        if (d) {
          if (!row.first_io || d < row.first_io) row.first_io = d;
          if (!row.last_io || d > row.last_io) row.last_io = d;
        }
        if (!row.product_name && it.name) row.product_name = it.name;
      }
      const rows = Array.from(styleMap.values())
        .sort((a, b) => String(b.last_io ?? "").localeCompare(String(a.last_io ?? "")));
      return { rows, items: filteredItems, orderMap };
    },
    retry: 1,
  });
}

function whLabel(set: Set<string>) {
  const arr = Array.from(set);
  if (arr.length === 0) return "-";
  if (arr.length === 1) return arr[0];
  return `${arr.length} 个仓库`;
}

type Props = {
  filters: OutboundByStyleFilters;
  exportRef?: React.MutableRefObject<(() => void) | null>;
};

export default function OutboundByStyleTab({ filters, exportRef }: Props) {
  const aggQ = useStyleAggregate(filters);
  const [page, setPage] = useState(0);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  useEffect(() => { setPage(0); }, [filters]);

  const rows = aggQ.data?.rows ?? [];
  const totalCount = rows.length;
  const pageRows = useMemo(() => rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE), [rows, page]);
  const detailRow = useMemo(() => rows.find(r => r.key === detailKey) ?? null, [rows, detailKey]);
  const detailItems = useMemo(() => {
    if (!detailRow || !aggQ.data) return [] as AggItem[];
    return aggQ.data.items.filter(it => {
      const rec = aggQ.data.orderMap.get(it.outbound_order_id);
      const sp = (rec?.shop_name ?? "").trim() || "(未知店铺)";
      return it._style === detailRow.style_no && sp === detailRow.shop_name;
    });
  }, [detailRow, aggQ.data]);

  const exportRows = () => {
    if (!rows.length) return toast({ title: "无数据可导出" });
    const headers = ["款号/商品编码", "商品名称", "店铺", "出库件数", "出库单数", "订单数", "SKU数",
      "首次出库时间", "最近出库时间", "涉及仓库"];
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push([
        r.style_no, r.product_name, r.shop_name, r.qty,
        r.io_set.size, r.o_set.size, r.sku_set.size,
        formatDateTimeCN(r.first_io, { withSeconds: false }),
        formatDateTimeCN(r.last_io, { withSeconds: false }),
        whLabel(r.wh_set),
      ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `出库款式统计_${todayCN()}.csv`;
    a.click();
  };

  useEffect(() => {
    if (exportRef) exportRef.current = exportRows;
    return () => { if (exportRef) exportRef.current = null; };
  });

  return (
    <Card><CardContent className="p-0">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="text-xs text-muted-foreground">
          按「款号 + 店铺」聚合 · 当前筛选 {totalCount} 个款式
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>款号 / 商品编码</TableHead>
            <TableHead>商品名称</TableHead>
            <TableHead>店铺</TableHead>
            <TableHead className="text-right">出库件数</TableHead>
            <TableHead className="text-right">出库单数</TableHead>
            <TableHead className="text-right">订单数</TableHead>
            <TableHead className="text-right">SKU 数</TableHead>
            <TableHead>最近出库</TableHead>
            <TableHead>首次出库</TableHead>
            <TableHead>仓库</TableHead>
            <TableHead>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {aggQ.isLoading && <TableRow><TableCell colSpan={11} className="text-center py-12 text-muted-foreground">聚合中...</TableCell></TableRow>}
          {aggQ.error && <TableRow><TableCell colSpan={11} className="text-center py-12 text-rose-600">读取失败：{(aggQ.error as any).message}</TableCell></TableRow>}
          {!aggQ.isLoading && !aggQ.error && totalCount === 0 && (
            <TableRow><TableCell colSpan={11} className="text-center py-12 text-muted-foreground">当前筛选下没有出库款式数据</TableCell></TableRow>
          )}
          {pageRows.map(r => (
            <TableRow key={r.key}>
              <TableCell className="font-mono text-xs">{r.style_no}</TableCell>
              <TableCell className="text-xs">{r.product_name || "-"}</TableCell>
              <TableCell className="text-xs">{r.shop_name}</TableCell>
              <TableCell className="text-right">{fmtInt(r.qty)}</TableCell>
              <TableCell className="text-right">{fmtInt(r.io_set.size)}</TableCell>
              <TableCell className="text-right">{fmtInt(r.o_set.size)}</TableCell>
              <TableCell className="text-right">{fmtInt(r.sku_set.size)}</TableCell>
              <TableCell className="text-xs whitespace-nowrap">{formatDateTimeCN(r.last_io, { withSeconds: false })}</TableCell>
              <TableCell className="text-xs whitespace-nowrap">{formatDateTimeCN(r.first_io, { withSeconds: false })}</TableCell>
              <TableCell className="text-xs">{whLabel(r.wh_set)}</TableCell>
              <TableCell>
                <Button size="sm" variant="ghost" onClick={() => setDetailKey(r.key)}>详情</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between p-3 border-t">
          <div className="text-xs text-muted-foreground">共 {totalCount} 条 · 第 {page + 1} / {Math.ceil(totalCount / PAGE_SIZE)} 页</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</Button>
            <Button size="sm" variant="outline" disabled={(page + 1) * PAGE_SIZE >= totalCount} onClick={() => setPage(p => p + 1)}>下一页</Button>
          </div>
        </div>
      )}

      {/* 详情抽屉 */}
      <Sheet open={!!detailKey} onOpenChange={(o) => !o && setDetailKey(null)}>
        <SheetContent side="right" className="w-full sm:max-w-4xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>款式出库明细 · {detailRow?.style_no}</SheetTitle>
            <SheetDescription>
              {detailRow?.product_name || "-"} · 店铺 {detailRow?.shop_name} · 共 {detailItems.length} 条明细 · 合计 {fmtInt(detailRow?.qty)} 件
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <Table>
              <TableHeader><TableRow>
                <TableHead>出库单号</TableHead>
                <TableHead>订单号</TableHead>
                <TableHead>店铺</TableHead>
                <TableHead>仓库</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>商品名称</TableHead>
                <TableHead>颜色</TableHead>
                <TableHead>尺码</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead>快递公司</TableHead>
                <TableHead>快递单号</TableHead>
                <TableHead>出库时间</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {detailItems.map((it, idx) => {
                  const rec = aggQ.data?.orderMap.get(it.outbound_order_id);
                  return (
                    <TableRow key={idx}>
                      <TableCell className="font-mono text-xs">{rec?.io_id || "-"}</TableCell>
                      <TableCell className="font-mono text-xs">{rec?.o_id || "-"}</TableCell>
                      <TableCell className="text-xs">{rec?.shop_name || "-"}</TableCell>
                      <TableCell className="text-xs">{rec?.warehouse || "-"}</TableCell>
                      <TableCell className="font-mono text-xs">{it.sku_id || "-"}</TableCell>
                      <TableCell className="text-xs">{it.name || "-"}</TableCell>
                      <TableCell className="text-xs">{it.color || "-"}</TableCell>
                      <TableCell className="text-xs">{it.size || "-"}</TableCell>
                      <TableCell className="text-right">{fmtInt(it.qty)}</TableCell>
                      <TableCell className="text-xs">{rec?.logistics_company || "-"}</TableCell>
                      <TableCell className="font-mono text-xs">{rec?.l_id || "-"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{formatDateTimeCN(rec?.io_date, { withSeconds: false })}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </SheetContent>
      </Sheet>
    </CardContent></Card>
  );
}
