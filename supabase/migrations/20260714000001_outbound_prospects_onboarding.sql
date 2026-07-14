-- outbound_prospects: add `onboarding` status (P35.12 $19.90 tripwire, 2026-07-14)
--
-- The $19.90 tripwire funnel adds a stage between a warm reply and a won $990
-- deal: a prospect who said "yes", paid the one-off $19.90 onboarding, and is
-- now being delivered their Digital Foundation package. They are a paying,
-- warm potential client — no longer a cold prospect, not yet a $990 `converted`
-- client. In the pilot, an FDE moves the row here by hand after confirming the
-- manually-sent payment link was paid (sending is never automated).
--
-- Pipeline order: … replied → onboarding → converted (won the $990 build).
--
-- ⚠️ PM applies this migration (workers never self-apply). Ships in the same PR
-- as the code that writes the status, but merge is two-step: apply first, then
-- the code that can set status='onboarding' goes live.

alter table outbound_prospects drop constraint if exists outbound_prospects_status_check;
alter table outbound_prospects add constraint outbound_prospects_status_check
  check (status in ('discovered', 'audited', 'qualified', 'analyzed',
                    'outreach_ready', 'contacted', 'replied', 'onboarding',
                    'converted', 'archived', 'opted_out'));

comment on column outbound_prospects.status is
  'discovered | audited | qualified | analyzed | outreach_ready | contacted | replied | onboarding ($19.90 paid, being delivered) | converted (won $990) | archived | opted_out (permanent do-not-contact)';
