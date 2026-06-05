-- ============================================
-- Signup bonus email-level dedup
-- 2026-06-26  Phase X.S3 — Wei Zheng H2 fix
-- ============================================
--
-- Old behaviour: grantSignupBonus used clients.email_verified_at as the
-- idempotency key. Since each fresh self_serve sign-up creates a NEW
-- clients row (with its own email_verified_at), one person could:
--   1. sign up as alice@gmail.com   → bonus #1 (500 MTC on client A)
--   2. sign up as alice+1@gmail.com → bonus #2 (500 MTC on client B)
--   3. sign up as a.l.i.c.e@gmail.com → bonus #3 (500 MTC on client C)
-- All three deliver to the same Gmail inbox; the system pays 1500 MTC
-- to one person.
--
-- New behaviour: a separate signup_bonus_grants table keyed by the
-- canonical email form (Gmail dot/+alias collapsed by lib/auth/email.ts).
-- The first call to grantSignupBonus INSERTs this row; subsequent calls
-- for any alias of the same Gmail address hit the unique-constraint and
-- noop. The clients.email_verified_at column is preserved for compat
-- but no longer drives the bonus decision.

CREATE TABLE IF NOT EXISTS public.signup_bonus_grants (
  email_canonical  TEXT        PRIMARY KEY,
  client_id        UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  granted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mtc_amount       INTEGER     NOT NULL DEFAULT 500,
  /** Cached original (lower-cased but not Gmail-normalised) for audit lookups. */
  email_lower      TEXT        NOT NULL,
  /** purchase_id for the bonus_500 batch — lets us join back to mtc_purchases. */
  purchase_id      UUID        REFERENCES public.mtc_purchases(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.signup_bonus_grants IS
  'Phase X.S3 H2 — one row per canonical email that has ever received the welcome bonus. Prevents Gmail aliasing from collecting multiple 500-MTC grants.';

CREATE INDEX IF NOT EXISTS signup_bonus_grants_client_id_idx
  ON public.signup_bonus_grants(client_id);

CREATE INDEX IF NOT EXISTS signup_bonus_grants_email_lower_idx
  ON public.signup_bonus_grants(email_lower);

-- Service-role-only; no client_portal_users tier should write this directly.
ALTER TABLE public.signup_bonus_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full"
  ON public.signup_bonus_grants FOR ALL TO service_role
  USING (true) WITH CHECK (true);
