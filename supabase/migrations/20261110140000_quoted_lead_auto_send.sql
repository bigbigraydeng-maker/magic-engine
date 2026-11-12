-- 「已报价可以自动回传」（Ray 2026-11-10 09:28 NZDT）。
--
-- 客户级开关，默认关。这里只给 CTS 打开。别的客户保持关，直到有人在配置里打开。
-- 不改已有的待核对行，也不调用广告平台。代码上线前要先执行这份变更。
-- 列还没加上时，程序把开关当成关。

alter table public.clients
  add column if not exists quoted_lead_auto_send_enabled boolean not null default false;

comment on column public.clients.quoted_lead_auto_send_enabled is
  '待核对咨询里，客人当前阶段是已报价、且还在广告平台 7 天窗口内的，自动走现有回传。默认关。';

update public.clients
set quoted_lead_auto_send_enabled = true
where id = 'c0000000-0000-0000-0000-000000000000';

notify pgrst, 'reload schema';

do $$
declare
  v_col boolean;
  v_cts boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clients'
      and column_name = 'quoted_lead_auto_send_enabled'
  ) into v_col;

  if not v_col then
    raise exception 'clients.quoted_lead_auto_send_enabled 没有加上';
  end if;

  select exists (
    select 1 from public.clients where id = 'c0000000-0000-0000-0000-000000000000'
  ) into v_cts;

  if v_cts and not exists (
    select 1
    from public.clients
    where id = 'c0000000-0000-0000-0000-000000000000'
      and quoted_lead_auto_send_enabled is true
  ) then
    raise exception 'CTS 的已报价自动回传开关没有打开';
  end if;
end $$;
