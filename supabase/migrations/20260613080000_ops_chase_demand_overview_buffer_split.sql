-- 催货页 7 天全景:把「货在路上」按安全缓冲拆成 吃紧 / 宽裕
--
-- 背景:原 in_transit(货在路上)被整体当成安全,但实测 98% 是「交期距发货截止
-- ≤3 天」的薄冰货——会一直伪装成安全,直到交期过了才跳进「要催」,那时已是最后一天。
-- 用户定的安全缓冲 = 3 天:缓冲 ≤3 天 = 吃紧(需提前盯);≥4 天 = 宽裕(真安全)。
--
-- 升级 ops_chase_demand_overview:新增可选参数 p_buffer_days(默认 3),把原 in_transit
-- 一类按 (latest_ship_time::date - delivery_date::date) 是否 ≤ p_buffer_days(或无交期)
-- 拆成两个 category 值:in_transit_tight(吃紧)/ in_transit_safe(宽裕)。返回列不变。
-- 因签名由 0 参变为 1 参,先 DROP 旧 0 参版本再建带默认值的新版本(0 参调用走默认 3)。
--
-- 本函数已由 Claude 在 staging 先行 + 生产部署完毕(两库一致);本迁移文件仅补登记到
-- git。权限:authenticated 可执行、anon 已 REVOKE、函数体内 is_ops_internal 二次校验。

DROP FUNCTION IF EXISTS public.ops_chase_demand_overview();
CREATE OR REPLACE FUNCTION public.ops_chase_demand_overview(p_buffer_days integer DEFAULT 3)
RETURNS TABLE(category text, qty_7d numeric, orders_7d bigint, qty_overdue numeric, orders_overdue bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_ops_internal(auth.uid()) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH base AS (
    SELECT CASE
        WHEN s.category = 'in_transit' AND (
          s.delivery_date IS NULL
          OR ((s.latest_ship_time AT TIME ZONE 'Asia/Shanghai')::date
              - (s.delivery_date AT TIME ZONE 'Asia/Shanghai')::date) <= p_buffer_days
        ) THEN 'in_transit_tight'
        WHEN s.category = 'in_transit' THEN 'in_transit_safe'
        ELSE s.category END AS category,
      s.match_qty, s.o_id, s.latest_ship_time
    FROM public.ops_chase_match_snapshot s
    WHERE s.latest_ship_time IS NOT NULL
      AND s.latest_ship_time <= now() + interval '7 days'
  )
  SELECT b.category,
    coalesce(sum(b.match_qty),0),
    count(DISTINCT b.o_id),
    coalesce(sum(b.match_qty) FILTER (WHERE b.latest_ship_time <= now()),0),
    count(DISTINCT b.o_id) FILTER (WHERE b.latest_ship_time <= now())
  FROM base b GROUP BY b.category;
END
$function$;
REVOKE ALL ON FUNCTION public.ops_chase_demand_overview(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_chase_demand_overview(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.ops_chase_demand_overview(integer) TO authenticated;
