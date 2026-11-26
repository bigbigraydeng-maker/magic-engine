-- Behaviour checks for supabase/migrations/20261117090000_triggered_send_letters.sql (AI 跟进信认领函数与账本守卫).
-- Run on a THROWAWAY local Postgres only, after 20261102130000_triggered_send_ledger.sql and the migration under test
-- (needs roles service_role/anon/authenticated and a minimal public.clients(id uuid primary key)).
-- Expected: 1 claimed, 2 in_flight, 3 claimed, 4 cap_reached, 5 letter_not_authorized, 6 template_mismatch,
-- 7/8 raise, 9 auth_inactive, 10 auth_inactive, 11 inserts a blocked row, 12 raises (bad trigger_key). Run with psql (ON_ERROR_STOP stays off so the raising cases are shown).

\set ON_ERROR_STOP 0
insert into clients values ('11111111-1111-1111-1111-111111111111');
insert into triggered_send_authorizations (request_id, client_id, trigger_key, channel, account, rule, rule_sha256, template_version, template_sha256, daily_cap, proposed_by_email)
values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'crm_ai_followup', 'email', 'cts',
 '{"schedule":{"timezone":"Pacific/Auckland"},"send":{"letters":[{"letter_key":"followup_d7","template_key":"auto-d7","template_version":2,"template_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},{"letter_key":"followup_d14","template_key":"auto-d14","template_version":1,"template_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]}}',
 repeat('c',64), 1, repeat('d',64), 2, 'pm@example.com') returning id \gset auth_
update triggered_send_authorizations set authorized_by_email='pm@example.com', authorized_by_user_id=gen_random_uuid(), authorized_at=now(), live_from=now(), expires_at=now()+interval '30 days' where id = :'auth_id';
update triggered_send_authorizations set activated_at=now() where id = :'auth_id';
select 'auth', authorized_at is not null, activated_at is not null from triggered_send_authorizations where id=:'auth_id';
\echo == 1 claim d7 (claimed)
select outcome from triggered_send_claim_letter(:'auth_id','followup_d7','22222222-2222-2222-2222-222222222222',repeat('e',64),'k1','auto-d7',2,repeat('a',64),repeat('f',64),null,null);
\echo == 2 same again (in_flight)
select outcome from triggered_send_claim_letter(:'auth_id','followup_d7','22222222-2222-2222-2222-222222222222',repeat('e',64),'k2','auto-d7',2,repeat('a',64),repeat('f',64),null,null);
\echo == 3 d14 same contact (claimed)
select outcome from triggered_send_claim_letter(:'auth_id','followup_d14','22222222-2222-2222-2222-222222222222',repeat('e',64),'k3','auto-d14',1,repeat('b',64),repeat('f',64),null,null);
\echo == 4 cap (cap_reached)
select outcome from triggered_send_claim_letter(:'auth_id','followup_d7','33333333-3333-3333-3333-333333333333',repeat('9',64),'k4','auto-d7',2,repeat('a',64),repeat('f',64),null,null);
\echo == 5 unknown letter (letter_not_authorized)
select outcome from triggered_send_claim_letter(:'auth_id','followup_d21','33333333-3333-3333-3333-333333333333',repeat('9',64),'k5','auto-d7',2,repeat('a',64),repeat('f',64),null,null);
\echo == 6 template mismatch
select outcome from triggered_send_claim_letter(:'auth_id','followup_d7','33333333-3333-3333-3333-333333333333',repeat('9',64),'k6','auto-d7',3,repeat('a',64),repeat('f',64),null,null);
\echo == 7 direct insert sent (must fail)
insert into triggered_sends (client_id,trigger_key,channel,contact_id,dedupe_scope,status) values ('11111111-1111-1111-1111-111111111111','crm_ai_followup','email',gen_random_uuid(),'letter:followup_d7','sent');
\echo == 8 direct insert pending (must fail)
insert into triggered_sends (client_id,trigger_key,channel,contact_id,dedupe_scope,status) values ('11111111-1111-1111-1111-111111111111','crm_ai_followup','email',gen_random_uuid(),'letter:followup_d7','pending');
\echo == 9 single-letter claim with a letters authorization (auth_inactive, writes nothing)
select outcome from triggered_send_claim(:'auth_id','44444444-4444-4444-4444-444444444444',repeat('8',64),'k9','auto-d7',1,repeat('d',64),repeat('f',64),null,null);
\echo == 10 letters claim with a single-letter (welcome) authorization (auth_inactive)
insert into triggered_send_authorizations (request_id, client_id, trigger_key, channel, account, rule, rule_sha256, template_version, template_sha256, daily_cap, proposed_by_email)
values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'welcome', 'email', 'cts', '{"schedule":{"timezone":"Pacific/Auckland"},"send":{"template":{"key":"auto-welcome"}}}', repeat('c',64), 1, repeat('d',64), 5, 'pm@example.com') returning id \gset w_
update triggered_send_authorizations set authorized_by_email='pm@example.com', authorized_by_user_id=gen_random_uuid(), authorized_at=now(), live_from=now(), expires_at=now()+interval '30 days' where id = :'w_id';
update triggered_send_authorizations set activated_at=now() where id = :'w_id';
select outcome from triggered_send_claim_letter(:'w_id','followup_d7','55555555-5555-5555-5555-555555555555',repeat('7',64),'k10','auto-d7',2,repeat('a',64),repeat('f',64),null,null);
\echo == 11 blocked letter row insert ok
insert into triggered_sends (client_id,trigger_key,channel,contact_id,dedupe_scope,status,reason_code) values ('11111111-1111-1111-1111-111111111111','crm_ai_followup','email',gen_random_uuid(),'letter:followup_d7','blocked','x') returning status;
\echo == 12 malformed trigger_key (must fail)
insert into triggered_sends (client_id,trigger_key,channel,contact_id,dedupe_scope,status) values ('11111111-1111-1111-1111-111111111111','Bad-Key','email',gen_random_uuid(),'letter:followup_d7','blocked');
select dedupe_scope, status, local_day from triggered_sends order by created_at;
