-- ════════════════════════════════════════════════════════════════════════════
-- AI 起草的信：一封一行（PM 2026-11-28「ai 写的信一定要有标记，做跟踪和学习，分析」）
-- 设计稿：docs/specs/2026-11-28-crm-ai-letter-tracking-design-v0.md
--
-- crm_ai_letters  AI 每起草一封给客人的信记一行：在哪一页起草的、AI 的原稿和当时的检查结果、谁让它写的。
--                 员工点发送时（发信之前）补上：这次发送的 request_id、最后发出的稿、改没改、谁放行的。
--                 发没发成、客人回没回、后来有没有报价订团，不存在这里：按 request_id 去发信回执
--                 （crm_email_send_receipts）和客人的往来、阶段、订单里查，只有一份真相。
--
-- 只加一张新表，不改任何旧表、不改发信流程。撤回办法见文件末尾。
-- ════════════════════════════════════════════════════════════════════════════

create table public.crm_ai_letters (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  -- 在哪起草的：客人抽屉里的「让 AI 写」/「跟进信」页 /「第 7 天跟进信」页
  surface text not null check (surface in ('drawer', 'letters_page', 'day7_page')),
  -- 第一封信，还是跟进信
  draft_kind text not null check (draft_kind in ('first', 'follow_up')),
  ai_subject text not null,
  ai_body text not null,
  -- 起草当时跑的检查（跟进信才有）：[{ id, status, label, detail }]
  ai_checks jsonb not null default '[]'::jsonb,
  drafted_by text not null,
  drafted_at timestamptz not null default now(),
  -- 以下在员工点发送、真正发信之前写入；没写上就不发（发信那一步 fail-closed）
  request_id uuid,
  released_by text,
  released_at timestamptz,
  final_subject text,
  final_body text,
  edited boolean
);

create index crm_ai_letters_client_drafted_idx on public.crm_ai_letters (client_id, drafted_at desc);
create index crm_ai_letters_contact_idx on public.crm_ai_letters (contact_id);
-- 一次发送只对应一封 AI 信
create unique index crm_ai_letters_request_idx on public.crm_ai_letters (client_id, request_id) where request_id is not null;

comment on table public.crm_ai_letters is
  'AI 起草的客人信，一封一行：原稿、检查、谁起草；发送前补 request_id、终稿、是否改过、谁放行。released_at 有值不等于发出去了（发送前就写、发送可能被拦）：发没发成一律按 request_id 去 crm_email_send_receipts 查。设计稿 2026-11-28。';

alter table public.crm_ai_letters enable row level security;

-- 只有服务器（service_role）能读写；匿名和登录用户一律不能直接碰。
create policy crm_ai_letters_service_role_all
  on public.crm_ai_letters
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.crm_ai_letters from anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 撤回办法（只在确认没有页面在用之后）：
--   drop table public.crm_ai_letters;
-- 撤回会丢掉已经记下的 AI 信记录，撤回前先导出。
-- ────────────────────────────────────────────────────────────────────────────
