// 聚水潭单据状态英文 → 中文展示
// 覆盖订单 / 出库 / 入库 / 售后等常见状态字符串
const MAP: Record<string, string> = {
  // 订单
  WaitConfirm: "待确认",
  Confirmed: "已确认",
  WaitSend: "待发货",
  Sending: "发货中",
  Sent: "已发货",
  Delivered: "已签收",
  Cancelled: "已取消",
  Canceled: "已取消",
  Closed: "已完结",
  Finished: "已完成",
  Merged: "已合并",
  Split: "已拆分",
  Question: "异常",
  Suspended: "已挂起",
  // 入库 / 出库 / 售后
  Confirming: "确认中",
  Outed: "已出库",
  WaitOuted: "待出库",
  PartOuted: "部分出库",
  WaitIn: "待入库",
  PartIn: "部分入库",
  InStorage: "已入库",
  Received: "已入库",
  Returned: "已退货",
  WaitReceive: "待收货",
  WaitReturn: "待退货",
  // 平台 / 通用
  Pending: "待处理",
  Processing: "处理中",
  Failed: "失败",
  Success: "成功",
};

export function zhStatus(s: any): string {
  if (s == null) return "-";
  const k = String(s).trim();
  if (!k) return "-";
  return MAP[k] ?? k;
}
