-- Publishing calendar — client-layer quota config + Story role.  APPLIED to prod 2026-10-13 14:33 UTC (migration 20261014_publishing_calendar_config).
-- Both columns are optional and nullable (no default). Rollback: alter table public.story_items drop column role; alter table public.clients drop column publishing_calendar_config;
-- Design: docs/specs/2026-10-14-publishing-calendar-design.md

-- 1. The client's own quotas, e.g. {"quota":{"post_per_day":2,"story_per_day":3,"reel_per_week":3}}
alter table public.clients add column if not exists publishing_calendar_config jsonb;

-- 2. What a Story is for in the day (not part of the content fingerprint; filled by the planner).
alter table public.story_items add column if not exists role text
  check (role is null or role in ('inspiration','fact','invite','itinerary','price_inclusions','reason','acquisition'));

-- Rollback:  alter table public.story_items drop column role;  alter table public.clients drop column publishing_calendar_config;

-- Backfill for the current CTS pack (75 号 confirmed, by item number, not by date): run only after the columns exist and PM says go.
--   01,04,07,10,13,16 = 08:30 inspiration; 02,05,08,11,14,17 = 13:00 fact; 03,06,09,12,15,18 = 20:00 invite
--   i.e. by slot: update story_items set role = case (extract(hour from slot_at at time zone 'Pacific/Auckland'))
--        when 8 then 'inspiration' when 13 then 'fact' when 20 then 'invite' end
--        where pack_id = '<pack id>' and role is null;
