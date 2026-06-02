-- 清理旧的"只写 jst_sync_logs running"的采购单同步记录（无 job_id、无 heartbeat、无 ended_at）
UPDATE public.jst_sync_logs
SET status = 'stalled',
    ended_at = now(),
    error_detail = '旧采购同步记录，未接入 job 任务系统，已标记为 stalled',
    message = COALESCE(NULLIF(message, ''), '') || ' [系统清理：旧采购同步记录已迁移到断点续跑任务系统]'
WHERE sync_type = 'purchase_orders'
  AND status = 'running'
  AND job_id IS NULL
  AND ended_at IS NULL;