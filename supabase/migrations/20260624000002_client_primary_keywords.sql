-- SEO Intelligence + Strategy: FDE-managed primary keywords on clients table.
-- Priority order: clients.primary_keywords (highest) > master_briefs.keyword_seeds > none.
-- Mirrors the clients.competitor_domains pattern (migration 20260623000001).

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS primary_keywords TEXT[];

COMMENT ON COLUMN clients.primary_keywords IS
  'FDE-managed list of primary business keywords (lowercased, trimmed). '
  'Highest priority source for keyword intent: SEO Intelligence main metrics, '
  'AI Tracker question generation, GEO Composer, Blog topic selection, etc. '
  'Falls back to master_briefs.keyword_seeds when null/empty.';
