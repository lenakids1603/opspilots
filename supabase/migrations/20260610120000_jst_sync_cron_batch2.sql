-- 聚水潭同步自动调度（第二批）：
--  1. jst-sync-dispatch 基础档案（店铺/供应商/仓库）每日全量快照同步。
--     dispatch 函数已支持 x-cron-secret 定时入口（见 supabase/functions/jst-sync-dispatch/index.ts），
--     cron 调用默认 module_key=base_archive、trigger_type=cron。base_archive 为全量快照 upsert，
--     天然幂等，body 中 days 参数对该模块无效（保留以符合 minutes/hours/days 约定）。
--  2. 出库 cron payload 增加 trigger_type=cron（此前 jst_sync_jobs.trigger_type 误记为 manual）。
--     说明：start_outbound_job 的 minutes 参数一直有效（staging 验证 requested_from/to 间隔确为
--     45 分钟）；此前 requested_range 显示 "1d" 是 _shared/jst-sync-job.ts 中标签按天取整所致，
--     已在代码侧修正（亚天级窗口显示 45m / 3h 等）。
--  3. 销售订单 cron 从 legacy 一次性路径切换为断点续跑 job 协议（start_sales_job）。
--     原因：staging 实测 45 分钟窗口约 6000 单 / 115+ 页，legacy 单次调用在 10 分钟
--     stale 守卫处被判超时（status=failed）。job 协议立即返回、按 tick 自续跑完整窗口，
--     活跃任务自动复用，不会因 15 分钟一次的调度产生堆积。
--  依赖：public.invoke_jst_sync（见 20260610064400_jst_sync_cron_schedules.sql），
--       Vault 密钥 jst_sync_cron_secret 已配置。
--  ★ 函数 URL 由 invoke_jst_sync 决定，当前指向 staging；生产上线时替换该函数中的项目 Ref。
--  pg_cron 为 UTC 时间：19:00 UTC = 北京时间次日 03:00。

do $cleanup$
begin
  if exists (select 1 from cron.job where jobname = 'jst_dispatch_base_archive_daily') then
    perform cron.unschedule('jst_dispatch_base_archive_daily');
  end if;
  if exists (select 1 from cron.job where jobname = 'jst_outbound_orders_15min') then
    perform cron.unschedule('jst_outbound_orders_15min');
  end if;
  if exists (select 1 from cron.job where jobname = 'jst_sales_orders_15min') then
    perform cron.unschedule('jst_sales_orders_15min');
  end if;
end
$cleanup$;

select cron.schedule(
  'jst_sales_orders_15min',
  '*/15 * * * *',
  $job$ select public.invoke_jst_sync('jst-sync-sales-orders', '{"action": "start_sales_job", "minutes": 45, "trigger_type": "cron"}'::jsonb) $job$
);

select cron.schedule(
  'jst_dispatch_base_archive_daily',
  '0 19 * * *',
  $job$ select public.invoke_jst_sync('jst-sync-dispatch', '{"module_key": "base_archive", "trigger_type": "cron", "days": 2}'::jsonb) $job$
);

select cron.schedule(
  'jst_outbound_orders_15min',
  '5-59/15 * * * *',
  $job$ select public.invoke_jst_sync('jst-sync-outbound-orders', '{"action": "start_outbound_job", "minutes": 45, "trigger_type": "cron"}'::jsonb) $job$
);
