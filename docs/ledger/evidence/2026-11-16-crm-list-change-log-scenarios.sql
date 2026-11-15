\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''
create or replace function pg_temp.n(c uuid) returns bigint language sql as $$ select count(*) from public.crm_list_change_log where client_id = c $$;
create or replace function pg_temp.expect(label text, got bigint, want bigint) returns void language plpgsql as $$
begin if got is distinct from want then raise exception 'FAIL %: got %, want %', label, got, want; end if; raise notice 'ok   %: %', label, got; end $$;
insert into clients (id, name, country, leads_config) values (:A, 'A', 'NZ', '{}'), (:B, 'B', 'AU', '{}');
select pg_temp.expect('new client rows record nothing', (select count(*) from crm_list_change_log), 0);

-- contacts: insert / real update / no-op update / delete
insert into contacts (id, client_id, display_name) values ('11111111-0000-0000-0000-000000000001', :A, 'Ann');
select pg_temp.expect('insert one contact', pg_temp.n(:A), 1);
update contacts set display_name = 'Ann B' where client_id = :A;
select pg_temp.expect('real update', pg_temp.n(:A), 2);
update contacts set display_name = 'Ann B' where client_id = :A;
select pg_temp.expect('no-op update records nothing', pg_temp.n(:A), 2);
update contacts set display_name = 'x' where client_id = 'cccccccc-0000-0000-0000-000000000003';
select pg_temp.expect('update matching zero rows records nothing', (select count(*) from crm_list_change_log), 2);

-- bulk insert for two clients in one statement: one row per client
insert into contact_touchpoints (client_id, contact_id, channel, direction, metadata, source_ref)
select case when g % 2 = 0 then :A::uuid else :B::uuid end, null, 'phone', 'outbound', jsonb_build_object('k', g), 'ref' || g from generate_series(1, 5000) g;
select pg_temp.expect('bulk insert, client A', pg_temp.n(:A), 3);
select pg_temp.expect('bulk insert, client B', pg_temp.n(:B), 1);

-- metadata-only change (the case the old code could not detect: no updated_at on touchpoints)
update contact_touchpoints set metadata = metadata || '{"callback_at":"2026-11-20"}' where source_ref = 'ref2';
select pg_temp.expect('metadata-only update', pg_temp.n(:A), 4);

-- upsert: conflict -> update
insert into contact_touchpoints (client_id, channel, direction, source_ref, raw) values (:A, 'phone', 'outbound', 'ref2', 'note')
on conflict (source_ref) do update set raw = excluded.raw;
select pg_temp.expect('upsert that updates', pg_temp.n(:A), 5);
insert into contact_touchpoints (client_id, channel, direction, source_ref, raw) values (:A, 'phone', 'outbound', 'ref2', 'note')
on conflict (source_ref) do nothing;
select pg_temp.expect('upsert that does nothing', pg_temp.n(:A), 5);

-- row moves between clients: both recorded
update contact_touchpoints set client_id = :B where source_ref = 'ref4';
select pg_temp.expect('move A->B, A', pg_temp.n(:A), 6);
select pg_temp.expect('move A->B, B', pg_temp.n(:B), 2);

-- cascade delete: deleting a contact removes its identities and touchpoints
insert into contact_identities (contact_id, client_id, kind, value) values ('11111111-0000-0000-0000-000000000001', :A, 'email', 'a@x.nz');
update contact_touchpoints set contact_id = '11111111-0000-0000-0000-000000000001' where source_ref = 'ref6';
select pg_temp.expect('before delete', pg_temp.n(:A), 8);
delete from contacts where id = '11111111-0000-0000-0000-000000000001';
select pg_temp.expect('delete contact + 2 cascades', pg_temp.n(:A), 11);
select pg_temp.expect('cascade really deleted the touchpoint', (select count(*) from contact_touchpoints where source_ref = 'ref6'), 0);

