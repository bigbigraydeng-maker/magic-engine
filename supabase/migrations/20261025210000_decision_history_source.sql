-- Adjustment memory: let client_decision_history record where a decision came from.
-- Additive only (3 nullable columns + 1 check + 1 partial unique index). A-level: schema change.
-- No new table, so no new RLS policy; the table already has service-role-only RLS.
-- Rollback: supabase/rollbacks/20261025210000_decision_history_source_rollback.sql
--
-- NULL source_kind = a legacy row written by the Zhuge session flow.

ALTER TABLE public.client_decision_history
  ADD COLUMN IF NOT EXISTS source_kind text,
  ADD COLUMN IF NOT EXISTS source_ref  jsonb,
  ADD COLUMN IF NOT EXISTS goal_id     uuid;

ALTER TABLE public.client_decision_history
  ADD CONSTRAINT client_decision_history_source_kind_check
  CHECK (source_kind IS NULL OR source_kind IN ('zhuge', 'promo_adjustment'));

-- One memory row per adjustment record: a retried write must not create a second row.
CREATE UNIQUE INDEX IF NOT EXISTS client_decision_history_adjustment_uniq
  ON public.client_decision_history ((source_ref->>'adjustment_id'))
  WHERE source_kind = 'promo_adjustment';

COMMENT ON COLUMN public.client_decision_history.source_kind IS
  'Where the decision came from: zhuge | promo_adjustment. NULL = legacy zhuge row.';
COMMENT ON COLUMN public.client_decision_history.source_ref IS
  'Source pointer, e.g. {"plan_id","adjustment_id","goal_id","window_start"}. No customer-private facts.';
COMMENT ON COLUMN public.client_decision_history.goal_id IS
  'Goal the decision was about (no FK: history must outlive goal archiving).';
