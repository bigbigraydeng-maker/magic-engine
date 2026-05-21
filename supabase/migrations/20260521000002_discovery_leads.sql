-- discovery_leads: public-facing free scan lead capture
-- Created: 2026-05-21 | Freemium model launch

create table if not exists discovery_leads (
  id           uuid primary key default gen_random_uuid(),
  url          text        not null,
  name         text,
  email        text        not null,
  status       text        not null default 'new',   -- new | contacted | converted | closed
  notes        text,                                  -- FDE team notes
  created_at   timestamptz not null default now(),
  contacted_at timestamptz
);

-- Index for FDE team workflow: sort by newest, filter by status
create index discovery_leads_status_created
  on discovery_leads (status, created_at desc);

-- Index for dedup check by email
create index discovery_leads_email
  on discovery_leads (email);

comment on table  discovery_leads              is 'Free Discovery scan leads captured from the public landing page';
comment on column discovery_leads.status       is 'new | contacted | converted | closed';
comment on column discovery_leads.contacted_at is 'Timestamp when FDE first reached out to this lead';
