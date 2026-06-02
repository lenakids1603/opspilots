CREATE TABLE IF NOT EXISTS public.jst_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_log_id uuid,
  sync_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  trigger_type text NOT NULL DEFAULT 'manual',
  requested_range text NOT NULL DEFAULT 'custom',
  requested_from timestamptz NOT NULL,
  requested_to timestamptz NOT NULL,
  total_windows integer NOT NULL DEFAULT 0,
  current_window_index integer NOT NULL DEFAULT 0,
  current_window_from timestamptz,
  current_window_to timestamptz,
  current_page_index integer NOT NULL DEFAULT 0,
  next_page_index integer NOT NULL DEFAULT 1,
  page_size integer NOT NULL DEFAULT 50,
  has_next boolean NOT NULL DEFAULT true,
  total_api_count integer NOT NULL DEFAULT 0,
  total_order_upserted integer NOT NULL DEFAULT 0,
  total_item_upserted integer NOT NULL DEFAULT 0,
  total_failed integer NOT NULL DEFAULT 0,
  max_window_days integer NOT NULL DEFAULT 3,
  max_pages_per_run integer NOT NULL DEFAULT 3,
  time_budget_seconds integer NOT NULL DEFAULT 45,
  windows jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  message text NOT NULL DEFAULT '',
  error_detail text NOT NULL DEFAULT '',
  created_by uuid,
  last_success_at timestamptz,
  heartbeat_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.jst_sync_jobs TO authenticated;
GRANT ALL ON public.jst_sync_jobs TO service_role;
ALTER TABLE public.jst_sync_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read jst_sync_jobs"
ON public.jst_sync_jobs
FOR SELECT
TO authenticated
USING (public.is_ops_internal(auth.uid()));
CREATE POLICY "admin write jst_sync_jobs"
ON public.jst_sync_jobs
FOR ALL
TO authenticated
USING (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code))
WITH CHECK (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code));

CREATE INDEX IF NOT EXISTS idx_jst_sync_jobs_type_status ON public.jst_sync_jobs(sync_type, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_jst_sync_jobs_parent_log ON public.jst_sync_jobs(parent_log_id);
CREATE INDEX IF NOT EXISTS idx_jst_sync_jobs_heartbeat ON public.jst_sync_jobs(status, heartbeat_at, started_at);

CREATE TABLE IF NOT EXISTS public.jst_sync_log_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.jst_sync_jobs(id) ON DELETE SET NULL,
  log_id uuid,
  sync_type text NOT NULL,
  window_index integer NOT NULL DEFAULT 0,
  window_from timestamptz,
  window_to timestamptz,
  page_index integer NOT NULL,
  page_size integer NOT NULL DEFAULT 50,
  api_count integer NOT NULL DEFAULT 0,
  has_next boolean NOT NULL DEFAULT false,
  main_upserted integer NOT NULL DEFAULT 0,
  item_upserted integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  first_io_date timestamptz,
  last_io_date timestamptz,
  first_modified_at timestamptz,
  last_modified_at timestamptz,
  request_body jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_code text,
  response_msg text,
  duration_ms integer NOT NULL DEFAULT 0,
  error_detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.jst_sync_log_details TO authenticated;
GRANT ALL ON public.jst_sync_log_details TO service_role;
ALTER TABLE public.jst_sync_log_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal read jst_sync_log_details"
ON public.jst_sync_log_details
FOR SELECT
TO authenticated
USING (public.is_ops_internal(auth.uid()));
CREATE POLICY "admin write jst_sync_log_details"
ON public.jst_sync_log_details
FOR ALL
TO authenticated
USING (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code))
WITH CHECK (public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code));

CREATE INDEX IF NOT EXISTS idx_jst_sync_log_details_job ON public.jst_sync_log_details(job_id, window_index, page_index);
CREATE INDEX IF NOT EXISTS idx_jst_sync_log_details_log ON public.jst_sync_log_details(log_id, created_at DESC);

ALTER TABLE public.jst_sync_logs
  ADD COLUMN IF NOT EXISTS job_id uuid,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_jst_sync_logs_job_id ON public.jst_sync_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_jst_sync_logs_heartbeat ON public.jst_sync_logs(status, heartbeat_at, started_at);

DROP TRIGGER IF EXISTS trg_jst_sync_jobs_updated ON public.jst_sync_jobs;
CREATE TRIGGER trg_jst_sync_jobs_updated
BEFORE UPDATE ON public.jst_sync_jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();