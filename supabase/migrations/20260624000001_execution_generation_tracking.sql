-- Phase: Kanban Content Workbench UX hardening
--
-- Adds generation lifecycle tracking to execution_items so the UI can
-- distinguish "actively generating" from "stale in_progress / failed".
--
-- Background:
--   When FDE clicks "生成这条内容" on a kanban card, we want to mark the
--   item in_progress *immediately* so the card reflects generation state
--   even after page refresh. But if generation fails (AI timeout, network
--   drop, etc.) the previous design left the item stuck in_progress forever
--   with no way to surface the error.
--
--   These two columns encode the real generation lifecycle:
--     generation_started_at — wall-clock when the latest generation started
--     generation_error      — populated on failure; cleared on next start /
--                             on successful save-to-board completion
--
--   The UI uses (started_at, error, status) to render:
--     • "制作中" — started_at within 10 min AND error IS NULL
--     • "失败 [重试]" — error IS NOT NULL
--     • "生成超时" — started_at > 10 min ago AND error IS NULL AND
--                    no completion log (defensive: shouldn't normally happen)

ALTER TABLE public.execution_items
  ADD COLUMN IF NOT EXISTS generation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS generation_error      text;

COMMENT ON COLUMN public.execution_items.generation_started_at IS
  'Wall-clock when the latest content generation started. NULL = never tried. UI uses (now - this) to detect stale in_progress.';

COMMENT ON COLUMN public.execution_items.generation_error IS
  'Populated when the latest generation failed. NULL = no failure / cleared on next start. UI shows "失败 [重试]" badge when set.';

-- Index for kanban "currently generating" queries (rare but cheap).
CREATE INDEX IF NOT EXISTS execution_items_generation_started_at_idx
  ON public.execution_items (generation_started_at)
  WHERE generation_started_at IS NOT NULL;
