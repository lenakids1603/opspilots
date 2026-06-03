// 货期交付看板 - 交付容差 / 尾差过滤 展示规则
// 仅用于看板数据展示层，不修改数据库、不修改采购单状态、不写入任何数据。
// 后续若改为按供应商 / 品类 / 采购单配置，请在此文件内扩展。

export const DELIVERY_COMPLETION_TOLERANCE_RATE = 0.98;
export const DELIVERY_TAIL_DIFF_MAX_QTY = 20;
export const DELIVERY_TAIL_DIFF_OVERDUE_DAYS = 5;

export type DeliveryCompletionType =
  | "normal"                       // 正常完成 (received >= purchase)
  | "tolerance"                    // 容差完成 (>= 98%)
  | "over"                         // 超交完成
  | "tail_difference_completed"    // 尾差完成（逾期 > 5 天 且 剩余 <= 20 件）
  | "pending";                     // 仍在交付中

export interface ToleranceInput {
  purchase_qty: number;
  received_qty: number;
  /** 计划交付日期，ISO 字符串或 Date；用于尾差判断，可不传 */
  delivery_date?: string | Date | null;
  /** 当前日期（用于测试可注入），默认 new Date() */
  now?: Date;
}

export interface ToleranceResult {
  purchase_qty: number;
  inbound_qty: number;
  raw_pending_qty: number;
  effective_pending_qty: number;
  completion_rate: number;             // 0~1+
  short_delivered_qty: number;         // 短交数量（容差完成 / 尾差完成时 >0）
  over_delivered_qty: number;          // 超交数量
  overdue_days: number | null;         // 逾期天数（计划日为今天=0，未来=负）
  is_tolerance_completed: boolean;
  is_over_delivered: boolean;
  is_tail_difference_completed: boolean;
  is_delivery_completed: boolean;      // 是否视为已完成（=不再显示在看板）
  completion_type: DeliveryCompletionType;
}

function diffDays(a: Date, b: Date): number {
  // 按整日差（向下取整），a - b
  const MS = 86400000;
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.floor((da - db) / MS);
}

export function evaluateDelivery(
  input: ToleranceInput,
  toleranceRate: number = DELIVERY_COMPLETION_TOLERANCE_RATE,
): ToleranceResult {
  const purchase = Math.max(0, Number(input.purchase_qty ?? 0));
  const inbound = Math.max(0, Number(input.received_qty ?? 0));

  const rawPending = Math.max(purchase - inbound, 0);
  const completionRate = purchase > 0 ? inbound / purchase : (inbound > 0 ? 1 : 0);
  const isOver = purchase > 0 && inbound > purchase;
  const isTolerance = !isOver && purchase > 0 && inbound >= purchase * toleranceRate;

  // 逾期天数：今天 - 计划日期，正数表示逾期
  let overdueDays: number | null = null;
  if (input.delivery_date) {
    const d = input.delivery_date instanceof Date
      ? input.delivery_date
      : new Date(input.delivery_date);
    if (!isNaN(d.getTime())) {
      overdueDays = diffDays(input.now ?? new Date(), d);
    }
  }

  // 先按容差/超交得到初步 effective_pending_qty
  const baseCompleted = isOver || isTolerance || (purchase === 0 && inbound === 0);
  let effectivePending = baseCompleted ? 0 : rawPending;

  // 再叠加「尾差过滤」
  const isTailDiff =
    !baseCompleted &&
    effectivePending > 0 &&
    effectivePending <= DELIVERY_TAIL_DIFF_MAX_QTY &&
    overdueDays != null &&
    overdueDays > DELIVERY_TAIL_DIFF_OVERDUE_DAYS;

  if (isTailDiff) effectivePending = 0;

  const isCompleted = baseCompleted || isTailDiff;

  let completionType: DeliveryCompletionType = "pending";
  if (isOver) completionType = "over";
  else if (purchase > 0 && inbound >= purchase) completionType = "normal";
  else if (isTolerance) completionType = "tolerance";
  else if (isTailDiff) completionType = "tail_difference_completed";

  return {
    purchase_qty: purchase,
    inbound_qty: inbound,
    raw_pending_qty: rawPending,
    effective_pending_qty: effectivePending,
    completion_rate: completionRate,
    short_delivered_qty: (isTolerance || isTailDiff) ? Math.max(purchase - inbound, 0) : 0,
    over_delivered_qty: isOver ? inbound - purchase : 0,
    overdue_days: overdueDays,
    is_tolerance_completed: isTolerance,
    is_over_delivered: isOver,
    is_tail_difference_completed: isTailDiff,
    is_delivery_completed: isCompleted,
    completion_type: completionType,
  };
}
