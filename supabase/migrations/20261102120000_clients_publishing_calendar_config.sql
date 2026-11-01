-- publishing_calendar_config
--
-- NOT APPLIED by the pull request that added this file.
-- The column already exists in production (added outside this folder on 2026-10-13,
-- migration name 20261014_publishing_calendar_config). This file only documents it
-- so a new environment can create the same column.
--
-- Idempotent. No default. No backfill. No UPDATE. No DELETE. No other column.
-- Applying it where the column already exists does not change any row.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS publishing_calendar_config jsonb;

COMMENT ON COLUMN public.clients.publishing_calendar_config IS
  'Client publishing calendar JSON. quota may hold per-day keys (post_per_day, story_per_day, reel_per_week) and per-week keys (post_per_week, story_per_week, reel_per_week). Missing keys are not zero. weekly_pack, when present, is weekday cadence, not a count.';
