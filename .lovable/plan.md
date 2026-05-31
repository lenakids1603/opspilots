## 目标

把当前项目从 Lovable Cloud 自带的 Supabase 项目，迁移到你自己新建的 Supabase 项目，确保新项目里数据库结构、RLS、Auth、Storage、Edge Function 都对齐。

> 重要前置说明：当前项目使用的是 Lovable Cloud（内置 Supabase），如果你切换到自建 Supabase 项目，需要在 Lovable 端 **Connectors → 断开 Lovable Cloud → 接入外部 Supabase**。`src/integrations/supabase/client.ts` 和 `.env` 由 Lovable 自动管理，你不要手动改，连接外部 Supabase 后 Lovable 会重写它们。

---

## 一、需要复制到新 Supabase 的内容总览

### 1. 数据库结构（15 个迁移，1204 行 SQL）

按时间顺序逐个执行 `supabase/migrations/` 下的所有 `.sql` 文件，**严格按文件名时间戳顺序**：

```
20260313005537_  报销系统初始（profiles, user_roles, expenses, expense_categories,
                 expense_receipts, approval_actions, audit_logs + 全部 RLS + 触发器
                 + handle_new_user + has_role + is_manager_of + receipts bucket）
20260313005553_  receipts storage 策略
20260313021505_  expense_categories 种子数据（这步走 INSERT，新库需要重跑）
20260325004758_  profiles 扩展 username/phone
20260528115813_  ops 系统：ops_role_code 枚举、ops_user_roles、ops_roles、
                 ops_suppliers、ops_products、ops_skus、ops_arrivals、
                 ops_supplier_bills 及 RLS + has_ops_role/is_ops_internal/supplier_id_of
20260528125436_  供应商账号：user_type, account_type, supplier_id 等 + 相关 RLS
20260528130049_  profiles 字段保护触发器 prevent_profile_privilege_change
20260529045629_  聚水潭采购单：purchase_orders / purchase_order_items /
                 purchase_receipts / purchase_receipt_items / jst_tokens /
                 jst_sync_logs / jst_sync_state + recalc_purchase_order_aggregates
20260529045647_  小补丁
20260529053158_  小补丁
20260529084631_  jst_sync 字段补充
20260529084829_  小补丁
20260529130851_  商品资料/SKU 同步扩展：ops_products / ops_skus 加字段，
                 新建 ops_sku_aliases，product-images bucket + storage 策略，
                 视图 v_purchase_order_items_with_image
20260529131403_  安全补丁 1（RLS / search_path）
20260529131435_  安全补丁 2
```

执行方式（任选一种）：

- **推荐**：在新 Supabase 项目里用 Supabase CLI `supabase db push` 直接推送 `supabase/migrations/`，顺序、幂等都帮你处理好。
- **如果你坚持用 SQL Editor**：让我在 build 模式下生成一个合并后的 `bootstrap.sql`（约 1200 行），你一次性粘进 SQL Editor 执行即可。

### 2. RLS 策略
全部已包含在上述 migrations 里，无需额外处理。覆盖的核心规则：
- `profiles` / `user_roles` / 报销系列：本人 + 经理 + finance 分层
- `ops_*` 系列：内部员工 (`is_ops_internal`) 全权 + 供应商账号 (`supplier_id_of`) 只读自己
- `purchase_orders` / `purchase_*_items` / `purchase_receipts`：内部全权 + 供应商只读自家
- `ops_sku_aliases`：仅内部
- `jst_sync_logs` / `jst_sync_state` / `jst_tokens`：仅内部可读，写入走 service_role
- Storage：`receipts`（私有，按 user_id 文件夹）+ `product-images`（公开读，内部写）

