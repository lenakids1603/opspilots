
ALTER TABLE public.jst_sync_jobs
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS lock_owner text,
  ADD COLUMN IF NOT EXISTS next_tick_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_continue boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- Atomic lock acquire
CREATE OR REPLACE FUNCTION public.jst_try_lock_job(_job_id uuid, _owner text, _ttl_seconds int DEFAULT 90)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_rows int;
BEGIN
  UPDATE public.jst_sync_jobs
  SET locked_until = now() + make_interval(secs => _ttl_seconds),
      lock_owner = _owner,
      heartbeat_at = now()
  WHERE id = _job_id
    AND status NOT IN ('cancelled','success')
    AND cancel_requested = false
    AND (locked_until IS NULL OR locked_until < now() OR lock_owner = _owner);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END $$;

CREATE OR REPLACE FUNCTION public.jst_release_job_lock(_job_id uuid, _owner text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.jst_sync_jobs
  SET locked_until = NULL, lock_owner = NULL
  WHERE id = _job_id AND lock_owner = _owner;
$$;

GRANT EXECUTE ON FUNCTION public.jst_try_lock_job(uuid, text, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.jst_release_job_lock(uuid, text) TO authenticated, service_role;

-- Replace cancel_all so cancellation includes the new flags
CREATE OR REPLACE FUNCTION public.jst_cancel_all_running_syncs()
 RETURNS TABLE(cancelled_logs integer, cancelled_jobs integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_logs integer := 0;
  v_jobs integer := 0;
  v_parent_log_ids uuid[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_ops_internal(auth.uid()) THEN
    RAISE EXCEPTION '无权限';
  END IF;

  WITH upd AS (
    UPDATE public.jst_sync_jobs
    SET status = 'cancelled',
        has_next = false,
        auto_continue = false,
        cancel_requested = true,
        cancelled_at = COALESCE(cancelled_at, now()),
        ended_at = COALESCE(ended_at, now()),
        heartbeat_at = now(),
        locked_until = NULL,
        message = COALESCE(NULLIF(message,''), '') ||
                  CASE WHEN COALESCE(message,'') = '' THEN '用户手动终止' ELSE ' · 用户手动终止' END,
        error_detail = COALESCE(NULLIF(error_detail,''), '用户手动终止')
    WHERE status IN ('pending','running','partial','waiting_next_tick','stalled')
       OR (status = 'failed' AND (has_next = true OR ended_at IS NULL))
       OR cancel_requested = false AND ended_at IS NULL
    RETURNING id, parent_log_id
  )
  SELECT count(*), array_remove(array_agg(parent_log_id), NULL)
    INTO v_jobs, v_parent_log_ids
  FROM upd;

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
$function$;
