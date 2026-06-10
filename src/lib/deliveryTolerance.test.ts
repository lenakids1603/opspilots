import { describe, it, expect } from "vitest";
import {
  evaluateDelivery,
  DELIVERY_COMPLETION_TOLERANCE_RATE,
} from "./deliveryTolerance";

// 固定「今天」用本地年月日构造，避免时区漂移影响逾期天数判断。
const NOW = new Date(2026, 5, 9); // 2026-06-09
const daysAgo = (n: number) => new Date(2026, 5, 9 - n);

describe("evaluateDelivery", () => {
  it("正常完成：入库 = 采购", () => {
    const r = evaluateDelivery({ purchase_qty: 100, received_qty: 100, now: NOW });
    expect(r.completion_type).toBe("normal");
    expect(r.is_delivery_completed).toBe(true);
    expect(r.effective_pending_qty).toBe(0);
    expect(r.completion_rate).toBe(1);
  });

  it("超交完成：入库 > 采购", () => {
    const r = evaluateDelivery({ purchase_qty: 100, received_qty: 120, now: NOW });
    expect(r.completion_type).toBe("over");
    expect(r.is_over_delivered).toBe(true);
    expect(r.over_delivered_qty).toBe(20);
    expect(r.effective_pending_qty).toBe(0);
    expect(r.is_delivery_completed).toBe(true);
  });

  it("容差完成：完成率 ≥ 98%", () => {
    const r = evaluateDelivery({ purchase_qty: 100, received_qty: 98, now: NOW });
    expect(r.completion_type).toBe("tolerance");
    expect(r.is_tolerance_completed).toBe(true);
    expect(r.short_delivered_qty).toBe(2);
    expect(r.effective_pending_qty).toBe(0);
    expect(r.is_delivery_completed).toBe(true);
    expect(r.completion_rate).toBeCloseTo(DELIVERY_COMPLETION_TOLERANCE_RATE);
  });

  it("未达容差且未逾期：仍在交付中", () => {
    const r = evaluateDelivery({ purchase_qty: 100, received_qty: 90, now: NOW });
    expect(r.completion_type).toBe("pending");
    expect(r.is_delivery_completed).toBe(false);
    expect(r.raw_pending_qty).toBe(10);
    expect(r.effective_pending_qty).toBe(10);
  });

  it("尾差完成：逾期 > 5 天且缺口 ≤ 20 件", () => {
    const r = evaluateDelivery({
      purchase_qty: 100,
      received_qty: 90,
      delivery_date: daysAgo(6),
      now: NOW,
    });
    expect(r.completion_type).toBe("tail_difference_completed");
    expect(r.is_tail_difference_completed).toBe(true);
    expect(r.is_delivery_completed).toBe(true);
    expect(r.effective_pending_qty).toBe(0);
    expect(r.short_delivered_qty).toBe(10);
    expect(r.overdue_days).toBe(6);
  });

  it("逾期不足 5 天不触发尾差过滤", () => {
    const r = evaluateDelivery({
      purchase_qty: 100,
      received_qty: 90,
      delivery_date: daysAgo(5),
      now: NOW,
    });
    expect(r.is_tail_difference_completed).toBe(false);
    expect(r.completion_type).toBe("pending");
    expect(r.effective_pending_qty).toBe(10);
    expect(r.overdue_days).toBe(5);
  });

  it("缺口超过 20 件不触发尾差过滤", () => {
    const r = evaluateDelivery({
      purchase_qty: 100,
      received_qty: 70,
      delivery_date: daysAgo(10),
      now: NOW,
    });
    expect(r.is_tail_difference_completed).toBe(false);
    expect(r.completion_type).toBe("pending");
    expect(r.effective_pending_qty).toBe(30);
  });

  it("空采购单（0/0）视为已完成", () => {
    const r = evaluateDelivery({ purchase_qty: 0, received_qty: 0, now: NOW });
    expect(r.is_delivery_completed).toBe(true);
    expect(r.effective_pending_qty).toBe(0);
  });
});
