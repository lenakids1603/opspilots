# 任务书：聚水潭自动同步完善（staging 阶段）

> 适用对象：Claude Code（仓库 opspilots0.3-lovable）
> 日期：2026-06-10。请先阅读仓库根目录 CLAUDE.md 了解项目结构与约定。

## 背景（已完成的工作，请勿重做）

- staging Supabase 项目（project ref: `sqbcyvxxpjhsfgvfmohc`）已启用 pg_cron + pg_net。
- 已创建 `public.invoke_jst_sync(fn_name text, payload jsonb)`：从 Vault 读取
  `jst_sync_cron_secret`，向 `https://<ref>.supabase.co/functions/v1/<fn>` 发送
  带 `x-cron-secret` 头的 POST。对应迁移文件已在仓库：
  `supabase/migrations/20260610064400_jst_sync_cron_schedules.sql`（已手动应用到 staging，
  请勿重复 db push 该文件之前的历史迁移到 staging——staging 库结构已是最新）。
- 4 个 cron 任务已在 staging 激活：
  - `jst_sales_orders_15min`（*/15 * * * *，payload `{"minutes":45}`）
  - `jst_outbound_orders_15min`（5-59/15 * * * *，payload `{"action":"start_outbound_job","minutes":45}`）
  - `jst_refund_orders_hourly`（20 * * * *，payload `{"minutes":180}`）
  - `jst_aftersale_received_hourly`（35 * * * *，payload `{"minutes":180}`）
- 端到端验证：出库函数经 cron 链路触发成功，jst_sync_jobs 中 status=success，
  重复触发返回同一 job（锁生效）。
- staging 的 Edge Functions 当前**只部署了 jst-sync-outbound-orders**，
  其余函数的 cron 调用目前返回 404（预期内）。
- staging Edge Function Secrets 已配置 `JST_SYNC_CRON_SECRET`（与 Vault 中同值）。

## 环境约定（重要约束）

1. **只操作 staging（sqbcyvxxpjhsfgvfmohc）。严禁向生产项目部署或执行任何迁移。**
2. 任何密钥不得写入代码、迁移文件或提交记录。
3. 同步相关改动必须保持幂等：重复执行同一窗口不得产生重复数据。
4. 不修改自动生成文件（src/integrations/supabase/client.ts、types.ts、lovable/index.ts）。
5. 部署命令参考：`supabase functions deploy <name> --project-ref sqbcyvxxpjhsfgvfmohc`。
   如 CLI 未登录，提示用户执行 `supabase login`，不要自行处理 token。

## 任务 1：部署其余 Edge Functions 到 staging

把以下函数全部部署到 staging（与仓库 supabase/functions/ 目录一致）：
jst-sync-sales-orders、jst-sync-purchase-orders、jst-sync-refund-orders、
jst-sync-aftersale-received、jst-sync-dispatch、jst-sync-products、
jst-debug-outbound-fields、ops-product-master-derive。
（supplier-* / admin-* / ask-ai / parse-bank-receipt / bootstrap-accounts 本次可不部署。）

**验收**：Supabase Dashboard → Edge Functions 列表可见上述函数；
用 SQL `select public.invoke_jst_sync('jst-sync-sales-orders','{"minutes":30}'::jsonb);`
触发后，`net._http_response` 最新记录 status_code=200，且 jst_sync_logs/jst_sync_jobs
出现对应成功记录。

## 任务 2：核对并修正出库定时入口的时间窗口参数

现象：cron 以 `{"action":"start_outbound_job","minutes":45}` 调用
jst-sync-outbound-orders 时，jst_sync_jobs.requested_range 显示 `1d` 而非 45 分钟。

要求：阅读 `supabase/functions/_shared/jst-sync-job.ts` 中 handleJobActions 的
`resolveWindowFromBody` 与 `jst-sync-outbound-orders/index.ts` 的 start 入口，
确认 start_outbound_job 接受的窗口字段名。二选一修正：
(a) 函数侧支持 minutes 参数；或 (b) 告知正确的 payload 写法，并更新 staging 中
`cron.alter_job` 的 command（同时把修正后的 payload 写进一份新的迁移文件提交）。

**验收**：cron 触发后 jst_sync_jobs.requested_range 反映约 45 分钟窗口。

## 任务 3：给 jst-sync-dispatch（商品同步）补定时入口

该函数目前无 `x-cron-secret` 支持。参照 `jst-sync-sales-orders/index.ts` 的
okCron/runLegacySync 写法（resolveCaller + JST_SYNC_CRON_SECRET 环境变量 +
x-cron-secret / x-internal-tick 头），为 dispatch 增加同样的定时入口，
窗口参数沿用 body 的 minutes/hours/days 约定。完成后部署到 staging 并新增
cron 任务（建议每天 1 次，UTC 19:00 = 北京时间凌晨 3:00，窗口 days:2），
cron 任务以新迁移文件形式提交。

**验收**：`select public.invoke_jst_sync('jst-sync-dispatch','{"hours":2}'::jsonb);`
返回 200 且产生成功的同步日志；重复触发不产生重复数据。

## 任务 4：实测采购单函数的定时入口

jst-sync-purchase-orders 含 x-cron-secret 检查但内部实现与其他函数不同（文件约 66KB）。
部署到 staging 后用 invoke_jst_sync 以 `{"minutes":60}` 触发一次，记录实际行为
（是否同步、窗口多大、写入哪些表、是否幂等）。如其 cron 路径不可用或语义不符，
修复并说明改动。

**验收**：触发返回 200，采购单相关表出现该窗口数据，重复触发行数不变。

## 完成后统一回归

1. `select jobname, schedule, active from cron.job;` —— 全部 active。
2. 等待一个整点周期后 `select j.jobname, d.status, d.return_message from
   cron.job_run_details d join cron.job j using (jobid) order by d.start_time desc
   limit 20;` —— 无 failed。
3. `net._http_response` 近期记录无 404/401。
4. 把所有代码改动 + 新迁移文件提交到 main（提交信息用英文，说明做了什么、
   在 staging 验证了什么）。

## 遗留事项（本次不做，仅记录）

- 生产上线：staging 观察 1-2 天后，在生产项目重复密钥配置 + 迁移（URL 换生产 ref）。
- 自动同步统一调度表 + Dashboard 同步健康卡片。
- 商品主档/平台映射增量同步、活跃 SKU 库存表（下一阶段）。
