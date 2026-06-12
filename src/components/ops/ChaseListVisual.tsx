// ChaseListVisual.tsx
// 催货清单「按供应商催货」页签的可视化区块：发货截止时间轴 + 按款式分组的供应商清单。
// 纯展示组件：把两个 RPC 的原始返回数组通过 props 传入即可，组件内部完成
// 分桶、按款合并（含平台数字ID与内部款号的同款合并）、筛选、复制催货消息、CSV 导出。
//
// 设计原则（请勿“美化”改动）：
//   1) 全页只允许红（已超时）、橙（24h内）两个警示色，且只用于文字，不做色块/描边/胶囊；
//   2) 列表无卡片边框，行与行之间用 1px 发丝线分隔；
//   3) 商品图是页面里唯一的大面积颜色，缩略图不加彩色描边；
//   4) 时间轴缩略图与彩带在同一个 grid 内，天然对齐。

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Check, Download } from "lucide-react";

export interface TimelineRow {
  deadline_date: string; // 'YYYY-MM-DD'
  style_no: string;
  product_name: string | null;
  image_url: string | null;
  qty: number;
  urgency: "overdue" | "due24" | "due48" | "due72" | "later";
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

interface Props {
  timeline: TimelineRow[];
  suppliers: SupplierRow[];
  /** 接入服务端导出（xlsx带图）；未提供时回退为本地CSV。返回 Promise 时按钮显示「生成中…」 */
  onExport?: (supplier: SupplierGroup) => void | Promise<void>;
}

const INK = "#1F2329";
const SUB = "#6E7480";
const FAINT = "#9AA1AA";
const HAIRLINE = "rgba(17,24,32,0.08)";
const RED = "#A82F2F";
const AMBER = "#8A5310";

const TONES = {
  red: { bg: "#FBEDEC", deep: "#7A2222" },
  purple: { bg: "#EEEDFA", deep: "#2A2566" },
  amber: { bg: "#FAF0DC", deep: "#6A4106" },
  teal: { bg: "#E4F4EE", deep: "#0A4A3A" },
} as const;
type ToneKey = keyof typeof TONES;

const CHEVRON =
  "polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%, 10px 50%)";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const NUMERIC_ID = /^\d{12,}$/;

function todayCN(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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

/* ---------- 时间轴分桶 ---------- */

interface DayStyle { key: string; code: string; name: string; img: string | null; qty: number; }
interface DayBucket {
  key: string; label: string; qty: number; tone: ToneKey;
  styles: DayStyle[]; restCount: number; styleNos: Set<string>;
}

function buildDays(rows: TimelineRow[], today: string): DayBucket[] {
  const defs: { key: string; label: string; tone: ToneKey; match: (d: string) => boolean }[] = [
    { key: "overdue", label: "逾期", tone: "red", match: (d) => d < today },
    { key: today, label: `今天 ${md(today)}`, tone: "purple", match: (d) => d === today },
    { key: addDays(today, 1), label: md(addDays(today, 1)), tone: "amber", match: (d) => d === addDays(today, 1) },
    { key: addDays(today, 2), label: md(addDays(today, 2)), tone: "teal", match: (d) => d === addDays(today, 2) },
    { key: addDays(today, 3), label: md(addDays(today, 3)), tone: "teal", match: (d) => d === addDays(today, 3) },
    { key: addDays(today, 4), label: md(addDays(today, 4)), tone: "teal", match: (d) => d === addDays(today, 4) },
    { key: "later", label: "更晚", tone: "teal", match: (d) => d > addDays(today, 4) },
  ];
  return defs.map((def) => {
    const hit = rows.filter((r) => def.match(r.deadline_date));
    const merged = new Map<string, DayStyle & { nos: string[] }>();
    for (const r of hit) {
      const name = shortName(r.product_name, r.style_no);
      const cur = merged.get(name);
      if (cur) {
        cur.qty += Number(r.qty);
        cur.nos.push(r.style_no);
        if (!cur.img && r.image_url) cur.img = r.image_url;
        if (NUMERIC_ID.test(cur.code) && !NUMERIC_ID.test(r.style_no)) cur.code = r.style_no;
      } else {
        merged.set(name, { key: name, code: r.style_no, name, img: r.image_url, qty: Number(r.qty), nos: [r.style_no] });
      }
    }
    const styles = [...merged.values()].sort((a, b) => b.qty - a.qty);
    return {
      key: def.key, label: def.label, tone: def.tone,
      qty: styles.reduce((s, x) => s + x.qty, 0),
      styles: styles.slice(0, 3),
      restCount: Math.max(0, styles.length - 3),
      styleNos: new Set(hit.map((r) => r.style_no)),
    };
  });
}

/* ---------- 供应商 / 款式聚合 ---------- */

interface SkuItem { tail: string; qty: number; overdue: number; due24: number; }
interface StyleGroup {
  key: string; code: string; name: string; img: string | null;
  total: number; overdue: number; due24: number; maxOverdue: number;
  skus: SkuItem[]; styleNos: string[];
}
export interface SupplierGroup {
  id: string; name: string; total: number; overdue: number; due24: number;
  styles: StyleGroup[];
}

function buildSuppliers(rows: SupplierRow[]): SupplierGroup[] {
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
      const name = shortName(r.product_name, r.style_no);
      let g = byStyle.get(name);
      if (!g) {
        g = { key: name, code: r.style_no, name, img: r.image_url, total: 0, overdue: 0, due24: 0, maxOverdue: 0, skus: [], styleNos: [] };
        byStyle.set(name, g);
      }
      if (NUMERIC_ID.test(g.code) && !NUMERIC_ID.test(r.style_no)) g.code = r.style_no;
      if (!g.img && r.image_url) g.img = r.image_url;
      g.total += Number(r.total_qty);
      g.overdue += Number(r.overdue_qty);
      g.due24 += Number(r.due24_qty);
      g.maxOverdue = Math.max(g.maxOverdue, r.max_overdue_days);
      g.styleNos.push(r.style_no);
      const tail = skuTail(r.sku, r.style_no);
      const exist = g.skus.find((k) => k.tail === tail);
      if (exist) { exist.qty += Number(r.total_qty); exist.overdue += Number(r.overdue_qty); exist.due24 += Number(r.due24_qty); }
      else g.skus.push({ tail, qty: Number(r.total_qty), overdue: Number(r.overdue_qty), due24: Number(r.due24_qty) });
    }
    const styles = [...byStyle.values()]
      .map((g) => ({ ...g, skus: g.skus.sort((a, b) => b.overdue - a.overdue || b.qty - a.qty) }))
      .sort((a, b) => b.overdue - a.overdue || b.total - a.total);
    groups.push({
      id, name: list[0].supplier_name,
      total: styles.reduce((s, x) => s + x.total, 0),
      overdue: styles.reduce((s, x) => s + x.overdue, 0),
      due24: styles.reduce((s, x) => s + x.due24, 0),
      styles,
    });
  }
  return groups.sort((a, b) => b.overdue - a.overdue || b.total - a.total);
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

export default function ChaseListVisual({ timeline, suppliers, onExport }: Props) {
  const today = useMemo(todayCN, []);
  const days = useMemo(() => buildDays(timeline, today), [timeline, today]);
  const groups = useMemo(() => buildSuppliers(suppliers), [suppliers]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [tailOpen, setTailOpen] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const filterSet = useMemo(() => {
    if (selected.size === 0) return null;
    const s = new Set<string>();
    days.filter((d) => selected.has(d.key)).forEach((d) => d.styleNos.forEach((n) => s.add(n)));
    return s;
  }, [selected, days]);

  const selectedDays = useMemo(() => days.filter((d) => selected.has(d.key)), [selected, days]);
  const selectedQty = selectedDays.reduce((s, d) => s + d.qty, 0);

  const styleDayQty = useMemo(() => {
    if (selected.size === 0) return null;
    const m = new Map<string, number>();
    for (const r of timeline) {
      const inSel =
        (selected.has("overdue") && r.deadline_date < today) ||
        selected.has(r.deadline_date) ||
        (selected.has("later") && r.deadline_date > addDays(today, 4));
      if (inSel) {
        const k = shortName(r.product_name, r.style_no);
        m.set(k, (m.get(k) ?? 0) + Number(r.qty));
      }
    }
    return m;
  }, [selected, timeline, today]);

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
      {/* ======== 发货截止时间轴 ======== */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>发货截止时间轴</span>
        <span style={{ fontSize: 11, color: FAINT }}>仅含可催供应商部分，非全部待发货</span>
        {selected.size > 0 ? (
          <button style={{ ...textBtn, color: RED, fontWeight: 500 }} onClick={() => setSelected(new Set())}>
            已选 {selectedDays.map((d) => d.label).join(" + ")} · 合计 {selectedQty} 件 · 点击清除
          </button>
        ) : (
          <span style={{ fontSize: 11, color: FAINT }}>点选一天或多天，叠加筛选下方款式</span>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 4, minWidth: 880 }}>
          {days.map((d) => {
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

      {/* ======== 供应商款式清单 ======== */}
      {groups.length === 0 && (
        <p style={{ textAlign: "center", color: TONES.teal.deep, fontSize: 14, padding: "48px 0" }}>
          当前没有需要催货的供应商
        </p>
      )}

      {groups.map((g, gi) => {
        const isOpen = open[g.id] ?? gi === 0;
        const visible = g.styles.filter((s) => !filterSet || s.styleNos.some((n) => filterSet.has(n)));
        const main = visible.filter((s) => s.total > 2);
        const tail = visible.filter((s) => s.total <= 2);
        const showTail = tailOpen[g.id] ?? false;
        const list = showTail ? [...main, ...tail] : main;
        if (filterSet && visible.length === 0) return null;
        return (
          <section key={g.id} style={{ marginTop: gi === 0 ? 28 : 8 }}>
            <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", borderTop: gi > 0 ? `1px solid ${HAIRLINE}` : "none" }}>
              <button style={{ ...textBtn, padding: 2, color: FAINT }} aria-label="展开/收起"
                onClick={() => setOpen({ ...open, [g.id]: !isOpen })}>
                {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              <span style={{ fontSize: 14.5, fontWeight: 600 }}>{g.name}</span>
              <span style={{ fontSize: 13, color: SUB }}>催货 {g.total} 件 · {g.styles.length} 款</span>
              {g.overdue > 0 && <span style={{ fontSize: 12.5, color: RED, fontWeight: 500 }}>已超时 {g.overdue} 件</span>}
              {g.due24 > 0 && <span style={{ fontSize: 12.5, color: AMBER, fontWeight: 500 }}>24h内 {g.due24} 件</span>}
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
                        {styleDayQty && (styleDayQty.get(st.key) ?? 0) > 0 && (
                          <span style={{ fontSize: 12, color: SUB, whiteSpace: "nowrap" }}>选中日 {styleDayQty.get(st.key)} 件</span>
                        )}
                        {st.overdue > 0 && <span style={{ fontSize: 12, color: RED, whiteSpace: "nowrap" }}>已超时 {st.overdue} 件 · 最长 {st.maxOverdue} 天</span>}
                        {st.overdue === 0 && st.due24 > 0 && <span style={{ fontSize: 12, color: AMBER, whiteSpace: "nowrap" }}>24h内 {st.due24} 件</span>}
                      </div>
                      <div style={{ marginTop: 5, fontFamily: MONO, fontSize: 12.5, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {st.skus.map((k, ki) => (
                          <span key={k.tail}>
                            {ki > 0 && <span style={{ color: "#C9CDD2" }}>{"  ·  "}</span>}
                            <span style={k.overdue > 0 ? { color: RED, fontWeight: 500 } : undefined}>
                              {k.tail}×{k.qty}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ width: 72, textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 22, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{st.total}</div>
                      <div style={{ fontSize: 11, color: FAINT }}>件待催</div>
                    </div>
                  </div>
                ))}
                {tail.length > 0 && (
                  <button style={{ ...textBtn, padding: "10px 0 14px 26px" }}
                    onClick={() => setTailOpen({ ...tailOpen, [g.id]: !showTail })}>
                    {showTail ? "收起零头" : `另有零头 ${tail.length} 款 · 共 ${tail.reduce((s, x) => s + x.total, 0)} 件`}
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
