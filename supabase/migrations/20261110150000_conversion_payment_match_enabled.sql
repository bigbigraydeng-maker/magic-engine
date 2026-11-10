-- 成交自动回传开关。默认关。
-- 打开之后：CRM 里定金已确认，且待核对成交的金额等于所订团的每人标价，才走现有发送路径。
-- 客人不一致、金额对不上、资料不够的，仍留在待核对，不从这里发。
-- 跟 clients.ai_auto_review_enabled 不是同一个开关。那个是让模型判断；这个只放行上面这一条规则。
--
-- 只随 PR 提交。本窗口不在生产库执行。
-- 代码先上、这一列还没有时：早上的自动回传读不到这一列就当没有客户打开，不发；
-- AI 审核同样当作关，成交仍走原来的审核。列加上之后才会按下面那一行只给 CTS 打开。

alter table public.clients
  add column if not exists conversion_payment_match_enabled boolean not null default false;

comment on column public.clients.conversion_payment_match_enabled is
  '定金已在 CRM 确认且金额等于所订团每人标价时，自动把这笔成交告诉广告平台。默认关。';

-- CTS 客户行。别的客户保持关。这是客户配置，不是共享代码里的分支。
-- 这一行不存在时（空库）更新 0 行，不算失败。
update public.clients
set conversion_payment_match_enabled = true
where id = 'c0000000-0000-0000-0000-000000000000';

notify pgrst, 'reload schema';

do $$
declare
  v_default text;
begin
  select column_default
  into v_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'clients'
    and column_name = 'conversion_payment_match_enabled';

  if v_default is null or v_default not in ('false', 'false::boolean') then
    raise exception '自验失败：conversion_payment_match_enabled 缺少或默认不是关';
  end if;

  raise notice '✅ 20261110150000 自验通过：成交自动回传开关默认关';
end $$;
