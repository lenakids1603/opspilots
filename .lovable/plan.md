
## 背景

数据库当前已有 `purchase_receipts` 和 `purchase_receipt_items` 两张表，结构基本能覆盖入库单需求（io_date / external_io_id / external_po_id / supplier_name / warehouse_name / status / jst_modified_at / raw 等）。但目前：

- 没有独立的「入库单」页面，只能在 JST 同步页/采购单管理页里看到聚合数据
- 最新 io_date 仅到 2026/5/27，5/31 以后的入库单没拉进来
- 同步日志只显示成功数量，不显示 API 返回 vs 数据库实际写入数量，问题定位困难

为避免数据迁移成本，**复用现有 `purchase_receipts` / `purchase_receipt_items` 表**，不新建 `jst_purchase_inbound_orders`。如果你坚持表名独立，告诉我后我再换。

## 一、菜单与路由

`src/components/ops/OpsSidebar.tsx`：「仓库系统」组下新增「入库单」放在「到货登记」之前。

`src/App.tsx` 新增路由 `/warehouse/inbound-orders` → `InboundOrdersPage`。

## 二、新增页面 `src/pages/ops/InboundOrdersPage.tsx`

**顶部统计卡片（按北京时间）**
- 今日入库单数 / 今日入库件数 / 今日入库金额
- 本月入库件数 / 本月入库金额
- 待核对入库单（暂以 `purchase_order_id IS NULL` 计）
- 异常入库单（明细行数为 0 或主表数量与明细汇总不一致）
- 查询失败显示「读取失败」而非 0

**筛选区**
- 入库日期范围（默认最近 7 天，北京时间 → UTC 用 `beijingRangeToUTC`）
- 供应商（下拉，来源 ops_suppliers）
- 仓库名（文本，来源 purchase_receipts.warehouse_name distinct）
- 入库单号 / 采购单号 / 款号/SKU
- 入库状态、是否有关联采购单、是否有明细、是否异常
- 按钮：查询 / 重置 / 同步最近 1/7/30 天 / 导出 CSV

**主表（分页 20 条/页）**
列：入库日期、入库单号、聚水潭入库 ID、采购单号、供应商、仓库、入库类型、状态、入库件数、入库金额、明细行数、创建时间、JST 修改时间、同步时间（updated_at）、异常标记、操作（查看详情 / 原始 JSON / 重新同步该单 / 关联采购单）

**右侧抽屉详情**（统一用 `Sheet` 组件，不用 Dialog）
- A 基础信息
- B 入库明细表格（款号/SKU/颜色/尺码/数量/单价/金额/采购单号/采购明细 ID）
- C 与采购单对比（如有 `purchase_order_id`，查询 purchase_order_items 汇总采购/已入库/本次/未入库/进度/超收/少收）
- D 原始 JSON（pretty）

## 三、同步诊断面板

页面右上角「诊断」按钮 → 弹抽屉，查询展示：
- 最近一次 `purchase_inbound_orders` 同步：开始/结束/耗时/API 返回数/主表 upsert 数/明细 upsert 数/失败数/错误
- 数据库最新入库单 io_date / jst_modified_at
- 最近 7 天主表 / 明细记录数
- 主表有但明细为空的入库单数
- 明细中 purchase_order_id IS NULL 的明细数（未关联采购单）

## 四、Edge Function 修复 `supabase/functions/jst-sync-purchase-orders/index.ts`

针对入库单同步 (`scope='purchase_inbound_orders'`)：

1. **打印关键日志到 `jst_sync_logs.message / error_detail`**：请求开始/结束时间（UTC + 北京）、传给 JST 的字段名、API 返回总数、主表 upsert 成功/失败、明细 upsert 成功/失败、第一条与最后一条 io_date 和 modified
2. **统计改为数据库实际 upsert 数量**，不再用 API 返回数量充数
3. **API 返回 > 0 但写入 0** 时，写入 `status='partial'` 并将错误堆栈写入 `error_detail`
4. **增量游标统一用 `jst_modified_at`**，业务展示用 `io_date`
5. **北京时间窗口转 UTC** 修正：days=1 表示北京今日 00:00 起，转 UTC 减 8h；不要让北京 6/2 的单因为窗口算错被排除
6. **类型字段统一为 `purchase_inbound_orders`**，删除旧的 `purchase_receipts` / `purchase_in` 写入路径（读路径仍 fallback 兼容历史日志）

## 五、同步日志详情抽屉增强

`JstDataIntegrationPage.tsx` 已有同步日志详情，扩展为展示：
批次 ID / sync_type / 触发人 / 起止时间 / 耗时 / 请求范围 / 请求参数 / JST 返回数 / 主表新增更新 / 明细新增更新 / 失败 / 错误堆栈 / 前 3 条 raw JSON 预览。
数据来源：`jst_sync_logs.message`（JSON 字符串）+ `error_detail`。

## 六、不做的事

- 不新建 `jst_purchase_inbound_orders` / `_items` 表，复用 `purchase_receipts` / `_items`
- 不改采购单同步逻辑、不动权限模型（沿用现有 `is_ops_internal` RLS）
- 不实现「关联采购单」的写入功能（只放占位按钮 + toast），因为这涉及业务规则待定
- 不实现金额计算（当前明细表已有 `cost_price / cost_amount`，直接展示，缺失显示 -）

## 验收

- 侧栏「仓库系统 / 入库单」可点击
- 点「同步最近 1 天」→ 触发已有 `jst-sync-dispatch` (scope=purchase_inbound_orders, days=1)
- 同步完成后列表立即刷新出今日聚水潭入库单
- 同步日志详情能看到 JST 返回数 vs 数据库写入数
- 若 JST 返回 0 / 写入 0 / 筛选条件遮挡，诊断面板能分别说明

## 技术细节

- 路由：`/warehouse/inbound-orders`
- 表：复用 `purchase_receipts` (主) + `purchase_receipt_items` (明细)
- 日期：统一用 `src/lib/datetime.ts` 的 `formatDateCN / formatDateTimeCN / beijingRangeToUTC`
- 抽屉：`@/components/ui/sheet`
- 触发同步：复用现有 `jst-sync-dispatch` edge function，`module_key=purchase`、`scope=['purchase_inbound_orders']`、`extra.days`
- 文件改动估计：新建 1 个页面文件 (~600 行)、改 OpsSidebar、App.tsx、JstDataIntegrationPage 日志详情、jst-sync-purchase-orders edge function 入库部分
