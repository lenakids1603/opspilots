// ChaseListVisual.tsx
// 催货清单「按供应商催货」页签的可视化区块：紧急度五档横幅 + 按款式分组的供应商清单。
// 纯展示组件：把两个 RPC 的原始返回数组通过 props 传入即可，组件内部完成
// 分档、按款合并（含平台数字ID与内部款号的同款合并）、筛选、复制催货消息、CSV 导出。
//
// 口径（2026-06-12 老板确认）：本页只含发货截止时间在【已逾期～未来7天】内的需求
// （过滤在 RPC 层完成），顶部横幅为固定五档：已逾期/24h/48h/72h/7天内，
// 可多选筛档，默认选中「已逾期+24h」。
//
// 设计原则（请勿“美化”改动）：
//   1) 警示色仅红（已逾期）>橙（24h）>黄（48h）三档，且只用于文字与彩带浅底；
//      72h 与 7 天内用常规色；
//   2) 列表无卡片边框，行与行之间用 1px 发丝线分隔；
//   3) 商品图是页面里唯一的大面积颜色，缩略图不加彩色描边；
//   4) 横幅缩略图与彩带在同一个 grid 内，天然对齐。

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Check, Download, Ban } from "lucide-react";

export type Urgency = "overdue" | "due24" | "due48" | "due72" | "later";

export interface TimelineRow {
  deadline_date: string; // 'YYYY-MM-DD'
  style_no: string;
  product_name: string | null;
  image_url: string | null;
  qty: number;
  urgency: Urgency;
}

export interface SupplierRow {
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
  po_details: unknown;
  product_name: string | null;
  image_url: string | null;
}

export interface UnmatchedRow {
  style_no: string;
  product_name: string | null;
  image_url: string | null;
  total_qty: number;
  overdue_qty: number;
  due24_qty: number;
  due48_qty: number;
  due72_qty: number;
  later_qty: number;
  order_count: number;
  shop_names: string[] | null;
  earliest_ship_time: string | null;
  sku_details: { sku: string; sku_name: string | null; qty: number; overdue_qty: number }[] | null;
}

interface Props {
  timeline: TimelineRow[];
  suppliers: SupplierRow[];
  /** 供应商未匹配兜底桶（ops_chase_unmatched_list）；空数组时整桶隐藏 */
  unmatched?: UnmatchedRow[];
  /** 匹配快照时间（时间轴 RPC 的 snapshot_at）；用于「数据截至 X 分钟前」角标 */
  snapshotAt?: string | null;
  /** 接入服务端导出（xlsx带图）；未提供时回退为本地CSV。返回 Promise 时按钮显示「生成中…」 */
  onExport?: (supplier: SupplierGroup) => void | Promise<void>;
  /** 「供应商未匹配」每款的「标记劝退」回调（按 style_no 标记整款）；未提供则不显示按钮 */
  onMarkUnmatched?: (input: { styleNo: string; name: string }) => void;
}

const INK = "#1F2329";
const SUB = "#6E7480";
const FAINT = "#9AA1AA";
const HAIRLINE = "rgba(17,24,32,0.08)";
const RED = "#A82F2F";
const AMBER = "#8A5310";
const YELLOW = "#7A6308";

const TONES = {
  red: { bg: "#FBEDEC", deep: "#7A2222" },
  orange: { bg: "#FAE8D9", deep: "#8A4310" },
  purple: { bg: "#EEEDFA", deep: "#2A2566" },
  amber: { bg: "#FAF0DC", deep: "#6A4106" },
  teal: { bg: "#E4F4EE", deep: "#0A4A3A" },
} as const;
type ToneKey = keyof typeof TONES;

// 五档定义：已逾期红 > 24h橙 > 48h黄(amber)，72h/7天内常规色
const TIER_DEFS: { key: Urgency; label: string; tone: ToneKey }[] = [
  { key: "overdue", label: "已逾期", tone: "red" },
  { key: "due24", label: "24小时内", tone: "orange" },
  { key: "due48", label: "48小时内", tone: "amber" },
  { key: "due72", label: "72小时内", tone: "teal" },
  { key: "later", label: "7天内", tone: "teal" },
];
const ALL_TIERS: Urgency[] = TIER_DEFS.map((t) => t.key);

