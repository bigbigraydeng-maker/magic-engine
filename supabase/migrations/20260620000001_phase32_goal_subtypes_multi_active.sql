-- ============================================================================
-- Phase 32 最小升级 — Goal sub_types + target_direction + 多 active Goal
-- ============================================================================
-- 解锁 CTS 4 团 + Oztop 清仓 等多 Goal 真实需求。保持扁平模型（无 hierarchy）。
--
-- 改动：
--   1. 移除 "一客户一 active Goal" 强约束（unique index）
--   2. 加 sub_type 字段（按 intent 分流 — sales/acquisition/awareness）
--   3. 加 target_direction 字段（'increase' | 'decrease'）支持清仓型 Goal
--
-- 兼容性：
--   - 现有 Goal 自动获得 target_direction='increase'（DEFAULT）
--   - 现有 awareness_subtype 字段保留（向后兼容）
--   - sub_type 可空（旧代码不读不影响）
-- ============================================================================

-- 1. 移除 1-active 约束
drop index if exists uniq_one_active_goal_per_client;

-- 2. 加 sub_type 字段（可空，按 intent 分流）
alter table goals
  add column if not exists sub_type text;

-- 3. 加 target_direction 字段（默认 increase 兼容旧数据）
alter table goals
  add column if not exists target_direction text not null default 'increase'
    check (target_direction in ('increase', 'decrease'));

-- 4. 给现有 placeholder Goal 设默认 sub_type
update goals
  set sub_type = 'placeholder'
  where title = '[Migration] Unassigned Backlog' and sub_type is null;

-- 5. 索引：active Goal 按 client 查询频繁
create index if not exists idx_goals_active_per_client
  on goals(client_id) where status = 'active';

-- 6. 注释（schema 文档化）
comment on column goals.sub_type is
  'Goal sub-type per intent. sales: ongoing_revenue|inventory_clearance|product_launch|conversion_lift. acquisition: ongoing|event_driven. awareness: see awareness_subtype enum.';

comment on column goals.target_direction is
  'Metric direction: increase (revenue, signups) or decrease (inventory clearance, churn rate).';
