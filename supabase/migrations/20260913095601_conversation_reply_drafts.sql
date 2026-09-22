-- CTS Governed Lead-Reply Agent 地基 —— #1574
--
-- 新表 conversation_reply_drafts：AI 生成的每一条候选回复 + 验证器判定结果的
-- 唯一记录点。Verifier / Inngest 四函数 / 门户 UI（#1575+）都依赖这张表存在。
-- clients 两个 kill switch 列（v3 对 v2 的修订——按渠道拆开，因为 Messenger 和
-- WhatsApp 上线节奏不同，WhatsApp 卡在企业验证见 #1299，不能共用一个开关）。
-- conversations.optout_unlinked 是退订兜底列，用于「退订请求对不上任何已知联系人」
-- 的场景。
--
-- 本次仅新增，不改任何既有表结构。
--
-- 达芬奇自我挑战（数据库 schema 变更前必答，见 docs/agents/80-davinci.md）：
-- 完整问答见本 PR 描述，这里只记录导致 SQL 偏离 issue 原文的那一条——
--   问题：issue #1574 原文给的 client_id / conversation_id 外键没写 ON DELETE
--   子句，Postgres 默认落到 NO ACTION（删除 clients/conversations 里被引用的
--   行会直接报错拒绝）。这跟仓库里**当前每一处** `references clients(id)` /
--   `references messenger_conversations(id)`（即改名前的 conversations）都不
--   一致——全部是 ON DELETE CASCADE（见 ai_visibility_tracker、diagnostic_engine、
--   social_post_measurement_receipts 等）。不改的话，这张表会成为仓库里唯一
--   一处「删客户会被外键卡住」的表，是隐藏的操作陷阱，不是刻意的审计保护
--   设计（其它 receipt 类表如 social_post_measurement_receipts 同样用 CASCADE）。
--   所以这里改成 ON DELETE CASCADE，跟全仓约定对齐。
--   superseded_by_draft_id 是自引用「被哪条新草稿取代」指针，参照仓库里同类
--   自引用列 team_lessons.superseded_by 的写法（ON DELETE SET NULL）——
--   删掉新草稿不该级联删掉被它取代的旧草稿，也不该拒绝删除，置空即可。
CREATE TABLE conversation_reply_drafts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  message_id_trigger text not null,
  channel text not null default 'messenger',
  draft_body text not null,
  agent_confidence numeric,
  source_offering_codes text[],
  quoted_offering_names text[],
  verifier_status text not null check (verifier_status in
    ('pending','blocked','approved','sent','timed_out','rejected','error','send_failed')),
  blocked_reasons text[],
  verifier_output_json jsonb,
  superseded_by_draft_id uuid references conversation_reply_drafts(id) on delete set null,
  inngest_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by_email text,
  unique (conversation_id, message_id_trigger)
);

create index on conversation_reply_drafts (client_id, verifier_status, created_at desc);
create index on conversation_reply_drafts (conversation_id, created_at desc);

alter table conversation_reply_drafts enable row level security;
create policy conversation_reply_drafts_service_role
  on conversation_reply_drafts for all to service_role using (true) with check (true);
-- 不给 anon/authenticated 建任何 policy —— UI 全走服务端 API + service_role（方案 H9）。

alter table clients add column if not exists messenger_agent_enabled_messenger boolean not null default false;
alter table clients add column if not exists messenger_agent_enabled_whatsapp boolean not null default false;
alter table conversations add column if not exists optout_unlinked boolean not null default false;
