-- outbound_prospects: add terminal `opted_out` status (板桥 P0-1, 2026-07-06)
--
-- The compliance footer promises "reply unsubscribe and we won't contact you
-- again" — that promise needs a real suppression state. `opted_out` rows are
--永久终态: the discover dedup (place_id / domain match against ALL existing
-- rows) guarantees a re-imported listing can never create a fresh contactable
-- row for an opted-out business, and the review queue never surfaces them.
-- AU Spam Act allows 5 business days to honour an opt-out; marking the row
-- immediately in the console satisfies it.

alter table outbound_prospects drop constraint if exists outbound_prospects_status_check;
alter table outbound_prospects add constraint outbound_prospects_status_check
  check (status in ('discovered', 'audited', 'qualified', 'analyzed',
                    'outreach_ready', 'contacted', 'replied', 'converted',
                    'archived', 'opted_out'));

comment on column outbound_prospects.status is
  'discovered | audited | qualified | analyzed | outreach_ready | contacted | replied | converted | archived | opted_out (permanent do-not-contact)';
