UPDATE public.jst_sync_logs
SET status = 'timeout_partial',
    ended_at = now(),
    error_detail = COALESCE(NULLIF(error_detail,''), '') ||
      CASE WHEN error_detail IS NULL OR error_detail = '' THEN '' ELSE ' | ' END ||
      'timeout: running > 10 minutes, marked as stale job',
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('stale_closed', true, 'stale_closed_at', now())
WHERE status = 'running'
  AND started_at < now() - interval '10 minutes';