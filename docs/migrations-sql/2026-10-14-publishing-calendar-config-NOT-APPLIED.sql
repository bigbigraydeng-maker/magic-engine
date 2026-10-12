-- Publishing calendar — client-layer quota config + Story role.  >>> NOT APPLIED. <<<
-- Apply only after explicit PM approval. Both columns are optional: the page shows "not configured" without them.
-- Design: docs/specs/2026-10-14-publishing-calendar-design.md

-- 1. The client's own quotas, e.g. {"quota":{"post_per_day":2,"story_per_day":3,"reel_per_week":3}}
alter table public.clients add column if not exists publishing_calendar_config jsonb;

-- 2. What a Story is for in the day (not part of the content fingerprint; filled by the planner).
alter table public.story_items add column if not exists role text
  check (role is null or role in ('inspiration','fact','invite'));

-- Rollback:  alter table public.story_items drop column role;  alter table public.clients drop column publishing_calendar_config;
