// 订单生命周期分类（ERP 内部口径）
// 与 supabase/functions/_shared/orderClassify.ts 保持同步

export type InternalOrderType =
  | "unpaid_cancelled"
  | "paid_cancelled_before_ship"
  | "returned_after_ship"
  | "paid_pending_ship"
  | "shipped"
  | "unknown";

export const INTERNAL_ORDER_TYPE_NAME: Record<InternalOrderType, string> = {
  unpaid_cancelled: "未付款取消",
  paid_cancelled_before_ship: "付款后未发货退款",
  returned_after_ship: "发货后退货",
  paid_pending_ship: "已付款待发货",
  shipped: "已发货",
  unknown: "待识别",
};

export interface ClassifyInput {
  status?: string | null;
  paid_amount?: number | string | null;
  pay_time?: string | null;
  io_id?: string | null;
  io_date?: string | null;
  send_date?: string | null;
  l_id?: string | null;
}

export interface RefundInfo {
  hasRefund?: boolean;
}

export function classifySalesOrder(
  o: ClassifyInput,
  refund?: RefundInfo,
): { code: InternalOrderType; name: string } {
  const status = String(o.status ?? "").toLowerCase().trim();
  const cancelled =
    status === "cancelled" || status === "canceled" || status === "cancel" || status === "已取消";
  const paid = Number(o.paid_amount ?? 0) > 0 || !!o.pay_time;
  const shipped =
    !!(o.io_id && String(o.io_id).length) ||
    !!o.io_date ||
    !!o.send_date ||
    !!(o.l_id && String(o.l_id).length);
  const hasRefund = !!refund?.hasRefund;

  let code: InternalOrderType = "unknown";
  if (cancelled && !paid && !shipped) code = "unpaid_cancelled";
  else if (cancelled && paid && !shipped) code = "paid_cancelled_before_ship";
  else if ((cancelled || hasRefund) && shipped) code = "returned_after_ship";
  else if (shipped) code = "shipped";
  else if (paid && !shipped && !cancelled) code = "paid_pending_ship";

  return { code, name: INTERNAL_ORDER_TYPE_NAME[code] };
}
