-- ============================================================================
-- Industry Brand Canonical Dictionary
-- ----------------------------------------------------------------------------
-- Cache the LLM-standardised brand name for each (industry, raw) pair so that
-- repeated SERP/AI-overview snapshots reuse the cached canonical instead of
-- re-querying the LLM every collection cycle.
--
-- Lookup key is (industry_code, raw_lower) — same raw "ctstours" may resolve
-- to different canonicals in different industries ("CTS Tours" in tourism vs
-- something else in finance), so the cache is industry-scoped.
-- ============================================================================

CREATE TABLE industry_brand_canonical (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cache key
  industry_code    text NOT NULL,        -- 'inbound_tour' | 'outbound_tour' | ...
  raw_lower        text NOT NULL,        -- e.g. 'ctstours', 'china travel service (nz) ltd'

  -- Cached result
  canonical_brand  text NOT NULL,        -- e.g. 'CTS Tours', null only via DELETE (we never store null canonical)

  -- Provenance
  source           text NOT NULL,        -- 'llm' | 'manual_override' | 'domain_fallback'
  llm_model        text,                 -- 'claude-haiku-4-5-20251001' when source='llm'
  llm_cost_usd     numeric(10,6),        -- per-call cost contribution
  notes            text,                 -- optional admin override reason

  -- Timestamps
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT industry_brand_canonical_unique UNIQUE (industry_code, raw_lower)
);

CREATE INDEX industry_brand_canonical_industry ON industry_brand_canonical (industry_code);

COMMENT ON TABLE industry_brand_canonical IS
  'Industry-scoped LLM cache for SERP/AI brand normalisation. Same raw key resolves differently per industry to avoid cross-industry collision (e.g. "CTS" in tourism vs finance).';
COMMENT ON COLUMN industry_brand_canonical.raw_lower IS
  'Lowercased input passed to the normaliser (domain or organic-result title). Trim whitespace before insert.';
COMMENT ON COLUMN industry_brand_canonical.source IS
  'llm = LLM normalised; manual_override = admin set canonical_brand by hand; domain_fallback = LLM failed, used cleaned domain';
