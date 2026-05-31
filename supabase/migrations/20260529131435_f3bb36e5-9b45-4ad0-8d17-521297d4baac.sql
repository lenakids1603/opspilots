
-- Change default for new signups to pending
ALTER TABLE public.profiles ALTER COLUMN account_type SET DEFAULT 'pending'::ops_account_type;

-- Update trigger: suppliers stay supplier, otherwise pending until admin promotion
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_type public.user_type;
  v_account_type public.ops_account_type;
BEGIN
  v_user_type := COALESCE((NEW.raw_user_meta_data->>'user_type')::public.user_type, 'internal');
  v_account_type := CASE WHEN v_user_type = 'supplier' THEN 'supplier'::public.ops_account_type
                         ELSE 'pending'::public.ops_account_type END;

  INSERT INTO public.profiles (id, full_name, department, username, phone, user_type, account_type)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'department', 'General'),
    NULLIF(NEW.raw_user_meta_data->>'username', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    v_user_type,
    v_account_type
  );
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'employee');
  RETURN NEW;
END;
$function$;

-- Tighten ops_suppliers SELECT to privileged roles only
DROP POLICY IF EXISTS "internal can read suppliers" ON public.ops_suppliers;
CREATE POLICY "privileged internal can read suppliers"
ON public.ops_suppliers
FOR SELECT
TO authenticated
USING (
  public.is_ops_internal(auth.uid()) AND (
    public.has_ops_role(auth.uid(), 'admin')
    OR public.has_ops_role(auth.uid(), 'ops')
    OR public.has_ops_role(auth.uid(), 'finance')
  )
);

-- Restrict write to admin/ops as well (was: any internal)
DROP POLICY IF EXISTS "internal can write suppliers" ON public.ops_suppliers;
CREATE POLICY "privileged internal can write suppliers"
ON public.ops_suppliers
FOR ALL
TO authenticated
USING (
  public.is_ops_internal(auth.uid()) AND (
    public.has_ops_role(auth.uid(), 'admin')
    OR public.has_ops_role(auth.uid(), 'ops')
  )
)
WITH CHECK (
  public.is_ops_internal(auth.uid()) AND (
    public.has_ops_role(auth.uid(), 'admin')
    OR public.has_ops_role(auth.uid(), 'ops')
  )
);

-- Explicit DENY UPDATE/DELETE on receipts bucket (only owner of folder may delete)
CREATE POLICY "Users can delete own receipts"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'receipts'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Block receipts updates"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'receipts' AND false);

-- Restrict product-images listing: allow reading individual objects but no broad listing by anon
-- Drop overly-permissive policies if any and replace with object-level read for everyone, no list
-- Note: public bucket reads still work via signed/public URLs; this just narrows storage.objects SELECT
