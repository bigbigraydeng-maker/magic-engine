-- SEO Intelligence: FDE-managed competitor domains on clients table.
-- Priority order: clients.competitor_domains (highest) > master_briefs.competitor_domains > DataForSEO auto-discovery.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS competitor_domains TEXT[];

COMMENT ON COLUMN clients.competitor_domains IS
  'FDE-managed list of competitor domains (bare domain, no protocol). '
  'Highest priority source for SEO Intelligence gap analysis.';
