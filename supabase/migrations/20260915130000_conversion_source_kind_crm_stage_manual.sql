-- NAL「客户管理工作台标已成交 → 回传 Meta CAPI」设计（2026-09-15）新增数据源：
-- 员工在工作台里把联系人手动推进到"已成交"档位时，顺带录入金额，直接写一条
-- me_sale_outcomes purchase 记录。跟 messenger_conversation / crm_sheet_sync 同一族
-- "非官方 CRM API 对接"的人工/半自动录入渠道标签。

alter table public.me_sale_outcomes
  drop constraint if exists me_sale_outcomes_source_kind_check;
alter table public.me_sale_outcomes
  add constraint me_sale_outcomes_source_kind_check
  check (
    source_kind in (
      'manual_seed', 'inbox_extract', 'web_form', 'meta_lead_form', 'api',
      'crm_hubspot', 'crm_sheet_sync', 'messenger_conversation', 'crm_stage_manual'
    )
  );

notify pgrst, 'reload schema';

-- ── 自验 ──────────────────────────────────────────────────────────────────
do $$
declare
  v_insert_ok boolean;
  v_constraint_has_value boolean;
begin
  begin
    insert into public.me_sale_outcomes (
      client_id, outcome_kind, page_scoped_user_id, amount_minor, currency,
      occurred_at, source_kind, review_status
    ) values (
      (select id from public.clients limit 1),
      'purchase', 'self_check_crm_stage_manual', 100, 'NZD', now(), 'crm_stage_manual', 'pending_review'
    );
    v_insert_ok := true;
    delete from public.me_sale_outcomes where page_scoped_user_id = 'self_check_crm_stage_manual';
  exception when check_violation then
    v_insert_ok := false;
  end;

  select pg_get_constraintdef((select oid from pg_constraint where conname = 'me_sale_outcomes_source_kind_check'))
    like '%crm_stage_manual%' into v_constraint_has_value;

  if not v_insert_ok then
    raise exception '自验失败：source_kind=crm_stage_manual 的行插不进去';
  end if;
  if not v_constraint_has_value then
    raise exception '自验失败：约束定义里没有 crm_stage_manual';
  end if;

  raise notice '✅ 20260915130000 自验通过：source_kind 新增值生效';
end $$;
