-- outbound_prospects: Phase 35 司马徽 outbound prospecting pipeline
-- Created: 2026-07-06 | Internal sales tool — customers never see this data.
--
-- Pipeline stages (status column):
--   discovered      → pulled from business listings search, no audit yet
--   audited         → rule-based audit ran, below qualification threshold
--   qualified       → prospect_score >= threshold, eligible for AI analysis
--   analyzed        → Zhangqian prospect-mode scan completed (ai_report set)
--   outreach_ready  → outreach email drafted, awaiting human review
--   contacted       → outreach sent
--   replied         → prospect responded
--   converted       → became a client (linked via converted_client_id)
--   archived        → disqualified / dead lead

create table if not exists outbound_prospects (
  id                  uuid primary key default gen_random_uuid(),

  -- Step 1: discovery (DataForSEO Business Listings)
  business_name       text        not null,
  industry            text        not null,           -- seed industry key, e.g. 'flooring'
  city                text        not null,
  country             text        not null default 'AU',  -- AU | NZ
  domain              text,                            -- null = no website (disqualifier)
  website_url         text,
  phone               text,
  email               text,                            -- publicly listed only
  facebook_url        text,
  instagram_url       text,
  place_id            text,                            -- Google place_id (dedup key)
  rating              numeric(2,1),                    -- 1.0–5.0
  review_count        integer,
  raw_listing         jsonb,                           -- full listing payload for later enrichment

  -- Step 2+3: rule-based audit + opportunity score (no AI)
  audit               jsonb,                           -- ProspectAudit JSON
  prospect_score      integer,                         -- 0–100
  score_breakdown     jsonb,                           -- per-signal contributions

  -- Step 4+5: AI analysis + sales assets (qualified prospects only)
  ai_report           jsonb,                           -- Zhangqian prospect-mode output
  outreach_email      jsonb,                           -- { subject, body, generated_at }

  status              text        not null default 'discovered'
    check (status in ('discovered', 'audited', 'qualified', 'analyzed',
                      'outreach_ready', 'contacted', 'replied', 'converted', 'archived')),
  notes               text,                            -- sales team notes
  converted_client_id uuid references clients(id) on delete set null,

  created_at          timestamptz not null default now(),
  audited_at          timestamptz,
  contacted_at        timestamptz,
  updated_at          timestamptz not null default now()
);

-- Dedup: one row per Google place; domain as fallback identity
create unique index if not exists outbound_prospects_place_id
  on outbound_prospects (place_id) where place_id is not null;
create index if not exists outbound_prospects_domain
  on outbound_prospects (domain) where domain is not null;

-- Sales workflow: filter by status + industry, newest / highest score first
create index if not exists outbound_prospects_status_score
  on outbound_prospects (status, prospect_score desc nulls last);
create index if not exists outbound_prospects_industry_city
  on outbound_prospects (industry, city);

comment on table  outbound_prospects                is 'Phase 35 outbound prospecting pipeline (internal sales tool)';
comment on column outbound_prospects.status         is 'discovered | audited | qualified | analyzed | outreach_ready | contacted | replied | converted | archived';
comment on column outbound_prospects.prospect_score is 'Rule-based opportunity score 0-100; >= threshold moves to qualified';

alter table outbound_prospects enable row level security;
do $$ begin
  create policy "service_role_full" on outbound_prospects for all using (true);
exception when duplicate_object then null; end $$;
