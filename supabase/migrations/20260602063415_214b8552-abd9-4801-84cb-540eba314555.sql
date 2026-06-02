ALTER TABLE public.bank_accounts ALTER COLUMN account_name DROP NOT NULL;
ALTER TABLE public.bank_accounts ALTER COLUMN account_name SET DEFAULT '';

CREATE OR REPLACE FUNCTION public.bank_accounts_mirror_holder()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.account_holder_name IS NULL OR NEW.account_holder_name = '' THEN
    NEW.account_holder_name := COALESCE(NEW.account_name, '');
  END IF;
  IF NEW.account_name IS NULL OR NEW.account_name = '' THEN
    NEW.account_name := COALESCE(NEW.account_holder_name, '');
  END IF;
  IF NEW.account_number IS NOT NULL AND NEW.account_number <> '' AND (NEW.account_no_masked IS NULL OR NEW.account_no_masked = '') THEN
    NEW.account_no_masked := NEW.account_number;
  END IF;
  IF NEW.account_no_masked IS NOT NULL AND NEW.account_no_masked <> '' AND (NEW.account_number IS NULL OR NEW.account_number = '') THEN
    NEW.account_number := NEW.account_no_masked;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bank_accounts_mirror_holder ON public.bank_accounts;
CREATE TRIGGER trg_bank_accounts_mirror_holder
  BEFORE INSERT OR UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.bank_accounts_mirror_holder();