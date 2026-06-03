import { useMemo, useState, useEffect } from "react";
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
import {
  formatDateTimeCN, beijingDayRangeToUTC, todayCN,
} from "@/lib/datetime";

const PAGE_SIZE = 20;
const fmtMoney = (n: number | null | undefined) =>
  "¥" + Number(n ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const fmtInt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 });

export type ByStyleFilters = {
  startDate: string; endDate: string; supplier: string; warehouse: string;
  ioNo: string; poNo: string; sku: string; status: string;
  hasPo: string; hasItems: string; abnormal: string;
};

type AggItem = {
  receipt_id: string;
  sku_no: string | null;
  product_name: string | null;
  product_id: string | null;
  sku_id: string | null;
  received_qty: number;
  cost_amount: number;
  cost_price: number;
  external_po_id: string | null;
  external_io_id: string | null;
};

type ReceiptMeta = {
  id: string;
  external_io_id: string | null;
  external_po_id: string | null;
  io_date: string | null;
  supplier_name: string | null;
  warehouse_name: string | null;
  status: string | null;
  jst_modified_at: string | null;
  purchase_order_id: string | null;
};

type StyleRow = {
  key: string;
  style_no: string;
  product_name: string;
  supplier_name: string;
  qty: number;
  amt: number;
  io_set: Set<string>;
  po_set: Set<string>;
  sku_set: Set<string>;
  wh_set: Set<string>;
  first_io: string | null;
  last_io: string | null;
};

function styleOf(sku: string | null | undefined, productName: string | null | undefined) {
  const s = (sku ?? "").trim();
  if (s) {
    // 常见约定 款号-颜色-尺码；取第一个分段
    const seg = s.split(/[-_/\s]/)[0];
    if (seg) return seg;
  }
  return (productName ?? "").trim() || "(未知款号)";
}

function applyReceiptFilters(q: any, f: ByStyleFilters) {
  if (f.startDate) { const r = beijingDayRangeToUTC(f.startDate); if (r) q = q.gte("io_date", r.gte); }
  if (f.endDate)   { const r = beijingDayRangeToUTC(f.endDate);   if (r) q = q.lte("io_date", r.lte); }
  if (f.supplier) q = q.ilike("supplier_name", `%${f.supplier}%`);
  if (f.warehouse) q = q.ilike("warehouse_name", `%${f.warehouse}%`);
  if (f.ioNo) q = q.ilike("external_io_id", `%${f.ioNo}%`);
  if (f.poNo) q = q.ilike("external_po_id", `%${f.poNo}%`);
  if (f.status !== "all") q = q.eq("status", f.status);
  if (f.hasPo === "yes") q = q.not("purchase_order_id", "is", null);
  if (f.hasPo === "no") q = q.is("purchase_order_id", null);
  return q;
}

