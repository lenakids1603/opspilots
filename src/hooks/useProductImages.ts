// 商品图片批量取图 hooks（货期交付看板 / 供应商工作台 / 催货清单共用）。
// 两个 RPC 均为 SECURITY DEFINER 字典接口，已授权 authenticated（含供应商账号），
// 只返回图片 URL / 款名，不含价格成本等敏感字段。
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StyleImageInfo {
  image_url: string | null;
  product_name: string | null;
}

/** 按款号批量取款图+款名（ops_style_images：main_image_url 优先、external_image_url 兜底） */
export function useStyleImages(styleNos: string[], enabled = true) {
  const uniq = useMemo(
    () => Array.from(new Set(styleNos.filter(Boolean))).sort(),
    [styleNos],
  );
  const key = uniq.join(",");
  return useQuery({
    queryKey: ["style-images", key],
    enabled: enabled && uniq.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ops_style_images" as never, { _style_nos: uniq } as never);
      if (error) throw error;
      const map: Record<string, StyleImageInfo> = {};
      type Row = { style_no: string; product_name: string | null; image_url: string | null };
      for (const row of (data ?? []) as Row[]) {
        map[row.style_no] = { image_url: row.image_url ?? null, product_name: row.product_name ?? null };
      }
      return map;
    },
  });
}

/** 按 SKU 批量取图（ops_sku_images：sku 图 → 款主图 → sku 外链 → 款外链） */
export function useSkuImages(skus: string[], enabled = true) {
  const uniq = useMemo(
    () => Array.from(new Set(skus.filter(Boolean))).sort(),
    [skus],
  );
  const key = uniq.join(",");
  return useQuery({
    queryKey: ["sku-images", key],
    enabled: enabled && uniq.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ops_sku_images" as never, { _skus: uniq } as never);
      if (error) throw error;
      const map: Record<string, string | null> = {};
      type Row = { sku: string; image_url: string | null };
      for (const row of (data ?? []) as Row[]) map[row.sku] = row.image_url ?? null;
      return map;
    },
  });
}
