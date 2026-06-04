
CREATE OR REPLACE FUNCTION public.jst_cancel_all_running_syncs()
RETURNS TABLE(cancelled_logs integer, cancelled_jobs integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_logs integer := 0;
  v_jobs integer := 0;
  v_parent_log_ids uuid[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_ops_internal(auth.uid()) THEN
    RAISE EXCEPTION '无权限';
  END IF;

  -- Cancel jobs: active statuses + failed-but-resumable
  WITH upd AS (
    UPDATE public.jst_sync_jobs
    SET status = 'cancelled',
        has_next = false,
        ended_at = COALESCE(ended_at, now()),
        heartbeat_at = now(),
        message = COALESCE(NULLIF(message,''), '') ||
                  CASE WHEN COALESCE(message,'') = '' THEN '用户手动终止' ELSE ' · 用户手动终止' END,
        error_detail = COALESCE(NULLIF(error_detail,''), '用户手动终止')
    WHERE status IN ('pending','running','partial','waiting_next_tick','stalled')
       OR (status = 'failed' AND (has_next = true OR ended_at IS NULL))
    RETURNING id, parent_log_id
  )
  SELECT count(*), array_remove(array_agg(parent_log_id), NULL)
    INTO v_jobs, v_parent_log_ids
  FROM upd;

  -- Cancel logs: active statuses + failed without ended_at, plus any parent logs of cancelled jobs
  WITH upd2 AS (
    UPDATE public.jst_sync_logs
    SET status = 'cancelled',
        ended_at = COALESCE(ended_at, now()),
        error_detail = COALESCE(NULLIF(error_detail,''), '用户手动终止')
    WHERE status IN ('running','partial','partial_failed','timeout_partial','stalled')
       OR (status = 'failed' AND ended_at IS NULL)
       OR (v_parent_log_ids IS NOT NULL AND id = ANY(v_parent_log_ids))
    RETURNING 1
  )
  SELECT count(*) INTO v_logs FROM upd2;

  RETURN QUERY SELECT v_logs, v_jobs;
END;
$$;

GRANT EXECUTE ON FUNCTION public.jst_cancel_all_running_syncs() TO authenticated;
