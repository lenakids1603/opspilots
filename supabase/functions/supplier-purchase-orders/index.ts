// 供应商采购单查询接口（RLS 强制隔离）
// GET ?view=order|style&start_date&end_date&keyword&warehouse_status&page&page_size
//
// 使用用户的 Authorization 调用 supabase 客户端，依赖数据库 RLS 保证供应商只能看到自己的数据。
// 不使用 service role，避免绕过 RLS。

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: claims, error: authErr } = await supabase.auth.getClaims(
    auth.slice(7),
  );
  if (authErr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);

  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "order";
  const startDate = url.searchParams.get("start_date");
  const endDate = url.searchParams.get("end_date");
  const keyword = (url.searchParams.get("keyword") ?? "").trim();
  const warehouseStatus = url.searchParams.get("warehouse_status"); // not_received|partial|received|null
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("page_size") ?? 50)));

  try {
    if (view === "style") {
      // 按款号聚合：先取符合条件的 items，再在内存聚合
      let q = supabase
        .from("purchase_order_items")
        .select(
          "id, purchase_order_id, style_no, product_name, product_image_url, purchase_qty, received_qty, unreceived_qty, delivery_date, purchase_orders!inner(id, external_po_id, po_date, warehouse_status, supplier_id)",
        )
        .limit(5000);
      if (startDate) q = q.gte("purchase_orders.po_date", startDate);
      if (endDate) q = q.lte("purchase_orders.po_date", endDate);
      if (warehouseStatus) q = q.eq("purchase_orders.warehouse_status", warehouseStatus);
      if (keyword) q = q.or(`style_no.ilike.%${keyword}%,product_name.ilike.%${keyword}%`);
      const { data, error } = await q;
      if (error) throw error;

      const grouped = new Map<string, any>();
      for (const it of data ?? []) {
        const key = it.style_no || "(未填款号)";
        const g = grouped.get(key) ?? {
          style_no: key,
          product_name: it.product_name,
          product_image_url: it.product_image_url,
          purchase_order_ids: new Set<string>(),
          total_purchase_qty: 0,
          total_received_qty: 0,
          total_unreceived_qty: 0,
          latest_po_date: null as string | null,
          latest_delivery_date: null as string | null,
          warehouse_statuses: new Set<string>(),
        };
        g.purchase_order_ids.add(it.purchase_order_id);
        g.total_purchase_qty += Number(it.purchase_qty || 0);
        g.total_received_qty += Number(it.received_qty || 0);
        g.total_unreceived_qty += Number(it.unreceived_qty || 0);
        const poDate = (it as any).purchase_orders?.po_date;
        if (poDate && (!g.latest_po_date || poDate > g.latest_po_date)) g.latest_po_date = poDate;
        if (it.delivery_date && (!g.latest_delivery_date || it.delivery_date > g.latest_delivery_date))
          g.latest_delivery_date = it.delivery_date;
        const ws = (it as any).purchase_orders?.warehouse_status;
        if (ws) g.warehouse_statuses.add(ws);
        grouped.set(key, g);
      }
      const all = Array.from(grouped.values())
        .map((g) => {
          const statuses = Array.from(g.warehouse_statuses);
          let summary = "未入库";
          if (statuses.length === 1) {
            summary = labelStatus(statuses[0]);
          } else if (statuses.includes("partial") || (statuses.includes("not_received") && statuses.includes("received"))) {
            summary = "部分入库";
          } else if (statuses.every((s) => s === "received")) summary = "已入库";
          return {
            style_no: g.style_no,
            product_name: g.product_name,
            product_image_url: g.product_image_url,
            purchase_order_count: g.purchase_order_ids.size,
            total_purchase_qty: g.total_purchase_qty,
            total_received_qty: g.total_received_qty,
            total_unreceived_qty: g.total_unreceived_qty,
            receipt_progress: g.total_purchase_qty > 0 ? g.total_received_qty / g.total_purchase_qty : 0,
            latest_po_date: g.latest_po_date,
            latest_delivery_date: g.latest_delivery_date,
            warehouse_status_summary: summary,
          };
        })
        .sort((a, b) => (b.latest_po_date ?? "").localeCompare(a.latest_po_date ?? ""));

      const total = all.length;
      const paged = all.slice((page - 1) * pageSize, page * pageSize);
      return json({ data: paged, pagination: { page, page_size: pageSize, total } });
    }

    // view = order
    let q = supabase
      .from("purchase_orders")
      .select(
        "id, external_po_id, po_date, supplier_name, status, status_label, warehouse_status, total_purchase_qty, total_received_qty, total_unreceived_qty, total_amount, expected_delivery_date, latest_receipt_at, remark, purchase_order_items(style_no, sku_no)",
        { count: "exact" },
      )
      .order("po_date", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (startDate) q = q.gte("po_date", startDate);
    if (endDate) q = q.lte("po_date", endDate);
    if (warehouseStatus) q = q.eq("warehouse_status", warehouseStatus);
    if (keyword) {
      // 关键字按款号 / 商品名匹配 → 先找到匹配的 po_id，再过滤
      const { data: hit } = await supabase
        .from("purchase_order_items")
        .select("purchase_order_id")
        .or(`style_no.ilike.%${keyword}%,product_name.ilike.%${keyword}%,sku_no.ilike.%${keyword}%`)
        .limit(1000);
      const ids = Array.from(new Set((hit ?? []).map((r: any) => r.purchase_order_id)));
      if (ids.length === 0) return json({ data: [], pagination: { page, page_size: pageSize, total: 0 } });
      q = q.in("id", ids);
    }
    const { data, count, error } = await q;
    if (error) throw error;
    const rows = (data ?? []).map((po: any) => {
      const styles = new Set((po.purchase_order_items ?? []).map((i: any) => i.style_no).filter(Boolean));
      const skus = new Set((po.purchase_order_items ?? []).map((i: any) => i.sku_no).filter(Boolean));
      return {
        id: po.id,
        external_po_id: po.external_po_id,
        po_date: po.po_date,
        supplier_name: po.supplier_name,
        status: po.status,
        status_label: po.status_label || po.status,
        warehouse_status: po.warehouse_status,
        warehouse_status_label: labelStatus(po.warehouse_status),
        style_count: styles.size,
        sku_count: skus.size,
        total_purchase_qty: Number(po.total_purchase_qty || 0),
        total_received_qty: Number(po.total_received_qty || 0),
        total_unreceived_qty: Number(po.total_unreceived_qty || 0),
        total_amount: Number(po.total_amount || 0),
        expected_delivery_date: po.expected_delivery_date,
        latest_receipt_at: po.latest_receipt_at,
        remark: po.remark,
      };
    });
    return json({ data: rows, pagination: { page, page_size: pageSize, total: count ?? rows.length } });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

function labelStatus(s: string) {
  return s === "received" ? "已入库" : s === "partial" ? "部分入库" : "未入库";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
