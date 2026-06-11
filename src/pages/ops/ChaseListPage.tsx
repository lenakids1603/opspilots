import React, { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, RefreshCw, Download, ChevronDown, ChevronRight, PartyPopper, ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ops/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatDateTimeCN, todayCN } from "@/lib/datetime";

type PoDetail = { po_id: string; delivery_date: string | null; overdue_days: number; qty: number };
type SupplierRow = {
  supplier_id: string;
  supplier_name: string;
  sku: string;
  style_no: string;
  total_qty: number;
  overdue_qty: number;
  due24_qty: number;
  due48_qty: number;
  due72_qty: number;
  later_qty: number;
  po_count: number;
  max_overdue_days: number;
  po_details: PoDetail[];
};
type PendingReviewCount = {
  pending_review_orders: number;
  pending_review_items: number;
  pending_review_qty: number;
};
type PurchaseRow = {
  sku: string;
  style_no: string;
  supplier_name: string;
  pending_qty: number;
  intransit_qty: number;
  missing_date_qty: number;
  late_order_qty: number;
  urge_supplier_qty: number;
  closed_short_qty: number;
  raw_gap: number;
  return_in_transit: number;
  resale_rate: number;
  return_offset: number;
  final_gap: number;
  earliest_pay_time: string | null;
};
type UrgencyRow = {
  urgency: "overdue" | "due24" | "due48" | "due72" | "later";
  qty: number;
  order_count: number;
  supplier_count: number;
};
type ClosedShortPoDetail = { po_id: string; delivery_date: string | null; short_qty: number };
type ClosedShortRow = {
  sku: string;
  style_no: string;
  supplier_name: string;
  short_qty: number;
  order_count: number;
  po_count: number;
  oldest_pay_time: string | null;
  po_details: ClosedShortPoDetail[];
};
type SkuImageRow = { sku: string; image_url: string | null };

const fmtNum = (n: number | null | undefined) =>
  n == null ? "-" : Number(n).toLocaleString("zh-CN");

