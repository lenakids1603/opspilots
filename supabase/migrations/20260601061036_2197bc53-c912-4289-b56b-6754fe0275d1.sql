
-- 1) Make the helper view run with invoker privileges (so RLS applies to caller)
ALTER VIEW public.v_purchase_order_items_with_image SET (security_invoker = true);

-- 2) Lock down SECURITY DEFINER functions: revoke from PUBLIC/anon; keep authenticated only for those used inside RLS policies
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_manager_of(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_ops_role(uuid, ops_role_code) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_ops_internal(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.supplier_id_of(uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_profile_privilege_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_email_by_identifier(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalc_purchase_order_aggregates(uuid) FROM PUBLIC, anon, authenticated;

-- 3) Remove the broad public listing policy on the product-images bucket.
-- Public buckets remain readable via their CDN URL; this only prevents listing the bucket contents.
DROP POLICY IF EXISTS "product-images public read" ON storage.objects;
