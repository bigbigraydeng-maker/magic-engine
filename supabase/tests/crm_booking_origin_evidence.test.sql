-- Behaviour checks for supabase/migrations/20261013100000_crm_booking_origin_evidence.sql
-- Run on a THROWAWAY local Postgres only, after the tour catalog migrations, 20261012200000_crm_booking_tracker.sql
-- and the migration under test. Safe to run after supabase/tests/crm_booking_tracker.test.sql (own fixture ids).
-- Every line printed as PASS/FAIL at the end is one check; any FAIL raises at the end.
-- Run with psql -v ON_ERROR_STOP=1 so an unexpected error stops the run instead of silently dropping a check.

create temp table oresults(name text, ok boolean, detail text); grant all on oresults to public;
create function pg_temp.ocheck(n text, c boolean, d text default '') returns void language sql as $$
  insert into oresults values (n, coalesce(c, false), d) $$;
-- run a statement, expect it to raise a message matching the pattern (LIKE)
create function pg_temp.orefused(n text, q text, pat text) returns void language plpgsql as $$
begin
  begin
    execute q;
    insert into oresults values (n, false, 'no error');
  exception when others then
    insert into oresults values (n, sqlerrm like pat or sqlstate::text like pat, sqlstate || ' ' || sqlerrm);
  end;
end $$;

insert into public.contacts(id, client_id) values
 ('cccccccc-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1'),
 ('cccccccc-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1'),
 ('cccccccc-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1'),
 ('cccccccc-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000b2');
