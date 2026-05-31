
-- 1. user_type enum
DO $$ BEGIN
  CREATE TYPE public.user_type AS ENUM ('internal', 'supplier');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Extend profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS phone TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS user_type public.user_type NOT NULL DEFAULT 'internal';

-- 3. Lookup function (security definer; only returns email, safe to expose)
CREATE OR REPLACE FUNCTION public.get_email_by_identifier(_identifier TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.email
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.email = lower(_identifier)
     OR p.username = _identifier
     OR p.phone = _identifier
     OR u.phone = _identifier
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_email_by_identifier(TEXT) TO anon, authenticated;

-- 4. Update new user trigger to include username/phone/user_type
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, department, username, phone, user_type)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'department', 'General'),
    NULLIF(NEW.raw_user_meta_data->>'username', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE((NEW.raw_user_meta_data->>'user_type')::public.user_type, 'internal')
  );
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'employee');
  RETURN NEW;
END;
$$;

-- ensure trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5. Create test accounts: lena (internal) and gys (supplier)
DO $$
DECLARE
  lena_id uuid;
  gys_id uuid;
BEGIN
  -- lena
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'lena@expensedesk.local') THEN
    lena_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', lena_id, 'authenticated', 'authenticated',
      'lena@expensedesk.local', crypt('lena', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name','Lena','department','Engineering','username','lena','user_type','internal'),
      now(), now(), '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), lena_id,
      jsonb_build_object('sub', lena_id::text, 'email','lena@expensedesk.local'),
      'email', lena_id::text, now(), now(), now());
  END IF;

  -- gys (supplier)
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'gys@expensedesk.local') THEN
    gys_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', gys_id, 'authenticated', 'authenticated',
      'gys@expensedesk.local', crypt('gys', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name','GYS Supplier','department','External','username','gys','user_type','supplier'),
      now(), now(), '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), gys_id,
      jsonb_build_object('sub', gys_id::text, 'email','gys@expensedesk.local'),
      'email', gys_id::text, now(), now(), now());
  END IF;
END $$;
