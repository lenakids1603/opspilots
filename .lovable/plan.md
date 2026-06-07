
# 前端影响评估报告 — 订单/商品轻量化改造适配

只做评估，不修改 DB / Edge Function / 不恢复旧 raw 逻辑。所有改动方案在 migration + Edge Function 部署后才会实际生效，前端需要处理「新表暂不存在 / 暂时为空」的过渡态。

---

## 一、各页面现状与建议

### 1. Dashboard 首页 `src/pages/Dashboard.tsx`
- **当前数据源**：与销售无关，仅读取 `expenses` / `expense_categories`（个人报销）。
- **结论**：本次不动；老板版销售 Dashboard 后续应新建（读取 `sales_hourly_summary` / `sales_daily_summary` / `shipping_risk_orders` / `sales_sku_daily_summary` / `sales_style_daily_summary`），但属于新页面，本轮不实现。
- **Fallback**：无。

### 2. 运营 Overview 页 `src/pages/ops/OverviewPage.tsx`
- 现状：占位 / 简单卡片。
- 建议：作为「老板 Dashboard」承载页，连入新汇总表（`sales_*_summary`、`shipping_risk_orders`）。本轮只做空表/未部署 fallback 文案，不实装数据。

### 3. 销售订单列表 `src/pages/ops/SalesOrdersListPage.tsx`
- **当前数据源**：大量 `jst_sales_orders` + `jst_sales_order_items` + `jst_refund_orders` + `jst_aftersale_received_orders`，多处 count/group/聚合。还有 raw_data 抽屉（line 738–760）。
- **风险**：新同步停止写完整明细后，明细查询会越来越稀疏，聚合数字会逐步失真。
- **建议**：
  - 页面重新定位为「轻量订单查询 + 历史回看」。统计/排行卡片改读 `sales_daily_summary` / `sales_sku_daily_summary`。
  - 表格主源切换为 `order_lookup_index` + `sales_order_light_items`，旧 `jst_sales_order_*` 作为「历史订单」fallback（只在用户切换到「历史」Tab 或新表查不到时使用）。
  - raw 抽屉保留只读 fallback，提示「新同步默认不保存 raw_data，如需排查请走短期 debug payload」。文案 line 738 已基本到位，无需扩展逻辑。
  - 顶部加全局提示条：「完整订单明细以聚水潭为准，本系统仅保留汇总 + 轻量索引 + 未发货风险」。

### 4. 订单详情（销售订单抽屉/详情）
- 当前在 SalesOrdersListPage 的抽屉中。
- **建议**：先查 `sales_order_light_items`（按 o_id / so_id），查不到再 fallback `jst_sales_order_items`；raw 区块仅做折叠展示，空时显示说明文案，不报错。

### 5. 未发货 / 超时预警页
- 当前无独立页面（`DeliveryDashboardPage` 主要读 `purchase_order_items`，是采购到货预警，不是发货预警）。
- **建议（本轮新增 1 个页面）**：基于 `shipping_risk_orders` 新建「未发货风险」页，字段：店铺/订单号/SKU/款号/颜色/尺码/数量/付款时间/最晚发货时间/剩余小时/是否超时/风险等级/供应商/最后检查时间；筛选：店铺/款号/SKU/供应商/风险等级/是否超时/最晚发货时间区间。在 migration 未部署前显示空表 + 部署提示。

### 6. 销售退款 / 出库 / 销退页
- `SalesReturnOrdersPage` → 读 `jst_aftersale_received_orders/_items`；
- `OutboundOrdersPage` + `OutboundSyncCards` + `OutboundByStyleTab` → 读 `jst_outbound_orders/_items`，含 raw_data 展示（line 555/570）；
- `SalesReturnByStyleTab` → 读 `jst_aftersale_received_*`。
- **现状下的影响**：这些表的 raw_data 字段新同步开始写 null，老数据仍可显示；表本身仍在写入，只是没有完整 JSON。
- **建议**：
  - 保留页面与查询逻辑（继续作为日常作业页）。
  - **隐藏所有 raw JSON `<pre>` 抽屉**，改为说明文案「新同步默认不保存 raw JSON」+ 折叠老数据 fallback。
  - 顶部小提示：本页字段以聚水潭为准。
  - 不要把这些表当成销售汇总数据源（如有「合计金额」类卡片应迁到 `sales_*_summary`）。

