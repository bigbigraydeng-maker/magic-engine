-- ============================================================================
-- Industry AI Visibility Archive
--   Industry × Question × Platform × Time time-series database
-- ----------------------------------------------------------------------------
-- Strategic purpose:
--   Build an Australia/New Zealand industry-level AI visibility time-series
--   database that captures brand recommendations across major AI platforms
--   (ChatGPT, Google AI Overview) and Google organic SERP for the same
--   question set, every week.
--
--   The data is non-recoverable — historical AI answers are not archived by
--   any platform, so the only way to own this data is to start collecting
--   today. Long-term destination is Yellowbook intelligence platform; for
--   now data lives in ME Supabase.
--
-- Naming note:
--   The existing `ai_visibility_queries / runs / snapshots` tables in this
--   database belong to the CLIENT-level AI Tracker module (each row tied to
--   a specific client_id). This migration creates the INDUSTRY-level archive
--   under the `industry_ai_visibility_*` prefix to keep the two products
--   clearly separated:
--
--     ai_visibility_*           = client-level (existing AI Tracker)
--     industry_ai_visibility_*  = industry-level archive (this migration)
--
-- Tables:
--   1. industry_ai_visibility_questions  — locked question library
--   2. industry_ai_visibility_snapshots  — per-(question, platform, week) captures
--   3. industry_ai_visibility_runs       — batch collection log
--
-- Access:
--   Admins + FDE only (server-side guarded via guardAdmin in API routes).
--   No RLS — all reads/writes gated by API layer.
-- ============================================================================

-- ---------- Table 1: questions library --------------------------------------
-- The canonical question set. Once a question is "locked" (locked_at set),
-- the question_text must never change — changing it would break the time
-- series. Add new questions instead. Deprecate by setting is_active=false.

CREATE TABLE industry_ai_visibility_questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Categorization
  industry_code   text NOT NULL,   -- 'inbound_tour' | 'outbound_tour' | 'migration' | 'restaurant' | 'real_estate'
  intent_layer    text NOT NULL,   -- 'discovery' | 'comparison' | 'scenario' | 'trust' | 'action' | 'visa_path' | 'first_home' | 'investor' | 'overseas_buyer' | 'sell' | 'local_expert' | etc.
  geo_scope       text NOT NULL,   -- 'national' | 'city'
  country         text,            -- 'nz' | 'au' (null = cross-country)
  city            text,            -- 'auckland' | 'sydney' etc.  (null when geo_scope = 'national')
  language        text NOT NULL,   -- 'en' | 'zh'

  -- The question itself
  question_text   text NOT NULL,
  question_hash   text NOT NULL UNIQUE,   -- sha256(question_text) to prevent dup
  platforms       text[] NOT NULL DEFAULT ARRAY['chatgpt','google_ai_overview','google_serp'],

  -- Lifecycle
  is_active       boolean NOT NULL DEFAULT true,
  locked_at       timestamptz,           -- non-null = collection has started; question_text immutable
  created_at      timestamptz NOT NULL DEFAULT now(),
  notes           text,

  -- Sanity guard: city must be present when geo_scope = 'city'
  CONSTRAINT iav_q_city_required CHECK (
    (geo_scope = 'city' AND city IS NOT NULL) OR
    (geo_scope = 'national' AND city IS NULL)
  )
);

CREATE INDEX iav_q_industry_active   ON industry_ai_visibility_questions (industry_code) WHERE is_active = true;
CREATE INDEX iav_q_geo               ON industry_ai_visibility_questions (country, city)  WHERE is_active = true;

COMMENT ON TABLE industry_ai_visibility_questions IS
  'Locked question library for Industry AI Visibility Archive. Once locked_at is set, question_text is immutable to preserve time-series integrity. Distinct from ai_visibility_queries (client-level AI Tracker).';
COMMENT ON COLUMN industry_ai_visibility_questions.locked_at IS
  'When non-null, the question has at least one snapshot — text must NEVER be changed. Deprecate by setting is_active=false.';

-- ---------- Table 2: snapshots ----------------------------------------------
-- One row per (question, platform, collection moment). Stores both the raw
-- platform response (for re-parsing later if extraction logic improves) and
-- structured extracted data (for fast dashboard queries).

