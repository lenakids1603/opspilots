-- 聚水潭同步自动调度（第一批：销售订单 / 出库 / 退款 / 销退入仓）
-- 已于 2026-06-10 在 staging（sqbcyvxxpjhsfgvfmohc）执行并验证通过：
--   出库同步任务经定时链路触发，status = success；重复触发返回同一 job，无重复数据。
-- 设计要点：
--  1. 密钥从 Supabase Vault 读取（名称: jst_sync_cron_secret），不写死在 SQL / Git 里。
--     执行前需先运行：select vault.create_secret('<密钥值>', 'jst_sync_cron_secret');
--     且 Edge Functions Secrets 中的 JST_SYNC_CRON_SECRET 必须为同一值。
--  2. 调度间隔 15 分钟，同步窗口 45 分钟，窗口重叠，靠唯一键 upsert 去重。
--  3. pg_cron 使用 UTC 时间；北京时间 = UTC + 8。
--  4. ★ 函数 URL 当前指向 staging；应用到生产前请替换为生产项目 Ref。
--  5. 待办：start_outbound_job 实际按 1d 窗口执行而非 minutes 参数，需核对窗口参数名。

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_jst_sync(fn_name text, payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_secret text;
  v_req_id bigint;
begin
  select decrypted_secret
    into v_secret
    from vault.decrypted_secrets
   where name = 'jst_sync_cron_secret'
   limit 1;

  if v_secret is null then
    raise exception 'Vault 中找不到密钥 jst_sync_cron_secret';
  end if;

  select net.http_post(
           url     := 'https://sqbcyvxxpjhsfgvfmohc.supabase.co/functions/v1/' || fn_name,
           headers := jsonb_build_object(
                        'Content-Type', 'application/json',
                        'x-cron-secret', v_secret
                      ),
           body    := payload,
           timeout_milliseconds := 30000
         )
    into v_req_id;

  return v_req_id;
end
$fn$;

revoke all on function public.invoke_jst_sync(text, jsonb) from public;
revoke all on function public.invoke_jst_sync(text, jsonb) from anon;
revoke all on function public.invoke_jst_sync(text, jsonb) from authenticated;

do $cleanup$
declare
  j record;
begin
  for j in
    select jobname from cron.job
     where jobname in (
       'jst_sales_orders_15min',
       'jst_outbound_orders_15min',
       'jst_refund_orders_hourly',
       'jst_aftersale_received_hourly'
     )
  loop
    perform cron.unschedule(j.jobname);
  end loop;
end
$cleanup$;

select cron.schedule(
  'jst_sales_orders_15min',
  '*/15 * * * *',
  $job$ select public.invoke_jst_sync('jst-sync-sales-orders', '{"minutes": 45}'::jsonb) $job$
);

select cron.schedule(
  'jst_outbound_orders_15min',
  '5-59/15 * * * *',
  $job$ select public.invoke_jst_sync('jst-sync-outbound-orders', '{"action": "start_outbound_job", "minutes": 45}'::jsonb) $job$
);

select cron.schedule(
  'jst_refund_orders_hourly',
  '20 * * * *',
  $job$ select public.invoke_jst_sync('jst-sync-refund-orders', '{"minutes": 180}'::jsonb) $job$
);

select cron.schedule(
  'jst_aftersale_received_hourly',
  '35 * * * *',
  $job$ select public.invoke_jst_sync('jst-sync-aftersale-received', '{"minutes": 180}'::jsonb) $job$
);

