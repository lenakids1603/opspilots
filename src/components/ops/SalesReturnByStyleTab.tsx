import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { formatDateTimeCN, beijingDayRangeToUTC } from "@/lib/datetime";

const PAGE_SIZE = 20;
const fmtMoney = (n: number | null | undefined) =>
  "¥" + Number(n ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const fmtInt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 });

export type SrByStyleFilters = {
  startDate: string; endDate: string; shop: string; warehouse: string;
  asNo: string; soNo: string; sku: string; status: string;
  hasOriginalOrder: string; hasItems: string; abnormal: string; refundNo: string;
};

type Order = {
  id: string; as_id: string; status: string | null; received_date: string | null;
  modified_at_jst: string | null; warehouse: string | null; shop_name: string | null; shop_id: string | null;
  so_id: string | null; o_id: string | null; outer_as_id: string | null;
};
type Item = {
  as_id: string; sku_id: string | null; name: string | null;
  qty: number; r_qty: number; amount: number; supplier_name: string | null;
  _style: string;
};
type StyleRow = {
  key: string; style_no: string; product_name: string; shop_name: string; supplier_name: string;
  qty: number; amt: number; as_set: Set<string>; so_set: Set<string>;
  sku_set: Set<string>; wh_set: Set<string>;
  first_at: string | null; last_at: string | null; abnormal: boolean;
};

function styleFallback(sku: string | null | undefined, name: string | null | undefined) {
  const s = (sku ?? "").trim();
  if (s) {
    const m = s.match(/^\d{6,12}/);
    if (m) return m[0];
    const seg = s.split(/[-_/\s]/)[0];
    if (seg) return seg;
  }
  return (name ?? "").trim() || "(未知款号)";
}

function applyOrderFilters(q: any, f: SrByStyleFilters) {
  if (f.startDate) { const r = beijingDayRangeToUTC(f.startDate); if (r) q = q.gte("received_date", r.gte); }
  if (f.endDate)   { const r = beijingDayRangeToUTC(f.endDate);   if (r) q = q.lte("received_date", r.lte); }
  if (f.shop) q = q.ilike("shop_name", `%${f.shop}%`);
  if (f.warehouse) q = q.ilike("warehouse", `%${f.warehouse}%`);
  if (f.asNo) q = q.ilike("as_id", `%${f.asNo}%`);
  if (f.soNo) q = q.ilike("so_id", `%${f.soNo}%`);
  if (f.refundNo) q = q.ilike("outer_as_id", `%${f.refundNo}%`);
  if (f.status !== "all") q = q.eq("status", f.status);
  if (f.hasOriginalOrder === "yes") q = q.not("so_id", "is", null);
  if (f.hasOriginalOrder === "no") q = q.or("so_id.is.null,so_id.eq.,so_id.eq.-1");
  return q;
}

