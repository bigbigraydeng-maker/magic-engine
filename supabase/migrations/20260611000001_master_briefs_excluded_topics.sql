-- Add excluded_topics to master_briefs
-- Purpose: per-client list of product category root words that should NOT appear
-- in keyword gap results (e.g. Oztop sells flooring but not shutters/blinds).
-- Singular root words — substring matching handles plurals automatically.
-- Example: ['shutter', 'blind', 'curtain', 'plantation', 'window treatment']
--
-- ⚠️  DAPE HARD CONSTRAINT: do NOT apply this migration without PM approval.
--     File is committed so the schema intent is visible in code review, but
--     the column must be added to the live DB only after PM confirms.

ALTER TABLE master_briefs
  ADD COLUMN IF NOT EXISTS excluded_topics text[] DEFAULT NULL;

COMMENT ON COLUMN master_briefs.excluded_topics IS
  'Singular root words for product categories this client does NOT sell. '
  'Used by competitors-gap route to filter out irrelevant gap keywords. '
  'Example: {shutter,blind,curtain,plantation} for a flooring-only retailer.';
