-- 催货 RPC 执行授权加固:把 ops_chase_purchase_list() / ops_chase_quantui_skus()
--   恢复到与同组接口一致的硬化授权(REVOKE public/anon + GRANT authenticated/service_role)。
--
-- 背景(生产 ref cnwuimllzotitgsurofn 实测):
--   * ops_chase_purchase_list() 于 20260613060300 因新增返回列被 DROP+CREATE 重建,
--     DROP 清除了 20260611060000 设置的 ACL,回落为 Supabase 默认(授予 PUBLIC/anon)。
--   * ops_chase_quantui_skus() 于 20260613060100 建立时即沿用默认 ACL。
--   加固前两者均为 "=X/postgres, anon=X/..., authenticated=X/..., service_role=X/..."。
--
-- 风险口径(本次复核,对 20260613060300 注释的纠正):
--   * ops_chase_purchase_list() 函数体入口校验 has_ops_role(admin/ops),anon 调用必被
--     RAISE 42501(实测 PostgREST 返回 401),默认 ACL 对它仅是纵深防御冗余。
--   * 但 ops_chase_quantui_skus() 为 LANGUAGE sql SECURITY DEFINER 且【无入口校验】,
--     默认 ACL 下 anon 可经 PostgREST 直接执行(加固前实测 HTTP 200),绕过
--     ops_chase_style_flags / ops_skus 的 RLS 读取劝退 SKU(sku+原供应商+备注)。
--     该表当前无 quantui 行,暂无实际数据泄露,但属真实可达的匿名读取路径,故收敛。
--     注:该函数是内部构件,也被 ops_chase_purchase_list / supplier_list / unmatched_list
--     以 SECURITY DEFINER(属主 postgres)嵌套调用;嵌套调用按属主鉴权,故本次收回
--     anon/authenticated 直连权限【不影响】这些内部调用。若日后要给其函数体补入口校验,
--     须同时放行供应商账号(supplier_list 可被供应商调用并内联本函数),不能只判
--     is_ops_internal,否则会把供应商的催货列表打成 42501。
--
-- 本次仅调整执行授权,不改任何函数体;加固后与 ops_chase_supplier_list /
--   ops_chase_unmatched_list / ops_chase_question_count 的授权一致。生产已通过
--   Management API 同步执行本段并 NOTIFY pgrst reload schema。REVOKE/GRANT 可重复执行。

REVOKE ALL ON FUNCTION public.ops_chase_purchase_list() FROM public;
REVOKE ALL ON FUNCTION public.ops_chase_purchase_list() FROM anon;
GRANT EXECUTE ON FUNCTION public.ops_chase_purchase_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_chase_purchase_list() TO service_role;

REVOKE ALL ON FUNCTION public.ops_chase_quantui_skus() FROM public;
REVOKE ALL ON FUNCTION public.ops_chase_quantui_skus() FROM anon;
GRANT EXECUTE ON FUNCTION public.ops_chase_quantui_skus() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_chase_quantui_skus() TO service_role;