const CHEVRON =
  "polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%, 10px 50%)";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const NUMERIC_ID = /^\d{12,}$/;

function todayCN(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}
function md(iso: string): string {
  return `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;
}
function shortName(name: string | null | undefined, styleNo: string): string {
  if (!name) return styleNo;
  const m = name.match(/【(.+?)】/);
  let s = (m ? m[1] : name).replace(/Lenakids/gi, "");
  s = s.split(styleNo).join("").trim().replace(/[.·\s]+$/, "");
  return s || styleNo;
}
function skuTail(sku: string, styleNo: string): string {
  return sku.startsWith(styleNo) ? sku.slice(styleNo.length) || sku : sku;
}

/* ---------- 紧急度五档分桶（横幅，兼任顶部汇总与筛选器） ---------- */

interface DayStyle { key: string; code: string; name: string; img: string | null; qty: number; }
interface TierBucket {
  key: Urgency; label: string; qty: number; tone: ToneKey;
  styles: DayStyle[]; restCount: number;
}

function buildTiers(rows: TimelineRow[]): TierBucket[] {
  return TIER_DEFS.map((def) => {
    const hit = rows.filter((r) => r.urgency === def.key);
    const merged = new Map<string, DayStyle>();
    for (const r of hit) {
      const name = shortName(r.product_name, r.style_no);
      const cur = merged.get(name);
      if (cur) {
        cur.qty += Number(r.qty);
        if (!cur.img && r.image_url) cur.img = r.image_url;
        if (NUMERIC_ID.test(cur.code) && !NUMERIC_ID.test(r.style_no)) cur.code = r.style_no;
      } else {
        merged.set(name, { key: name, code: r.style_no, name, img: r.image_url, qty: Number(r.qty) });
      }
    }
    const styles = [...merged.values()].sort((a, b) => b.qty - a.qty);
    return {
      key: def.key, label: def.label, tone: def.tone,
      qty: styles.reduce((s, x) => s + x.qty, 0),
      styles: styles.slice(0, 3),
      restCount: Math.max(0, styles.length - 3),
    };
  });
}

/* ---------- 供应商 / 款式聚合 ---------- */

// 行级五档件数：sel = 当前选中档位内的件数（筛选与展示主数字都用它）
type TierQty = { overdue: number; due24: number; due48: number; due72: number; later: number };
function tierQtyOf(r: { overdue_qty: number; due24_qty: number; due48_qty: number; due72_qty: number; later_qty: number }): TierQty {
  return {
    overdue: Number(r.overdue_qty || 0), due24: Number(r.due24_qty || 0),
    due48: Number(r.due48_qty || 0), due72: Number(r.due72_qty || 0), later: Number(r.later_qty || 0),
  };
}
function selQty(t: TierQty, active: Set<Urgency>): number {
  return ALL_TIERS.reduce((s, k) => s + (active.has(k) ? t[k] : 0), 0);
}

interface SkuItem { tail: string; qty: number; sel: number; overdue: number; due24: number; due48: number; }
interface StyleGroup {
  key: string; code: string; name: string; img: string | null;
  total: number; sel: number; overdue: number; due24: number; due48: number; maxOverdue: number;
  skus: SkuItem[]; styleNos: string[];
}
export interface SupplierGroup {
  id: string; name: string; total: number; sel: number; overdue: number; due24: number; due48: number;
  styles: StyleGroup[];
}

function buildSuppliers(rows: SupplierRow[], active: Set<Urgency>): SupplierGroup[] {
  const bySupplier = new Map<string, SupplierRow[]>();
  for (const r of rows) {
    const list = bySupplier.get(r.supplier_id) ?? [];
    list.push(r);
    bySupplier.set(r.supplier_id, list);
  }
  const groups: SupplierGroup[] = [];
  for (const [id, list] of bySupplier) {
    const byStyle = new Map<string, StyleGroup>();
    for (const r of list) {
      const t = tierQtyOf(r);
      const sel = selQty(t, active);
      const name = shortName(r.product_name, r.style_no);
      let g = byStyle.get(name);
      if (!g) {
        g = { key: name, code: r.style_no, name, img: r.image_url, total: 0, sel: 0, overdue: 0, due24: 0, due48: 0, maxOverdue: 0, skus: [], styleNos: [] };
        byStyle.set(name, g);
      }
      if (NUMERIC_ID.test(g.code) && !NUMERIC_ID.test(r.style_no)) g.code = r.style_no;
      if (!g.img && r.image_url) g.img = r.image_url;
      g.total += Number(r.total_qty);
      g.sel += sel;
      g.overdue += t.overdue;
      g.due24 += t.due24;
      g.due48 += t.due48;
      g.maxOverdue = Math.max(g.maxOverdue, r.max_overdue_days);
      g.styleNos.push(r.style_no);
      const tail = skuTail(r.sku, r.style_no);
      const exist = g.skus.find((k) => k.tail === tail);
      if (exist) { exist.qty += Number(r.total_qty); exist.sel += sel; exist.overdue += t.overdue; exist.due24 += t.due24; exist.due48 += t.due48; }
      else g.skus.push({ tail, qty: Number(r.total_qty), sel, overdue: t.overdue, due24: t.due24, due48: t.due48 });
    }
    // 仅显示选中档位内有量的款/SKU；催货消息与导出仍用 7 天全量
    const styles = [...byStyle.values()]
      .filter((g) => g.sel > 0)
      .map((g) => ({ ...g, skus: g.skus.sort((a, b) => b.overdue - a.overdue || b.sel - a.sel || b.qty - a.qty) }))
      .sort((a, b) => b.overdue - a.overdue || b.sel - a.sel || b.total - a.total);
    if (styles.length === 0) continue;
    groups.push({
      id, name: list[0].supplier_name,
      total: styles.reduce((s, x) => s + x.total, 0),
      sel: styles.reduce((s, x) => s + x.sel, 0),
      overdue: styles.reduce((s, x) => s + x.overdue, 0),
      due24: styles.reduce((s, x) => s + x.due24, 0),
      due48: styles.reduce((s, x) => s + x.due48, 0),
      styles,
    });
  }
  return groups.sort((a, b) => b.overdue - a.overdue || b.sel - a.sel || b.total - a.total);
}

/* ---------- 供应商未匹配兜底桶 ---------- */

interface UnmatchedGroup {
  key: string; code: string; name: string; img: string | null;
  total: number; sel: number; overdue: number; due24: number; due48: number;
  shops: string[]; styleNos: string[];
  skus: { tail: string; qty: number; overdue: number }[];
}

// 复用款号纠正逻辑:按 shortName 归并同款,数字款号(平台副本)借同名正本款号显示
function buildUnmatched(rows: UnmatchedRow[], active: Set<Urgency>): UnmatchedGroup[] {
  const byName = new Map<string, UnmatchedGroup>();
  for (const r of rows) {
    const t = tierQtyOf(r);
    const sel = selQty(t, active);
    const name = shortName(r.product_name, r.style_no);
    let g = byName.get(name);
    if (!g) {
      g = { key: name, code: r.style_no, name, img: r.image_url, total: 0, sel: 0, overdue: 0, due24: 0, due48: 0, shops: [], styleNos: [], skus: [] };
      byName.set(name, g);
    }
    if (NUMERIC_ID.test(g.code) && !NUMERIC_ID.test(r.style_no)) g.code = r.style_no;
    if (!g.img && r.image_url) g.img = r.image_url;
    g.total += Number(r.total_qty);
    g.sel += sel;
    g.overdue += t.overdue;
    g.due24 += t.due24;
    g.due48 += t.due48;
    g.styleNos.push(r.style_no);
    for (const s of r.shop_names ?? []) if (s && !g.shops.includes(s)) g.shops.push(s);
    for (const d of r.sku_details ?? []) {
      const tail = skuTail(d.sku, r.style_no);
      const exist = g.skus.find((k) => k.tail === tail);
      if (exist) { exist.qty += Number(d.qty); exist.overdue += Number(d.overdue_qty); }
      else g.skus.push({ tail, qty: Number(d.qty), overdue: Number(d.overdue_qty) });
    }
  }
  return [...byName.values()]
    .filter((g) => g.sel > 0)
    .map((g) => ({ ...g, skus: g.skus.sort((a, b) => b.overdue - a.overdue || b.qty - a.qty) }))
    .sort((a, b) => b.overdue - a.overdue || b.sel - a.sel || b.total - a.total);
}

/* ---------- 复制 / 导出 ---------- */

function chaseMessage(g: SupplierGroup, today: string): string {
  const lines = g.styles.map((st) => {
    const parts = st.skus.map((k) => `${k.tail}×${k.qty}`).join("、");
    const late = st.overdue > 0 ? `（已超时 ${st.overdue} 件，最长 ${st.maxOverdue} 天）` : "";
    return `【${st.code} ${st.name}】${parts}${late}`;
  });
  return `${g.name} ${md(today)} 催货：\n${lines.join("\n")}\n合计 ${g.total} 件，麻烦尽快安排，谢谢！`;
}

export function exportCsv(g: SupplierGroup, today: string) {
  const rows: string[][] = [["供应商", "款号", "款名", "SKU", "急需件数", "其中已超时", "最长超期天数"]];
  g.styles.forEach((st) =>
    st.skus.forEach((k) =>
      rows.push([g.name, st.code, st.name, k.tail, String(k.qty), String(k.overdue), String(st.maxOverdue)])
    )
  );
  const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `催货单_${g.name}_${today}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- 子组件 ---------- */

function Thumb({ img, qty, dim }: { img: string | null; qty: number; dim: boolean }) {
  return (
    <div style={{ position: "relative", width: 40, height: 40, borderRadius: 6, background: "#F3F4F6", border: `1px solid ${HAIRLINE}`, overflow: "hidden", flexShrink: 0, opacity: dim ? 0.35 : 1 }}>
      {img && (
        <img src={img} referrerPolicy="no-referrer" loading="lazy" alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={(e) => { e.currentTarget.style.display = "none"; }} />
      )}
      <span style={{ position: "absolute", right: 0, bottom: 0, background: "rgba(15,18,22,0.62)", color: "#FFF", fontSize: 10, lineHeight: "14px", padding: "0 4px", borderTopLeftRadius: 5 }}>
        {qty}
      </span>
    </div>
  );
}

/* ---------- 主组件 ---------- */

function snapshotAgeLabel(snapshotAt: string | null | undefined): string | null {
  if (!snapshotAt) return null;
  const t = new Date(snapshotAt).getTime();
  if (isNaN(t)) return null;
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
  return mins <= 1 ? "数据截至 1 分钟内" : `数据截至 ${mins} 分钟前`;
}

export default function ChaseListVisual({ timeline, suppliers, unmatched, snapshotAt, onExport, onMarkUnmatched }: Props) {
  const today = useMemo(todayCN, []);
  const tiers = useMemo(() => buildTiers(timeline), [timeline]);
  const snapshotLabel = snapshotAgeLabel(snapshotAt);
  // 默认选中「已逾期+24h」：打开页面第一眼就是最危险的部分；全部取消 = 看 7 天内全部
  const [selected, setSelected] = useState<Set<Urgency>>(new Set(["overdue", "due24"]));
  const active = useMemo<Set<Urgency>>(
    () => (selected.size === 0 ? new Set(ALL_TIERS) : selected),
    [selected],
  );
  const groups = useMemo(() => buildSuppliers(suppliers, active), [suppliers, active]);
  const unmatchedGroups = useMemo(() => buildUnmatched(unmatched ?? [], active), [unmatched, active]);
  const [unmatchedOpen, setUnmatchedOpen] = useState(true);
  const [unmatchedShowAll, setUnmatchedShowAll] = useState(false);

  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [tailOpen, setTailOpen] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const selectedTiers = useMemo(() => tiers.filter((d) => selected.has(d.key)), [selected, tiers]);
  const selectedQty = selectedTiers.reduce((s, d) => s + d.qty, 0);

  const copy = async (g: SupplierGroup) => {
    await navigator.clipboard.writeText(chaseMessage(g, today));
    setCopiedId(g.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const doExport = async (g: SupplierGroup) => {
    if (!onExport) { exportCsv(g, today); return; }
    if (exportingId) return;
    setExportingId(g.id);
    try { await onExport(g); } finally { setExportingId(null); }
  };

  const textBtn: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "none",
    color: SUB, fontSize: 12.5, cursor: "pointer", padding: "4px 6px",
  };

  return (
    <div style={{ color: INK }}>
      {/* ======== 紧急度五档横幅（顶部汇总 + 筛选器） ======== */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>紧急度五档</span>
        <span style={{ fontSize: 11, color: FAINT }}>仅含发货截止在【已逾期～未来7天】内的需求（可催供应商＋未匹配兜底）</span>
        {snapshotLabel && <span style={{ fontSize: 11, color: FAINT }}>· {snapshotLabel}</span>}
        {selected.size > 0 ? (
          <button style={{ ...textBtn, color: RED, fontWeight: 500 }} onClick={() => setSelected(new Set())}>
            已选 {selectedTiers.map((d) => d.label).join(" + ")} · 合计 {selectedQty} 件 · 点击清除看 7 天内全部
          </button>
        ) : (
          <span style={{ fontSize: 11, color: FAINT }}>点选一档或多档，叠加筛选下方款式</span>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: 4, minWidth: 720 }}>
          {tiers.map((d) => {
            const dim = selected.size > 0 && !selected.has(d.key);
            const tone = TONES[d.tone];
            return (
              <div key={d.key} style={{ display: "flex", flexDirection: "column", cursor: d.qty ? "pointer" : "default" }}
                onClick={() => {
                  if (!d.qty) return;
                  const next = new Set(selected);
                  if (next.has(d.key)) next.delete(d.key); else next.add(d.key);
                  setSelected(next);
                }}>
                <div style={{ height: 52, display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 6, marginBottom: 8 }}>
                  {d.styles.map((s) => <Thumb key={s.key} img={s.img} qty={s.qty} dim={dim} />)}
                  {d.restCount > 0 && (
                    <div style={{ width: 40, height: 40, borderRadius: 6, background: "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: SUB, opacity: dim ? 0.35 : 1 }}>
                      +{d.restCount}
                    </div>
                  )}
                </div>
                <div style={{ height: 42, clipPath: CHEVRON, background: tone.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: dim ? 0.35 : 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: tone.deep }}>{d.label}</span>
                  <span style={{ fontSize: 11, color: tone.deep, opacity: 0.75 }}>{d.qty ? `${d.qty} 件` : "—"}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ======== 供应商未匹配兜底桶(有数据才显示) ======== */}
      {(() => {
        const visibleUm = unmatchedGroups;
        if (visibleUm.length === 0) return null;
        const umSel = visibleUm.reduce((s, g) => s + g.sel, 0);
        const umOverdue = visibleUm.reduce((s, g) => s + g.overdue, 0);
        const umDue24 = visibleUm.reduce((s, g) => s + g.due24, 0);
        const umDue48 = visibleUm.reduce((s, g) => s + g.due48, 0);
        const TOP_N = 10;
        const list = unmatchedShowAll ? visibleUm : visibleUm.slice(0, TOP_N);
        const restCount = visibleUm.length - list.length;
        const restQty = visibleUm.slice(TOP_N).reduce((s, g) => s + g.sel, 0);
        return (
          <section style={{ marginTop: 28 }}>
            <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0" }}>
              <button style={{ ...textBtn, padding: 2, color: FAINT }} aria-label="展开/收起"
                onClick={() => setUnmatchedOpen(!unmatchedOpen)}>
                {unmatchedOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              <span style={{ fontSize: 14.5, fontWeight: 600, color: RED }}>供应商未匹配</span>
              <span style={{ fontSize: 13, color: SUB }}>{visibleUm.length} 款 · {umSel} 件无人可催</span>
              {umOverdue > 0 && <span style={{ fontSize: 12.5, color: RED, fontWeight: 500 }}>已逾期 {umOverdue} 件</span>}
              {umDue24 > 0 && <span style={{ fontSize: 12.5, color: AMBER, fontWeight: 500 }}>24h内 {umDue24} 件</span>}
              {umDue48 > 0 && <span style={{ fontSize: 12.5, color: YELLOW, fontWeight: 500 }}>48h内 {umDue48} 件</span>}
              <span style={{ fontSize: 11, color: FAINT }}>平台副本款/缺归属映射，请尽快补建商品对应关系；无采购单的缺货新款见「采购缺口」</span>
            </header>
            {unmatchedOpen && (
              <div>
                {list.map((g, gi) => (
                  <div key={g.key} style={{ display: "flex", gap: 14, alignItems: "center", padding: "13px 0 13px 26px", borderTop: gi > 0 ? `1px solid ${HAIRLINE}` : "none" }}>
                    <div onClick={() => g.img && setPreview(g.img)}
                      style={{ width: 56, height: 56, borderRadius: 8, background: "#F3F4F6", border: `1px solid ${HAIRLINE}`, overflow: "hidden", flexShrink: 0, cursor: g.img ? "zoom-in" : "default" }}>
                      {g.img && (
                        <img src={g.img} referrerPolicy="no-referrer" loading="lazy" alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ fontFamily: MONO, fontSize: 12, color: FAINT, letterSpacing: "0.02em" }}>{g.code}</span>
                        <span style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</span>
                        <span style={{ flex: 1 }} />
                        {g.overdue > 0 && <span style={{ fontSize: 12, color: RED, whiteSpace: "nowrap" }}>已超时 {g.overdue} 件</span>}
                        {g.overdue === 0 && g.due24 > 0 && <span style={{ fontSize: 12, color: AMBER, whiteSpace: "nowrap" }}>24h内 {g.due24} 件</span>}
                      </div>
                      <div style={{ marginTop: 5, fontFamily: MONO, fontSize: 12.5, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {g.skus.map((k, ki) => (
                          <span key={k.tail}>
                            {ki > 0 && <span style={{ color: "#C9CDD2" }}>{"  ·  "}</span>}
                            <span style={k.overdue > 0 ? { color: RED, fontWeight: 500 } : undefined}>
                              {k.tail}×{k.qty}
                            </span>
                          </span>
                        ))}
                      </div>
                      {g.shops.length > 0 && (
                        <div style={{ marginTop: 4, fontSize: 11.5, color: FAINT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          店铺：{g.shops.join("、")}
                        </div>
                      )}
                    </div>
                    <div style={{ width: 72, textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 22, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{g.sel}</div>
                      <div style={{ fontSize: 11, color: FAINT }}>件待催</div>
                    </div>
                    {onMarkUnmatched && (
                      <button
                        style={{ ...textBtn, color: SUB, flexShrink: 0, whiteSpace: "nowrap" }}
                        onClick={() => onMarkUnmatched({ styleNo: g.code, name: g.name })}
                        title="标记为劝退款：不再催此款货，移入「采购缺口」的劝退分组">
                        <Ban size={13} /> 劝退
                      </button>
                    )}
                  </div>
                ))}
                {restCount > 0 && (
                  <button style={{ ...textBtn, padding: "10px 0 14px 26px" }}
                    onClick={() => setUnmatchedShowAll(true)}>
                    展开其余 {restCount} 款 · 共 {restQty} 件
                  </button>
                )}
                {unmatchedShowAll && visibleUm.length > TOP_N && (
                  <button style={{ ...textBtn, padding: "10px 0 14px 26px" }}
                    onClick={() => setUnmatchedShowAll(false)}>
                    收起
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })()}

      {/* ======== 供应商款式清单 ======== */}
      {groups.length === 0 && (
        <p style={{ textAlign: "center", color: TONES.teal.deep, fontSize: 14, padding: "48px 0" }}>
          当前选中档位内没有需要催货的供应商
        </p>
      )}

      {groups.map((g, gi) => {
        const isOpen = open[g.id] ?? gi === 0;
        const visible = g.styles;
        const main = visible.filter((s) => s.sel > 2);
        const tail = visible.filter((s) => s.sel <= 2);
        const showTail = tailOpen[g.id] ?? false;
        const list = showTail ? [...main, ...tail] : main;
        return (
          <section key={g.id} style={{ marginTop: gi === 0 ? 28 : 8 }}>
            <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", borderTop: gi > 0 ? `1px solid ${HAIRLINE}` : "none" }}>
              <button style={{ ...textBtn, padding: 2, color: FAINT }} aria-label="展开/收起"
                onClick={() => setOpen({ ...open, [g.id]: !isOpen })}>
                {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              <span style={{ fontSize: 14.5, fontWeight: 600 }}>{g.name}</span>
              <span style={{ fontSize: 13, color: SUB }}>催货 {g.sel} 件 · {g.styles.length} 款</span>
              {g.overdue > 0 && <span style={{ fontSize: 12.5, color: RED, fontWeight: 500 }}>已逾期 {g.overdue} 件</span>}
              {g.due24 > 0 && <span style={{ fontSize: 12.5, color: AMBER, fontWeight: 500 }}>24h内 {g.due24} 件</span>}
              {g.due48 > 0 && <span style={{ fontSize: 12.5, color: YELLOW, fontWeight: 500 }}>48h内 {g.due48} 件</span>}
              <span style={{ flex: 1 }} />
              <button style={{ ...textBtn, color: copiedId === g.id ? TONES.teal.deep : SUB }} onClick={() => copy(g)}>
                {copiedId === g.id ? <Check size={14} /> : <Copy size={14} />}
                {copiedId === g.id ? "已复制" : "复制催货消息"}
              </button>
              <button style={{ ...textBtn, cursor: exportingId ? "default" : "pointer", opacity: exportingId && exportingId !== g.id ? 0.5 : 1 }}
                disabled={!!exportingId} onClick={() => doExport(g)}>
                <Download size={14} />{exportingId === g.id ? "生成中…" : "导出催货单"}
              </button>
            </header>

            {isOpen && (
              <div>
                {list.map((st, si) => (
                  <div key={st.key} style={{ display: "flex", gap: 14, alignItems: "center", padding: "13px 0 13px 26px", borderTop: si > 0 ? `1px solid ${HAIRLINE}` : "none" }}>
                    <div onClick={() => st.img && setPreview(st.img)}
                      style={{ width: 56, height: 56, borderRadius: 8, background: "#F3F4F6", border: `1px solid ${HAIRLINE}`, overflow: "hidden", flexShrink: 0, cursor: st.img ? "zoom-in" : "default" }}>
                      {st.img && (
                        <img src={st.img} referrerPolicy="no-referrer" loading="lazy" alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ fontFamily: MONO, fontSize: 12, color: FAINT, letterSpacing: "0.02em" }}>{st.code}</span>
                        <span style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{st.name}</span>
                        <span style={{ flex: 1 }} />
                        {st.overdue > 0 && <span style={{ fontSize: 12, color: RED, whiteSpace: "nowrap" }}>已逾期 {st.overdue} 件 · 最长 {st.maxOverdue} 天</span>}
                        {st.overdue === 0 && st.due24 > 0 && <span style={{ fontSize: 12, color: AMBER, whiteSpace: "nowrap" }}>24h内 {st.due24} 件</span>}
                        {st.overdue === 0 && st.due24 === 0 && st.due48 > 0 && <span style={{ fontSize: 12, color: YELLOW, whiteSpace: "nowrap" }}>48h内 {st.due48} 件</span>}
                      </div>
                      <div style={{ marginTop: 5, fontFamily: MONO, fontSize: 12.5, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {st.skus.filter((k) => k.sel > 0).map((k, ki) => (
                          <span key={k.tail}>
                            {ki > 0 && <span style={{ color: "#C9CDD2" }}>{"  ·  "}</span>}
                            <span style={k.overdue > 0 ? { color: RED, fontWeight: 500 } : undefined}>
                              {k.tail}×{k.sel}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ width: 72, textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 22, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{st.sel}</div>
                      <div style={{ fontSize: 11, color: FAINT }}>件待催</div>
                    </div>
                  </div>
                ))}
                {tail.length > 0 && (
                  <button style={{ ...textBtn, padding: "10px 0 14px 26px" }}
                    onClick={() => setTailOpen({ ...tailOpen, [g.id]: !showTail })}>
                    {showTail ? "收起零头" : `另有零头 ${tail.length} 款 · 共 ${tail.reduce((s, x) => s + x.sel, 0)} 件`}
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}

      {preview && (
        <div onClick={() => setPreview(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,18,22,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, cursor: "zoom-out" }}>
          <img src={preview} referrerPolicy="no-referrer" alt=""
            style={{ maxWidth: "86vw", maxHeight: "86vh", borderRadius: 12, background: "#FFF" }} />
        </div>
      )}
    </div>
  );
}