const fmtMMDDHM = (input: string | null) => {
  if (!input) return "-";
  const d = new Date(input);
  if (isNaN(d.getTime())) return "-";
  const s = d.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai", hour12: false,
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  return s.replace(/\//g, "-");
};

function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [headers, ...rows].map(r => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

/** 批量获取 SKU 缩略图。skus 数组会被排序去重作为 query key。 */
function useSkuImages(skus: string[], enabled = true) {
  const uniq = useMemo(() => {
    const s = Array.from(new Set(skus.filter(Boolean))).sort();
    return s;
  }, [skus]);
  const key = uniq.join(",");
  return useQuery({
    queryKey: ["sku-images", key],
    enabled: enabled && uniq.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ops_sku_images" as never, { _skus: uniq } as never);
      if (error) throw error;
      const map: Record<string, string | null> = {};
      for (const row of (data ?? []) as SkuImageRow[]) {
        map[row.sku] = row.image_url ?? null;
      }
      return map;
    },
  });
}

function SkuThumb({ sku, imageUrl, onPreview, size = 40 }: {
  sku: string;
  imageUrl: string | null | undefined;
  onPreview: (url: string, sku: string) => void;
  size?: number;
}) {
  const [errored, setErrored] = useState(false);
  const showImg = !!imageUrl && !errored;
  return (
    <div
      className={cn(
        "rounded-md bg-muted overflow-hidden flex items-center justify-center shrink-0",
        showImg && "cursor-zoom-in",
      )}
      style={{ width: size, height: size }}
      onClick={() => { if (showImg) onPreview(imageUrl!, sku); }}
      title={sku}
    >
      {showImg ? (
        <img
          src={imageUrl!}
          alt={sku}
          referrerPolicy="no-referrer"
          loading="lazy"
          className="w-full h-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <ImageIcon className="size-4 text-muted-foreground/60" />
      )}
    </div>
  );
}

export default function ChaseListPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("supplier");
  const [showSC, setShowSC] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [openPo, setOpenPo] = useState<Record<string, boolean>>({});
  const [openClosed, setOpenClosed] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<{ url: string; sku: string } | null>(null);
  const onPreview = (url: string, sku: string) => setPreview({ url, sku });

  const queries = useQueries({
    queries: [
      {
        queryKey: ["chase", "supplier_list"],
        queryFn: async () => {
          const { data, error } = await supabase.rpc("ops_chase_supplier_list" as never);
          if (error) throw error;
          return (data ?? []) as SupplierRow[];
        },
        staleTime: 60_000,
      },
      {
        queryKey: ["chase", "question_count"],
        queryFn: async () => {
          const { data, error } = await supabase.rpc("ops_chase_question_count" as never);
          if (error) throw error;
          const arr = (data ?? []) as unknown as PendingReviewCount[];
          const row = Array.isArray(arr) ? arr[0] : (arr as unknown as PendingReviewCount);
          return (row ?? { pending_review_orders: 0, pending_review_items: 0, pending_review_qty: 0 }) as PendingReviewCount;
        },
        staleTime: 60_000,
      },
      {
        queryKey: ["chase", "purchase_list"],
        queryFn: async () => {
          const { data, error } = await supabase.rpc("ops_chase_purchase_list" as never);
          if (error) throw error;
          return (data ?? []) as PurchaseRow[];
        },
        staleTime: 60_000,
      },
      {
        queryKey: ["chase", "urgency_summary"],
        queryFn: async () => {
          const { data, error } = await supabase.rpc("ops_chase_urgency_summary" as never);
          if (error) throw error;
          return (data ?? []) as UrgencyRow[];
        },
        staleTime: 60_000,
      },
      {
        queryKey: ["chase", "closed_short_list"],
        queryFn: async () => {
          const { data, error } = await supabase.rpc("ops_chase_closed_short_list" as never);
          if (error) throw error;
          return (data ?? []) as ClosedShortRow[];
        },
        staleTime: 60_000,
      },
    ],
  });
  const [supplierQ, questionQ, purchaseQ, urgencyQ, closedQ] = queries;
  const loading = queries.some(q => q.isLoading);
  const anyError = queries.find(q => q.error)?.error as { code?: string; message?: string } | undefined;
  const isForbidden = anyError?.code === "42501" || /42501|权限|permission/i.test(anyError?.message ?? "");

  const supplierRows = (supplierQ.data ?? []) as SupplierRow[];
  const questionCount = (questionQ.data ?? { pending_review_orders: 0, pending_review_items: 0, pending_review_qty: 0 }) as PendingReviewCount;
  const purchaseRows = (purchaseQ.data ?? []) as PurchaseRow[];
  const urgencyRows = (urgencyQ.data ?? []) as UrgencyRow[];
  const closedRows = (closedQ.data ?? []) as ClosedShortRow[];
  const urgencyByKey = useMemo(() => {
    const m: Record<string, UrgencyRow> = {};
    for (const r of urgencyRows) m[r.urgency] = r;
    return m;
  }, [urgencyRows]);
  const overdueU = urgencyByKey.overdue;
  const due24U = urgencyByKey.due24;

  const summary = useMemo(() => {
    const totalQty = supplierRows.reduce((s, r) => s + Number(r.total_qty || 0), 0);
    const supplierIds = new Set(supplierRows.map(r => r.supplier_id));
    const skus = new Set(supplierRows.map(r => r.sku));
    return { totalQty, supplierCount: supplierIds.size, skuCount: skus.size };
  }, [supplierRows]);

  const grouped = useMemo(() => {
    const map = new Map<string, {
      supplier_id: string; supplier_name: string; rows: SupplierRow[];
      totalQty: number; overdueQty: number; due24Qty: number;
      styleCount: number; maxDays: number;
    }>();
    for (const r of supplierRows) {
      const g = map.get(r.supplier_id) ?? {
        supplier_id: r.supplier_id, supplier_name: r.supplier_name, rows: [],
        totalQty: 0, overdueQty: 0, due24Qty: 0, styleCount: 0, maxDays: 0,
      };
      g.rows.push(r);
      g.totalQty += Number(r.total_qty || 0);
      g.overdueQty += Number(r.overdue_qty || 0);
      g.due24Qty += Number(r.due24_qty || 0);
      g.maxDays = Math.max(g.maxDays, Number(r.max_overdue_days || 0));
      map.set(r.supplier_id, g);
    }
    const arr = Array.from(map.values()).map(g => ({
      ...g, styleCount: new Set(g.rows.map(r => r.sku)).size,
    }));
    arr.sort((a, b) => b.totalQty - a.totalQty);
    return arr;
  }, [supplierRows]);

  const firstSupplierId = grouped[0]?.supplier_id;
  const isExpanded = (id: string) => expanded[id] ?? id === firstSupplierId;
  const toggle = (id: string) => setExpanded(s => ({ ...s, [id]: !isExpanded(id) }));

  const visiblePurchase = useMemo(
    () => showSC ? purchaseRows : purchaseRows.filter(r => (r.sku || "").toUpperCase() !== "SC"),
    [purchaseRows, showSC],
  );

  // === 缩略图：按页签批量取 ===
  // 供应商页签：取所有"已展开供应商"的 SKU
  const supplierTabSkus = useMemo(() => {
    const set = new Set<string>();
    for (const g of grouped) {
      if (isExpanded(g.supplier_id)) {
        for (const r of g.rows) set.add(r.sku);
      }
    }
    return Array.from(set);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouped, expanded, firstSupplierId]);
  const purchaseTabSkus = useMemo(
    () => visiblePurchase.map(r => r.sku),
    [visiblePurchase],
  );
  const closedTabSkus = useMemo(() => closedRows.map(r => r.sku), [closedRows]);

  const supplierImgQ = useSkuImages(supplierTabSkus, tab === "supplier");
  const purchaseImgQ = useSkuImages(purchaseTabSkus, tab === "purchase");
  const closedImgQ = useSkuImages(closedTabSkus, tab === "closed");

  const exportSupplier = (g: typeof grouped[number]) => {
    const headers = ["款号", "SKU", "总件数", "其中已超时", "24小时内到期", "最长超期天数", "涉及采购单号"];
    const rows = g.rows.map(r => [
      r.style_no, r.sku,
      Number(r.total_qty || 0), Number(r.overdue_qty || 0), Number(r.due24_qty || 0),
      Number(r.max_overdue_days || 0),
      (r.po_details ?? []).map(p => p.po_id).join(" / "),
    ]);
    downloadCSV(`催货单_${g.supplier_name}_${todayCN()}.csv`, headers, rows);
  };

  const exportAll = () => {
    const headers = ["供应商", "款号", "SKU", "总件数", "其中已超时", "24小时内到期", "最长超期天数", "涉及采购单号"];
    const rows: (string | number)[][] = [];
    for (const g of grouped) {
      for (const r of g.rows) {
        rows.push([
          g.supplier_name, r.style_no, r.sku,
          Number(r.total_qty || 0), Number(r.overdue_qty || 0), Number(r.due24_qty || 0),
          Number(r.max_overdue_days || 0),
          (r.po_details ?? []).map(p => p.po_id).join(" / "),
        ]);
      }
    }
    downloadCSV(`催货单_全部_${todayCN()}.csv`, headers, rows);
  };

  const exportClosed = () => {
    const headers = ["SKU", "款号", "供应商", "少交件数", "影响订单数", "影响采购单数", "最早付款"];
    const rows = closedRows.map(r => [
      r.sku, r.style_no || "", r.supplier_name || "",
      Number(r.short_qty || 0), Number(r.order_count || 0), Number(r.po_count || 0),
      fmtMMDDHM(r.oldest_pay_time),
    ]);
    downloadCSV(`厂家已结单缺口_${todayCN()}.csv`, headers, rows);
  };

  const refresh = () => queries.forEach(q => q.refetch());

  return (
    <div className="p-6">
      <PageHeader
        breadcrumb={["运维系统", "催货清单"]}
        title="催货清单"
        description="按供应商汇总当前所有超期未发货 SKU，便于采购集中跟进。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportAll} disabled={loading || grouped.length === 0}>
              <Download className="mr-1" /> 导出全部
            </Button>
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={cn(loading && "animate-spin")} /> 刷新
            </Button>
          </>
        }
      />

      {isForbidden && (
        <Card className="border-amber-300 bg-amber-50/60 mb-4">
          <CardContent className="py-4 flex items-center gap-2 text-sm text-amber-800">
            <AlertTriangle className="text-amber-600" />
            此页面仅限内部账号访问。
          </CardContent>
        </Card>
      )}
      {!isForbidden && anyError && (
        <Card className="border-destructive/40 bg-destructive/5 mb-4">
          <CardContent className="py-4 text-sm text-destructive">
            数据加载失败：{anyError.message ?? "未知错误"}
          </CardContent>
        </Card>
      )}

      {/* 汇总卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <SummaryCard
          label="需催货件数" loading={loading}
          value={fmtNum(summary.totalQty)} suffix="件"
          extra={`涉及 ${fmtNum(summary.supplierCount)} 家供应商 · ${fmtNum(summary.skuCount)} 个 SKU`}
        />
        <SummaryCard
          label="已对客超时" loading={loading}
          value={fmtNum(overdueU?.qty ?? 0)} suffix="件" accent="danger"
          extra={`${fmtNum(overdueU?.order_count ?? 0)} 单`}
        />
        <SummaryCard
          label="24小时内到期" loading={loading}
          value={fmtNum(due24U?.qty ?? 0)} suffix="件" accent="warning"
          extra={`${fmtNum(due24U?.order_count ?? 0)} 单 · 今晚必催`}
        />
        <SummaryCard
          label="待审核单" loading={loading}
          value={fmtNum(questionCount.pending_review_orders)} suffix="单"
          onClick={() => navigate("/operations/sales-orders?order_status=Question")}
          extra="点击查看"
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="supplier">按供应商催货</TabsTrigger>
          <TabsTrigger value="purchase">采购缺口</TabsTrigger>
          <TabsTrigger value="closed">厂家已结单</TabsTrigger>
        </TabsList>

        <TabsContent value="supplier" className="mt-4">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : grouped.length === 0 ? (
            <Card>
              <CardContent className="py-12 flex flex-col items-center text-center gap-2 text-emerald-700">
                <PartyPopper className="size-8" />
                <div className="font-medium">当前没有需要催货的供应商 🎉</div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {grouped.map(g => {
                const open = isExpanded(g.supplier_id);
                return (
                  <Card key={g.supplier_id}>
                    <button
                      type="button"
                      onClick={() => toggle(g.supplier_id)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 text-left"
                    >
                      {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      <div className="font-medium flex-1 truncate">{g.supplier_name || "未知供应商"}</div>
                      <div className="text-sm text-muted-foreground hidden sm:block">
                        催货 <span className="text-foreground font-semibold">{fmtNum(g.totalQty)}</span> 件
                        · 涉及 {fmtNum(g.styleCount)} 款
                      </div>
                      {g.overdueQty > 0 && (
                        <Badge variant="destructive">已超时 {fmtNum(g.overdueQty)} 件</Badge>
                      )}
                      {g.due24Qty > 0 && (
                        <Badge className="bg-orange-500 hover:bg-orange-500/90 text-white border-transparent">
                          24h内 {fmtNum(g.due24Qty)} 件
                        </Badge>
                      )}
                      <Badge variant="secondary">最长超期 {g.maxDays} 天</Badge>
                      <Button
                        variant="outline" size="sm"
                        onClick={(e) => { e.stopPropagation(); exportSupplier(g); }}
                      >
                        <Download className="mr-1" /> 导出催货单
                      </Button>
                    </button>
                    {open && (
                      <div className="border-t overflow-x-auto">
                        <table className="w-full text-sm min-w-[920px]">
                          <thead className="bg-muted/40 text-muted-foreground">
                            <tr>
                              <th className="text-left px-4 py-2 font-medium w-8"></th>
                              <th className="text-left px-4 py-2 font-medium w-14">图</th>
                              <th className="text-left px-4 py-2 font-medium">SKU</th>
                              <th className="text-left px-4 py-2 font-medium">款号</th>
                              <th className="text-right px-4 py-2 font-medium">总件数</th>
                              <th className="text-right px-4 py-2 font-medium">已超时</th>
                              <th className="text-right px-4 py-2 font-medium">24h内</th>
                              <th className="text-right px-4 py-2 font-medium">48h内</th>
                              <th className="text-right px-4 py-2 font-medium">涉及采购单</th>
                              <th className="text-right px-4 py-2 font-medium">最长超期</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.rows.map((r) => {
                              const key = `${g.supplier_id}|${r.sku}`;
                              const poOpen = !!openPo[key];
                              return (
                                <React.Fragment key={key}>
                                  <tr className="border-t hover:bg-muted/20">
                                    <td className="px-4 py-2">
                                      <button
                                        type="button"
                                        onClick={() => setOpenPo(s => ({ ...s, [key]: !s[key] }))}
                                        className="text-muted-foreground hover:text-foreground"
                                        aria-label="展开采购单"
                                      >
                                        {poOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                                      </button>
                                    </td>
                                    <td className="px-4 py-2">
                                      <SkuThumb sku={r.sku} imageUrl={supplierImgQ.data?.[r.sku]} onPreview={onPreview} />
                                    </td>
                                    <td className="px-4 py-2 font-mono">{r.sku}</td>
                                    <td className="px-4 py-2">{r.style_no || "-"}</td>
                                    <td className="px-4 py-2 text-right font-semibold">{fmtNum(r.total_qty)}</td>
                                    <td className={cn("px-4 py-2 text-right", Number(r.overdue_qty) > 0 && "text-destructive font-medium")}>
                                      {fmtNum(r.overdue_qty)}
                                    </td>
                                    <td className={cn("px-4 py-2 text-right", Number(r.due24_qty) > 0 && "text-orange-500 font-medium")}>
                                      {fmtNum(r.due24_qty)}
                                    </td>
                                    <td className="px-4 py-2 text-right">{fmtNum(r.due48_qty)}</td>
                                    <td className="px-4 py-2 text-right">{r.po_count}</td>
                                    <td className="px-4 py-2 text-right">
                                      <Badge variant={r.max_overdue_days >= 15 ? "destructive" : "secondary"}>
                                        {r.max_overdue_days} 天
                                      </Badge>
                                    </td>
                                  </tr>
                                  {poOpen && (r.po_details?.length ?? 0) > 0 && (
                                    <tr key={key + "-d"} className="bg-muted/10 border-t">
                                      <td></td>
                                      <td colSpan={9} className="px-4 py-2">
                                        <table className="text-xs w-full">
                                          <thead className="text-muted-foreground">
                                            <tr>
                                              <th className="text-left py-1 pr-4 font-normal">采购单号</th>
                                              <th className="text-left py-1 pr-4 font-normal">协议到货</th>
                                              <th className="text-right py-1 pr-4 font-normal">超期天数</th>
                                              <th className="text-right py-1 font-normal">数量</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {r.po_details.map((p, idx) => (
                                              <tr key={idx}>
                                                <td className="py-1 pr-4 font-mono">{p.po_id}</td>
                                                <td className="py-1 pr-4">{p.delivery_date ? formatDateTimeCN(p.delivery_date, { withSeconds: false }) : "-"}</td>
                                                <td className="py-1 pr-4 text-right text-destructive">{p.overdue_days} 天</td>
                                                <td className="py-1 text-right">{fmtNum(p.qty)}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="purchase" className="mt-4">
          <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
            <div className="text-xs text-muted-foreground">
              缺口 = 未匹配待发 + 已结单少交 - 销退可复售冲抵；已结单少交=厂家已完成采购单的未交数量（不会再补交）；当天新上款采购单可能尚未同步，缺口仅供参考
            </div>
            <div className="flex items-center gap-2">
              <Switch id="show-sc" checked={showSC} onCheckedChange={setShowSC} />
              <Label htmlFor="show-sc" className="text-sm">显示赠品SC</Label>
            </div>
          </div>
          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[960px]">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium w-14">图</th>
                      <th className="text-left px-4 py-2 font-medium">SKU</th>
                      <th className="text-left px-4 py-2 font-medium">款号</th>
                      <th className="text-left px-4 py-2 font-medium">供应商</th>
                      <th className="text-right px-4 py-2 font-medium">待发</th>
                      <th className="text-right px-4 py-2 font-medium">在途</th>
                      <th className="text-right px-4 py-2 font-medium">已结单少交</th>
                      <th className="text-right px-4 py-2 font-medium">销退冲抵</th>
                      <th className="text-right px-4 py-2 font-medium">最终缺口</th>
                      <th className="text-left px-4 py-2 font-medium">最早付款</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePurchase.length === 0 ? (
                      <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">暂无数据</td></tr>
                    ) : visiblePurchase.map((r, i) => (
                      <tr key={i} className={cn("border-t", Number(r.final_gap) > 0 && "bg-red-50/60")}>
                        <td className="px-4 py-2">
                          <SkuThumb sku={r.sku} imageUrl={purchaseImgQ.data?.[r.sku]} onPreview={onPreview} />
                        </td>
                        <td className="px-4 py-2 font-mono">{r.sku}</td>
                        <td className="px-4 py-2">{r.style_no || "-"}</td>
                        <td className="px-4 py-2">{r.supplier_name || "-"}</td>
                        <td className="px-4 py-2 text-right">{fmtNum(r.pending_qty)}</td>
                        <td className="px-4 py-2 text-right">{fmtNum(r.intransit_qty)}</td>
                        <td className={cn("px-4 py-2 text-right", Number(r.closed_short_qty) > 0 && "text-amber-700")}>{fmtNum(r.closed_short_qty)}</td>
                        <td className="px-4 py-2 text-right">{fmtNum(r.return_offset)}</td>
                        <td className={cn("px-4 py-2 text-right font-semibold", Number(r.final_gap) > 0 && "text-destructive")}>
                          {fmtNum(r.final_gap)}
                        </td>
                        <td className="px-4 py-2">{fmtMMDDHM(r.earliest_pay_time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="closed" className="mt-4">
          <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
            <div className="text-xs text-muted-foreground">
              供应商已结单交付完毕，此处缺口不会再到货，需决策补单或退款
            </div>
            <Button
              variant="outline" size="sm"
              onClick={exportClosed}
              disabled={loading || closedRows.length === 0}
            >
              <Download className="mr-1" /> 导出 CSV
            </Button>
          </div>
          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : closedRows.length === 0 ? (
            <Card>
              <CardContent className="py-12 flex flex-col items-center text-center gap-2 text-emerald-700">
                <PartyPopper className="size-8" />
                <div className="font-medium">暂无厂家已结单的缺口 🎉</div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[900px]">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium w-8"></th>
                      <th className="text-left px-4 py-2 font-medium w-14">图</th>
                      <th className="text-left px-4 py-2 font-medium">SKU</th>
                      <th className="text-left px-4 py-2 font-medium">款号</th>
                      <th className="text-left px-4 py-2 font-medium">供应商</th>
                      <th className="text-right px-4 py-2 font-medium">少交件数</th>
                      <th className="text-right px-4 py-2 font-medium">影响订单数</th>
                      <th className="text-left px-4 py-2 font-medium">最早付款</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedRows.map((r, i) => {
                      const key = `closed|${r.sku}|${i}`;
                      const open = !!openClosed[key];
                      const hasDetails = (r.po_details?.length ?? 0) > 0;
                      return (
                        <React.Fragment key={key}>
                          <tr className="border-t hover:bg-muted/20">
                            <td className="px-4 py-2">
                              {hasDetails && (
                                <button
                                  type="button"
                                  onClick={() => setOpenClosed(s => ({ ...s, [key]: !s[key] }))}
                                  className="text-muted-foreground hover:text-foreground"
                                  aria-label="展开采购单"
                                >
                                  {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                                </button>
                              )}
                            </td>
                            <td className="px-4 py-2">
                              <SkuThumb sku={r.sku} imageUrl={closedImgQ.data?.[r.sku]} onPreview={onPreview} />
                            </td>
                            <td className="px-4 py-2 font-mono">{r.sku}</td>
                            <td className="px-4 py-2">{r.style_no || "-"}</td>
                            <td className="px-4 py-2">{r.supplier_name || "-"}</td>
                            <td className="px-4 py-2 text-right font-semibold text-destructive">{fmtNum(r.short_qty)}</td>
                            <td className="px-4 py-2 text-right">{fmtNum(r.order_count)}</td>
                            <td className="px-4 py-2">{fmtMMDDHM(r.oldest_pay_time)}</td>
                          </tr>
                          {open && hasDetails && (
                            <tr className="bg-muted/10 border-t">
                              <td></td>
                              <td colSpan={7} className="px-4 py-2">
                                <table className="text-xs w-full">
                                  <thead className="text-muted-foreground">
                                    <tr>
                                      <th className="text-left py-1 pr-4 font-normal">采购单号</th>
                                      <th className="text-left py-1 pr-4 font-normal">协议到货</th>
                                      <th className="text-right py-1 font-normal">少交数</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {r.po_details.map((p, idx) => (
                                      <tr key={idx}>
                                        <td className="py-1 pr-4 font-mono">{p.po_id}</td>
                                        <td className="py-1 pr-4">{p.delivery_date ? formatDateTimeCN(p.delivery_date, { withSeconds: false }) : "-"}</td>
                                        <td className="py-1 text-right text-destructive">{fmtNum(p.short_qty)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null); }}>
        <DialogContent className="max-w-2xl p-2">
          {preview && (
            <div className="flex flex-col items-center gap-2">
              <img
                src={preview.url}
                alt={preview.sku}
                referrerPolicy="no-referrer"
                className="max-h-[80vh] w-auto object-contain rounded"
              />
              <div className="text-xs text-muted-foreground font-mono pb-2">{preview.sku}</div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  label, value, suffix, extra, accent, loading, onClick,
}: {
  label: string;
  value: string;
  suffix?: string;
  extra?: string;
  accent?: "danger" | "warning";
  loading?: boolean;
  onClick?: () => void;
}) {
  return (
    <Card
      className={cn(onClick && "cursor-pointer hover:shadow-md transition-shadow")}
      onClick={onClick}
    >
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground mb-1">{label}</div>
        {loading ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          <div className="flex items-baseline gap-1">
            <span className={cn("text-2xl font-bold",
              accent === "danger" && "text-destructive",
              accent === "warning" && "text-orange-500")}>
              {value}
            </span>
            {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
          </div>
        )}
        {extra && <div className="text-xs text-muted-foreground mt-1">{extra}</div>}
      </CardContent>
    </Card>
  );
}
