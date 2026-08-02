-- Team Working Memory — 跨窗口工作记忆系统
--
-- 背景（2026-08-02 PM 盘问拍板）：
--   PM 同时开 30+ 个 Claude Code 窗口，但 Claude Code 的本地记忆是按*目录*存的。
--   实测：主目录 95 条记忆，37 个 worktree 窗口各 0 条 —— 不是"没看"，是根本看不到。
--   这是"同一个坑踩三遍"的机械根因（Dropbox 重复系统、APIFY_TOKEN 自造 env 等事故）。
--
-- 本 migration 建 5 张表，分三层：
--   1. 录制层  work_sessions / work_events —— hook 自动上报，不靠人自觉
--   2. 教训层  team_lessons              —— 一句话提醒，全自动入库（PM 拍板）
--   3. 套路层  team_skills / team_skill_runs —— 可复用步骤，全自动上线（PM 拍板）
--
-- PM 选了「教训和套路都全自动、不用我点」。因此把关全部落在**机器可验证的证据**上：
--   - 入库门槛见 evidence_kind（只认硬证据，不认"Claude 说搞定了"）
--   - 被推翻自动撤下见 contradicted_count / is_active
--   - 套路连续砸锅自动下架见 team_skill_runs → status='retired'
--   - 套路含花钱/对外/难撤回步骤时 requires_approval=true，执行时仍需 PM 显式 go
--
-- RLS：service-role 模板（CLAUDE.md 强约束，ME 从不走 end-user RLS）

-- ---------------------------------------------------------------------------
-- 1. 录制层
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS work_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Claude Code 自己的 session id，hook 每次带上来，用于幂等 upsert
  session_key       text NOT NULL UNIQUE,
  -- 归一化后的项目名：magic-engine / chinatravel / midashand / magic-lab-academy
  -- worktree 全部归到父项目，这样 37 个 0 记忆窗口自动继承父项目的教训
  project_key       text NOT NULL,
  cwd               text,
  git_branch        text,
  git_head          text,
  -- 这次会话在干什么（会话结束时由 distill 概括，或取首条用户消息）
  goal              text,
  -- 交接摘要：换窗口时直接读这个，不用 PM 人工传"咒语"
  summary           text,
  status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'ended')),

  -- 机器可验证的结果信号（喂给 evidence gate）
  files_changed     text[] NOT NULL DEFAULT '{}',
  commit_shas       text[] NOT NULL DEFAULT '{}',
  pr_number         integer,
  commands_run      integer NOT NULL DEFAULT 0,
  event_count       integer NOT NULL DEFAULT 0,
  tests_passed      boolean,
  tests_failed      boolean,
  -- PM 当场纠正我的次数 —— 最强的教训信号
  user_corrections  integer NOT NULL DEFAULT 0,

  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,
  distilled_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_sessions_project
  ON work_sessions (project_key, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_sessions_pending_distill
  ON work_sessions (ended_at) WHERE status = 'ended' AND distilled_at IS NULL;

COMMENT ON TABLE work_sessions IS
  '每个 Claude Code 窗口一行。hook 自动上报，PM 不手工写。';

CREATE TABLE IF NOT EXISTS work_events (
  id            bigserial PRIMARY KEY,
  session_key   text NOT NULL,
  seq           integer NOT NULL,
  kind          text NOT NULL
                  CHECK (kind IN ('tool', 'error', 'correction', 'test', 'git', 'note')),
  tool_name     text,
  -- 摘要级，已脱敏（密钥/token 在上报前后各抹一次），硬截断防止刷爆库
  summary       text NOT NULL,
  -- 文件路径 / 命令头，用于聚类"同一类活"
  target        text,
  ok            boolean,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_key, seq)
);

CREATE INDEX IF NOT EXISTS idx_work_events_session
  ON work_events (session_key, seq);
CREATE INDEX IF NOT EXISTS idx_work_events_kind
  ON work_events (kind, occurred_at DESC);

COMMENT ON TABLE work_events IS
  '工具事件摘要流。不存对话原文，不存密钥。distill 的原料。';