### 3. Auth 配置（在新 Supabase Dashboard → Authentication 里操作）
- Providers → **Email**：开启；建议开启 **Confirm email**（生产环境）
- Providers → **Google**：开启，填入 Google OAuth Client ID / Secret，并把新项目回调 URL 加到 Google Console
- URL Configuration → **Site URL** / **Redirect URLs**：加入
  - `http://localhost:5173`
  - `https://opspilots.lovable.app`
  - `https://erp.lenakids.xyz`
  - `https://id-preview--c1f600eb-6199-4436-b61a-bd921c25bbc8.lovable.app`
- Auth → Policies → **Leaked Password Protection (HIBP)**：建议开启
- ⚠️ **不要**开启 Anonymous sign-ins

### 4. Edge Functions（4 个，需要部署到新项目）
路径：`supabase/functions/`
- `admin-supplier-accounts`
- `ask-ai`
- `jst-sync-products`
- `jst-sync-purchase-orders`
- `supplier-purchase-orders`
- `supplier-purchase-order-detail`

部署：`supabase functions deploy <name> --project-ref <新ref>`。`supabase/config.toml` 里的 `project_id` 也要改成你新项目的 ref。

### 5. Secrets（Edge Function 环境变量，在新 Supabase Project Settings → Edge Functions → Secrets 配置）

**Supabase 自动注入，不用手填**：
`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_DB_URL` / `SUPABASE_PUBLISHABLE_KEY`

**需要你手动新建**：
- 聚水潭：`JST_API_BASE`, `JST_APP_KEY`, `JST_APP_SECRET`, `JST_ACCESS_TOKEN`, `JST_REFRESH_TOKEN`, `JST_PARTNER_ID`, `JST_PARTNER_KEY`, `JST_AUTH_MODE`, `JST_TOKEN`
- 代理（如有）：`JST_PROXY_URL`, `JST_PROXY_USER`, `JST_PROXY_PASS`
- 定时任务：`JST_SYNC_CRON_SECRET`, `JST_SYNC_START_DATE`
- AI：`LOVABLE_API_KEY`（如要继续用 Lovable AI Gateway；自建 Supabase 后这个 Key 仍然有效，需新生成）

### 6. 前端环境变量
`.env` 由 Lovable 在重连 Supabase 后自动写入，你不需要手填。涉及：
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

### 7. Storage Bucket
迁移里会自动创建：
- `receipts`（私有）
- `product-images`（公开）

### 8. 历史数据
迁移只创建结构，不搬数据。如果你要把现有 Supabase 的业务数据（聚水潭采购单、商品、供应商、用户等）一并迁过去，需要单独跑一次 `pg_dump --data-only` + `psql` 导入，**这一步不在本计划范围内**，需要时再单独处理。

---

## 二、执行顺序

1. 在新 Supabase 项目里：Settings 拿到 `Project ref` / `URL` / `anon key` / `service_role key`
2. 配置 Auth（Email + Google + Site URL + Redirect URLs）
3. 跑 SQL（CLI `db push` 或粘合并后的 `bootstrap.sql`）
4. Project Settings → Edge Functions → Secrets 配置上面列出的所有 JST_* 和 LOVABLE_API_KEY
5. `supabase functions deploy` 部署 6 个 edge functions（或用 Lovable 自动部署）
6. 回 Lovable：Connectors → 断开 Lovable Cloud → 接入 Supabase（粘 URL + anon key）
7. 在登录页注册第一个用户 → 在 SQL Editor 手动给它加 `ops_user_roles` (role_code='admin') 和把 `profiles.account_type` 改为 `internal`
8. 测试：登录 → 数据中心 → 聚水潭同步 → 跑一次最小连通性测试

---

## 三、确认问题

请确认两件事，我就进入 build 模式开干：

1. **你希望我怎么交付 SQL？**
   - A. 生成一个合并后的 `bootstrap.sql`（推荐，方便你粘到 SQL Editor 一次执行）
   - B. 保持现有 15 个 migration 文件不动，你自己用 Supabase CLI `db push`

2. **是否需要我同时生成「首个 admin 账号开通」的 SQL 模板**（包含 `ops_user_roles` 和 `profiles.account_type` 升级语句）？
