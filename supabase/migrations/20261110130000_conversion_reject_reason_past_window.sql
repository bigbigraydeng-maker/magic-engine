-- 「不发送」原因加上 past_window（页面上写「超过时限」）。
--
-- 人在核对页选这个原因，以及超过广告平台 7 天窗口后系统自动标不发送，都写这个值。
-- 只改约束，不改任何客户开关，也不改已有行。
--
-- 代码上线前要先执行这份 migration。旧约束不认 past_window，自动标不发送会写不进去。

do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'me_sale_outcomes'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%reject_reason%'
      and pg_get_constraintdef(c.oid) ilike '%customer_opted_out%'
      and c.conname <> 'me_sale_outcomes_reject_reason_required'
  loop
    execute format('alter table public.me_sale_outcomes drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.me_sale_outcomes
  drop constraint if exists me_sale_outcomes_reject_reason_check;

alter table public.me_sale_outcomes
  add constraint me_sale_outcomes_reject_reason_check
  check (
    reject_reason is null
    or reject_reason in (
      'customer_opted_out',
      'not_real_sale',
      'duplicate',
      'past_window',
      'other'
    )
  );

notify pgrst, 'reload schema';

do $$
declare
  def text;
begin
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'me_sale_outcomes'
    and c.conname = 'me_sale_outcomes_reject_reason_check';
  if def is null or position('past_window' in def) = 0 then
    raise exception 'past_window 没有写进不发送原因约束';
  end if;
end $$;
