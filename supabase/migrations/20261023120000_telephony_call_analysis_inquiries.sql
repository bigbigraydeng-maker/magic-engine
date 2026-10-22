-- Structured customer questions, sourced answers, and their verification counts.
-- Keep the existing service-role-only access policy; these columns contain call-derived customer data.
-- A-level migration: apply only after isolated validation and PM approval.

alter table public.telephony_call_analyses
  add column if not exists inquiries jsonb not null default '[]'::jsonb
    check (jsonb_typeof(inquiries) = 'array'),
  add column if not exists dropped_inquiries integer not null default 0
    check (dropped_inquiries >= 0);
