import { describe, it, expect } from "vitest";
import {
  classifySalesOrder,
  INTERNAL_ORDER_TYPE_NAME,
  type ClassifyInput,
  type InternalOrderType,
} from "./orderClassify";
// 镜像实现：Deno Edge 运行时下的同一逻辑。两份必须保持一致（见底部 parity 用例）。
import { classifySalesOrder as classifySalesOrderEdge } from "../../supabase/functions/_shared/orderClassify";

type Case = {
  name: string;
  input: ClassifyInput;
  refund?: { hasRefund?: boolean };
  expected: InternalOrderType;
};

// 覆盖 classifySalesOrder 的每一条分支。
const CASES: Case[] = [
  {
    name: "未付款 + 已取消 + 未发货 → unpaid_cancelled",
    input: { status: "cancelled", paid_amount: 0 },
    expected: "unpaid_cancelled",
  },
  {
    name: "中文「已取消」+ 未付款 → unpaid_cancelled",
    input: { status: "已取消", paid_amount: 0 },
    expected: "unpaid_cancelled",
  },
  {
    name: "已付款(金额) + 已取消 + 未发货 → paid_cancelled_before_ship",
    input: { status: "cancelled", paid_amount: 99.5 },
    expected: "paid_cancelled_before_ship",
  },
  {
    name: "已付款(pay_time) + 已取消 + 未发货 → paid_cancelled_before_ship",
    input: { status: "canceled", paid_amount: 0, pay_time: "2026-01-01T00:00:00Z" },
    expected: "paid_cancelled_before_ship",
  },
  {
    name: "已取消 + 已发货(io_id) → returned_after_ship",
    input: { status: "cancelled", paid_amount: 100, io_id: "IO123" },
    expected: "returned_after_ship",
  },
  {
    name: "未取消但有退款 + 已发货 → returned_after_ship",
    input: { status: "sent", paid_amount: 100, io_id: "IO123" },
    refund: { hasRefund: true },
    expected: "returned_after_ship",
  },
  {
    name: "已发货(io_id) 无退款 → shipped",
    input: { status: "sent", paid_amount: 100, io_id: "IO999" },
    expected: "shipped",
  },
  {
    name: "已发货(send_date) → shipped",
    input: { status: "sent", paid_amount: 100, send_date: "2026-02-02" },
    expected: "shipped",
  },
  {
    name: "已发货(l_id 物流单号) → shipped",
    input: { status: "sent", paid_amount: 100, l_id: "SF12345" },
    expected: "shipped",
  },
  {
    name: "已付款 + 未发货 + 未取消 → paid_pending_ship",
    input: { status: "waitconfirm", paid_amount: 200 },
    expected: "paid_pending_ship",
  },
  {
    name: "空对象 → unknown",
    input: {},
    expected: "unknown",
  },
];

describe("classifySalesOrder", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const res = classifySalesOrder(c.input, c.refund);
      expect(res.code).toBe(c.expected);
      expect(res.name).toBe(INTERNAL_ORDER_TYPE_NAME[c.expected]);
    });
  }

  it("hasRefund 不影响未发货订单的分类", () => {
    const base: ClassifyInput = { status: "waitconfirm", paid_amount: 200 };
    expect(classifySalesOrder(base, { hasRefund: false }).code).toBe("paid_pending_ship");
    expect(classifySalesOrder(base, { hasRefund: true }).code).toBe("paid_pending_ship");
  });
});

// 防漂移：前端 (src/lib) 与 Edge (supabase/functions/_shared) 两份实现必须输出一致。
describe("orderClassify parity (前端 vs Edge)", () => {
  for (const c of CASES) {
    it(`一致: ${c.name}`, () => {
      const front = classifySalesOrder(c.input, c.refund);
      const edge = classifySalesOrderEdge(c.input, c.refund);
      expect(edge).toEqual(front);
    });
  }
});
