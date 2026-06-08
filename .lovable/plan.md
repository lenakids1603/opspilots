# 发货超时预警页改造计划

仅前端，不动数据库 / migration / Edge Function / 同步逻辑。在现有 `src/pages/ops/ShippingRiskPage.tsx` 基础上扩展。

## 数据源（只读，已存在）

- `shipping_risk_orders`：风险订单主数据（含 `risk_level`、`remaining_hours`、`is_timeout`、`order_created_at`、`pay_time`、`latest_ship_time`、`sku_code`、`style_no`、`qty`、`shop_name`、`supplier_name` 等）
- `purchase_order_items`：用 `sku_no` / `style_no` 匹配，取 `purchase_order_id`、`purchase_qty`、`received_qty`、`unreceived_qty`、`delivery_date`
- `purchase_orders`：取 `supplier_name`、`status`、`status_label`、`expected_delivery_date`、`external_po_id`、`total_unreceived_qty`
- `ops_skus` / `ops_products`：默认供应商 fallback（通过 `supplier_id` → `ops_suppliers.name`）

匹配策略（前端一次性按当前页 SKU 批量查询）：

1. 用本页订单的 `sku_code` 集合查 `purchase_order_items` 中 `received_qty < purchase_qty` 的行 → join `purchase_orders` 取供应商和到货日期
2. 若 SKU 无未完成采购单，再用 `style_no` 同样匹配
3. 若仍无匹配，查 `ops_skus.supplier_id` → `ops_suppliers.name` 作为商品档案默认供应商
4. 全部失败则显示 `待匹配`

采购状态推导（前端纯展示，不写库）：

- 多张未完成采购单存在且 `received_qty=0` → `已下采购单，待入库`
- 任一采购单 `received_qty>0` 且仍有 `unreceived_qty>0` → `部分入库`
- 全部采购单已完成（`unreceived_qty=0`）但订单仍未发货 → `采购单已完成但订单仍未发货`
- 无任何匹配采购单 → `未找到采购单`
- 协议到货日期 `delivery_date` 已早于今天且 `unreceived_qty>0` → 额外标记 `协议到货日期已超`（用 Badge 叠加）

## 页面结构

### 顶部统计卡（6 张，复用 Card）

通过 6 个轻量并行 `count` 查询（带相同筛选条件）实现：

1. 已超时未发货订单数：`is_timeout=true` 的 distinct `o_id`
2. 24h 内即将超时：`is_timeout=false AND remaining_hours <= 24`
3. 48h 内即将超时：`is_timeout=false AND remaining_hours > 24 AND remaining_hours <= 48`
4. 涉及店铺数：distinct `shop_id`
5. 涉及供应商数：distinct `supplier_name`（含采购单匹配补全后的，但 v1 先用 `shipping_risk_orders.supplier_name` distinct 计数，避免大查询）
6. 涉及 SKU 数：distinct `sku_code`

distinct 计数通过 RPC 不可用时回退为对当前结果集近似（标注"基于当前结果"）。v1 直接用 `shipping_risk_orders` 上的 `select sku_code, shop_id, supplier_name`（不含分页）做客户端 distinct，限制 limit 5000；超出则展示 `5000+`。

### 主表格列

风险等级 | 剩余发货时间 | 店铺 | 订单号 | 下单时间 | 付款时间 | 商品名/SKU/款号 | 数量 | 供应商 | 采购状态 | 协议到货日期 | 操作

- 默认按 `remaining_hours asc nulls last`
- 行底色：`is_timeout` 红 `bg-rose-50`；`remaining_hours <= 24` 橙；`<= 48` 黄；其余无底色
- 供应商列：单个供应商直接显示；多个则显示首个 + `+N`，hover tooltip 列全
- 采购状态列：Badge + 可选"协议日期已超"小红标

### 筛选区

店铺 / 供应商（文本 ilike） / SKU / 款号 / 风险等级（含 timeout/24h/48h 选项） / 下单时间区间（用 `order_created_at`） / 采购状态（前端过滤） / 是否找到采购单（是 / 否 / 全部，前端过滤）

下单时间筛选替代原"最晚发货时间"筛选项，原筛选移除（用户没要求）。

### 详情抽屉（Sheet）

点击行打开，展示：

- 订单信息：订单号、店铺、平台、订单状态、下单时间、付款时间、最晚发货时间、剩余、收货省份
- 商品明细：当前订单所有风险行（同 `o_id` 再查 `shipping_risk_orders`）
- 采购单信息：列出所有匹配的 `purchase_orders`（外部 PO 号、供应商、状态、到货日期、采购数/已收/未收）
- 供应商信息：来源标签（采购单 / 商品档案默认 / 待匹配）

## 文件改动

- 重写 `src/pages/ops/ShippingRiskPage.tsx`（在现有结构上扩展，保留 PageHeader、只读提示、`tableUnavailable` 兜底）
- 新增 `src/components/ops/ShippingRiskStatsCards.tsx`（6 张统计卡）
- 新增 `src/components/ops/ShippingRiskDetailDrawer.tsx`（详情抽屉 + 采购单查询）
- 新增 `src/lib/purchaseMatch.ts`（按 SKU/款号集合批量匹配采购单 + 推导采购状态的纯函数）

## 空 / 错误态

- 表不可用：保留现有"风险订单表暂不可用"
- 统计卡查询失败：显示 `-` 并 hover 提示错误
- 采购单匹配失败：行内"采购状态"显示 `未找到采购单`，供应商 fallback 到商品档案，再 fallback `待匹配`
- 抽屉中采购单为空：显示"未匹配到采购单，建议在采购模块补录"

## 不做

不改 DB / migration / RLS / Edge Function；不触发任何同步 / 回填；不写入任何表；不删旧表；不清 raw。
