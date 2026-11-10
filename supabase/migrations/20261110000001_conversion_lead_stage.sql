-- 线索阶段回传（Meta「Conversion Leads」CRM 集成，2026-11-10）
--
-- 员工在客户管理页把一位**来自 Facebook 即时表单**的客人推进到某个阶段（如「已报价」
-- 「已付定金」）时，ME 每天把这次阶段变化作为一条「线索阶段事件」回报给 Meta，
-- 让 Meta 能把它对回带来这条线索的广告。
--
-- 为什么复用 me_sale_outcomes，不另建表：发送状态机（防重复发送的三道闸、
-- 7 天窗口、拒联检查、试运行、补发、回执）全挂在这张表 + me_conversion_writebacks 上，
-- 另建表等于把这些撤不回的闸再抄一遍。
--
-- 新增的只有：
--   outcome_kind = 'lead_stage'   一条「线索走到某阶段」的事实，不带金额
--   lead_stage                    发给 Meta 的阶段名（如 'Quoted'），来自客户配置
--   source_kind  = 'crm_stage_auto'  由阶段变化自动生成，不经人工录入
--
-- 🔴 lead_stage 行必须带 Facebook 线索编号：Meta 的线索阶段集成只认即时表单线索，
--    没有编号的事件会被收下但不会用于学习，发了等于白发、还多暴露一次个人信息。

-- ── 1. outcome_kind 增加 lead_stage ───────────────────────────────────────
alter table public.me_sale_outcomes
  drop constraint if exists me_sale_outcomes_outcome_kind_check;
alter table public.me_sale_outcomes
  add constraint me_sale_outcomes_outcome_kind_check
  check (outcome_kind in ('purchase', 'balance', 'lead', 'lead_stage'));

-- ── 2. 金额规则：lead 与 lead_stage 都不带金额 ────────────────────────────
alter table public.me_sale_outcomes
  drop constraint if exists me_sale_outcomes_amount_required;
alter table public.me_sale_outcomes
  add constraint me_sale_outcomes_amount_required
  check (
    outcome_kind in ('lead', 'lead_stage')
    or (amount_minor is not null and currency is not null)
  );

-- ── 3. 阶段名列 + 与种类绑定 ──────────────────────────────────────────────
alter table public.me_sale_outcomes
  add column if not exists lead_stage text;

alter table public.me_sale_outcomes
  drop constraint if exists me_sale_outcomes_lead_stage_shape;
alter table public.me_sale_outcomes
  add constraint me_sale_outcomes_lead_stage_shape
  check (
    (outcome_kind = 'lead_stage') = (lead_stage is not null)
    and (lead_stage is null or length(btrim(lead_stage)) between 1 and 100)
  );

-- 已删除个人信息的行不受此约束（脱敏会清空 meta_lead_id）
alter table public.me_sale_outcomes
  drop constraint if exists me_sale_outcomes_lead_stage_needs_lead_id;
alter table public.me_sale_outcomes
  add constraint me_sale_outcomes_lead_stage_needs_lead_id
  check (
    outcome_kind <> 'lead_stage'
    or redacted_at is not null
    or meta_lead_id is not null
  );

-- 🔴 同一位客人的同一档只能有一条：客人后来又填了一次表（换了线索编号）时，
--    不能把「已报价」挂到新编号上再报一次——Meta 那边就多记一位，撤不回。
--    删除个人信息后 contact_id 仍保留，所以这条索引也挡住「删完又被每日任务重新写入」。
create unique index if not exists uq_me_sale_outcomes_lead_stage_per_contact
  on public.me_sale_outcomes (client_id, contact_id, lead_stage)
  where outcome_kind = 'lead_stage' and contact_id is not null;

-- ── 4. source_kind 增加 crm_stage_auto ────────────────────────────────────
alter table public.me_sale_outcomes
  drop constraint if exists me_sale_outcomes_source_kind_check;
alter table public.me_sale_outcomes
  add constraint me_sale_outcomes_source_kind_check
  check (
    source_kind in (
      'manual_seed', 'inbox_extract', 'web_form', 'meta_lead_form', 'api',
      'crm_hubspot', 'crm_sheet_sync', 'messenger_conversation', 'crm_stage_manual',
      'crm_stage_auto'
    )
  );

notify pgrst, 'reload schema';

-- ── 自验 ──────────────────────────────────────────────────────────────────
-- 在一个子事务里插一条合法的 lead_stage 行、再试三条非法行，全部回滚，不留痕迹。
do $$
declare
  v_client uuid := (select id from public.clients limit 1);
  v_ok boolean;
begin
  -- 合法：带阶段名、带线索编号、不带金额
  begin
    insert into public.me_sale_outcomes (
      client_id, outcome_kind, lead_stage, meta_lead_id, customer_phone,
      occurred_at, source_kind, source_ref, review_status
    ) values (
      v_client, 'lead_stage', 'Quoted', '123456789012345', '+6421000000',
      now(), 'crm_stage_auto', 'self_check_lead_stage', 'pending_review'
    );
    v_ok := true;
    delete from public.me_sale_outcomes where source_ref = 'self_check_lead_stage';
  exception when check_violation then
    v_ok := false;
  end;
  if not v_ok then
    raise exception '自验失败：合法的 lead_stage 行插不进去';
  end if;

  -- 非法 1：lead_stage 没有阶段名
  begin
    insert into public.me_sale_outcomes (
      client_id, outcome_kind, meta_lead_id, customer_phone, occurred_at, source_kind, review_status
    ) values (v_client, 'lead_stage', '123456789012345', '+6421000000', now(), 'crm_stage_auto', 'pending_review');
    raise exception '自验失败：没有阶段名的 lead_stage 行竟然插进去了';
  exception when check_violation then null;
  end;

  -- 非法 2：lead_stage 没有线索编号
  begin
    insert into public.me_sale_outcomes (
      client_id, outcome_kind, lead_stage, customer_phone, occurred_at, source_kind, review_status
    ) values (v_client, 'lead_stage', 'Quoted', '+6421000000', now(), 'crm_stage_auto', 'pending_review');
    raise exception '自验失败：没有线索编号的 lead_stage 行竟然插进去了';
  exception when check_violation then null;
  end;

  -- 非法 3：别的种类带了阶段名
  begin
    insert into public.me_sale_outcomes (
      client_id, outcome_kind, lead_stage, customer_phone, occurred_at, source_kind, review_status
    ) values (v_client, 'lead', 'Quoted', '+6421000000', now(), 'manual_seed', 'pending_review');
    raise exception '自验失败：普通 lead 行带阶段名竟然插进去了';
  exception when check_violation then null;
  end;

  raise notice '✅ 20261110000001 自验通过：lead_stage 种类、阶段名、线索编号约束生效';
end $$;