### 7. 聚水潭同步页 `JstSyncPage.tsx` / `JstDataIntegrationPage.tsx` / `JstProductSyncPage.tsx`
- 当前 `JstProductSyncPage` 已有「同步最近 N 天」(限制 1–7) 与按款号 / SKU 同步按钮（已较为符合新方向），但还有「同步商品图片」按钮和 sync_all 入口的潜在风险。
- `JstDataIntegrationPage` 是模块矩阵，可能渲染包含 `sales_refund` (RAW) / 全量商品同步的入口（line 76 读取 `jst_sync_modules`）。
- **建议按钮策略**：
  - **隐藏 / 禁用**：「同步全部历史订单」「同步全部商品 / 全量 64 万 SKU」「sales_refund 旧 RAW 同步」以及任何 `action: sync_all`、`module_key: sales_refund` 的入口。如来自 DB 配置 `jst_sync_modules`，前端按 `module_key` / `action` 白名单过滤或显示「已停用：新架构不再保存完整 raw」灰按钮 + tooltip。
  - **推荐按钮（保留 / 改名）**：
    - 同步最近 10 分钟订单
    - 同步最近 1 小时订单
    - 同步未发货风险订单
    - 同步今日销售汇总
    - 同步最近 1 天商品变更
    - 按 SKU / 款号范围同步商品
  - 每个按钮副标题：「新同步默认不保存完整 raw JSON，仅写销售汇总、未发货风险和轻量索引」。

### 8. 商品资料页 `ProductsPage.tsx`
- 当前：读 `ops_skus` 作为主源（已是正确方向）。
- 风险：JstSyncPage 顶部用 `ops_products` / `ops_skus` 做 count 展示「同步进度」，会给人「应同步全部」的暗示。
- **建议**：
  - 顶部文案改为「仅展示活跃 / 指定范围 SKU；本系统不保存聚水潭全部商品档案」。
  - 空结果文案：「当前系统只同步活跃或指定范围商品。」
  - 不引入 64 万级列表逻辑；保持现有分页。

### 9. 商品详情页 `ProductDetailPage.tsx`
- 当前各 Tab 读 `jst_sales_order_items` / `jst_outbound_order_items` / `jst_refund_order_items` / `jst_aftersale_received_items`。
- **建议**：
  - 销售 Tab 优先读 `sales_order_light_items`（按 sku_code / jst_sku_id），数据不足再 fallback 旧 `jst_sales_order_items`。
  - 销量统计卡片改用 `sales_sku_daily_summary`（按 sku 聚合最近 7/30 天）。
  - 出库 / 退款 / 售后 Tab 继续读对应表（页面级日常作业用途），但移除 raw JSON 展示。
  - 没有数据时显示「暂无数据 / 新同步默认不保存 raw」。

### 10. 同步日志页（位于 `JstDataIntegrationPage.tsx` 与 `JstProductSyncPage.tsx`）
- 当前已展示 `jst_sync_logs` 摘要字段。
- **建议补充列**：写入汇总数量、写入风险订单数量、删除风险订单数量（如新增列存在则展示，否则隐藏列）。
- **隐藏**：任何完整 request/response body 直出；如 `error_detail` 过长，做折叠 + 复制按钮。

---

## 二、需要隐藏 / 禁用 / 改名的按钮（汇总）

