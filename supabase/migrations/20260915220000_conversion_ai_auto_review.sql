-- 成交审核 AI 全自动判断 + 自动发送（PM 拍板 2026-09-15，两轮设计复审后落地）：
-- ① 客户级开关 + 熔断暂停原因（同构复用 messenger_agent_enabled_* 的"一个开关管一件事"
--    模式，避免出现"页面显示关了、代码判的是另一个字段"的分裂——见 kill-switch.ts 头部说明）。
-- ② `me_sale_outcomes` 加两列，让"AI 判不出来（uncertain）"这一档有处安放：不强行推成
--    approved/rejected，也不会被同一批次无限重复判断（子牙复审 BLOCKER：不加这两列，
--    同一条 uncertain 记录会被每次批处理重新判一次，AI 调用成本无界增长）。

alter table public.clients
  add column if not exists ai_auto_review_enabled boolean not null default false,
  add column if not exists ai_auto_review_paused_reason text;

comment on column public.clients.ai_auto_review_enabled is
  '成交审核是否交给 AI 全自动判断+发送（不需要人工逐条点确认）。默认 false——按客户手动开启。';
comment on column public.clients.ai_auto_review_paused_reason is
  '非空 = 被"异常刹车"自动暂停的原因（人工关闭这个开关时不写这一列，避免跟自动熔断混淆，
   见 pm-todo 里区分"要不要主动通知 PM"用的就是这一列是否非空）。';

alter table public.me_sale_outcomes
  add column if not exists ai_review_attempts integer not null default 0,
  add column if not exists ai_last_reviewed_at timestamptz;

comment on column public.me_sale_outcomes.ai_review_attempts is
  'AI 判断这条记录"拿不准"（uncertain）的次数。达到上限后不再自动重判，
   计入"AI 判不了、需要人看一眼"的信号（复用现有今日待办 pending_review 展示，不新开通道）。';
comment on column public.me_sale_outcomes.ai_last_reviewed_at is
  'AI 上一次判断这条记录的时间，用来避免同一批次内重复判断同一条 uncertain 记录。';

notify pgrst, 'reload schema';

-- ── 自验 ──────────────────────────────────────────────────────────────────
do $$
declare
  v_client_cols_ok boolean;
  v_outcome_cols_ok boolean;
begin
  select
    count(*) filter (where column_name = 'ai_auto_review_enabled') = 1
    and count(*) filter (where column_name = 'ai_auto_review_paused_reason') = 1
  into v_client_cols_ok
  from information_schema.columns
  where table_schema = 'public' and table_name = 'clients';

  select
    count(*) filter (where column_name = 'ai_review_attempts') = 1
    and count(*) filter (where column_name = 'ai_last_reviewed_at') = 1
  into v_outcome_cols_ok
  from information_schema.columns
  where table_schema = 'public' and table_name = 'me_sale_outcomes';

  if not v_client_cols_ok then
    raise exception '自验失败：clients 表缺少 ai_auto_review_enabled / ai_auto_review_paused_reason';
  end if;
  if not v_outcome_cols_ok then
    raise exception '自验失败：me_sale_outcomes 表缺少 ai_review_attempts / ai_last_reviewed_at';
  end if;

  raise notice '✅ 20260915220000 自验通过：AI 全自动审核所需字段都在';
end $$;
