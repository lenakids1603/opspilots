# 验证 + 接入 base_archive 真实同步

分两步走：先做链路验证（不改代码），再接入真实的 base_archive 同步。

---

## 第一步：验证当前数据链路（只读检查，无代码改动）

针对你列的 5 点，我会用 `psql` + 代码审计直接验证：

1. **页面无 mock**：`grep` 已确认 `JstDataIntegrationPage.tsx` 中所有渲染源都来自 `useModules / useMetrics / useErrors / useRuns` 四个 hook，无写死数组。✅
2. **同步触发会写 jst_sync_runs**：现有 `triggerRun` mutation 直接 `insert` 到 `jst_sync_runs`，右上角下拉、行内"重试"、补数据工具按钮（共 14 处 onClick）全部走它。我会在验证阶段实际触发一次并查表确认。
3. **日志实时刷新**：mutation `onSuccess` 调 `qc.invalidateQueries(["jst_sync_runs"])`，会重新拉取并显示。
4. **errors → 顶部异常 + 模块状态**：`jst_sync_errors` 驱动顶部 `abnormalModules` 横幅；`jst_sync_modules.status` 驱动各行状态徽章。两者目前是**两套独立字段**，我会在第二步把 edge function 写入 errors 时同步更新 modules.status，保证一致。
5. **供应商账号无权访问**：4 张表的 RLS 都是 `is_ops_internal(auth.uid())`，supplier 账号 `account_type='supplier'` 会被全部拒绝。我会用 supplier 账号做一次 `SELECT` 验证返回 0 行。

验证结果会在执行后用一两行文字汇报，不阻塞第二步。

---

## 第二步：接入真实 base_archive 同步

### 范围（第一批，仅基础档案）
- 店铺资料 → `shops`
- 供应商资料 → `ops_suppliers`
- 仓库资料 → **新表 `jst_warehouses`**（当前无对应业务表）

商品/SKU 已有独立 edge function (`jst-sync-products`)，本批不动；后续验证字段稳定后再合并到 base_archive 调度里。

### 架构

```text
前端按钮
   │
   ▼
supabase.functions.invoke("jst-sync-dispatch", { module_key, trigger_type, scope })
   │
   ▼
jst-sync-dispatch (新 edge function)
   ├─ 校验 ops_internal + admin
   ├─ INSERT jst_sync_runs(status=running, created_by=auth.uid)
   ├─ 按 module_key 调用对应 syncer（本批仅 base_archive）
   │     ├─ shops:      /open/shops/query
   │     ├─ suppliers:  /open/suppliers/query
   │     └─ warehouses: /open/wms/partner/query
   ├─ 成功 → UPDATE runs(status=ok, counts, finished_at, duration_ms)
   │       → UPDATE jst_sync_modules(last_sync_at, next_sync_at, status='ok', last_result_summary)
   │       → UPSERT jst_sync_metrics(base_archive_summary)
   │       → UPDATE jst_sync_errors SET status='resolved' WHERE module_key=...
   └─ 失败 → UPDATE runs(status=error, error_message)
           → UPSERT jst_sync_errors(open, retry_count++)
           → UPDATE jst_sync_modules(status='error', last_result_summary)
```

### 数据库迁移

新增 `jst_warehouses`（仓库主数据）：

```text
id, jst_wms_co_id (unique), name, type, status,
remark, raw_jst_json, last_synced_at, created_at, updated_at
```

RLS：`is_ops_internal` 读；`admin` 写；service_role 全权。

修改 `jst_sync_runs` 的 INSERT 策略：允许 `created_by IS NULL` 当调用方是 service_role（edge function 走 service role 不会走 RLS，所以现状已 ok，无需改）。

### 前端改动

- 把 `triggerRun.mutationFn` 改为：对 `base_archive`/`shop`/`supplier`/`warehouse` 走 `supabase.functions.invoke("jst-sync-dispatch", ...)`；其他模块（product/sku/inventory/sales_refund/purchase）**保留旧的 mock-insert 行为并加 toast 提示"暂未接入"**，直到逐一上线。
- 不在前端直接调用聚水潭，符合要求 #1。
- mutation 完成后 `invalidateQueries(["jst_sync_runs","jst_sync_modules","jst_sync_metrics","jst_sync_errors"])` 一次性刷新所有看板。

### 边界与不做的事

- ❌ 不接 sales_refund、inventory、purchase、商品/SKU
- ❌ 不实现自动定时调度（cron）。本步只做"手动按钮 → 真实接口"链路。后续接 `pg_cron` 再说。
- ❌ 不引入 webhook 回调
- ✅ Edge function 使用现有 JST secrets（`JST_APP_KEY` / `JST_APP_SECRET` / `JST_ACCESS_TOKEN`），与 `jst-sync-products` 共用 token 刷新逻辑

### 交付物

1. 数据库迁移：`jst_warehouses` 表 + RLS + GRANT
2. 新 edge function：`supabase/functions/jst-sync-dispatch/index.ts`
3. 修改 `JstDataIntegrationPage.tsx`：`triggerRun` 改走 invoke
4. 验证 checklist 的简短汇报

确认后我会：先执行第一步验证（产出一段汇报），然后申请数据库迁移并写代码。
