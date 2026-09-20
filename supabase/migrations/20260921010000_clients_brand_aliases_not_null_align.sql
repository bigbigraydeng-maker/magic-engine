-- Schema-drift fix — clients.brand_aliases
--
-- Drift discovered 2026-09-21 (found while working on an unrelated column):
--   repo migration 20260624010000_client_brand_aliases.sql declares
--     brand_aliases text[]            -- nullable, no default
--   production (glbdnayojixmexgofbsd) actually has
--     brand_aliases text[] NOT NULL DEFAULT '{}'::text[]
--   Confirmed via the PostgREST schema spec: `brand_aliases` is listed in the
--   `clients` required set, i.e. is_nullable = NO. Nobody recorded the ALTER.
--
-- Consequence before this PR: the Brand Aliases settings panel could add
-- aliases but never clear them. PATCH wrote NULL on an empty list, Postgres
-- raised 23502 (not-null violation) and the endpoint returned 500.
--
-- Which side wins: production. NOT NULL DEFAULT '{}' is the better invariant
-- because every reader already collapses NULL and [] to the same thing
-- (isBrandedKeywordWithAliases skips an empty loop and falls through to the
-- domain-root token match; auto-fetch / rankings / crm-touchpoints all test
-- `Array.isArray(x) && x.length > 0`). Removing NULL removes a state that
-- carried no meaning but could crash a write. The PATCH handler now writes
-- `[]` instead of NULL.
--
-- Idempotent: a no-op on production, brings every other environment (local
-- replay, branch databases, a rebuilt-from-scratch database) into line.

UPDATE public.clients
   SET brand_aliases = '{}'::text[]
 WHERE brand_aliases IS NULL;

ALTER TABLE public.clients
  ALTER COLUMN brand_aliases SET DEFAULT '{}'::text[];

ALTER TABLE public.clients
  ALTER COLUMN brand_aliases SET NOT NULL;

-- The 20260624010000 comment documented a NULL-vs-[] distinction that no
-- longer exists (and that no reader ever acted on). Restate it.
COMMENT ON COLUMN public.clients.brand_aliases IS
  'Optional list of brand-name aliases for GSC brand-search recognition. Each entry is matched as a case-insensitive substring against the GSC query. Required for multi-word brands ("CTS Tours" needs ["cts tours"] because the domain-root "ctstours" never matches "cts tours" in token-equality mode). NOT NULL DEFAULT ''{}'' — an empty array means "no aliases configured" and falls back to the domain-root token match.';
