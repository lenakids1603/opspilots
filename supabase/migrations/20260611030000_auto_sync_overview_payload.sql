-- get_auto_sync_overview 增加 payload 列
--  背景：前端「自动同步总览」卡片此前硬编码各任务的同步窗口（如采购单写死 60 分钟），
--  与 cron command 里 invoke_jst_sync 的真实参数（minutes: 180）不一致。
--  改为：从 cron.job.command 中提取 invoke_jst_sync 的 jsonb payload 原样返回，
--  前端解析 payload.minutes / payload.days 显示窗口，不再维护硬编码表。
--  说明：返回 table 的函数增加列必须 drop 后重建（create or replace 不能改返回类型）。

drop function if exists public.get_auto_sync_overview();

create function public.get_auto_sync_overview()
returns table (
  jobname text,
  sync_type text,
  schedule text,
  active boolean,
  payload jsonb,
  last_run_status text,
  last_run_started_at timestamptz,
  last_run_ended_at timestamptz,
  last_run_message text,
  success_count_24h bigint,
  failed_count_24h bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.has_ops_role(auth.uid(), 'admin'::public.ops_role_code) then
    raise exception '仅限管理员调用 get_auto_sync_overview' using errcode = '42501';
  end if;

  return query
  with mapping(m_jobname, m_sync_type) as (
    values
      ('jst_sales_orders_15min',          'sales_orders'),
      ('jst_outbound_orders_15min',       'outbound_orders'),
      ('jst_refund_orders_hourly',        'refund_orders'),
      ('jst_aftersale_received_hourly',   'aftersale_received'),
      ('jst_dispatch_base_archive_daily', 'dispatch_base_archive'),
      ('jst_purchase_orders_hourly',      'purchase_orders'),
      ('jst_purchase_inbound_hourly',     'purchase_inbound_orders')
  )
  select
    j.jobname::text,
    m.m_sync_type,
    j.schedule::text,
    j.active,
    -- command 形如  select public.invoke_jst_sync('<fn>', '{...}'::jsonb)
    -- 提取其中的 jsonb 字面量；不匹配时为 null（前端按无窗口参数处理）
    (substring(j.command from $re$'({[^']*})'::jsonb$re$))::jsonb,
    lr.status,
    lr.started_at,
    lr.ended_at,
    lr.message,
    coalesce(c.succ, 0),
    coalesce(c.fail, 0)
  from cron.job j
  join mapping m on m.m_jobname = j.jobname::text
  left join lateral (
    select k.status::text, k.started_at, k.ended_at, k.message
    from public.jst_sync_jobs k
    where k.sync_type = m.m_sync_type
      and k.trigger_type = 'cron'
    order by k.started_at desc
    limit 1
  ) lr on true
  left join lateral (
    select
      count(*) filter (where k.status = 'success') as succ,
      count(*) filter (where k.status in ('failed', 'stalled')) as fail
    from public.jst_sync_jobs k
    where k.sync_type = m.m_sync_type
      and k.trigger_type = 'cron'
      and k.started_at >= now() - interval '24 hours'
  ) c on true
  order by j.jobname::text;
end
$fn$;

revoke all on function public.get_auto_sync_overview() from public;
revoke all on function public.get_auto_sync_overview() from anon;
grant execute on function public.get_auto_sync_overview() to authenticated;
grant execute on function public.get_auto_sync_overview() to service_role;
