-- 一次性回填:对所有已有采购单刷新聚合字段(total_purchase_qty / total_amount / total_received_qty / total_unreceived_qty / warehouse_status)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.purchase_orders LOOP
    PERFORM public.recalc_purchase_order_aggregates(r.id);
  END LOOP;
END $$;

-- 清理悬挂的 running 日志,避免误导
UPDATE public.jst_sync_logs
SET status = 'failed',
    ended_at = now(),
    message = COALESCE(message, '') || ' [自动清理]',
    error_detail = '后台任务被中断或超时(超过 10 分钟),已手动标记为失败'
WHERE status = 'running'
  AND started_at < now() - interval '10 minutes';