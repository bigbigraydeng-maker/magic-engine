-- CTS Governed Reply · F4 conversation.health.heartbeat（issue #1587）
--
-- 两张新表：
--   1) conversation_optout_write_failures —— 退订写入失败的落地记录（之前完全不存在，
--      见 optout.ts 文件头「宁可拦一条」——但 opt-out **写入**失败一直只有 console.error，
--      心跳检查读不到，会被误判成「没人退订、一切正常」）。
--   2) conversation_health_alerts —— 心跳检查的「当前活跃告警」，自愈表：健康了就删行，
--      不健康就 upsert，不会无限堆积（跟 conversation_reply_drafts 这类只增不减的记录表
--      不同，这张表的行数 = 现在正在报警的问题数，不是历史)。
--
-- 本次仅新增，不改任何既有表结构。

CREATE TABLE conversation_optout_write_failures (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients(id) on delete cascade,
  channel          text not null,
  conversation_id  uuid references conversations(id) on delete set null,
  contact_id       uuid,
  error_message    text not null,
  occurred_at      timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create index on conversation_optout_write_failures (client_id, channel, occurred_at desc);

alter table conversation_optout_write_failures enable row level security;
revoke all on conversation_optout_write_failures from anon, authenticated;
grant all on conversation_optout_write_failures to service_role;

create policy conversation_optout_write_failures_service_role
  on conversation_optout_write_failures for all to service_role using (true) with check (true);
-- 不给 anon/authenticated 建任何 policy —— 这张表只由 webhook 的服务端 best-effort
-- 写入路径和心跳检查读，跟 conversation_reply_drafts（方案 H9）同一约定。

CREATE TABLE conversation_health_alerts (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references clients(id) on delete cascade,
  channel            text not null,
  check_type         text not null check (check_type in
    ('webhook_silent','verifier_block_rate_high','verifier_error_rate_high','optout_write_failed')),
  detail             text not null,
  first_detected_at  timestamptz not null default now(),
  last_detected_at   timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (client_id, channel, check_type)
);

alter table conversation_health_alerts enable row level security;
revoke all on conversation_health_alerts from anon, authenticated;
grant all on conversation_health_alerts to service_role;

create policy conversation_health_alerts_service_role
  on conversation_health_alerts for all to service_role using (true) with check (true);
-- 不给 anon/authenticated 建任何 policy —— 心跳函数（service_role）和 pm-daily-todo
-- 读时聚合（service_role）是仅有的两个读写方。
