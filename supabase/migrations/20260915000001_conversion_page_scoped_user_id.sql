-- NAL（New Asian Logistics）私信线索几乎全部没有邮箱/电话（182 个联系人只有 3/2 个
-- 有），但 186 个有 Facebook page-scoped user id（PSID，Messenger 平台自带的身份）。
-- Meta 官方 Conversions API 文档明确支持用 page_scoped_user_id（配 page_id）做匹配键，
-- 且明确说这两个字段"不哈希"——见设计评审 nal-psid-matchkey-design-v1.md。
--
-- 🔴 子牙+魏征双审都抓到同一个漏洞：只加了新列、只放宽了「必须有匹配键」这条约束，
--    漏了「客人要求删除个人信息」这条约束（me_sale_outcomes_redacted_is_empty）——
--    那条约束原来只锁邮箱/电话/名/姓四列，PSID 不在里面，删除功能会对纯 PSID 记录
--    形同虚设。这次一并补上，不留到下一次。

alter table public.me_sale_outcomes
  add column if not exists page_scoped_user_id text;

comment on column public.me_sale_outcomes.page_scoped_user_id is
  'Facebook Messenger 私信身份（page-scoped user id）。Meta 文档要求不哈希发送。'
  '客人要求删除个人信息时必须跟邮箱/电话/姓名一起清空——见 redacted_is_empty 约束。';

-- 匹配键三选一：邮箱 / 电话 / Facebook 私信身份，任一存在即可（已删除的行不受此约束）。
alter table public.me_sale_outcomes
  drop constraint if exists me_sale_outcomes_needs_match_key;
alter table public.me_sale_outcomes
  add constraint me_sale_outcomes_needs_match_key
  check (
    redacted_at is not null
    or customer_email is not null
    or customer_phone is not null
    or page_scoped_user_id is not null
  );

-- 🔴 必须跟上面那条一起改：新增的匹配键也要被「已删除」状态锁空，否则客人要求删除后
--    这一列会原封不动地留着一个能反查到具体真人的 Facebook 身份号。
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
    )
  );

-- NAL 私信分类器的数据源（PR 待提交），跟 CTS 的 crm_sheet_sync 是姊妹枚举值。
alter table public.me_sale_outcomes
  drop constraint if exists me_sale_outcomes_source_kind_check;
alter table public.me_sale_outcomes
  add constraint me_sale_outcomes_source_kind_check
  check (
    source_kind in (
      'manual_seed', 'inbox_extract', 'web_form', 'meta_lead_form', 'api',
      'crm_hubspot', 'crm_sheet_sync', 'messenger_conversation'
    )
  );

notify pgrst, 'reload schema';

-- ── 自验（5 项，全部必须为 true）──────────────────────────────────────────
do $$
declare
  v_column_exists boolean;
  v_match_key_ok boolean;
  v_redacted_ok boolean;
  v_source_kind_ok boolean;
  v_ctS_untouched boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'me_sale_outcomes'
      and column_name = 'page_scoped_user_id'
  ) into v_column_exists;

  -- 只有 PSID、没有邮箱电话的行，插入应该成功（约束放宽生效）。
  begin
    insert into public.me_sale_outcomes (
      client_id, outcome_kind, page_scoped_user_id, occurred_at, source_kind, review_status
    ) values (
      (select id from public.clients limit 1),
      'lead', 'self_check_psid_12345', now(), 'messenger_conversation', 'pending_review'
    );
    v_match_key_ok := true;
    delete from public.me_sale_outcomes where page_scoped_user_id = 'self_check_psid_12345';
  exception when check_violation then
    v_match_key_ok := false;
  end;

  -- 一行都没有匹配键（redacted_at 也为空）应该仍然被拒绝。
  begin
    insert into public.me_sale_outcomes (client_id, outcome_kind, occurred_at, source_kind, review_status)
    values ((select id from public.clients limit 1), 'lead', now(), 'messenger_conversation', 'pending_review');
    v_redacted_ok := false; -- 不该走到这里
  exception when check_violation then
    v_redacted_ok := true;
  end;

  -- redacted_at 非空但 page_scoped_user_id 仍有值——应该被拒绝。
  begin
    insert into public.me_sale_outcomes (
      client_id, outcome_kind, page_scoped_user_id, occurred_at, source_kind, review_status, redacted_at
    ) values (
      (select id from public.clients limit 1),
      'lead', 'self_check_psid_67890', now(), 'messenger_conversation', 'pending_review', now()
    );
    v_ctS_untouched := false; -- 不该走到这里（应该报错）
  exception when check_violation then
    v_ctS_untouched := true;
  end;

  select pg_get_constraintdef((select oid from pg_constraint where conname = 'me_sale_outcomes_source_kind_check'))
    like '%messenger_conversation%' into v_source_kind_ok;

  if not v_column_exists then
    raise exception '自验失败：page_scoped_user_id 列没建成';
  end if;
  if not v_match_key_ok then
    raise exception '自验失败：只有 PSID 的行插不进去，约束没放宽';
  end if;
  if not v_redacted_ok then
    raise exception '自验失败：一个匹配键都没有的行居然插进去了';
  end if;
  if not v_ctS_untouched then
    raise exception '自验失败：redacted_at 非空但 PSID 有值的行居然插进去了';
  end if;
  if not v_source_kind_ok then
    raise exception '自验失败：source_kind 约束没加 messenger_conversation';
  end if;

  raise notice '✅ 20260915000001 自验通过：5 项全部符合预期';
end $$;
