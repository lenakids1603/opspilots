## 目标

把所有展示订单时间的页面统一到新口径：

- 业务下单时间：`order_created_at → pay_time → created_at`（已有 helper `orderBusinessTime`，复用并复制到其它页面）
- 付款时间：`pay_time`
- 系统入库时间：`created_at`，只在调试 / 详情技术区显示，文案改为"系统入库时间"
- 聚水潭修改时间：`modified / modified_time`，文案改为"聚水潭修改时间"

本轮只做前端展示和文案，不动 migration / Edge Function / 同步 / 回填。

---

## 一、SalesOrdersListPage.tsx

已基本到位，仅做收尾：

1. 详情抽屉（约 line 661）：
   - "修改时间" → "聚水潭修改时间"
   - 在概览区新增一行"系统入库时间：`created_at`"（小字、灰色，仅技术信息）
2. 筛选区时间字段下拉（约 line 481–484）：
   - `created_time` 选项标签 "创建时间" → "聚水潭创建时间"
   - `modified_time` 选项标签 "修改时间" → "聚水潭修改时间"
   - 顺序保持 下单时间 / 支付时间 / 聚水潭创建时间 / 聚水潭修改时间
3. 列表表头第 5 列 "下单时间" 已正确显示 `orderBusinessTime(r)`，无需改动。
4. Stats 区文案（约 line 453）保留，但补一句："以下今日汇总以 `order_created_at`/`pay_time` 为口径，旧明细仅做对照。"

不改 fallback 逻辑、不改主源（仍 `jst_sales_orders`，因为列表需要 `internal_order_type` 等列，`order_lookup_index` 切换由后续批次专题处理）。

---

## 二、ShippingRiskPage.tsx

1. `RiskRow` 类型补 `order_created_at: string | null` 和 `created_at: string | null`。
2. `select(...)` 字段补 `order_created_at, created_at`。
3. 表头在"付款时间"列前新增"下单时间"列，单元格用 `formatDateTimeCN(r.order_created_at ?? r.pay_time ?? r.created_at)`。
4. "付款时间" 列保留，显示 `pay_time`。
5. "最晚发货" / "最后检查" 标签保持原样（这两个本来就不是下单时间）。
6. 顶部说明 banner 末尾补一句："时间显示：下单时间 = `order_created_at`，付款时间 = `pay_time`，最晚发货 = `latest_ship_time`，不再用系统入库时间冒充下单时间。"

---

## 三、SalesBoardPage.tsx

1. 顶部蓝色提示 banner（line 127）追加一句：
   > "06-03 / 06-04 高峰历史数据仍在分批回填中，7 天 / 历史趋势以当前已回填范围为准。"
2. 标题/文案沿用"下单"口径（已对齐），无需替换。
3. 不新增任何回填按钮。
4. 顶部 KPI 副标题"下单金额"/"下单订单"等已正确，保持。

---

## 四、ProductDetailPage.tsx 销售 Tab

1. 轻量分支 `sales_order_light_items` 的 `select` 补 `order_created_at, pay_time`。
2. 旧表 fallback `jst_sales_order_items` 的 `select` 补 `pay_time`（如该表有）。如无字段则只用 `synced_at` 并把列标题改为"同步入库时间（历史）"。
3. 销售表格列定义（line 268）：
   - 最后一列 "时间" → "下单时间"
   - 单元格改为：`fmt(s.order_created_at ?? s.pay_time ?? s.synced_at)`
4. 表格上方说明："时间列为下单时间（`order_created_at`），历史 fallback 行可能仅有同步入库时间。"
5. 不动 `salesSummary` 7/30 天卡片（已使用 `sales_sku_daily_summary`）。

其他 Tab（出库 / 退款 / 售后 / 采购 / 入库 / 异常）保持原样，因为它们的"时间"语义本身不是销售下单时间。

---

## 五、其它检查项

- 全局搜索 `创建时间` 字样，仅替换"客户下单 / 销售订单"上下文的，不动采购单、入库单、银行流水等非销售订单语义的"创建时间"。
- `RemainingShipTime` 组件仅显示发货 / 超时倒计时，无需改动。
- 不引入新表查询、不增加 RPC 调用、不触发同步 / 回填。

---

## 六、技术细节

- 复用 `orderBusinessTime` helper，并在 `ShippingRiskPage` / `ProductDetailPage` 内联同样三段 coalesce，不抽公共文件以减少跨页面影响。
- `formatDateTimeCN` 已是统一时间格式化入口，无需改造。
- 不改 `src/integrations/supabase/types.ts`（由 Supabase 同步生成）。
- 完成后执行视觉自检：SalesOrdersListPage 列表 / 详情抽屉，ShippingRiskPage 表格，SalesBoardPage 顶部 banner，ProductDetailPage 销售 Tab。

---

## 七、不做事项

不修改 migration / Edge Function；不触发任何同步或 backfill；不新增 1d/7d/30d 回填按钮；不清理 raw；不删旧表；不恢复 raw JSON 业务展示；不把 `created_at` 当下单时间；不把旧明细表作 Dashboard 主源。

---

## 八、交付物

- 修改文件清单：`SalesOrdersListPage.tsx` / `ShippingRiskPage.tsx` / `SalesBoardPage.tsx` / `ProductDetailPage.tsx`
- 每页"下单时间 / 付款时间 / 系统入库时间 / 聚水潭修改时间"四类文案对齐
- ShippingRiskPage 新增"下单时间"列并读取 `order_created_at`
- SalesBoardPage banner 增补历史回填提示
- ProductDetailPage 销售 Tab 时间列改为"下单时间"并支持 light/legacy 双源
- 自检并报告 build 结果