-- Phase1 · Leads 营销自动化 —— 客户级阶段模型 + 阶段流转审计 + leads 配置位
--
-- ⚠️ 本文件记录的 schema 已由上游(设计 + 三审 workflow)于 2026-07-28 应用到
--    生产库(glbdnayojixmexgofbsd)并 SQL 验证通过。补进仓库仅为「防漂移」——
--    DB 已经有了、仓库缺这个文件。全部 IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
--    ON CONFLICT DO NOTHING，对已应用的库是无操作(no-op)。不要再单独 apply。
--
-- WHY
-- ---
-- 冷热分级(lib/crm/segments.ts)能从触点自动算出「谁该联系」，不靠人填状态 ——
-- 这是 CTS 手工 Google Sheet 塌掉的根因(128 行「阶段」列 0 个填了)。但有一类
-- 结论性状态触点算不出来:「付了定金 / 付了全款 / 明确不感兴趣 / 短期不考虑」——
-- 这些需要员工明确推进一次。本 Phase 给每个客户一套「可配置的阶段模型」+ 每次
-- 流转留一条审计,让员工在 ME 里改阶段、看全渠道时间线,从而弃用 Sheet。
--
-- 每个阶段挂一个 marketing_action(营销动作),决定后续自动化怎么对待这个人:
--   nurture   继续按序列跟进
--   defer     先不发,到某时间点自动捞回
--   suppress  停止主动联系
--   postsale  转售后,不再营销
--   won       赢单归档
--
-- stage_key 是稳定英文 slug(代码 / 审计 / 自动化引用,永不改);label 是中文
-- (运营在配置页可改)。改名只改 label,不动 key。

-- ---------------------------------------------------------------------------
-- client_pipeline_stages —— 客户级阶段模型(可配置,一客户一套)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_pipeline_stages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- 稳定英文 slug —— 代码 / 审计 / 自动化引用它,永不改。
  stage_key         TEXT NOT NULL,
  -- 中文显示名 —— 运营可改,改名不动 key。
  label             TEXT NOT NULL,
  -- 漏斗顺序,越小越靠前(拖拽排序写这一列)。
  sort_order        INTEGER NOT NULL DEFAULT 0,

  -- 营销动作:后续自动化据此决定怎么对待这个人。
  marketing_action  TEXT NOT NULL
                      CHECK (marketing_action IN ('nurture', 'defer', 'suppress', 'postsale', 'won')),
  -- 终态(赢单 / 明确不感兴趣)—— 到了就不再往下推。
  is_terminal       BOOLEAN NOT NULL DEFAULT FALSE,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 同一客户下 stage_key 唯一 —— 配置页 upsert / 审计引用都靠它。
  CONSTRAINT client_pipeline_stages_client_key UNIQUE (client_id, stage_key)
);

CREATE INDEX IF NOT EXISTS client_pipeline_stages_client_sort_idx
  ON client_pipeline_stages (client_id, sort_order);

ALTER TABLE client_pipeline_stages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON client_pipeline_stages FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE client_pipeline_stages IS
  '客户级可配置阶段模型。stage_key 稳定英文 slug(引用),label 中文(可改)。marketing_action 决定后续自动化怎么对待该联系人。';

-- ---------------------------------------------------------------------------
-- contacts —— 挂上「当前阶段」
-- 冷热分级仍从触点算;stage 只承载触点算不出来的结论性状态(付定金 / 成交 / 拒绝)。
-- 可空:没人推进过的联系人 stage = NULL,由分级逻辑照常处理。
-- ---------------------------------------------------------------------------
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS stage            TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS stage_updated_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- contact_stage_events —— 阶段流转审计(每改一次阶段留一条)
-- 「谁、什么时候、从哪个阶段、改到哪个阶段、为什么」—— 全渠道时间线的一部分。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_stage_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,

  -- 改之前的 stage_key(首次推进时为 NULL)。
  from_stage   TEXT,
  -- 改之后的 stage_key。
  to_stage     TEXT,
  -- 谁改的(操作者邮箱 / 'system')。
  changed_by   TEXT,
  -- 备注(选填)。
  note         TEXT,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contact_stage_events_contact_time_idx
  ON contact_stage_events (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS contact_stage_events_client_time_idx
  ON contact_stage_events (client_id, created_at DESC);

ALTER TABLE contact_stage_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON contact_stage_events FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE contact_stage_events IS
  '阶段流转审计。每次改 contacts.stage 留一条,进联系人全渠道时间线。';

-- ---------------------------------------------------------------------------
-- clients —— leads 模块的按客户配置位(留给后续 Phase 用,如触点渠道开关等)
-- ---------------------------------------------------------------------------
ALTER TABLE clients ADD COLUMN IF NOT EXISTS leads_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- Seed —— CTS(c0000000-...)9 档阶段
-- ON CONFLICT DO NOTHING:生产库已 seed,这段对它是无操作;只在全新 db reset 时
-- 重建初始 9 档。label 为初始默认值,生产以库内实际(运营可能已改)为准。
-- ---------------------------------------------------------------------------
INSERT INTO client_pipeline_stages
  (client_id, stage_key, label, sort_order, marketing_action, is_terminal)
VALUES
  ('c0000000-0000-0000-0000-000000000000', 'new',            '新线索',       10, 'nurture',  FALSE),
  ('c0000000-0000-0000-0000-000000000000', 'contacted',      '已联系',       20, 'nurture',  FALSE),
  ('c0000000-0000-0000-0000-000000000000', 'quoted',         '已报价',       30, 'nurture',  FALSE),
  ('c0000000-0000-0000-0000-000000000000', 'deposit_paid',   '已付定金',     40, 'suppress', FALSE),
  ('c0000000-0000-0000-0000-000000000000', 'paid_full',      '已付全款',     50, 'won',      TRUE),
  ('c0000000-0000-0000-0000-000000000000', 'no_response',    '无下文',       60, 'nurture',  FALSE),
  ('c0000000-0000-0000-0000-000000000000', 'deferred',       '短期内不考虑', 70, 'defer',    FALSE),
  ('c0000000-0000-0000-0000-000000000000', 'not_interested', '不感兴趣',     80, 'suppress', TRUE),
  ('c0000000-0000-0000-0000-000000000000', 'traveling_soon', '即将出行',     90, 'postsale', FALSE)
ON CONFLICT (client_id, stage_key) DO NOTHING;