-- ---------------------------------------------------------------------------
-- 2. 教训层
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS team_lessons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_key         text NOT NULL UNIQUE,
  -- PM 拍板的两格：project = 只在这个项目提醒，global = 哪儿都提醒
  scope              text NOT NULL CHECK (scope IN ('project', 'global')),
  -- scope='project' 时必填（下方 CHECK 强制）
  project_key        text,
  title              text NOT NULL,
  lesson             text NOT NULL,
  rationale          text,

  -- 硬证据门槛。PM 选了全自动入库，所以这里是唯一的闸：
  --   user_correction —— PM 当场纠正过我（最强）
  --   merged          —— 改动真的合进 main 了
  --   tests_passed    —— 测试真的跑过了
  --   multi_session   —— 同一现象在 >=2 个独立会话里重现
  -- "Claude 说搞定了" 不在列，永远进不来。
  evidence_kind      text NOT NULL
                       CHECK (evidence_kind IN
                         ('user_correction', 'merged', 'tests_passed', 'multi_session')),
  evidence           jsonb NOT NULL DEFAULT '{}'::jsonb,

  confidence         numeric NOT NULL DEFAULT 0.5
                       CHECK (confidence >= 0 AND confidence <= 1),
  confirmed_count    integer NOT NULL DEFAULT 1,
  -- 后来被推翻的次数。>=2 时 hygiene cron 自动 is_active=false，不用 PM 点。
  contradicted_count integer NOT NULL DEFAULT 0,

  source             text NOT NULL DEFAULT 'auto_distill'
                       CHECK (source IN ('auto_distill', 'imported_memory', 'manual')),
  is_active          boolean NOT NULL DEFAULT true,
  superseded_by      uuid REFERENCES team_lessons(id) ON DELETE SET NULL,

  first_observed_at  timestamptz NOT NULL DEFAULT now(),
  last_confirmed_at  timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT team_lessons_project_scope_ck
    CHECK (scope = 'global' OR project_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_team_lessons_lookup
  ON team_lessons (scope, project_key, is_active, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_team_lessons_active
  ON team_lessons (is_active, last_confirmed_at DESC);

COMMENT ON TABLE team_lessons IS
  '跨窗口教训层。新窗口开启时按当前项目 + 当前活取相关几条注入，不全塞。';
COMMENT ON COLUMN team_lessons.evidence_kind IS
  '硬证据类型。全自动入库下这是唯一的闸门 —— "Claude 说搞定了" 不是证据。';

-- ---------------------------------------------------------------------------
-- 3. 套路层
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS team_skills (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_key           text NOT NULL UNIQUE,
  scope               text NOT NULL CHECK (scope IN ('project', 'global')),
  project_key         text,
  name                text NOT NULL,
  -- 什么时候该用它（给未来窗口做匹配判断）
  description         text NOT NULL,
  preconditions       text[] NOT NULL DEFAULT '{}',
  -- 有序步骤：[{ step: 1, action: '...', why: '...' }]
  procedure           jsonb NOT NULL DEFAULT '[]'::jsonb,
  success_criteria    text[] NOT NULL DEFAULT '{}',
  stop_conditions     text[] NOT NULL DEFAULT '{}',

  -- 安全绳：套路自动上线（PM 拍板），但套路只是说明书。
  -- 步骤里出现花钱 / 对外发布 / 难撤回动作时，distill 置 true，
  -- 执行时仍要 PM 显式 go —— 现有闸门一根不拆。
  requires_approval   boolean NOT NULL DEFAULT true,

  source_session_keys text[] NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'retired')),
  retired_reason      text,

  use_count           integer NOT NULL DEFAULT 0,
  success_count       integer NOT NULL DEFAULT 0,
  fail_count          integer NOT NULL DEFAULT 0,
  last_used_at        timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT team_skills_project_scope_ck
    CHECK (scope = 'global' OR project_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_team_skills_lookup
  ON team_skills (scope, project_key, status);

COMMENT ON TABLE team_skills IS
  '套路层。自动上线（PM 拍板），但 requires_approval 的步骤执行时仍需 PM 显式 go。';

CREATE TABLE IF NOT EXISTS team_skill_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_key     text NOT NULL,
  session_key   text,
  outcome       text NOT NULL CHECK (outcome IN ('success', 'fail', 'abandoned')),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_skill_runs_skill
  ON team_skill_runs (skill_key, created_at DESC);

COMMENT ON TABLE team_skill_runs IS
  '套路每次被用的结果。连续失败达阈值时 hygiene cron 自动下架，不用 PM 点。';

-- ---------------------------------------------------------------------------
-- 教训确认计数器
--
-- 同一条教训在别的会话里又被印证一次时 +1。用数据库函数而不是
-- 「读出来 +1 再写回去」，因为 30+ 个窗口可能同时结束、同时确认同一条，
-- 读改写会互相覆盖，计数悄悄丢失。
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION increment_lesson_confirmation(p_lesson_key text)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE team_lessons
     SET confirmed_count   = confirmed_count + 1,
         last_confirmed_at = now(),
         -- 每次被印证都往上抬一点，但封顶 0.98，永远给推翻留余地
         confidence        = LEAST(confidence + 0.02, 0.98),
         updated_at        = now()
   WHERE lesson_key = p_lesson_key;
$$;

-- ---------------------------------------------------------------------------
-- RLS —— service-role 模板（CLAUDE.md 强约束）
-- ---------------------------------------------------------------------------

ALTER TABLE work_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_lessons    ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_skills     ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_skill_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_full" ON work_sessions FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "service_role_full" ON work_events FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "service_role_full" ON team_lessons FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "service_role_full" ON team_skills FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "service_role_full" ON team_skill_runs FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
