-- Rollback for 20261025210000_decision_history_source.sql. Run by hand; never by the migration runner.
-- Drops only what that migration added. Decision text and outcome of existing rows are untouched;
-- rows written with source_kind = 'promo_adjustment' just lose their source pointer.
DROP INDEX IF EXISTS public.client_decision_history_adjustment_uniq;
ALTER TABLE public.client_decision_history
  DROP CONSTRAINT IF EXISTS client_decision_history_source_kind_check;
ALTER TABLE public.client_decision_history
  DROP COLUMN IF EXISTS goal_id,
  DROP COLUMN IF EXISTS source_ref,
  DROP COLUMN IF EXISTS source_kind;
