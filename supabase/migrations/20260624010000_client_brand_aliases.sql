-- A2.2 P0 fix — clients.brand_aliases
--
-- Background:
--   A2.2 ships brand_search_volume that reads GSC clicks for brand-tagged
--   queries. The naive identifier is the domain root (e.g. "ctstours" from
--   "ctstours.co.nz") matched via isBrandedKeyword's token-equality rule.
--
--   Live-data audit (2026-06-04): CTS Tours NZ's top GSC queries are
--   "cts tours" (127 clicks), "china travel service nz" (21), "cts travel"
--   (13), "china travel service" (9). The domain-root "ctstours" matches
--   NONE of these because token-equality demands an exact token "ctstours".
--   We would surface ~0 brand clicks for CTS instead of ~180.
--
--   Multi-word brands need an explicit alias list. brand_aliases is a
--   TEXT[] of substrings that, when found inside a GSC query, mark it as
--   a brand search. CTS would be configured with
--     ["cts tours", "cts travel", "china travel service", "ctsnz"]
--   and the auto-fetch tier-1 path will sum clicks across all matches.
--
-- Lifecycle:
--   NULL  → fall back to isBrandedKeyword(query, domainRoot)  (legacy)
--   []    → treated same as NULL (defensive)
--   [...] → substring match (case-insensitive, normalised)

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS brand_aliases text[];

COMMENT ON COLUMN public.clients.brand_aliases IS
  'Optional list of brand-name aliases for GSC brand-search recognition. Each entry is matched as a case-insensitive substring against the GSC query. Required for multi-word brands ("CTS Tours" needs ["cts tours"] because the domain-root "ctstours" never matches "cts tours" in token-equality mode). NULL or empty array falls back to domain-root token match.';
