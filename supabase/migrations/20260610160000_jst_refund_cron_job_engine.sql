-- 退款单自动同步切换到 job 协议（断点续跑任务引擎）
-- 背景：jst_refund_orders_hourly 原 command 不带 action，走 legacy 一次性后台路径，
--   3 小时窗口退款量大时（1200+ 单）单次调用跑不完，持续「同步超时，已自动结束」。
-- 改为 start_refund_job：经 _shared/jst-sync-job.ts 任务引擎窗口化分页、断点续跑、
--   后台自续跑（auto_continue 自调用 tick_refund_job），写 jst_sync_jobs（trigger_type='cron'）。
-- get_auto_sync_overview 的 mapping 已有 refund_orders 行，无需改动（见 20260610150100）。
-- 注意：
--   1. cron.alter_job 内部校验调用者 = 任务属主（本库任务均属 postgres），须以 postgres 执行。
--   2. 生产库（cnwuimllzotitgsurofn）已于 2026-06-11 手工执行本变更并验证后启用
--      （active=true）；本文件同步设置 active=true 以与生产实际状态一致，
--      并已在 supabase_migrations.schema_migrations 补登记，不会被 db push 重放。

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'jst_refund_orders_hourly';
  if v_jobid is null then
    raise exception '定时任务不存在: jst_refund_orders_hourly';
  end if;
  perform cron.alter_job(
    job_id  := v_jobid,
    command := $job$ select public.invoke_jst_sync('jst-sync-refund-orders', '{"action": "start_refund_job", "minutes": 180, "trigger_type": "cron"}'::jsonb) $job$,
    active  := true
  );
end
$$;