function useStyleAggregate(filters: ByStyleFilters) {
  return useQuery({
    queryKey: ["inbound_by_style", filters],
    queryFn: async () => {
      // 1) 取符合筛选的入库单主表（最多 5000）
      let q = supabase.from("purchase_receipts")
        .select("id, external_io_id, external_po_id, io_date, supplier_name, warehouse_name, status, jst_modified_at, purchase_order_id")
        .limit(5000);
      q = applyReceiptFilters(q, filters);
      const { data: recs, error } = await q;
      if (error) throw error;
      const receipts = (recs ?? []) as ReceiptMeta[];
      const receiptMap = new Map<string, ReceiptMeta>(receipts.map(r => [r.id, r]));
      const ids = receipts.map(r => r.id);
      if (!ids.length) return { rows: [] as StyleRow[], items: [] as AggItem[], receiptMap };

      // 2) 取入库明细
      const allItems: AggItem[] = [];
      for (let i = 0; i < ids.length; i += 800) {
        const slice = ids.slice(i, i + 800);
        let iq = supabase.from("purchase_receipt_items")
          .select("receipt_id, sku_no, product_name, product_id, sku_id, received_qty, cost_amount, cost_price, external_po_id, external_io_id")
          .in("receipt_id", slice);
        if (filters.sku) iq = iq.ilike("sku_no", `%${filters.sku}%`);
        const { data: items, error: itErr } = await iq;
        if (itErr) throw itErr;
        for (const it of items ?? []) {
          allItems.push({
            receipt_id: (it as any).receipt_id,
            sku_no: (it as any).sku_no,
            product_name: (it as any).product_name,
            product_id: (it as any).product_id,
            sku_id: (it as any).sku_id,
            received_qty: Number((it as any).received_qty ?? 0),
            cost_amount: Number((it as any).cost_amount ?? 0),
            cost_price: Number((it as any).cost_price ?? 0),
            external_po_id: (it as any).external_po_id,
            external_io_id: (it as any).external_io_id,
          });
        }
      }

      // 3) 应用 hasItems / abnormal 过滤（按 receipt 维度的明细情况）
      const receiptItemCount = new Map<string, number>();
      for (const it of allItems) {
        receiptItemCount.set(it.receipt_id, (receiptItemCount.get(it.receipt_id) ?? 0) + 1);
      }
      const allowedReceipts = new Set<string>();
      for (const r of receipts) {
        const c = receiptItemCount.get(r.id) ?? 0;
        if (filters.hasItems === "yes" && c === 0) continue;
        if (filters.hasItems === "no" && c > 0) continue;
        if (filters.abnormal === "yes" && c > 0) continue;
        if (filters.abnormal === "no" && c === 0) continue;
        allowedReceipts.add(r.id);
      }
      const filteredItems = allItems.filter(it => allowedReceipts.has(it.receipt_id));

      // 4) 按款 + 供应商 聚合
      const styleMap = new Map<string, StyleRow>();
      for (const it of filteredItems) {
        const rec = receiptMap.get(it.receipt_id);
        const supplier = (rec?.supplier_name ?? "").trim() || "(未知供应商)";
        const style = styleOf(it.sku_no, it.product_name);
        const key = `${style}__${supplier}`;
        let row = styleMap.get(key);
        if (!row) {
          row = {
            key, style_no: style,
            product_name: it.product_name ?? "",
            supplier_name: supplier,
            qty: 0, amt: 0,
            io_set: new Set(), po_set: new Set(), sku_set: new Set(), wh_set: new Set(),
            first_io: null, last_io: null,
          };
          styleMap.set(key, row);
        }
        row.qty += it.received_qty;
        row.amt += it.cost_amount;
        const ioNo = rec?.external_io_id ?? it.external_io_id ?? "";
        if (ioNo) row.io_set.add(ioNo);
        const poNo = it.external_po_id ?? rec?.external_po_id ?? "";
        if (poNo) row.po_set.add(poNo);
        const skuKey = it.sku_no || it.sku_id || "";
        if (skuKey) row.sku_set.add(skuKey);
        const wh = rec?.warehouse_name ?? "";
        if (wh) row.wh_set.add(wh);
        const d = rec?.io_date ?? null;
        if (d) {
          if (!row.first_io || d < row.first_io) row.first_io = d;
          if (!row.last_io  || d > row.last_io)  row.last_io = d;
        }
        if (!row.product_name && it.product_name) row.product_name = it.product_name;
      }

      const rows = Array.from(styleMap.values())
        .sort((a, b) => String(b.last_io ?? "").localeCompare(String(a.last_io ?? "")));
      return { rows, items: filteredItems, receiptMap };
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

export default function InboundByStyleTab({ filters }: { filters: ByStyleFilters }) {
  const aggQ = useStyleAggregate(filters);
  const [page, setPage] = useState(0);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  useEffect(() => { setPage(0); }, [filters]);

  const rows = aggQ.data?.rows ?? [];
  const totalCount = rows.length;
  const pageRows = useMemo(
    () => rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [rows, page]
  );

  const detailRow = useMemo(
    () => rows.find(r => r.key === detailKey) ?? null,
    [rows, detailKey]
  );
  const detailItems = useMemo(() => {
    if (!detailRow || !aggQ.data) return [] as AggItem[];
    const supplier = detailRow.supplier_name;
    return aggQ.data.items.filter(it => {
      const rec = aggQ.data.receiptMap.get(it.receipt_id);
      const sp = (rec?.supplier_name ?? "").trim() || "(未知供应商)";
      const st = styleOf(it.sku_no, it.product_name);
      return st === detailRow.style_no && sp === supplier;
    });
  }, [detailRow, aggQ.data]);

  const exportRows = () => {
    if (!rows.length) return toast({ title: "无数据可导出" });
    const headers = ["款号/商品编码", "商品名称", "供应商", "入库件数", "入库金额",
      "入库单数", "关联采购单数", "SKU数", "首次入库时间", "最近入库时间", "涉及仓库"];
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push([
        r.style_no, r.product_name, r.supplier_name, r.qty, r.amt.toFixed(2),
        r.io_set.size, r.po_set.size, r.sku_set.size,
        formatDateTimeCN(r.first_io, { withSeconds: false }),
        formatDateTimeCN(r.last_io, { withSeconds: false }),
        whLabel(r.wh_set),
      ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `入库款式统计_${todayCN()}.csv`;
    a.click();
  };

  // SKU 维度聚合（详情用）
  const skuBreakdown = useMemo(() => {
    if (!detailRow) return [] as any[];
    const m = new Map<string, any>();
    for (const it of detailItems) {
      const rec = aggQ.data!.receiptMap.get(it.receipt_id);
      const k = it.sku_no || it.sku_id || "(未知SKU)";
      let row = m.get(k);
      if (!row) {
        row = { sku_no: it.sku_no || "-", product_name: it.product_name || "-",
          qty: 0, amt: 0, io_set: new Set<string>(), last_io: null as string | null };
        m.set(k, row);
      }
      row.qty += it.received_qty;
      row.amt += it.cost_amount;
      const ioNo = rec?.external_io_id ?? it.external_io_id ?? "";
      if (ioNo) row.io_set.add(ioNo);
      const d = rec?.io_date ?? null;
      if (d && (!row.last_io || d > row.last_io)) row.last_io = d;
    }
    return Array.from(m.values()).sort((a, b) => b.qty - a.qty);
  }, [detailRow, detailItems, aggQ.data]);

  // 采购单维度聚合（详情用）
  const poBreakdown = useMemo(() => {
    if (!detailRow) return [] as any[];
    const m = new Map<string, any>();
    for (const it of detailItems) {
      const rec = aggQ.data!.receiptMap.get(it.receipt_id);
      const poNo = it.external_po_id ?? rec?.external_po_id ?? "(无采购单)";
      let row = m.get(poNo);
      if (!row) {
        row = { po_no: poNo, qty: 0, last_io: null as string | null };
        m.set(poNo, row);
      }
      row.qty += it.received_qty;
      const d = rec?.io_date ?? null;
      if (d && (!row.last_io || d > row.last_io)) row.last_io = d;
    }
    return Array.from(m.values()).sort((a, b) => String(b.last_io ?? "").localeCompare(String(a.last_io ?? "")));
  }, [detailRow, detailItems, aggQ.data]);

  // 入库单记录（详情用）
  const ioBreakdown = useMemo(() => {
    if (!detailRow) return [] as any[];
    const m = new Map<string, any>();
    for (const it of detailItems) {
      const rec = aggQ.data!.receiptMap.get(it.receipt_id);
      const ioNo = rec?.external_io_id ?? it.external_io_id ?? "(未知)";
      let row = m.get(ioNo);
      if (!row) {
        row = {
          io_no: ioNo, io_date: rec?.io_date ?? null, po_no: rec?.external_po_id ?? "-",
          warehouse: rec?.warehouse_name ?? "-", jst_modified_at: rec?.jst_modified_at ?? null,
          qty: 0, amt: 0, sku_set: new Set<string>(),
        };
        m.set(ioNo, row);
      }
      row.qty += it.received_qty;
      row.amt += it.cost_amount;
      const sk = it.sku_no || it.sku_id || "";
      if (sk) row.sku_set.add(sk);
    }
    return Array.from(m.values())
      .map(r => ({ ...r, sku_count: r.sku_set.size }))
      .sort((a, b) => String(b.io_date ?? "").localeCompare(String(a.io_date ?? "")));
  }, [detailRow, detailItems, aggQ.data]);

  return (
    <Card><CardContent className="p-0">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="text-xs text-muted-foreground">
          按「款号 + 供应商」聚合 · 当前筛选 {totalCount} 个款式
        </div>
        <Button size="sm" variant="outline" onClick={exportRows}>
          <Download className="w-4 h-4 mr-1" />导出当前 Tab
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>款号 / 商品编码</TableHead>
            <TableHead>商品名称</TableHead>
            <TableHead>供应商</TableHead>
            <TableHead className="text-right">入库件数</TableHead>
            <TableHead className="text-right">入库金额</TableHead>
            <TableHead className="text-right">入库单数</TableHead>
            <TableHead className="text-right">采购单数</TableHead>
            <TableHead className="text-right">SKU 数</TableHead>
            <TableHead>最近入库</TableHead>
            <TableHead>首次入库</TableHead>
            <TableHead>仓库</TableHead>
            <TableHead>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {aggQ.isLoading && <TableRow><TableCell colSpan={12} className="text-center py-12 text-muted-foreground">聚合中...</TableCell></TableRow>}
          {aggQ.error && <TableRow><TableCell colSpan={12} className="text-center py-12 text-rose-600">读取失败：{(aggQ.error as any).message}</TableCell></TableRow>}
          {!aggQ.isLoading && !aggQ.error && totalCount === 0 && (
            <TableRow><TableCell colSpan={12} className="text-center py-12 text-muted-foreground">
              当前筛选下没有入库款式数据
            </TableCell></TableRow>
          )}
          {pageRows.map(r => (
            <TableRow key={r.key}>
              <TableCell className="font-mono text-xs">{r.style_no}</TableCell>
              <TableCell className="text-xs">{r.product_name || "-"}</TableCell>
              <TableCell className="text-xs">{r.supplier_name}</TableCell>
              <TableCell className="text-right">{fmtInt(r.qty)}</TableCell>
              <TableCell className="text-right">{r.amt > 0 ? fmtMoney(r.amt) : "-"}</TableCell>
              <TableCell className="text-right">{fmtInt(r.io_set.size)}</TableCell>
              <TableCell className="text-right">{fmtInt(r.po_set.size)}</TableCell>
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
            <SheetTitle>款式入库详情 · {detailRow?.style_no}</SheetTitle>
            <SheetDescription>{detailRow?.product_name} · {detailRow?.supplier_name}</SheetDescription>
          </SheetHeader>
          {detailRow && (
            <div className="space-y-5 mt-4 text-sm">
              <section>
                <h3 className="font-medium mb-2">A. 基础信息</h3>
                <div className="grid grid-cols-2 gap-y-1">
                  <div><span className="text-muted-foreground">款号 / 商品编码：</span>{detailRow.style_no}</div>
                  <div><span className="text-muted-foreground">商品名称：</span>{detailRow.product_name || "-"}</div>
                  <div><span className="text-muted-foreground">供应商：</span>{detailRow.supplier_name}</div>
                  <div><span className="text-muted-foreground">筛选日期：</span>{filters.startDate || "全部"} ~ {filters.endDate || "全部"}</div>
                  <div><span className="text-muted-foreground">入库总件数：</span>{fmtInt(detailRow.qty)}</div>
                  <div><span className="text-muted-foreground">入库总金额：</span>{fmtMoney(detailRow.amt)}</div>
                  <div><span className="text-muted-foreground">入库单数：</span>{fmtInt(detailRow.io_set.size)}</div>
                  <div><span className="text-muted-foreground">采购单数：</span>{fmtInt(detailRow.po_set.size)}</div>
                  <div><span className="text-muted-foreground">SKU 数：</span>{fmtInt(detailRow.sku_set.size)}</div>
                  <div><span className="text-muted-foreground">涉及仓库：</span>{whLabel(detailRow.wh_set)}</div>
                  <div><span className="text-muted-foreground">首次入库：</span>{formatDateTimeCN(detailRow.first_io)}</div>
                  <div><span className="text-muted-foreground">最近入库：</span>{formatDateTimeCN(detailRow.last_io)}</div>
                </div>
              </section>

              <section>
                <h3 className="font-medium mb-2">B. SKU 入库明细</h3>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>SKU 编码</TableHead><TableHead>商品名称</TableHead>
                    <TableHead className="text-right">入库件数</TableHead>
                    <TableHead className="text-right">入库金额</TableHead>
                    <TableHead className="text-right">入库单数</TableHead>
                    <TableHead>最近入库</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {skuBreakdown.map((s: any) => (
                      <TableRow key={s.sku_no}>
                        <TableCell className="font-mono text-xs">{s.sku_no}</TableCell>
                        <TableCell className="text-xs">{s.product_name}</TableCell>
                        <TableCell className="text-right">{fmtInt(s.qty)}</TableCell>
                        <TableCell className="text-right">{s.amt > 0 ? fmtMoney(s.amt) : "-"}</TableCell>
                        <TableCell className="text-right">{fmtInt(s.io_set.size)}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{formatDateTimeCN(s.last_io, { withSeconds: false })}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>

              <section>
                <h3 className="font-medium mb-2">C. 关联采购单</h3>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>采购单号</TableHead>
                    <TableHead className="text-right">本款已入库数量</TableHead>
                    <TableHead>最近入库时间</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {poBreakdown.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-4">无关联采购单</TableCell></TableRow>}
                    {poBreakdown.map((p: any) => (
                      <TableRow key={p.po_no}>
                        <TableCell className="font-mono text-xs">{p.po_no}</TableCell>
                        <TableCell className="text-right">{fmtInt(p.qty)}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{formatDateTimeCN(p.last_io, { withSeconds: false })}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>

              <section>
                <h3 className="font-medium mb-2">D. 入库单记录</h3>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>入库单号</TableHead>
                    <TableHead>入库日期</TableHead>
                    <TableHead>采购单号</TableHead>
                    <TableHead>仓库</TableHead>
                    <TableHead className="text-right">SKU 数</TableHead>
                    <TableHead className="text-right">本款入库件数</TableHead>
                    <TableHead className="text-right">本款入库金额</TableHead>
                    <TableHead>JST 修改时间</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {ioBreakdown.map((r: any) => (
                      <TableRow key={r.io_no}>
                        <TableCell className="font-mono text-xs">{r.io_no}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{formatDateTimeCN(r.io_date, { withSeconds: false })}</TableCell>
                        <TableCell className="font-mono text-xs">{r.po_no}</TableCell>
                        <TableCell className="text-xs">{r.warehouse}</TableCell>
                        <TableCell className="text-right">{fmtInt(r.sku_count)}</TableCell>
                        <TableCell className="text-right">{fmtInt(r.qty)}</TableCell>
                        <TableCell className="text-right">{r.amt > 0 ? fmtMoney(r.amt) : "-"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{formatDateTimeCN(r.jst_modified_at, { withSeconds: false })}</TableCell>
                      </TableRow>
                    ))}
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
