-- Phase 20.A.1 — MTC Foundation
-- Magic Token Coin self-serve billing layer
--
-- 1. Extend clients table (source, stripe_customer_id, email_verified_at)
-- 2. Create mtc_purchases (per-purchase batch, FIFO expiry)
-- 3. Create mtc_ledger  (debit/credit audit trail)
-- 4. Create stripe_events_log (idempotency guard)

-- ── 1. Extend clients ────────────────────────────────────────────────────────

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'fde'
    CHECK (source IN ('fde', 'self_serve')),
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN clients.source IS
  'fde = managed by FDE team; self_serve = registered via /register (MTC Tier 2)';

-- ── 2. mtc_purchases ─────────────────────────────────────────────────────────

CREATE TABLE mtc_purchases (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  stripe_payment_intent_id  TEXT        UNIQUE,           -- Stripe idempotency key
  package_key               TEXT        NOT NULL
                            CHECK (package_key IN ('starter_29', 'growth_79', 'scale_199', 'bonus_100')),
  amount_nzd                NUMERIC(8,2) NOT NULL DEFAULT 0,
  mtc_amount                INT         NOT NULL CHECK (mtc_amount > 0),
  mtc_remaining             INT         NOT NULL CHECK (mtc_remaining >= 0),
  purchased_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at                TIMESTAMPTZ NOT NULL,          -- purchased_at + 12 months
  status                    TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'completed', 'refunded', 'expired')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mtc_purchases_client_active
  ON mtc_purchases(client_id, expires_at)
  WHERE status = 'completed';

COMMENT ON TABLE mtc_purchases IS
  'One row per MTC purchase batch (or bonus grant). FIFO expiry: earliest expires_at consumed first.';

-- ── 3. mtc_ledger ────────────────────────────────────────────────────────────

CREATE TABLE mtc_ledger (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  purchase_id   UUID        REFERENCES mtc_purchases(id) ON DELETE SET NULL,
  direction     TEXT        NOT NULL CHECK (direction IN ('debit', 'credit')),
  service_key   TEXT        NOT NULL,
  -- e.g. 'blog_seo' | 'blog_dual_signal' | 'image_single' | 'image_pack_4'
  -- | 'image_pack_12' | 'reels_video' | 'social_post' | 'social_series'
  -- | 'social_calendar' | 'marketing_plan' | 'keyword_report' | 'geo_directives'
  -- | 'ai_tracker_report' | 'competitor_report' | 'master_brief_update'
  -- | 'bonus_registration'
  mtc_amount    INT         NOT NULL CHECK (mtc_amount > 0),
  reference_id  UUID,                                      -- blog_posts.id / image id / etc.
  source        TEXT        NOT NULL DEFAULT 'auto'
                CHECK (source IN ('auto', 'manual', 'refund', 'bonus')),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mtc_ledger_client
  ON mtc_ledger(client_id, created_at DESC);

COMMENT ON TABLE mtc_ledger IS
  'Full debit/credit audit trail for MTC. Every token movement must have a ledger entry.';

-- ── 4. stripe_events_log ─────────────────────────────────────────────────────

CREATE TABLE stripe_events_log (
  stripe_event_id  TEXT        PRIMARY KEY,   -- Stripe event.id — globally unique
  event_type       TEXT        NOT NULL,
  processed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status           TEXT        NOT NULL CHECK (status IN ('processed', 'skipped', 'failed')),
  error_message    TEXT
);

COMMENT ON TABLE stripe_events_log IS
  'Idempotency guard: each Stripe event.id processed exactly once.';
