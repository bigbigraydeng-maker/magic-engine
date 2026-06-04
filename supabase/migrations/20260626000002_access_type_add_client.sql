-- ============================================
-- access_type: add 'client' as the canonical paid-customer value
-- 2026-06-26  Phase X.S2 — Tiered backend authz
-- ============================================
--
-- Background: client_portal_users.access_type currently has 5 values:
--   portal       — legacy /portal route users
--   dashboard    — early /dashboard customers
--   fde          — internal Frontline Deployment Engineer accounts
--   both         — portal + dashboard
--   self_serve   — auto-created from /discover signup
--
-- Adding 'client' as the canonical value for a paid customer entering /dashboard
-- (the new self-serve → paid upgrade path). Authz code maps:
--   {dashboard, fde, both, client} → tier='paid_client'
--   {self_serve}                   → tier='self_serve'
--   {portal}                       → no /dashboard access (portal only)
--
-- The existing values are kept as legacy aliases so live data is unaffected.
-- New writes from the FDE UI should use 'client'; the self-serve → paid
-- upgrade flow (still to be built in Step 3 / H1) will UPDATE rows in place
-- from 'self_serve' to 'client'.

ALTER TABLE public.client_portal_users
  DROP CONSTRAINT IF EXISTS client_portal_users_access_type_check;

ALTER TABLE public.client_portal_users
  ADD CONSTRAINT client_portal_users_access_type_check
    CHECK (access_type IN ('portal', 'dashboard', 'fde', 'both', 'self_serve', 'client'));

COMMENT ON COLUMN public.client_portal_users.access_type IS
  'Access tier for this email × client pairing. Canonical paid value is ''client''; ''dashboard''/''fde''/''both'' are legacy paid aliases. ''self_serve'' = free signup tier. ''portal'' = legacy /portal route.';
