// 货期交付看板 - 交付容差 / 短溢装完结规则
// 仅用于看板数据展示层，不修改数据库、不修改采购单状态、不写入任何数据。
// 后续若改为按供应商 / 品类 / 采购单配置，请在此文件内扩展。

export const DELIVERY_COMPLETION_TOLERANCE_RATE = 0.98;

export type DeliveryCompletionType =
  | "normal"     // 正常完成 (received >= purchase)
  | "tolerance"  // 容差完成 (>= 98%)
  | "over"       // 超交完成
  | "pending";   // 仍在交付中

export interface ToleranceInput {
  purchase_qty: number;
  received_qty: number;
}

export interface ToleranceResult {
  purchase_qty: number;
  inbound_qty: number;
  raw_pending_qty: number;
  effective_pending_qty: number;
  completion_rate: number;             // 0~1+
  short_delivered_qty: number;         // 短交数量（容差完成时 >0）
  over_delivered_qty: number;          // 超交数量
  is_tolerance_completed: boolean;
  is_over_delivered: boolean;
  is_delivery_completed: boolean;      // 是否视为已完成（=不再显示在看板）
  completion_type: DeliveryCompletionType;
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
  const isCompleted = isOver || isTolerance || (purchase === 0 && inbound === 0);

  let completionType: DeliveryCompletionType = "pending";
  if (isOver) completionType = "over";
  else if (purchase > 0 && inbound >= purchase) completionType = "normal";
  else if (isTolerance) completionType = "tolerance";

  return {
    purchase_qty: purchase,
    inbound_qty: inbound,
    raw_pending_qty: rawPending,
    effective_pending_qty: isCompleted ? 0 : rawPending,
    completion_rate: completionRate,
    short_delivered_qty: isTolerance ? Math.max(purchase - inbound, 0) : 0,
    over_delivered_qty: isOver ? inbound - purchase : 0,
    is_tolerance_completed: isTolerance,
    is_over_delivered: isOver,
    is_delivery_completed: isCompleted,
    completion_type: completionType,
  };
}
