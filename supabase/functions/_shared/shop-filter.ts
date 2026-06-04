// 共享：加载"停用 / 不参与订单同步"的店铺 jst_shop_id 集合
// 用于所有订单类同步（销售订单、退款单、销售退仓、出库单）跳过历史弃用店铺。
import { admin } from "./jst-client.ts";

export type SkippedShops = { disabled: Set<string>; syncOff: Set<string> };

export async function loadSkippedShops(): Promise<SkippedShops> {
  const disabled = new Set<string>();
  const syncOff = new Set<string>();
  try {
    const { data } = await admin.from("shops")
      .select("jst_shop_id, status, is_order_sync_enabled, is_ignored")
      .is("deleted_at", null);
    (data ?? []).forEach((s: any) => {
      if (!s.jst_shop_id) return;
      const k = String(s.jst_shop_id);
      if ((s.status ?? "active") !== "active" || s.is_ignored === true) disabled.add(k);
      else if ((s.is_order_sync_enabled ?? true) === false) syncOff.add(k);
    });
  } catch (_e) { /* ignore */ }
  return { disabled, syncOff };
}

export function shopIdOf(r: any): string {
  return r?.shop_id != null ? String(r.shop_id) : "";
}

export function shouldSkipShop(sid: string, sk: SkippedShops): "disabled" | "sync_off" | null {
  if (!sid) return null;
  if (sk.disabled.has(sid)) return "disabled";
  if (sk.syncOff.has(sid)) return "sync_off";
  return null;
}

export function formatSkipNote(skippedDisabled: number, skippedSyncOff: number, shopCount: number): string {
  if (!skippedDisabled && !skippedSyncOff) return "";
  return ` · 跳过停用店铺 ${skippedDisabled} 条 / 不参与同步店铺 ${skippedSyncOff} 条（涉及 ${shopCount} 个店铺）`;
}