| 位置 | 按钮 | 处理 |
|---|---|---|
| JstProductSyncPage | 「同步商品图片 (每次 50 张)」 | 保留但加 tooltip「不批量下载 64 万图」；或本轮先隐藏 |
| JstSyncPage / JstDataIntegrationPage 任何 `sync_all` 入口 | 全量同步 | 隐藏或灰显 + 「已停用」提示 |
| 任何 `module_key=sales_refund` RAW 同步 | 旧 RAW 同步 | 隐藏 / 灰显 + 提示 |
| SalesOrdersListPage / OutboundOrdersPage / SalesReturnOrdersPage 的「查看 raw_data」 | raw 抽屉 | 改为只读 fallback + 文案 |
| 商品资料/详情页可能存在的「同步全部商品」 | （已被 Codex 移除）二次核对 | 保持隐藏 |

---

## 三、可能因新同步导致显示为空 / 失真的地方

- SalesOrdersListPage 的合计、按状态分布、近 N 天订单数（基于完整明细聚合）→ 数据停滞或偏低。
- ProductDetailPage 「销售订单」「退款」Tab 行数会逐步减少。
- 任何依赖 `raw_data` / `raw_item_data` / `raw_jst_json` 渲染的字段（OutboundOrdersPage line 555/570、SuppliersPage line 463-470、SalesOrdersListPage raw 抽屉）→ 新数据会是 null。
- JstSyncPage 顶部商品 count 卡片：在「不同步全部」语境下会显得「同步进度永远不满」，需要改文案。

---

## 四、Fallback 策略

- **应 fallback 旧表**：订单详情、商品详情销售 Tab、SalesOrdersListPage 历史查询（仅作为兜底）。
- **不应 fallback 旧表**：销售汇总卡片、SKU/款号排行、Dashboard、未发货风险列表 — 必须走新表，否则就是空。
- **raw JSON 区块**：永远只 fallback 显示旧数据，绝不再写入；新数据空时给说明，不报错。

---

## 五、与 migration / Edge Function 部署的依赖

| 改动 | 是否依赖部署 |
|---|---|
| 隐藏 / 禁用旧 raw 同步按钮、隐藏 raw 抽屉、文案提示 | 否，立即可做 |
| SalesOrdersListPage 顶部全局提示、JstSyncPage 文案修正 | 否 |
| ProductDetailPage 移除 raw、添加「暂无数据」提示 | 否 |
| 销售排行/汇总卡片改读 `sales_*_summary` | 需 migration 应用 + Edge Function 部署，并有一次同步入数据 |
| 新增未发货风险页（读 `shipping_risk_orders`） | 同上；可先建页面框架，表不存在时显示「等待部署 / 暂无数据」 |
| 订单详情优先读 `sales_order_light_items` | 同上，可先写 fallback 逻辑（新表空 → 旧表） |

---

## 六、建议改造顺序

1. **第 1 批（不依赖部署，立即可做）**
   - 全局移除/折叠 raw JSON 区块，统一替换为说明文案。
   - JstProductSyncPage / JstSyncPage / JstDataIntegrationPage 按钮白名单整理，禁用全量 / sales_refund RAW。
   - SalesOrdersListPage、ProductsPage、JstSyncPage 顶部提示条文案。
2. **第 2 批（依赖 migration 应用）**
   - 新增「未发货风险」页（`shipping_risk_orders`）。
   - SalesOrdersListPage 主源切到 `order_lookup_index` + `sales_order_light_items`，旧表降级为 fallback Tab。
   - ProductDetailPage 销售 Tab 优先 `sales_order_light_items`。
3. **第 3 批（依赖 Edge Function 部署 + 首次回填）**
   - 老板 Dashboard / 销售分析页接 `sales_*_summary`。
   - 同步日志页新增写入汇总数量等列。

---

## 七、本轮我可以直接做 vs 需等待

- **可立即做（仅前端，安全）**：第 1 批全部。
- **可现在写但要做「表不存在 / 空」兜底**：第 2 批页面骨架、查询代码（新表查询失败时静默降级为 fallback 或空状态提示）。
- **必须等 migration + Edge Function 部署后才接通**：销售汇总、SKU/款号排行、未发货风险列表的真实数据。

---

请确认这份评估方向是否正确。确认后我会按「第 1 批 → 第 2 批骨架 → 等部署后第 3 批」分步执行，绝不恢复旧 raw 逻辑、不动 migration 和 Edge Function。