CREATE TABLE industry_ai_visibility_snapshots (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id          uuid NOT NULL REFERENCES industry_ai_visibility_questions(id) ON DELETE CASCADE,

  -- When + which platform
  platform             text NOT NULL,        -- 'chatgpt' | 'google_ai_overview' | 'google_serp' | 'xiaohongshu' (future)
  collected_at         timestamptz NOT NULL DEFAULT now(),
  week_of              date NOT NULL,        -- ISO week start (Monday), the primary time-axis bucket

  -- Raw response (for future re-parsing if extraction logic improves)
  raw_response         jsonb,                -- whole platform return — shape varies by platform

  -- ─── Common extracted fields (all platforms) ───
  brands_mentioned     text[] NOT NULL DEFAULT ARRAY[]::text[],
  top3_brands          text[] NOT NULL DEFAULT ARRAY[]::text[],

  -- ─── AI-platform specific (chatgpt, google_ai_overview) ───
  ai_answer_text       text,                 -- the AI's full text answer (preserved verbatim)
  ai_citation_sources  text[],               -- URLs the AI cited

  -- ─── Google SERP specific ───
  serp_organic_top10   jsonb,                -- array of {position, title, url, description}
  serp_local_pack      jsonb,                -- array of {name, rating, review_count, address}
  serp_paid_domains    text[],
  serp_people_also_ask text[],               -- PAA questions — free reverse-question discovery

  -- ─── Metadata ───
  model_version        text,                 -- 'gpt-4o-mini' | 'dataforseo-serp-organic-live' etc.
  tokens_used          int,                  -- for chatgpt
  cost_usd             numeric(10,4),        -- per-call cost estimate
  collection_run_id    uuid,                 -- FK to industry_ai_visibility_runs (added below)
  parse_confidence     real,                 -- 0..1, brand-extraction confidence

  -- Error tracking
  error_code           text,                 -- null on success
  error_message        text
);

CREATE INDEX iav_snap_q_p_week        ON industry_ai_visibility_snapshots (question_id, platform, week_of DESC);
CREATE INDEX iav_snap_week            ON industry_ai_visibility_snapshots (week_of DESC);
CREATE INDEX iav_snap_run             ON industry_ai_visibility_snapshots (collection_run_id);
CREATE INDEX iav_snap_brands_gin      ON industry_ai_visibility_snapshots USING gin (brands_mentioned);

COMMENT ON TABLE industry_ai_visibility_snapshots IS
  'One row per (question, platform, collection moment). Raw response preserved for re-parsing; structured fields drive dashboards.';
COMMENT ON COLUMN industry_ai_visibility_snapshots.week_of IS
  'ISO week start (Monday). Use date_trunc(''week'', collected_at)::date when inserting.';

-- ---------- Table 3: collection runs ----------------------------------------
-- A run = one batch execution. Cron triggers one run per week; admins can
-- also trigger manual runs from the UI.

CREATE TABLE industry_ai_visibility_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  week_of             date NOT NULL,
  status              text NOT NULL DEFAULT 'running',  -- 'running' | 'completed' | 'partial' | 'failed'

  -- Scope
  industries_scope    text[],                -- which industries this run covered (null = all)
  platforms_scope     text[] NOT NULL,       -- which platforms this run covered

  -- Counters
  questions_attempted int NOT NULL DEFAULT 0,
  questions_ok        int NOT NULL DEFAULT 0,
  questions_failed    int NOT NULL DEFAULT 0,
  snapshots_written   int NOT NULL DEFAULT 0,

  -- Cost
  total_cost_usd      numeric(10,4),

  -- Triggering context
  triggered_by        text NOT NULL DEFAULT 'cron',     -- 'cron' | 'admin_manual'
  triggered_by_user   text,                  -- email of admin if manual
  duration_seconds    int,
  error_message       text
);

CREATE INDEX iav_runs_week     ON industry_ai_visibility_runs (week_of DESC);
CREATE INDEX iav_runs_started  ON industry_ai_visibility_runs (started_at DESC);

COMMENT ON TABLE industry_ai_visibility_runs IS
  'Batch execution log for Industry AI Visibility collection. One row per cron tick or manual trigger.';

-- ---------- FK back-reference from snapshots -> runs -----------------------
ALTER TABLE industry_ai_visibility_snapshots
  ADD CONSTRAINT iav_snap_run_fk
  FOREIGN KEY (collection_run_id) REFERENCES industry_ai_visibility_runs(id) ON DELETE SET NULL;
