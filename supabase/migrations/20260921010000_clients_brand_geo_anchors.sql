-- clients.brand_geo_anchors — geo evidence for AI-visibility brand matching
--
-- Background (2026-09-20 CTS audit):
--   `resolveClientBrandRank` accepts any configured brand alias as proof the
--   client was mentioned. CTS Tours NZ has the alias "china travel service",
--   which is the GROUP name the whole China Travel Service group trades
--   under — including "China Travel Service (Australia) Pty Ltd" in Sydney
--   and the Hong Kong arm. CTS only serves New Zealand, so 15 of 1,768
--   ranked historical answers credited CTS with an Australian sibling's
--   mention. Same class of error as the Ray White one fixed in #1823/#1837.
--
--   Dropping the alias is worse: 40 answers write the client's own name as
--   "China Travel Service (NZ) Ltd" and would lose their rank.
--
-- What this column holds:
--   Words that prove an answer is talking about the client's OWN market —
--   e.g. CTS: {"new zealand","nz","aotearoa","auckland"}. When the list is
--   non-empty, ALIAS evidence only counts in an answer that also carries one
--   of these words. The official brand name and the client's own domain are
--   self-identifying and are never gated.
--
-- Lifecycle:
--   NULL / {} → rule does not fire; matching behaves exactly as before.
--   {...}     → alias-only evidence requires a geo anchor in the text.
--
-- Geography stays client configuration on purpose: no country word lives in
-- src/lib. Same shape as GeoEntityProfile.geoAnchors* in src/lib/geo-module.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS brand_geo_anchors text[];

COMMENT ON COLUMN public.clients.brand_geo_anchors IS
  'Optional list of geo words proving an AI answer is about this client''s own market ("new zealand", "nz", "auckland"). Matched word-bounded against the normalised answer text. When non-empty, evidence that comes ONLY from clients.brand_aliases requires one of these words to appear; the official brand name and clients.domain are never gated. NULL or empty array = rule disabled, matching unchanged.';
