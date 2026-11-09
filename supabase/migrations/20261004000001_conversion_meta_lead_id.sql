-- Facebook 即时表单线索编号（Meta lead id）随成交一起发给 Meta。
--
-- 为什么：成交回传现在只靠邮箱/电话让 Meta 去认人。CTS 的线索全部来自 Facebook 即时表单，
-- 线索表第 1 列每一行都有 `l:<15–17 位数字>`（786 行无一例外）。Meta 官方 Conversions API
-- 的 user_data 里有 `lead_id` 参数（文档标注「Do not hash」），带上它，Meta 能把这笔成交
-- 直接对回那条广告线索，不依赖对方当时填的邮箱/电话跟我们记的一致。
--
-- ⚠️ 跟 migration 一样：只随 PR 提交，apply 需 PM 显式 go。本迁移只加一列、一条格式约束，
--    并把「已删除」约束补上这一列；不改任何既有数据。
--
-- 🔴 跟 20260915000001（page_scoped_user_id）同一个教训：新增一个能反查到具体真人的标识符，
--    必须同时锁进 redacted_is_empty，否则客人要求删除个人信息后，这一列会原封不动留着。

alter table public.me_sale_outcomes
  add column if not exists meta_lead_id text;

comment on column public.me_sale_outcomes.meta_lead_id is
  'Facebook 即时表单线索编号（Meta lead id，15–17 位纯数字）。发给 Meta 时作为 user_data.lead_id，'
  '官方标注不哈希。能反查到具体一次表单提交，客人要求删除个人信息时必须跟邮箱/电话一起清空——见 redacted_is_empty 约束。';

-- 格式闸：只允许 15–17 位纯数字或空。发给 Meta 的东西撤不回，写库这一层就拒掉脏值。
-- 约束先以 NOT VALID 加上（不长时间持强锁），随后单独 VALIDATE（只持较弱的锁扫描现有行）。
alter table public.me_sale_outcomes
  drop constraint if exists me_sale_outcomes_meta_lead_id_format;
alter table public.me_sale_outcomes
  add constraint me_sale_outcomes_meta_lead_id_format
  check (meta_lead_id is null or meta_lead_id ~ '^[0-9]{15,17}$') not valid;
alter table public.me_sale_outcomes
  validate constraint me_sale_outcomes_meta_lead_id_format;

-- 已删除的行：个人信息列必须全空，现在包含 meta_lead_id。
alter table public.me_sale_outcomes
  drop constraint if exists me_sale_outcomes_redacted_is_empty;
alter table public.me_sale_outcomes
  add constraint me_sale_outcomes_redacted_is_empty
  check (
    redacted_at is null
    or (
      customer_email is null
      and customer_phone is null
      and customer_first is null
      and customer_last is null
      and page_scoped_user_id is null
      and meta_lead_id is null
    )
  ) not valid;
alter table public.me_sale_outcomes
  validate constraint me_sale_outcomes_redacted_is_empty;

notify pgrst, 'reload schema';

-- ── 自验（只读，不往生产表里插任何行；3 项全部必须为 true）──────────────────────
do $$
declare
  v_column_exists boolean;
  v_format_ok boolean;
  v_redacted_ok boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'me_sale_outcomes'
      and column_name = 'meta_lead_id'
  ) into v_column_exists;

  select exists (
    select 1 from pg_constraint
    where conname = 'me_sale_outcomes_meta_lead_id_format'
      and conrelid = 'public.me_sale_outcomes'::regclass
  ) into v_format_ok;

  select coalesce(pg_get_constraintdef(c.oid) like '%meta_lead_id%', false)
    from pg_constraint c
    where c.conname = 'me_sale_outcomes_redacted_is_empty'
      and c.conrelid = 'public.me_sale_outcomes'::regclass
    into v_redacted_ok;

  if not v_column_exists then
    raise exception '自验失败：meta_lead_id 列没建成';
  end if;
  if not v_format_ok then
    raise exception '自验失败：meta_lead_id 格式约束没建成';
  end if;
  if v_redacted_ok is not true then
    raise exception '自验失败：redacted_is_empty 约束没包含 meta_lead_id';
  end if;

  raise notice '✅ 20261004000001 自验通过：3 项全部符合预期';
end $$;
