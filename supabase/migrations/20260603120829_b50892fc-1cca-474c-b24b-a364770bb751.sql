CREATE OR REPLACE FUNCTION public.jst_cancel_all_running_syncs()
RETURNS TABLE(cancelled_logs integer, cancelled_jobs integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_logs integer := 0;
  v_jobs integer := 0;
BEGIN
  IF NOT public.is_ops_internal(auth.uid()) THEN
    RAISE EXCEPTION '无权限';
  END IF;

  WITH upd AS (
    UPDATE public.jst_sync_logs
    SET status = 'cancelled',
        ended_at = COALESCE(ended_at, now()),
        error_detail = COALESCE(NULLIF(error_detail,''), '用户手动终止')
    WHERE status = 'running'
    RETURNING 1
  )
  SELECT count(*) INTO v_logs FROM upd;

  WITH upd2 AS (
    UPDATE public.jst_sync_jobs
    SET status = 'cancelled',
        ended_at = COALESCE(ended_at, now()),
        message = COALESCE(NULLIF(message,''), '用户手动终止')
    WHERE status IN ('running','pending','stalled')
    RETURNING 1
  )
  SELECT count(*) INTO v_jobs FROM upd2;

  RETURN QUERY SELECT v_logs, v_jobs;
END;
$$;

GRANT EXECUTE ON FUNCTION public.jst_cancel_all_running_syncs() TO authenticated;