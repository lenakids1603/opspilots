-- =============================================================================
-- 商品资料同步 · 生产 schema 对齐（幂等，可重复执行）
--
-- 背景：ops_product_mapping_exceptions 已绕过迁移历史进入生产（20260604155311
--   在 git 建表，但生产 supabase_migrations 未登记该版本，对象系手工 SQL 落库）；
--   主档三列（20260612153000）则尚未上生产。本迁移把「异常表 + 主档新列」收敛为
--   一份**全 IF NOT EXISTS** 的迁移，无论对象是否已存在都安全，用于生产对齐 + 补登记。
--
-- 列定义与 staging 完全一致：
--   ops_products.lead_time_days  integer            可空（交期，纯人工维护，同步永不写）
--   ops_products.manual_fields   text[] NOT NULL DEFAULT '{}'（字段级人工维护标记）
--   ops_products.jst_modified_at timestamptz        可空（该款 SKU modified 最大值）
--   ops_skus.manual_fields       text[] NOT NULL DEFAULT '{}'
--   ops_skus.jst_modified_at     timestamptz        可空（增量同步水位）
--
-- 注：异常表的 RLS/策略/grants/updated 触发器在 20260604155311 建立（生产已在用、
--   全量应用时该迁移先于本迁移执行），故此处只做幂等的「表 + 索引 + 列」对齐，不重复
--   CREATE POLICY（CREATE POLICY 无 IF NOT EXISTS，对既有表会报错）。
-- =============================================================================

-- 1) 异常表（幂等兜底；生产已存在 → no-op）
create table if not exists public.ops_product_mapping_exceptions (
  id uuid primary key default gen_random_uuid(),
  platform text,
  shop_id text,
  shop_name text,
  online_item_code text,
  online_sku_code text,
  jst_sku_id text,
  order_no text,
  source_table text,
  reason text,
  status text not null default 'pending',
  raw_data jsonb,
  resolved_sku_id uuid references public.ops_skus(id) on delete set null,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_ops_product_mapping_exceptions_key
  on public.ops_product_mapping_exceptions(
    coalesce(shop_id,''), coalesce(online_sku_code,''), coalesce(jst_sku_id,'')
  ) where status = 'pending';

create index if not exists idx_ops_product_mapping_exceptions_status
  on public.ops_product_mapping_exceptions(status, created_at desc);

-- 2) 主档新列（本卡真正的生产缺口）
alter table public.ops_products
  add column if not exists lead_time_days integer,
  add column if not exists manual_fields text[] not null default '{}',
  add column if not exists jst_modified_at timestamptz;

alter table public.ops_skus
  add column if not exists manual_fields text[] not null default '{}',
  add column if not exists jst_modified_at timestamptz;

comment on column public.ops_products.lead_time_days  is '交期(天)，人工维护；JST 同步永不写此列';
comment on column public.ops_products.manual_fields   is '人工维护字段名列表；列在此处的字段 JST 同步不覆盖';
comment on column public.ops_products.jst_modified_at is '聚水潭商品资料 modified（取该款下 SKU 的最大值）';
comment on column public.ops_skus.manual_fields       is '人工维护字段名列表；列在此处的字段 JST 同步不覆盖';
comment on column public.ops_skus.jst_modified_at     is '聚水潭商品资料 modified；增量同步据此跳过未变更行';

-- 3) 刷新 PostgREST schema 缓存（新列对前端/REST 立即可见）
notify pgrst, 'reload schema';
