
-- 1) Prevent privilege escalation via profiles update
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  -- Allow service_role / superuser unconditionally
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  v_is_admin := public.has_ops_role(auth.uid(), 'admin');

  IF NOT v_is_admin THEN
    IF NEW.account_type IS DISTINCT FROM OLD.account_type
       OR NEW.user_type   IS DISTINCT FROM OLD.user_type
       OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
       OR NEW.manager_id  IS DISTINCT FROM OLD.manager_id
       OR NEW.id          IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Not allowed to modify protected profile fields';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_priv_change ON public.profiles;
CREATE TRIGGER profiles_prevent_priv_change
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_privilege_change();

-- 2) Tighten storage policy: managers only see receipts of their direct reports
DROP POLICY IF EXISTS "Managers can view team receipts" ON storage.objects;

CREATE POLICY "Managers can view team receipts"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'receipts'
  AND public.has_role(auth.uid(), 'manager'::public.app_role)
  AND EXISTS (
    SELECT 1
    FROM public.expense_receipts r
    JOIN public.expenses e ON e.id = r.expense_id
    WHERE r.file_path = storage.objects.name
      AND public.is_manager_of(auth.uid(), e.user_id)
  )
);

-- 3) Revoke EXECUTE on SECURITY DEFINER helper functions from anon/public
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_manager_of(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_ops_role(uuid, public.ops_role_code) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_ops_internal(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.supplier_id_of(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_email_by_identifier(text) FROM PUBLIC;
-- get_email_by_identifier intentionally remains callable by anon for login lookup
GRANT EXECUTE ON FUNCTION public.get_email_by_identifier(text) TO anon, authenticated;

-- handle_new_user and update_updated_at are trigger functions; revoke from anon
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_privilege_change() FROM PUBLIC, anon, authenticated;
