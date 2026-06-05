-- ============================================
-- MTC refund failure ledger
-- 2026-06-26  Phase X.S6 — Wei Zheng M-2 fix
-- ============================================
--
-- Before this migration: refundOnFail() logged to console.error and moved on.
-- If the original generation actually had been committed (commit then fail),
-- the customer was over-charged with no audit trail; reconciliation sweeps
-- could not find these silently-failed refunds.
--
-- After: every refundOnFail() that cannot complete writes a row here. An ops
-- script can periodically retry these (or surface them to admin UI) so the
-- "应退未退" condition has a single source of truth.
--
-- Schema choices:
--   - We log the *requested* refund amount + serviceKey + reference_id so a
--     replay can recreate the exact call.
--   - status defaults to 'pending'; the retry sweep flips to 'resolved' or
--     'manual_intervention' depending on outcome.
--   - last_error is free text; the retry loop overwrites it with the most
--     recent attempt.

CREATE TABLE IF NOT EXISTS public.mtc_refund_failures (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  service_key      TEXT        NOT NULL,
  mtc_amount       INTEGER     NOT NULL,
  reference_id     TEXT,
  /** The original reason the underlying job failed (e.g. "openai timeout"). */
  failure_reason   TEXT,
  /** Why the refund itself failed (DB error message). */
  last_error       TEXT,
  status           TEXT        NOT NULL DEFAULT 'pending',
  attempts         INTEGER     NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ,

  CONSTRAINT mtc_refund_failures_status_check
    CHECK (status IN ('pending', 'resolved', 'manual_intervention'))
);

CREATE INDEX IF NOT EXISTS mtc_refund_failures_status_idx
  ON public.mtc_refund_failures(status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS mtc_refund_failures_client_id_idx
  ON public.mtc_refund_failures(client_id);

ALTER TABLE public.mtc_refund_failures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full"
  ON public.mtc_refund_failures FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.mtc_refund_failures IS
  'Phase X.S6 M-2 — durable record of refundOnFail() calls that could not complete. Ops sweep replays pending rows so over-charged customers are never silently lost.';