-- conversation_messages has no client_id
insert into conversations (id, client_id, conversation_id, channel, last_synced_at) values ('22222222-0000-0000-0000-000000000001', :B, 't1', 'email', now());
select pg_temp.expect('insert conversation', pg_temp.n(:B), 3);
insert into conversation_messages (conversation_id, direction, body) values ('22222222-0000-0000-0000-000000000001', 'inbound', 'hi');
select pg_temp.expect('insert message -> client via conversation', pg_temp.n(:B), 4);
insert into conversation_messages (conversation_id, direction, body) values ('99999999-0000-0000-0000-000000000009', 'inbound', 'orphan');
select pg_temp.expect('orphan message records nothing and does not fail', (select count(*) from crm_list_change_log), 15);
update conversation_messages set body = 'hello' where body = 'hi';
select pg_temp.expect('update message', pg_temp.n(:B), 5);
delete from conversation_messages where body = 'hello';
select pg_temp.expect('delete message', pg_temp.n(:B), 6);

-- a sync that rewrites the same values
update conversations set channel = 'email' where client_id = :B;
select pg_temp.expect('sync rewriting identical values', pg_temp.n(:B), 6);

-- columns whose types have no equality operator must not break UPDATE
insert into tailor_made_itineraries (client_id, quote_ref, status, payload, legacy, shape) values (:A, 'Q1', 'draft', '{}', '{"a":1}', point(1,2));
update tailor_made_itineraries set status = 'sent' where quote_ref = 'Q1';
update tailor_made_itineraries set legacy = '{"a":1}' where quote_ref = 'Q1';
select pg_temp.expect('json/point columns: insert + real update + no-op', pg_temp.n(:A), 13);

-- clients: only leads_config / country count
update clients set name = 'A2', seo_config = '{"x":1}' where id = :A;
select pg_temp.expect('unrelated client columns', pg_temp.n(:A), 13);
update clients set leads_config = '{"own_email_domains":["a.nz"]}' where id = :A;
select pg_temp.expect('leads_config change', pg_temp.n(:A), 14);
update clients set leads_config = leads_config, country = country where id = :A;
select pg_temp.expect('leads_config rewritten with same value', pg_temp.n(:A), 14);

-- the other five tables fire too
insert into contact_stage_events (client_id, to_stage) values (:A, 'quoted');
insert into client_pipeline_stages (client_id, stage_key) values (:A, 'quoted');
insert into conversation_briefs (client_id, summary) values (:A, 's');
select pg_temp.expect('stage events + pipeline stages + briefs', pg_temp.n(:A), 17);

-- a rolled-back write leaves no mark
begin; insert into contacts (client_id, display_name) values (:A, 'Rolled'); rollback;
select pg_temp.expect('rolled back write', pg_temp.n(:A), 17);

-- access: a writer with no rights on the log still writes business tables; anon/authenticated cannot read the log
set role authenticated;
insert into contacts (client_id, display_name) values (:B, 'By authenticated');
reset role;
select pg_temp.expect('write as authenticated still recorded', pg_temp.n(:B), 7);
set role service_role; select pg_temp.expect('service_role reads the log', (select count(*) from crm_list_change_log where client_id = :B), 7); reset role;
do $$ begin
  begin set local role anon; perform count(*) from public.crm_list_change_log; raise exception 'FAIL anon could read the log';
  exception when insufficient_privilege then raise notice 'ok   anon cannot read the log'; end;
end $$;
do $$ begin
  begin set local role authenticated; insert into public.crm_list_change_log (client_id) values (gen_random_uuid()); raise exception 'FAIL authenticated could write the log';
  exception when insufficient_privilege then raise notice 'ok   authenticated cannot write the log'; end;
end $$;

-- review round (2026-11-16): changed primary key, and the log is read-only even for service_role
update contact_stage_events set id = gen_random_uuid() where client_id = :A;
select pg_temp.expect('row whose id changed is still recorded', pg_temp.n(:A), 18);
do $$ begin
  begin set local role service_role; delete from public.crm_list_change_log; raise exception 'FAIL service_role could delete from the log';
  exception when insufficient_privilege then raise notice 'ok   service_role cannot delete from the log'; end;
end $$;
do $$ begin
  begin set local role service_role; insert into public.crm_list_change_log (client_id) values (gen_random_uuid()); raise exception 'FAIL service_role could insert into the log';
  exception when insufficient_privilege then raise notice 'ok   service_role cannot insert into the log'; end;
end $$;
set role service_role;
insert into contacts (client_id, display_name) values (:A, 'By service_role');
reset role;
select pg_temp.expect('service_role business write still recorded', pg_temp.n(:A), 19);
show lock_timeout;
