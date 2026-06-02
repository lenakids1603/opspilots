// 统一的日期/时间显示与筛选工具。
// 业务规则：业务时间统一以北京时间（Asia/Shanghai, UTC+8）展示与筛选；
// 数据库存的是 timestamptz / ISO UTC，禁止直接 .slice(0,10) / split("T")[0] 当作日期。
//
// 使用方式：
//   formatDateCN("2026-05-30T17:59:48Z")       → "2026/5/31"
//   formatDateTimeCN("2026-05-30T17:59:48Z")   → "2026/5/31 01:59:48"
//   todayCN()                                  → "2026-05-31"  (北京当日 YYYY-MM-DD，用于 <input type="date">)
//   beijingDayRangeToUTC("2026-05-31")
//     → { gte: "2026-05-30T16:00:00.000Z", lte: "2026-05-31T15:59:59.999Z" }

const TZ = "Asia/Shanghai";

function toDate(input: unknown): Date | null {
  if (input == null || input === "") return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  const d = new Date(input as string | number);
  return isNaN(d.getTime()) ? null : d;
}

/** 显示北京时区日期，例如 "2026/5/31"。 */
export function formatDateCN(input: unknown): string {
  const d = toDate(input);
  if (!d) return "-";
  return d.toLocaleDateString("zh-CN", { timeZone: TZ });
}

/** 显示北京时区日期 + 时间，例如 "2026/5/31 01:59:48"。 */
export function formatDateTimeCN(input: unknown, opts?: { withSeconds?: boolean }): string {
  const d = toDate(input);
  if (!d) return "-";
  return d.toLocaleString("zh-CN", {
    timeZone: TZ,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    second: opts?.withSeconds === false ? undefined : "2-digit",
  });
}

/** 北京当日 YYYY-MM-DD，用于 <input type="date"> 默认值、导出文件名等。 */
export function todayCN(): string {
  return beijingYMD(new Date());
}

/** 任意 Date/ISO 转 北京时区 "YYYY-MM-DD"。 */
export function beijingYMD(input: unknown): string {
  const d = toDate(input);
  if (!d) return "";
  // sv-SE locale 输出 ISO-like "YYYY-MM-DD"
  return d.toLocaleDateString("sv-SE", { timeZone: TZ });
}

/**
 * 把用户在界面上选的北京时间日期 "YYYY-MM-DD"，转成数据库查询用的 UTC ISO 起止区间。
 * 例：beijingDayRangeToUTC("2026-05-31")
 *   → { gte: "2026-05-30T16:00:00.000Z", lte: "2026-05-31T15:59:59.999Z" }
 */
export function beijingDayRangeToUTC(ymd: string): { gte: string; lte: string } | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  // 北京 = UTC+8，无夏令时，直接减 8h。
  const startUtc = new Date(`${ymd}T00:00:00+08:00`);
  const endUtc = new Date(`${ymd}T23:59:59.999+08:00`);
  return { gte: startUtc.toISOString(), lte: endUtc.toISOString() };
}

/** 一段北京日期范围转 UTC 起止；任一端为空时返回单边。 */
export function beijingRangeToUTC(startYmd?: string | null, endYmd?: string | null) {
  const s = startYmd ? beijingDayRangeToUTC(startYmd) : null;
  const e = endYmd ? beijingDayRangeToUTC(endYmd) : null;
  return { gte: s?.gte ?? null, lte: e?.lte ?? null };
}
