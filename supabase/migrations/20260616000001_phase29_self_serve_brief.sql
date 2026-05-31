-- Phase 29 P29.A.1
-- 1. Extend client_portal_users.access_type to include 'self_serve'
--    (self-registered users who completed signup via /register flow)
-- 2. Add brief_completed_at + brief_fields to clients
--    (tracks when a self-serve client completed their onboarding brief)

-- 1. Extend access_type CHECK constraint
ALTER TABLE client_portal_users
  DROP CONSTRAINT IF EXISTS client_portal_users_access_type_check;

ALTER TABLE client_portal_users
  ADD CONSTRAINT client_portal_users_access_type_check
    CHECK (access_type IN ('portal', 'dashboard', 'fde', 'both', 'self_serve'));

-- 2. Add brief fields to clients
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS brief_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS brief_fields       JSONB;

COMMENT ON COLUMN clients.brief_completed_at IS
  'P29.A: Timestamp when the self-serve client submitted their onboarding brief. NULL = not yet completed.';

COMMENT ON COLUMN clients.brief_fields IS
  'P29.A: JSONB snapshot of the brief answers submitted during self-serve onboarding.';

CREATE INDEX IF NOT EXISTS idx_clients_brief_completed_at
  ON clients(brief_completed_at)
  WHERE brief_completed_at IS NOT NULL;