insert into public.tour_catalog_tours(id, client_id, slug, destination, tier, name, manages_departures) values
 ('aaaaaaaa-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'origin-a1', 'china', 'origin', 'Origin A1 tour', true),
 ('bbbbbbbb-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b2', 'origin-b1', 'china', 'origin', 'Origin B1 tour', true);
insert into public.tour_catalog_departures(id, tour_id, client_id, depart_on, return_on, status, status_source) values
 ('aaaaaaaa-0000-0000-0000-0000000000e2', 'aaaaaaaa-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '2029-03-11', '2029-03-25', 'open', 'manual'),
 ('aaaaaaaa-0000-0000-0000-0000000000e3', 'aaaaaaaa-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '2029-03-18', '2029-04-01', 'open', 'manual'),
 ('bbbbbbbb-0000-0000-0000-0000000000e2', 'bbbbbbbb-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b2', '2029-03-11', '2029-03-25', 'open', 'manual');

\set A '00000000-0000-0000-0000-0000000000a1'
\set TOUR 'aaaaaaaa-0000-0000-0000-0000000000e1'
\set D1 'aaaaaaaa-0000-0000-0000-0000000000e2'
\set D2 'aaaaaaaa-0000-0000-0000-0000000000e3'

-- N1: the OLD 9-parameter crm_booking_create still works (UI path unchanged) and leaves the new columns NULL
do $$ declare v jsonb; begin
  v := public.crm_booking_create('00000000-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-0000000000e1',
    'aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-0000000000e3', date '2029-01-02', 2::smallint, false, null, 'Staff1@Example.com');
  perform pg_temp.ocheck('N1 old 9-arg create still works, origin_kind null', (v->>'origin_kind') is null and (v->>'evidence_ref') is null, v::text);
end $$;
select pg_temp.ocheck('N1b only one create function with 9 args and one create_with_origin',
  (select count(*) from pg_proc where proname = 'crm_booking_create') = 1
  and (select count(*) from pg_proc where proname = 'crm_booking_create_with_origin') = 1);

-- N2..N4: create_with_origin
select pg_temp.orefused('N2 company_confirmed without invoice refused',
  $q$select public.crm_booking_create_with_origin('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e2','aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e2',date '2029-01-05',2::smallint,false,null,'company_confirmed',null,'Staff1@Example.com')$q$,
  'evidence_required');

do $$ declare v jsonb; begin
  v := public.crm_booking_create_with_origin('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e2',
    'aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e2', date '2029-01-05', 2::smallint, false, null,
    'company_confirmed', ' 84-030 ', 'Staff1@Example.com');
  perform pg_temp.ocheck('N3 invoice normalised (spaces and hyphens removed)', v->>'evidence_ref' = '84030' and v->>'origin_kind' = 'company_confirmed', v::text);
  insert into oresults values ('N3b departure snapshot written', (v->>'departure_depart_on') = '2029-03-11', v::text);
  perform pg_temp.ocheck('N3c two milestones created, both unpaid',
    (select count(*) from public.crm_booking_milestones where booking_id = (v->>'id')::uuid and state = 'unpaid') = 2);
  insert into oresults values ('N3d actor lower-cased as created_by', (v->>'created_by') = 'staff1@example.com', v::text);
end $$;

select pg_temp.orefused('N4 same invoice on another live order -> duplicate_evidence_ref',
  $q$select public.crm_booking_create_with_origin('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e3','aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e2',date '2029-01-06',1::smallint,false,null,'company_confirmed','84030','Staff1@Example.com')$q$,
  'duplicate_evidence_ref');
select pg_temp.orefused('N5 same guest + same departure -> duplicate_booking (not evidence)',
  $q$select public.crm_booking_create_with_origin('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e2','aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e2',date '2029-01-06',1::smallint,false,null,'company_confirmed','84031','Staff1@Example.com')$q$,
  'duplicate_booking');
select pg_temp.orefused('N6 unknown origin_kind refused',
  $q$select public.crm_booking_create_with_origin('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e3','aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e2',date '2029-01-06',1::smallint,false,null,'whatever','84032','Staff1@Example.com')$q$,
  'invalid_origin_kind');
select pg_temp.orefused('N7 departure is required for an import',
  $q$select public.crm_booking_create_with_origin('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e3','aaaaaaaa-0000-0000-0000-0000000000e1',null,date '2029-01-06',1::smallint,false,null,'staff_entered',null,'Staff1@Example.com')$q$,
  'departure_required');
select pg_temp.orefused('N8 contact of another client refused',
  $q$select public.crm_booking_create_with_origin('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e9','aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e2',date '2029-01-06',1::smallint,false,null,'staff_entered',null,'Staff1@Example.com')$q$,
  'contact_not_found');
select pg_temp.orefused('N9 departure of another client refused',
  $q$select public.crm_booking_create_with_origin('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e3','aaaaaaaa-0000-0000-0000-0000000000e1','bbbbbbbb-0000-0000-0000-0000000000e2',date '2029-01-06',1::smallint,false,null,'staff_entered',null,'Staff1@Example.com')$q$,
  'departure_not_found');
select pg_temp.orefused('N10 blank actor refused',
  $q$select public.crm_booking_create_with_origin('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e3','aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e2',date '2029-01-06',1::smallint,false,null,'staff_entered',null,'  ')$q$,
  'invalid_actor');

-- N11: staff_entered without invoice is allowed and leaves evidence_ref NULL
do $$ declare v jsonb; begin
  v := public.crm_booking_create_with_origin('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e3',
    'aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e3', date '2029-01-07', null, false, 'x',
    'staff_entered', null, 'Staff1@Example.com');
  perform pg_temp.ocheck('N11 staff_entered without invoice ok, party_size null stays null', (v->>'evidence_ref') is null and (v->>'party_size') is null, v::text);
end $$;

-- N12: the table itself refuses company_confirmed without an invoice (not only the function) and a malformed invoice
select pg_temp.orefused('N12 table CHECK: company_confirmed needs evidence_ref (direct insert)',
  $q$insert into public.crm_bookings(client_id,contact_id,tour_id,departure_id,departure_depart_on,booked_on,created_by,origin_kind) values ('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e2','2029-03-11','2029-01-01','x','company_confirmed')$q$,
  '23514');
select pg_temp.orefused('N13 table CHECK: invoice with whitespace refused (direct insert)',
  $q$insert into public.crm_bookings(client_id,contact_id,tour_id,departure_id,departure_depart_on,booked_on,created_by,origin_kind,evidence_ref) values ('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e2','2029-03-11','2029-01-01','x','customer_stated','84 030')$q$,
  '23514');

-- N14: origin_kind / evidence_ref cannot be changed after creation; other edits still work
select pg_temp.orefused('N14a origin_kind immutable',
  $q$update public.crm_bookings set origin_kind = 'staff_entered' where evidence_ref = '84030'$q$, 'origin_immutable');
select pg_temp.orefused('N14b evidence_ref immutable',
  $q$update public.crm_bookings set evidence_ref = '99999' where evidence_ref = '84030'$q$, 'origin_immutable');
do $$ declare v jsonb; b uuid; begin
  select id into b from public.crm_bookings where evidence_ref = '84030';
  v := public.crm_booking_update('00000000-0000-0000-0000-0000000000a1', b,
    (select updated_at from public.crm_bookings where id = b), '{"party_size":3}', 'Staff1@Example.com');
  perform pg_temp.ocheck('N14c ordinary edit via crm_booking_update still works', (v->>'party_size') = '3', v::text);
end $$;

-- N15: cancel releases the invoice number (cancelled rows keep it but do not hold it)
do $$ declare b uuid; v jsonb; begin
  select id into b from public.crm_bookings where evidence_ref = '84030' and status = 'active';
  v := public.crm_booking_cancel('00000000-0000-0000-0000-0000000000a1', b,
    (select updated_at from public.crm_bookings where id = b), 'test cancel', 'Staff1@Example.com');
  perform pg_temp.ocheck('N15a cancel works and keeps the invoice number on the row',
    (select status = 'cancelled' and evidence_ref = '84030' from public.crm_bookings where id = b), v::text);
end $$;
do $$ declare v jsonb; begin
  v := public.crm_booking_create_with_origin('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e3',
    'aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e2', date '2029-01-08', 1::smallint, false, null,
    'company_confirmed', '84030', 'Staff1@Example.com');
  perform pg_temp.ocheck('N15b the same invoice can be re-used after the first order was cancelled', v->>'evidence_ref' = '84030', v::text);
end $$;
select pg_temp.ocheck('N15c exactly one active order holds the invoice',
  (select count(*) from public.crm_bookings where evidence_ref = '84030' and status = 'active') = 1
  and (select count(*) from public.crm_bookings where evidence_ref = '84030') = 2);

-- N16: audit events
select pg_temp.ocheck('N16a created event carries origin_kind and has_evidence_ref=true',
  exists (select 1 from public.crm_booking_events e join public.crm_bookings b on b.id = e.booking_id
           where e.action = 'created' and b.evidence_ref = '84030'
             and e.detail->>'origin_kind' = 'company_confirmed' and (e.detail->>'has_evidence_ref')::boolean));
select pg_temp.ocheck('N16b no event detail ever contains the invoice number text',
  not exists (select 1 from public.crm_booking_events where detail::text like '%84030%'));
select pg_temp.ocheck('N16c old-path created event has origin_kind null and has_evidence_ref=false',
  exists (select 1 from public.crm_booking_events e join public.crm_bookings b on b.id = e.booking_id
           where e.action = 'created' and b.contact_id = 'cccccccc-0000-0000-0000-0000000000e1'
             and (e.detail->>'origin_kind') is null and not (e.detail->>'has_evidence_ref')::boolean));
select pg_temp.ocheck('N16d cancel still audited as cancelled',
  exists (select 1 from public.crm_booking_events e join public.crm_bookings b on b.id = e.booking_id
           where e.action = 'cancelled' and b.evidence_ref = '84030' and b.status = 'cancelled'));

-- N17: privileges: nobody but service_role may run the new function or the trigger function
select pg_temp.ocheck('N17a anon cannot execute create_with_origin',
  not has_function_privilege('anon', 'public.crm_booking_create_with_origin(uuid,uuid,uuid,uuid,date,smallint,boolean,text,text,text,text)', 'execute'));
select pg_temp.ocheck('N17b authenticated cannot execute create_with_origin',
  not has_function_privilege('authenticated', 'public.crm_booking_create_with_origin(uuid,uuid,uuid,uuid,date,smallint,boolean,text,text,text,text)', 'execute'));
select pg_temp.ocheck('N17c service_role can execute create_with_origin',
  has_function_privilege('service_role', 'public.crm_booking_create_with_origin(uuid,uuid,uuid,uuid,date,smallint,boolean,text,text,text,text)', 'execute'));
select pg_temp.ocheck('N17d public pseudo-role cannot execute create_with_origin',
  not has_function_privilege('public', 'public.crm_booking_create_with_origin(uuid,uuid,uuid,uuid,date,smallint,boolean,text,text,text,text)', 'execute'));
select pg_temp.ocheck('N17e nobody but service_role can execute the immutability trigger function',
  not has_function_privilege('anon', 'public.crm_booking_origin_immutable()', 'execute')
  and not has_function_privilege('authenticated', 'public.crm_booking_origin_immutable()', 'execute'));
select pg_temp.ocheck('N17f session settings are cleared after the write (no actor leaks into the next statement)',
  coalesce(current_setting('crm_booking.actor', true), '') = '');

-- N18: invoice whitelist (zero-width / BOM / en dash / minus / full-width digits are refused, in the function and in the table)
select pg_temp.orefused('N18a zero-width space inside the invoice refused',
  $q$select public.crm_booking_create_with_origin('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e3','aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e2',date '2029-01-09',1::smallint,false,null,'company_confirmed',E'84​030','Staff1@Example.com')$q$,
  'invalid_evidence_ref');
select pg_temp.orefused('N18b BOM in front of the invoice refused',
  $q$select public.crm_booking_create_with_origin('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e3','aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e2',date '2029-01-09',1::smallint,false,null,'company_confirmed',E'﻿84030','Staff1@Example.com')$q$,
  'invalid_evidence_ref');
select pg_temp.orefused('N18c en dash refused (only ASCII hyphen is normalised away)',
  $q$select public.crm_booking_create_with_origin('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e3','aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e2',date '2029-01-09',1::smallint,false,null,'company_confirmed',E'84–030','Staff1@Example.com')$q$,
  'invalid_evidence_ref');
select pg_temp.orefused('N18d full-width digits refused',
  $q$select public.crm_booking_create_with_origin('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e3','aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e2',date '2029-01-09',1::smallint,false,null,'company_confirmed',E'８４０３０','Staff1@Example.com')$q$,
  'invalid_evidence_ref');
select pg_temp.orefused('N18e too short (2 chars) gets the business code, not a raw CHECK error',
  $q$select public.crm_booking_create_with_origin('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e3','aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e2',date '2029-01-09',1::smallint,false,null,'customer_stated','84','Staff1@Example.com')$q$,
  'invalid_evidence_ref');
select pg_temp.orefused('N18f table CHECK: lower-case invoice refused on a direct insert',
  $q$insert into public.crm_bookings(client_id,contact_id,tour_id,departure_id,departure_depart_on,booked_on,created_by,origin_kind,evidence_ref) values ('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e2','2029-03-11','2029-01-01','x','customer_stated','abc99')$q$,
  '23514');
select pg_temp.orefused('N18g table CHECK: zero-width character refused on a direct insert',
  $q$insert into public.crm_bookings(client_id,contact_id,tour_id,departure_id,departure_depart_on,booked_on,created_by,origin_kind,evidence_ref) values ('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e2','2029-03-11','2029-01-01','x','customer_stated',E'84030​')$q$,
  '23514');

-- N19: an import must state its origin
select pg_temp.orefused('N19 NULL origin_kind refused by the import function',
  $q$select public.crm_booking_create_with_origin('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e3','aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e2',date '2029-01-09',1::smallint,false,null,null,'84040','Staff1@Example.com')$q$,
  'invalid_origin_kind');

-- N20: the same invoice number may exist for two different clients; conflict priority is pinned
do $$ declare v jsonb; begin
  v := public.crm_booking_create_with_origin('00000000-0000-0000-0000-0000000000b2','cccccccc-0000-0000-0000-0000000000e9',
    'bbbbbbbb-0000-0000-0000-0000000000e1','bbbbbbbb-0000-0000-0000-0000000000e2', date '2029-01-09', 1::smallint, false, null,
    'company_confirmed', '84030', 'Staff1@Example.com');
  perform pg_temp.ocheck('N20a the same invoice number for another client is allowed', v->>'evidence_ref' = '84030', v::text);
end $$;
select pg_temp.orefused('N20b same guest + same departure + same invoice reports duplicate_booking (older index is checked first)',
  $q$select public.crm_booking_create_with_origin('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000e3','aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e3',date '2029-01-09',1::smallint,false,null,'customer_stated','84030','Staff1@Example.com')$q$,
  'duplicate_booking');
select pg_temp.ocheck('N20c service_role can execute the immutability trigger function',
  has_function_privilege('service_role', 'public.crm_booking_origin_immutable()', 'execute'));

-- A block that errored out leaves NO row behind, so also pin the number of checks that must have run.
select pg_temp.ocheck('N99 all 44 checks above ran (none was skipped by an unexpected error)', (select count(*) from oresults) = 44, (select count(*) from oresults)::text);

select name, case when ok then 'PASS' else 'FAIL' end as r, left(detail, 160) as detail from oresults order by name;
do $$ begin
  if exists (select 1 from oresults where ok is not true) then raise exception 'crm booking origin/evidence checks FAILED'; end if;
end $$;
