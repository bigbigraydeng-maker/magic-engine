-- Phase 21.6 — Token Budget Governance (monthly MTC cap)
-- AI Content Factory cost circuit-breaker.
--
-- Adds an optional per-client monthly MTC spend cap. When NULL, the client
-- falls back to the global default (DEFAULT_MONTHLY_MTC_CAP in src/lib/mtc/types.ts).
-- The budget guard (src/lib/mtc/budget-guard.ts) sums this month's mtc_ledger
-- debits and trips when the sum reaches the cap — preventing runaway Factory spend.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS monthly_mtc_cap INT
    CHECK (monthly_mtc_cap IS NULL OR monthly_mtc_cap > 0);

COMMENT ON COLUMN clients.monthly_mtc_cap IS
  'Phase 21.6: per-client monthly MTC spend cap for AI Factory circuit-breaker. '
  'NULL = use global default (DEFAULT_MONTHLY_MTC_CAP). '
  'Budget guard sums current-month mtc_ledger debits against this value.';
