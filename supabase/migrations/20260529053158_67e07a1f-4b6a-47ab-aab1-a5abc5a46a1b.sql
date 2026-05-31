ALTER TABLE public.jst_tokens ENABLE ROW LEVEL SECURITY;
-- 不创建任何策略,authenticated/anon 都无法访问;service_role 自动绕过 RLS
REVOKE ALL ON public.jst_tokens FROM anon, authenticated;
GRANT ALL ON public.jst_tokens TO service_role;