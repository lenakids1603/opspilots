UPDATE public.jst_sync_errors
SET status = 'resolved', resolved_at = now()
WHERE status <> 'resolved'
  AND (
    error_message ILIKE '%credential_missing%'
    OR error_message ILIKE '%missing secret%'
    OR error_message ILIKE '%缺少%JST_%'
    OR error_message ILIKE '%缺少%凭证%'
    OR error_message ILIKE '%缺少必要凭证%'
    OR error_message ILIKE '%Token 种子%'
    OR error_message ILIKE '%JST_APP_KEY%'
    OR error_message ILIKE '%JST_APP_SECRET%'
    OR error_message ILIKE '%JST_ACCESS_TOKEN%'
    OR error_message ILIKE '%JST_REFRESH_TOKEN%'
  );