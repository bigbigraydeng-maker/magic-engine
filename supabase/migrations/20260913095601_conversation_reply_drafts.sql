-- CTS Governed Lead-Reply Agent 地基 —— #1574
--
-- 新表 conversation_reply_drafts：AI 生成的每一条候选回复 + 验证器判定结果的
-- 唯一记录点。Verifier / Inngest 四函数 / 门户 UI（#1575+）都依赖这张表存在。
-- clients 两个 kill switch 列（v3 对 v2 的修订——按渠道拆开，因为 Messenger 和
-- WhatsApp 上线节奏不同，WhatsApp 卡在企业验证见 #1299，不能共用一个开关）。
-- conversations.optout_unlinked 是退订兜底列，用于「退订请求对不上任何已知联系人」
-- 的场景。
--
-- 本次仅新增，不改任何既有表结构（conversations 上追加的 UNIQUE 索引例外——
-- 复合外键要求被引用列有唯一约束/索引；conversations.id 本来就是主键，全表
-- 天然唯一，这里只是新建一个覆盖 (client_id, id, channel) 的额外唯一索引，
-- 不可能因历史数据冲突失败，也不影响任何既有查询/约束）。
--
-- 达芬奇自我挑战（数据库 schema 变更前必答，见 docs/agents/80-davinci.md）：
-- 完整问答见本 PR 描述，这里只记录导致 SQL 偏离 issue #1574 原文的两条——
--
-- 1) issue 原文给的 client_id / conversation_id 外键没写 ON DELETE 子句，
--    Postgres 默认落到 NO ACTION（删除 clients/conversations 里被引用的行会
--    直接报错拒绝）。这跟仓库里**当前每一处** `references clients(id)` /
--    `references messenger_conversations(id)`（即改名前的 conversations）都不
--    一致——全部是 ON DELETE CASCADE（见 ai_visibility_tracker、diagnostic_engine、
--    social_post_measurement_receipts 等）。不改的话，这张表会成为仓库里唯一
--    一处「删客户会被外键卡住」的表，是隐藏的操作陷阱，不是刻意的审计保护
--    设计（其它 receipt 类表如 social_post_measurement_receipts 同样用 CASCADE）。
--    所以这里改成 ON DELETE CASCADE，跟全仓约定对齐。
--
-- 2) 复审（Codex #1622 round 1）发现 client_id / conversation_id / channel
--    三个独立约束互相不知道彼此存在：WhatsApp 写入方漏传 channel（会静默落到
--    default 'messenger'）或传错 client_id，三个独立约束仍然全部通过，草稿就
--    可能挂错客户/渠道，下游按草稿的 client_id/channel 选队列、渠道开关、发送
--    Connector 时就会串台。改成复合外键 (client_id, conversation_id, channel)
--    → conversations(client_id, id, channel)，强制三者必须跟父会话一致；写法
--    参照仓库里已有的同类模式（20260808000003_me2_execution_kernel_v1.sql 的
--    fk_action_runs_goal_same_client / fk_action_runs_execution_item_same_client，
--    20260908153810_web_intelligence_v01.sql 的 market_snapshots/market_evidence）。
--    superseded_by_draft_id 同理改成复合自引用 (client_id, superseded_by_draft_id,
--    conversation_id) → 本表 (client_id, id, conversation_id)，防止替代指针跨
--    会话/跨客户；SET NULL 只置空 superseded_by_draft_id 一列（列清单写法需要
--    PG ≥ 15，生产实测 PostgreSQL 17.6 可用），因为 client_id/conversation_id
--    是这条草稿自己的归属列，不该被这个动作改动。

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_client_id_id_channel
  ON conversations (client_id, id, channel);

CREATE TABLE conversation_reply_drafts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  conversation_id uuid not null,
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
  superseded_by_draft_id uuid,
  inngest_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by_email text,
  unique (conversation_id, message_id_trigger),
  unique (client_id, id, conversation_id),

  -- 草稿的 client_id / conversation_id / channel 必须三者同时对上同一条父会话，
  -- 堵住漏传 channel（静默落到 default 'messenger'）或传错 client_id 时单列外键
  -- 各自校验通过、组合却串到别的客户/渠道的场景。
  constraint fk_conversation_reply_drafts_conversation_same_client_channel
    foreign key (client_id, conversation_id, channel)
    references conversations (client_id, id, channel)
    on delete cascade,

  -- 被哪条新草稿取代，只能是同一个客户、同一个会话下的草稿，堵住更新流程传错
  -- 会话/客户 ID 时把无关草稿标记成「取代者」。
  constraint fk_conversation_reply_drafts_superseded_by_same_conversation
    foreign key (client_id, superseded_by_draft_id, conversation_id)
    references conversation_reply_drafts (client_id, id, conversation_id)
    on delete set null (superseded_by_draft_id)
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
