-- P22.E.S2: seo_patrol_findings table
-- Stores SEO opportunity findings output by the SEO patrol rule engine
-- (cron, no AI). Consumed downstream by 诸葛亮 → persistZhugeActions() which
-- writes pending execution_items (source='zhuge') onto the SEO kanban column.
--
-- Distinct from anomaly_signals (P22.D): anomaly_signals detects metric
-- DROPS from flywheel_metrics; seo_patrol_findings detects OPPORTUNITIES
-- (low-CTR titles, missing internal links, stale content, uncovered keywords)
-- from per-keyword keyword_snapshots + per-page gsc_performance_snapshots.
--
-- Reference: ROADMAP.md § Phase 22.E · docs/seo-sop-implementation-design.md

-- ── Enum: seo patrol rule id ──────────────────────────────────────────────────
-- One value per diagnostic rule. Keep in sync with src/lib/seo-patrol/rules.ts.

CREATE TYPE seo_patrol_rule AS ENUM (
  'low_ctr_title',        -- R1: ranking P2-P3 but CTR below position benchmark
  'missing_internal_link',-- R2: page has GSC impressions but no internal link to a money page
  'stale_content',        -- R3: ranking dropped > 3 positions over ~30 days
  'keyword_opportunity',  -- R4: high-volume low-KD keyword not yet covered
  'not_indexed'           -- R5: GSC "discovered - currently not indexed" > 7 days
);

-- ── Table: seo_patrol_findings ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS seo_patrol_findings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Which rule fired (matches SeoPatrolRule.id in the rule engine)
  rule_id         seo_patrol_rule NOT NULL,

  -- The subject of the finding: a keyword (R1/R3/R4) and/or a page URL (R2/R5).
  -- At least one is non-null depending on the rule.
  keyword         TEXT,
  url             TEXT,

  -- Snapshot signals captured at detection time (all nullable; which are set
  -- depends on the rule). These drive both the human-readable summary and the
  -- 诸葛亮 decision context.
  position        NUMERIC,          -- current SERP position (R1/R3)
  ctr             NUMERIC,          -- actual GSC CTR, 0..1 (R1)
  ctr_benchmark   NUMERIC,          -- expected CTR for that position, 0..1 (R1)
  search_volume   INTEGER,          -- monthly search volume (R4)
  keyword_difficulty NUMERIC,       -- DataForSEO KD 0..100 (R4)
  position_delta  NUMERIC,          -- positions dropped since reference (R3)

  -- The action_type this finding should become if 诸葛亮 acts on it
  -- (e.g. 'seo.publish_blog', 'seo.refresh_blog'). Maps to flywheel vocabulary.
  suggested_action_type TEXT NOT NULL,

  -- Human-readable summary for kanban card + AI context
  -- e.g. "Ranking #3 but CTR 2.1% (benchmark 10%) — rewrite title"
  description     TEXT NOT NULL,

  -- Downstream processing state
  -- 'fresh'    = awaiting 诸葛亮 decision
  -- 'actioned' = 诸葛亮 created an execution_item for it
  -- 'dismissed'= 诸葛亮 judged it not worth acting on
  status          TEXT NOT NULL DEFAULT 'fresh'
                  CHECK (status IN ('fresh', 'actioned', 'dismissed')),

  -- Link back to the zhuge_session that consumed this finding (P24.A)
  zhuge_session_id UUID REFERENCES zhuge_sessions(id) ON DELETE SET NULL,

  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One open finding per (client, rule, keyword, url) — re-running the patrol the
-- same day refreshes rather than duplicates. NULLs are treated as distinct by
-- default in Postgres, so coalesce keyword/url for a stable conflict target.
CREATE UNIQUE INDEX uq_seo_patrol_findings_open
  ON seo_patrol_findings (
    client_id,
    rule_id,
    COALESCE(keyword, ''),
    COALESCE(url, '')
  )
  WHERE status = 'fresh';

CREATE INDEX idx_seo_patrol_findings_client
  ON seo_patrol_findings(client_id);

CREATE INDEX idx_seo_patrol_findings_fresh
  ON seo_patrol_findings(status, detected_at DESC)
  WHERE status = 'fresh';

ALTER TABLE seo_patrol_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full" ON seo_patrol_findings FOR ALL USING (true);

COMMENT ON TABLE seo_patrol_findings IS
  'SEO opportunity findings from the SEO patrol rule engine (P22.E). '
  'status=fresh → awaiting 诸葛亮 decision; actioned → execution_item created; dismissed → no-op. '
  'Distinct from anomaly_signals: detects opportunities (low CTR / missing links / uncovered keywords), not metric drops.';
