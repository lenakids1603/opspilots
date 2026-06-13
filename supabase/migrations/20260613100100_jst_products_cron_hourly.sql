-- =============================================================================
-- 商品资料增量同步 · 每小时 cron（jst_products_hourly）
--
-- 沿用 public.invoke_jst_sync(fn, payload)：从 Vault 读 jst_sync_cron_secret，
--   net.http_post 带 x-cron-secret 打到函数 URL（与 退款/出库 cron 同一套机制；
--   生产 invoke_jst_sync 的 URL 已指向生产、Vault 密钥已就绪，因退款/出库 cron 在跑）。
--
-- 窗口：滚动近 120 分钟（minutes:120），与小时调度刻意重叠留冗余；重叠由
--   sku_code/jst_sku_id 唯一键 + jst_modified_at 水位幂等去重，物理行不翻倍。
--   ★ 不写死时间戳——每次触发都按「现在往前 120 分钟」滚动。
-- pg_cron 使用 UTC；每小时一次。分钟错峰取 :50
--   （现有：销售 */15、出库 5-59/15、退款 :20、售后 :35）。
--
-- ⚠️ 生产部署顺序：本迁移须在「部署 jst-sync-products 函数(--no-verify-jwt)」之后再应用，
--   否则首跑会打到未更新/缺鉴权的函数。
-- 本迁移可重复执行（先 unschedule 同名任务再 schedule）。
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $cleanup$
begin
  if exists (select 1 from cron.job where jobname = 'jst_products_hourly') then
    perform cron.unschedule('jst_products_hourly');
  end if;
end
$cleanup$;

select cron.schedule(
  'jst_products_hourly',
  '50 * * * *',
  $job$ select public.invoke_jst_sync('jst-sync-products', '{"action":"start_products_job","minutes":120,"trigger_type":"cron"}'::jsonb) $job$
);