function useAgg(filters: SrByStyleFilters) {
  return useQuery({
    queryKey: ["sr_by_style", filters],
    queryFn: async () => {
      // 店铺映射：jst_shop_id → name
      const { data: shopsData } = await supabase.from("shops")
        .select("jst_shop_id, name").is("deleted_at", null).not("jst_shop_id", "is", null).limit(5000);
      const shopMap = new Map<string, string>();
      for (const s of shopsData ?? []) {
        const k = String((s as any).jst_shop_id ?? "").trim();
        if (k) shopMap.set(k, (s as any).name ?? "");
      }

      let q = supabase.from("jst_aftersale_received_orders")
        .select("id, as_id, status, received_date, modified_at_jst, warehouse, shop_id, shop_name, so_id, o_id, outer_as_id")
        .limit(5000);
      q = applyOrderFilters(q, filters);
      const { data: ords, error } = await q;
      if (error) throw error;
      const orders = (ords ?? []) as Order[];
      const orderByAs = new Map<string, Order>(orders.map(o => [o.as_id, o]));
      const asIds = orders.map(o => o.as_id);
      if (!asIds.length) return { rows: [] as StyleRow[], items: [] as Item[], orderByAs };

      const allItems: Item[] = [];
      for (let i = 0; i < asIds.length; i += 800) {
        const slice = asIds.slice(i, i + 800);
        let iq = supabase.from("jst_aftersale_received_items")
          .select("as_id, sku_id, name, qty, r_qty, amount, supplier_name")
          .in("as_id", slice);
        if (filters.sku) iq = iq.ilike("sku_id", `%${filters.sku}%`);
        const { data: items, error: itErr } = await iq;
        if (itErr) throw itErr;
        for (const it of items ?? []) {
          allItems.push({
            as_id: (it as any).as_id,
            sku_id: (it as any).sku_id,
            name: (it as any).name,
            qty: Number((it as any).qty ?? 0),
            r_qty: Number((it as any).r_qty ?? 0),
            amount: Number((it as any).amount ?? 0),
            supplier_name: (it as any).supplier_name,
            _style: "",
          });
        }
      }

      // 解析款号：先用 ops_skus → ops_products.style_no，失败用 SKU 数字前缀
      const skuCodes = Array.from(new Set(allItems.map(i => i.sku_id).filter(Boolean))) as string[];
      const skuToStyle = new Map<string, string>();
      for (let i = 0; i < skuCodes.length; i += 500) {
        const slice = skuCodes.slice(i, i + 500);
        const { data: skus } = await supabase.from("ops_skus")
          .select("sku_code, product_id").in("sku_code", slice);
        const pidSet = Array.from(new Set((skus ?? []).map((s: any) => s.product_id).filter(Boolean)));
        const pidToStyle = new Map<string, string>();
        if (pidSet.length) {
          const { data: prods } = await supabase.from("ops_products")
            .select("id, style_no").in("id", pidSet);
          for (const p of prods ?? []) if ((p as any).style_no) pidToStyle.set((p as any).id, (p as any).style_no);
        }
        for (const s of skus ?? []) {
          const st = pidToStyle.get((s as any).product_id);
          if (st) skuToStyle.set((s as any).sku_code, st);
        }
      }

      for (const it of allItems) {
        it._style = skuToStyle.get(it.sku_id ?? "") || styleFallback(it.sku_id, it.name);
      }

      // 按 receipt 维度统计有无明细
      const itemCountByAs = new Map<string, number>();
      for (const it of allItems) itemCountByAs.set(it.as_id, (itemCountByAs.get(it.as_id) ?? 0) + 1);

      const allowed = new Set<string>();
      for (const o of orders) {
        const c = itemCountByAs.get(o.as_id) ?? 0;
        const noOrig = !o.so_id || o.so_id === "" || o.so_id === "-1";
        const isAbnormal = c === 0 || noOrig || !o.status;
        if (filters.hasItems === "yes" && c === 0) continue;
        if (filters.hasItems === "no" && c > 0) continue;
        if (filters.abnormal === "yes" && !isAbnormal) continue;
        if (filters.abnormal === "no" && isAbnormal) continue;
        allowed.add(o.as_id);
      }
      const filteredItems = allItems.filter(it => allowed.has(it.as_id));

      const styleMap = new Map<string, StyleRow>();
      for (const it of filteredItems) {
        const ord = orderByAs.get(it.as_id);
        const sid = String(ord?.shop_id ?? "").trim();
        const shop = (sid && shopMap.get(sid)) || (ord?.shop_name ?? "").trim() || "(未知店铺)";
        const supplier = (it.supplier_name ?? "").trim() || "-";
        const style = it._style;
        const key = `${style}__${shop}__${supplier}`;
        let row = styleMap.get(key);
        if (!row) {
          row = {
            key, style_no: style, product_name: it.name ?? "",
            shop_name: shop, supplier_name: supplier,
            qty: 0, amt: 0,
            as_set: new Set(), so_set: new Set(), sku_set: new Set(), wh_set: new Set(),
            first_at: null, last_at: null, abnormal: false,
          };
          styleMap.set(key, row);
        }
        row.qty += it.qty;
        row.amt += it.amount;
        row.as_set.add(it.as_id);
        if (ord?.so_id && ord.so_id !== "-1") row.so_set.add(ord.so_id);
        if (it.sku_id) row.sku_set.add(it.sku_id);
        if (ord?.warehouse) row.wh_set.add(ord.warehouse);
        const d = ord?.received_date ?? null;
        if (d) {
          if (!row.first_at || d < row.first_at) row.first_at = d;
          if (!row.last_at || d > row.last_at) row.last_at = d;
        }
        if (!row.product_name && it.name) row.product_name = it.name;
        const c = itemCountByAs.get(it.as_id) ?? 0;
        if (c === 0 || !ord?.so_id || ord.so_id === "-1" || !ord?.status) row.abnormal = true;
      }
      const rows = Array.from(styleMap.values())
        .sort((a, b) => String(b.last_at ?? "").localeCompare(String(a.last_at ?? "")));
      return { rows, items: filteredItems, orderByAs, shopMap };
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
  filters: SrByStyleFilters;
  exportRef?: React.MutableRefObject<((kind: "byStyle" | "byOrder") => void) | null>;
};

export default function SalesReturnByStyleTab({ filters, exportRef }: Props) {
  const aggQ = useAgg(filters);
  const [page, setPage] = useState(0);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  useEffect(() => { setPage(0); }, [filters]);

  const rows = aggQ.data?.rows ?? [];
  const totalCount = rows.length;
  const pageRows = useMemo(() => rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE), [rows, page]);
  const detailRow = useMemo(() => rows.find(r => r.key === detailKey) ?? null, [rows, detailKey]);
  const detailItems = useMemo(() => {
    if (!detailRow || !aggQ.data) return [] as Item[];
    const sm = aggQ.data.shopMap;
    return aggQ.data.items.filter(it => {
      const ord = aggQ.data.orderByAs.get(it.as_id);
      const sid = String(ord?.shop_id ?? "").trim();
      const shop = (sid && sm.get(sid)) || (ord?.shop_name ?? "").trim() || "(未知店铺)";
      const supplier = (it.supplier_name ?? "").trim() || "-";
      return shop === detailRow.shop_name
        && it._style === detailRow.style_no
        && supplier === detailRow.supplier_name;
    });
  }, [detailRow, aggQ.data, rows, detailKey]);

  // expose export
  useEffect(() => {
    if (!exportRef) return;
    exportRef.current = async (kind) => {
      const XLSX = await import("xlsx");
      const ts = new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })
        .replace(/[\/: ]/g, "").slice(0, 12);
      if (kind === "byStyle") {
        const data = rows.map(r => ({
          "款号/商品编码": r.style_no, "商品名称": r.product_name, "店铺": r.shop_name,
          "供应商": r.supplier_name, "销退件数": r.qty, "销退金额": r.amt,
          "销退单数": r.as_set.size, "原始订单数": r.so_set.size, "SKU 数": r.sku_set.size,
          "最近销退": formatDateTimeCN(r.last_at, { withSeconds: false }),
          "首次销退": formatDateTimeCN(r.first_at, { withSeconds: false }),
          "仓库": whLabel(r.wh_set), "是否异常": r.abnormal ? "异常" : "",
        }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "按款号");
        XLSX.writeFile(wb, `销退信息_按款号_${ts}.xlsx`);
      } else {
        // 按销退单导出：主单 + 明细两张表
        const orders = Array.from(new Map(
          aggQ.data?.items.map(it => [it.as_id, aggQ.data!.orderByAs.get(it.as_id)!]) ?? []
        ).values()).filter(Boolean);
        const main = orders.map(o => ({
          "销退单号": o.as_id, "原始订单号": o.so_id ?? "", "售后/退款单号": o.outer_as_id ?? "",
          "店铺": o.shop_name ?? "", "仓库": o.warehouse ?? "", "状态": o.status ?? "",
          "销退时间": formatDateTimeCN(o.received_date, { withSeconds: false }),
          "修改时间": formatDateTimeCN(o.modified_at_jst, { withSeconds: false }),
        }));
        const details = (aggQ.data?.items ?? []).map(it => {
          const o = aggQ.data!.orderByAs.get(it.as_id);
          return {
            "销退单号": it.as_id, "SKU": it.sku_id ?? "", "商品名称": it.name ?? "",
            "件数": it.qty, "退款数": it.r_qty, "金额": it.amount,
            "店铺": o?.shop_name ?? "", "仓库": o?.warehouse ?? "",
            "销退时间": formatDateTimeCN(o?.received_date, { withSeconds: false }),
          };
        });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(main), "销退单");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(details), "明细");
        XLSX.writeFile(wb, `销退信息_按销退单号_${ts}.xlsx`);
      }
    };
    return () => { if (exportRef) exportRef.current = null; };
  }, [rows, aggQ.data, exportRef]);

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
            <TableHead>供应商</TableHead>
            <TableHead className="text-right">销退件数</TableHead>
            <TableHead className="text-right">销退金额</TableHead>
            <TableHead className="text-right">销退单数</TableHead>
            <TableHead className="text-right">原始订单数</TableHead>
            <TableHead className="text-right">SKU 数</TableHead>
            <TableHead>最近销退</TableHead>
            <TableHead>首次销退</TableHead>
            <TableHead>仓库</TableHead>
            <TableHead>异常</TableHead>
            <TableHead>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {aggQ.isLoading && <TableRow><TableCell colSpan={14} className="text-center py-12 text-muted-foreground">聚合中...</TableCell></TableRow>}
          {aggQ.error && <TableRow><TableCell colSpan={14} className="text-center py-12 text-rose-600">读取失败：{(aggQ.error as any).message}</TableCell></TableRow>}
          {!aggQ.isLoading && !aggQ.error && totalCount === 0 && (
            <TableRow><TableCell colSpan={14} className="text-center py-12 text-muted-foreground">当前筛选下没有销退款式数据</TableCell></TableRow>
          )}
          {pageRows.map(r => (
            <TableRow key={r.key}>
              <TableCell className="font-mono text-xs">{r.style_no}</TableCell>
              <TableCell className="text-xs max-w-[260px] truncate" title={r.product_name}>{r.product_name || "-"}</TableCell>
              <TableCell className="text-xs">{r.shop_name}</TableCell>
              <TableCell className="text-xs">{r.supplier_name}</TableCell>
              <TableCell className="text-right">{fmtInt(r.qty)}</TableCell>
              <TableCell className="text-right">{r.amt > 0 ? fmtMoney(r.amt) : "-"}</TableCell>
              <TableCell className="text-right">{fmtInt(r.as_set.size)}</TableCell>
              <TableCell className="text-right">{fmtInt(r.so_set.size)}</TableCell>
              <TableCell className="text-right">{fmtInt(r.sku_set.size)}</TableCell>
              <TableCell className="text-xs whitespace-nowrap">{formatDateTimeCN(r.last_at, { withSeconds: false })}</TableCell>
              <TableCell className="text-xs whitespace-nowrap">{formatDateTimeCN(r.first_at, { withSeconds: false })}</TableCell>
              <TableCell className="text-xs">{whLabel(r.wh_set)}</TableCell>
              <TableCell>{r.abnormal ? <Badge variant="destructive">异常</Badge> : null}</TableCell>
              <TableCell><Button size="sm" variant="ghost" onClick={() => setDetailKey(r.key)}>详情</Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between p-3 border-t">
          <div className="text-xs text-muted-foreground">共 {totalCount} 个款式 · 第 {page + 1} / {Math.ceil(totalCount / PAGE_SIZE)} 页</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</Button>
            <Button size="sm" variant="outline" disabled={(page + 1) * PAGE_SIZE >= totalCount} onClick={() => setPage(p => p + 1)}>下一页</Button>
          </div>
        </div>
      )}

      <Sheet open={!!detailKey} onOpenChange={(o) => !o && setDetailKey(null)}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>款式销退详情 · {detailRow?.style_no}</SheetTitle>
            <SheetDescription>{detailRow?.product_name} · {detailRow?.shop_name}</SheetDescription>
          </SheetHeader>
          {detailRow && (
            <div className="space-y-5 mt-4 text-sm">
              <section className="grid grid-cols-2 gap-y-1">
                <div><span className="text-muted-foreground">销退件数：</span>{fmtInt(detailRow.qty)}</div>
                <div><span className="text-muted-foreground">销退金额：</span>{fmtMoney(detailRow.amt)}</div>
                <div><span className="text-muted-foreground">销退单数：</span>{fmtInt(detailRow.as_set.size)}</div>
                <div><span className="text-muted-foreground">原始订单数：</span>{fmtInt(detailRow.so_set.size)}</div>
                <div><span className="text-muted-foreground">SKU 数：</span>{fmtInt(detailRow.sku_set.size)}</div>
                <div><span className="text-muted-foreground">仓库：</span>{whLabel(detailRow.wh_set)}</div>
                <div><span className="text-muted-foreground">首次销退：</span>{formatDateTimeCN(detailRow.first_at)}</div>
                <div><span className="text-muted-foreground">最近销退：</span>{formatDateTimeCN(detailRow.last_at)}</div>
              </section>

              <section>
                <h3 className="font-medium mb-2">按销退单明细</h3>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>销退单号</TableHead><TableHead>SKU</TableHead><TableHead>商品</TableHead>
                    <TableHead className="text-right">件数</TableHead><TableHead className="text-right">金额</TableHead>
                    <TableHead>店铺</TableHead><TableHead>销退时间</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {detailItems.map((it, idx) => {
                      const o = aggQ.data!.orderByAs.get(it.as_id);
                      return (
                        <TableRow key={`${it.as_id}-${it.sku_id}-${idx}`}>
                          <TableCell className="font-mono text-xs">{it.as_id}</TableCell>
                          <TableCell className="font-mono text-xs">{it.sku_id ?? "-"}</TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate">{it.name}</TableCell>
                          <TableCell className="text-right">{fmtInt(it.qty)}</TableCell>
                          <TableCell className="text-right">{it.amount > 0 ? fmtMoney(it.amount) : "-"}</TableCell>
                          <TableCell className="text-xs">{o?.shop_name ?? "-"}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{formatDateTimeCN(o?.received_date, { withSeconds: false })}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </CardContent></Card>
  );
}
