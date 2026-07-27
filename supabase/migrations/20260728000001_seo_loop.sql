-- Weekly SEO loop: competitor keyword positions + weekly topic candidates.
--
-- NOT APPLIED BY THE AUTHOR. Per CLAUDE.md, applying a migration is a PM
-- decision. Apply with the Supabase MCP `apply_migration` only after PM says go.
--
-- RLS uses the service-role template mandated by CLAUDE.md. It deliberately
-- does NOT reference clients.workspace_id, client_team, auth.uid() or
-- auth.jwt() — none of those exist in this project, and referencing them is
-- what silently rolled back 13 earlier migrations.

-- ---------------------------------------------------------------------------
-- 1. competitor_keyword_snapshots
--
-- Mirrors keyword_snapshots but for a competitor domain. The existing
-- `competitor_snapshots` table is a per-run usage log whose top_keywords JSON
-- carries no positions, so it cannot answer "who ranks where" — that is why
-- this table exists rather than extending that one.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competitor_keyword_snapshots (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  competitor_domain  TEXT NOT NULL,
  keyword            TEXT NOT NULL,
  position           INTEGER,
  search_volume      INTEGER,
  keyword_difficulty NUMERIC(5,2),
  cpc                NUMERIC(10,2),
  competition        NUMERIC(5,4),
  intent             TEXT,
  source             TEXT NOT NULL DEFAULT 'dataforseo',
  location_code      INTEGER NOT NULL,
  semrush_db         TEXT,
  snapshot_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  measured_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS competitor_keyword_snapshots_unique
  ON competitor_keyword_snapshots (client_id, competitor_domain, keyword, location_code, snapshot_date);

CREATE INDEX IF NOT EXISTS competitor_keyword_snapshots_client_date
  ON competitor_keyword_snapshots (client_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS competitor_keyword_snapshots_keyword
  ON competitor_keyword_snapshots (client_id, keyword);

ALTER TABLE competitor_keyword_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON competitor_keyword_snapshots FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2. seo_topic_candidates
--
-- Three suggested topics per client per week. status starts at 'candidate' and
-- only a human moves it forward — this table is the hand-off point between the
-- automated loop and human approval. Nothing auto-publishes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seo_topic_candidates (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  week_of              DATE NOT NULL,
  keyword              TEXT NOT NULL,
  source               TEXT NOT NULL
                         CHECK (source IN ('opportunity_gap','striking_distance','ai_visibility_gap')),
  priority             INTEGER NOT NULL DEFAULT 1,
  my_position          INTEGER,
  search_volume        INTEGER,
  keyword_difficulty   NUMERIC(5,2),
  competitors_ranking  TEXT[] NOT NULL DEFAULT '{}',
  reason               TEXT NOT NULL,
  -- candidate -> a human approves -> drafting -> draft lands in blog_posts
  status               TEXT NOT NULL DEFAULT 'candidate'
                         CHECK (status IN ('candidate','approved','rejected','drafted')),
  blog_post_id         UUID REFERENCES blog_posts(id) ON DELETE SET NULL,
  reviewed_at          TIMESTAMPTZ,
  reviewed_by          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS seo_topic_candidates_unique
  ON seo_topic_candidates (client_id, week_of, keyword);

CREATE INDEX IF NOT EXISTS seo_topic_candidates_client_week
  ON seo_topic_candidates (client_id, week_of DESC);

CREATE INDEX IF NOT EXISTS seo_topic_candidates_status
  ON seo_topic_candidates (status) WHERE status = 'candidate';

ALTER TABLE seo_topic_candidates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON seo_topic_candidates FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
