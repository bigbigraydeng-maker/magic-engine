-- Chunk A of supabase/tests/crm_booking_tracker.test.sql
-- Behaviour checks for supabase/migrations/20261012200000_crm_booking_tracker.sql
-- (run after the tour catalog migrations and their test files, on a THROWAWAY local Postgres only).
-- A = client a1, B = client b2. Every "refused" check also proves nothing moved.
-- Chunks B and C are concatenated after this file; the final report query and the final
-- do-block live in chunk C, not here.

create temp table aresults(name text, ok boolean, detail text); grant all on aresults to public;
create temp table ctx(k text primary key, v text); grant all on ctx to public;

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as the superuser; these exact ids)
-- ---------------------------------------------------------------------------
insert into public.contacts(id, client_id) values
 ('cccccccc-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
 ('cccccccc-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1'),
 ('cccccccc-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1'),
 ('cccccccc-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');

insert into public.tour_catalog_tours(id, client_id, slug, destination, tier, name, manages_departures) values
 ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'crm-a1', 'china', 'crm', 'CRM A1 tour', true),
 ('aaaaaaaa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'crm-a2', 'china', 'crm', 'CRM A2 tour', true),
 ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'crm-b1', 'china', 'crm', 'CRM B1 tour', true);

insert into public.tour_catalog_departures(id, tour_id, client_id, depart_on, return_on, status, status_source) values
 ('aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '2028-03-01', '2028-03-10', 'open', 'manual'),
 ('aaaaaaaa-0000-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '2028-04-01', '2028-04-10', 'open', 'manual'),
 ('aaaaaaaa-0000-0000-0000-0000000000d3', 'aaaaaaaa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', '2028-05-01', '2028-05-10', 'open', 'manual'),
 ('bbbbbbbb-0000-0000-0000-0000000000d1', 'bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', '2028-03-01', '2028-03-10', 'open', 'manual');

-- ---------------------------------------------------------------------------
-- Temp helpers (chunk A defines them; later chunks reuse them by name and signature)
-- ---------------------------------------------------------------------------
create function pg_temp.bid(p_key text) returns uuid language sql as $$
  select v::uuid from ctx where k = p_key;
$$;

create function pg_temp.tok_b(p_booking uuid) returns timestamptz language sql as $$
  select updated_at from public.crm_bookings where id = p_booking;
$$;

create function pg_temp.tok_m(p_booking uuid, p_kind text) returns timestamptz language sql as $$
  select updated_at from public.crm_booking_milestones where booking_id = p_booking and kind = p_kind;
$$;

-- Fingerprint of everything the tracker owns: bookings, milestones, event count, member count.
create function pg_temp.fp() returns text language sql as $$
  select md5(
    coalesce((select string_agg(to_jsonb(b)::text, '|' order by b.id) from public.crm_bookings b), '') ||
    coalesce((select string_agg(to_jsonb(m)::text, '|' order by m.id) from public.crm_booking_milestones m), '') ||
    (select count(*)::text from public.crm_booking_events) ||
    (select count(*)::text from public.crm_booking_members)
  );
$$;

-- Runs one statement that must fail with exactly p_expected, and must leave everything unchanged.
create function pg_temp.refused(p_name text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v_before text := pg_temp.fp(); v_err text := 'no error';
begin
  begin
    execute p_sql;
  exception when others then v_err := sqlerrm;
  end;
  insert into aresults values (p_name, v_err like p_expected and pg_temp.fp() = v_before,
    format('error=%s unchanged=%s', v_err, pg_temp.fp() = v_before));
end $$;

-- Runs one statement that must be refused with insufficient_privilege.
create function pg_temp.denied(p_name text, p_sql text) returns void language plpgsql as $$
declare v_err text := 'no error';
begin
  begin execute p_sql; exception when insufficient_privilege then v_err := 'insufficient_privilege'; when others then v_err := sqlerrm; end;
  insert into aresults values (p_name, v_err = 'insufficient_privilege', v_err);
end $$;

create function pg_temp.check(p_name text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  insert into aresults values (p_name, coalesce(p_ok, false), p_detail);
end $$;

-- Creates a booking as client A with the staff actor and stores its id in ctx under p_key.
create function pg_temp.mk(p_key text, p_contact uuid, p_tour uuid, p_dep uuid, p_booked date, p_party smallint, p_cruise boolean, p_note text) returns void language plpgsql as $$
declare v jsonb;
begin
  v := public.crm_booking_create('00000000-0000-0000-0000-0000000000a1', p_contact, p_tour, p_dep, p_booked, p_party, p_cruise, p_note, 'Staff1@Example.com');
  insert into ctx(k, v) values (p_key, v->>'id') on conflict (k) do update set v = excluded.v;
end $$;

-- ---------------------------------------------------------------------------
-- G1 create
-- ---------------------------------------------------------------------------
do $$ declare v jsonb; v_id uuid; begin
  v := public.crm_booking_create('00000000-0000-0000-0000-0000000000a1',
    'cccccccc-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-0000000000d1', '2028-01-10', 2::smallint, false, 'Li couple', 'Staff1@Example.com');
  insert into ctx(k, v) values ('bk1', v->>'id') on conflict (k) do update set v = excluded.v;
  v_id := (v->>'id')::uuid;
  perform pg_temp.check('G01 create with departure DA1 snapshots depart_on and is active',
    (v->>'departure_depart_on')::date = '2028-03-01' and v->>'status' = 'active'
      and (v->>'departure_id')::uuid = 'aaaaaaaa-0000-0000-0000-0000000000d1'
      and (v->>'booked_on')::date = '2028-01-10' and (v->>'party_size')::int = 2
      and (v->>'is_cruise')::boolean = false and v->>'note' = 'Li couple',
    v::text);

  perform pg_temp.check('G02 exactly two milestones for bk1, deposit and balance, both unpaid',
    (select count(*) = 2 and bool_and(state = 'unpaid') and bool_and(kind in ('deposit','balance'))
       from public.crm_booking_milestones where booking_id = v_id), '');

  perform pg_temp.check('G03 exactly one created event for bk1, staff source, lower-cased actor',
    (select count(*) = 1 and bool_and(action = 'created') and bool_and(source = 'staff')
       and bool_and(actor_email = 'staff1@example.com')
       from public.crm_booking_events where booking_id = v_id and action = 'created'), '');
end $$;

do $$ declare v jsonb; begin
  v := public.crm_booking_create('00000000-0000-0000-0000-0000000000a1',
    'cccccccc-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000002',
    null, null, null, null, null, 'Staff1@Example.com');
  insert into ctx(k, v) values ('bk_today', v->>'id') on conflict (k) do update set v = excluded.v;
  perform pg_temp.check('G04 null booked_on defaults to NZ today',
    (v->>'booked_on')::date = (now() at time zone 'Pacific/Auckland')::date, v->>'booked_on');
end $$;

do $$ declare v jsonb; begin
  v := public.crm_booking_create('00000000-0000-0000-0000-0000000000a1',
    'cccccccc-0000-0000-0000-0000000000a3', 'aaaaaaaa-0000-0000-0000-000000000002',
    'aaaaaaaa-0000-0000-0000-0000000000d3', '2028-01-11', null, null, '   ', 'Staff1@Example.com');
  insert into ctx(k, v) values ('bk_blank', v->>'id') on conflict (k) do update set v = excluded.v;
  perform pg_temp.check('G05 created_by lower-cased and blank note stored as null',
    v->>'created_by' = 'staff1@example.com' and v->>'note' is null, v::text);
end $$;

-- ---------------------------------------------------------------------------
-- G2 duplicates
-- ---------------------------------------------------------------------------
select pg_temp.refused('G06 duplicate active booking (ca1, TA1, DA1) refused',
  $q$select public.crm_booking_create('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000d1','2028-01-12',2::smallint,false,null,'Staff1@Example.com')$q$,
  'duplicate_booking');

select pg_temp.refused('G07 duplicate active booking with null departure refused',
  $q$select public.crm_booking_create('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-000000000002',null,'2028-01-12',null,null,null,'Staff1@Example.com')$q$,
  'duplicate_booking');

do $$ declare v jsonb; begin
  v := public.crm_booking_create('00000000-0000-0000-0000-0000000000a1',
    'cccccccc-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-0000000000d2', '2028-01-13', 2::smallint, false, null, 'Staff1@Example.com');
  insert into ctx(k, v) values ('bk_other', v->>'id') on conflict (k) do update set v = excluded.v;
  perform pg_temp.check('G08 same contact and tour with another departure is allowed',
    v->>'status' = 'active' and (v->>'departure_id')::uuid = 'aaaaaaaa-0000-0000-0000-0000000000d2'
      and (v->>'departure_depart_on')::date = '2028-04-01', v::text);
end $$;

do $$ declare v jsonb; begin
  perform public.crm_booking_cancel('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk_other'),
    pg_temp.tok_b(pg_temp.bid('bk_other')), 'changed mind', 'Staff1@Example.com');
  v := public.crm_booking_create('00000000-0000-0000-0000-0000000000a1',
    'cccccccc-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-0000000000d2', '2028-01-14', 2::smallint, false, null, 'Staff1@Example.com');
  insert into ctx(k, v) values ('bk_again', v->>'id') on conflict (k) do update set v = excluded.v;
  perform pg_temp.check('G09 after cancelling bk_other the same slot can be booked again',
    v->>'status' = 'active' and (v->>'id')::uuid <> pg_temp.bid('bk_other'), v::text);
end $$;

-- ---------------------------------------------------------------------------
-- G3 cross-client
-- ---------------------------------------------------------------------------
select pg_temp.refused('G10 contact of client B refused',
  $q$select public.crm_booking_create('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000b1','aaaaaaaa-0000-0000-0000-000000000001',null,'2028-01-15',null,null,null,'Staff1@Example.com')$q$,
  'contact_not_found');

select pg_temp.refused('G11 tour of client B refused',
  $q$select public.crm_booking_create('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-000000000001',null,'2028-01-15',null,null,null,'Staff1@Example.com')$q$,
  'tour_not_found');

select pg_temp.refused('G12 departure of client B refused',
  $q$select public.crm_booking_create('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-0000000000d1','2028-01-15',null,null,null,'Staff1@Example.com')$q$,
  'departure_not_found');

select pg_temp.refused('G13 departure of another tour refused',
  $q$select public.crm_booking_create('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000d3','2028-01-15',null,null,null,'Staff1@Example.com')$q$,
  'departure_not_found');

select pg_temp.refused('G14 client B with a client A contact refused',
  $q$select public.crm_booking_create('00000000-0000-0000-0000-0000000000b2','cccccccc-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',null,'2028-01-15',null,null,null,'Staff1@Example.com')$q$,
  'contact_not_found');

select pg_temp.refused('G15 update of bk1 as client B refused',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000b2',(select v::uuid from ctx where k='bk1'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk1')),'{"party_size":3}','Staff1@Example.com')$q$,
  'booking_not_found');

select pg_temp.refused('G16 cancel of bk1 as client B refused',
  $q$select public.crm_booking_cancel('00000000-0000-0000-0000-0000000000b2',(select v::uuid from ctx where k='bk1'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk1')),'nope','Staff1@Example.com')$q$,
  'booking_not_found');

select pg_temp.refused('G17 set_paid of bk1 as client B refused',
  $q$select public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000b2',(select v::uuid from ctx where k='bk1'),'deposit',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk1') and kind='deposit'),'2028-02-01','staff',null,false,'Staff1@Example.com')$q$,
  'booking_not_found');

-- ---------------------------------------------------------------------------
-- G4 blank actor refused by all nine write functions
-- ---------------------------------------------------------------------------
select pg_temp.refused('G18 create refuses a blank actor',
  $q$select public.crm_booking_create('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',null,'2028-01-16',null,null,null,'   ')$q$,
  'invalid_actor');

select pg_temp.refused('G19 create refuses a null actor',
  $q$select public.crm_booking_create('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',null,'2028-01-16',null,null,null,null)$q$,
  'invalid_actor');

select pg_temp.refused('G20 update refuses a blank actor',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk1')),'{"party_size":3}','   ')$q$,
  'invalid_actor');

select pg_temp.refused('G21 set_paid refuses a blank actor',
  $q$select public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),'deposit',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk1') and kind='deposit'),'2028-02-01','staff',null,false,'   ')$q$,
  'invalid_actor');

select pg_temp.refused('G22 unset_paid refuses a blank actor',
  $q$select public.crm_booking_unset_paid('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),'deposit',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk1') and kind='deposit'),'   ')$q$,
  'invalid_actor');

select pg_temp.refused('G23 override_due refuses a blank actor',
  $q$select public.crm_booking_override_due('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),'deposit',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk1') and kind='deposit'),'2028-02-01','   ')$q$,
  'invalid_actor');

select pg_temp.refused('G24 confirm_departure refuses a blank actor',
  $q$select public.crm_booking_confirm_departure('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk1')),'   ')$q$,
  'invalid_actor');

select pg_temp.refused('G25 nudge refuses a blank actor',
  $q$select public.crm_booking_nudge('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),'deposit',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk1') and kind='deposit'),'nudged_today',null,'   ')$q$,
  'invalid_actor');

select pg_temp.refused('G26 cancel refuses a blank actor',
  $q$select public.crm_booking_cancel('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk1')),'nope','   ')$q$,
  'invalid_actor');

select pg_temp.refused('G27 erase_actor_email refuses a blank actor',
  $q$select public.crm_booking_erase_actor_email('00000000-0000-0000-0000-0000000000a1','x@y.zz','   ')$q$,
  'invalid_actor');

-- end of chunk A
-- start of chunk B
-- Chunk B of supabase/tests/crm_booking_tracker.test.sql
-- Behaviour checks for supabase/migrations/20261012200000_crm_booking_tracker.sql
-- (run after the tour catalog migrations and their test files, on a THROWAWAY local Postgres only).
-- Chunk A defined the fixtures, ctx table and pg_temp helpers; this chunk reuses them directly.
-- Chunks A and C are concatenated around this file; the final report query and the final
-- do-block live in chunk C, not here.

-- ---------------------------------------------------------------------------
-- G5 stale tokens
-- ---------------------------------------------------------------------------
select pg_temp.refused('G30 update bk1 with a stale token refused',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),'2000-01-01'::timestamptz,'{"party_size":3}','Staff1@Example.com')$q$,
  'conflict:stale:%');

select pg_temp.refused('G31 set_paid on bk1 deposit with a stale token refused',
  $q$select public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),'deposit','2000-01-01'::timestamptz,'2028-02-01','staff',null,false,'Staff1@Example.com')$q$,
  'conflict:stale:%');

select pg_temp.refused('G32 unset_paid with a stale token refused',
  $q$select public.crm_booking_unset_paid('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),'deposit','2000-01-01'::timestamptz,'Staff1@Example.com')$q$,
  'conflict:stale:%');

select pg_temp.refused('G33 override_due with a stale token refused',
  $q$select public.crm_booking_override_due('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),'deposit','2000-01-01'::timestamptz,'2028-02-01','Staff1@Example.com')$q$,
  'conflict:stale:%');

select pg_temp.refused('G34 confirm_departure with a stale token refused',
  $q$select public.crm_booking_confirm_departure('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),'2000-01-01'::timestamptz,'Staff1@Example.com')$q$,
  'conflict:stale:%');

select pg_temp.refused('G35 nudge with a stale token refused',
  $q$select public.crm_booking_nudge('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),'deposit','2000-01-01'::timestamptz,'nudged_today',null,'Staff1@Example.com')$q$,
  'conflict:stale:%');

select pg_temp.refused('G36 cancel with a stale token refused',
  $q$select public.crm_booking_cancel('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),'2000-01-01'::timestamptz,'nope','Staff1@Example.com')$q$,
  'conflict:stale:%');

-- G37: a real stale case. Capture the current token, make a successful update, then reuse the
-- old token and expect a conflict.
do $$ declare v_old timestamptz; v jsonb; begin
  v_old := pg_temp.tok_b(pg_temp.bid('bk1'));
  insert into ctx(k, v) values ('old_tok', v_old::text) on conflict (k) do update set v = excluded.v;
  v := public.crm_booking_update('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk1'),
    v_old, '{"party_size":3}', 'Staff1@Example.com');
  perform pg_temp.check('G37a update with the current token succeeds',
    (v->>'party_size')::int = 3, v::text);
end $$;

select pg_temp.refused('G37b update with the now-stale token refused',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),(select v::timestamptz from ctx where k='old_tok'),'{"party_size":4}','Staff1@Example.com')$q$,
  'conflict:stale:%');

-- ---------------------------------------------------------------------------
-- G6 update
-- ---------------------------------------------------------------------------
select pg_temp.refused('G40 update with an unknown key refused',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk1')),'{"status":"cancelled"}','Staff1@Example.com')$q$,
  'field_not_editable:status');

select pg_temp.refused('G41 update with tour_id null refused',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk1')),'{"tour_id":null}','Staff1@Example.com')$q$,
  'invalid_null:tour_id');

select pg_temp.refused('G42 update with booked_on null refused',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk1')),'{"booked_on":null}','Staff1@Example.com')$q$,
  'invalid_null:booked_on');

-- G43: a no-op update writes nothing (updated_at unchanged, no new event).
do $$ declare v_before timestamptz; v_after timestamptz; v_ev_before bigint; v_ev_after bigint; v jsonb; begin
  v_before := pg_temp.tok_b(pg_temp.bid('bk_today'));
  select count(*) into v_ev_before from public.crm_booking_events where booking_id = pg_temp.bid('bk_today');
  v := public.crm_booking_update('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk_today'),
    v_before, '{"is_cruise":false}', 'Staff1@Example.com');
  v_after := pg_temp.tok_b(pg_temp.bid('bk_today'));
  select count(*) into v_ev_after from public.crm_booking_events where booking_id = pg_temp.bid('bk_today');
  perform pg_temp.check('G43 no-op update leaves updated_at and event count unchanged',
    v_after = v_before and v_ev_after = v_ev_before,
    format('before=%s after=%s ev_before=%s ev_after=%s', v_before, v_after, v_ev_before, v_ev_after));
end $$;

-- G44: bk_today (ca2, TA2, no departure) cannot take DA1b (belongs to TA1).
select pg_temp.refused('G44 setting a departure of another tour refused',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_today'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_today')),'{"departure_id":"aaaaaaaa-0000-0000-0000-0000000000d2"}','Staff1@Example.com')$q$,
  'departure_not_found');

-- G45: bk_today takes DA2 (TA2) -> snapshot becomes 2028-05-01 and the event records departure_id.
do $$ declare v jsonb; v_ev jsonb; begin
  v := public.crm_booking_update('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk_today'),
    pg_temp.tok_b(pg_temp.bid('bk_today')), '{"departure_id":"aaaaaaaa-0000-0000-0000-0000000000d3"}', 'Staff1@Example.com');
  perform pg_temp.check('G45a setting DA2 snapshots depart_on 2028-05-01',
    (v->>'departure_id')::uuid = 'aaaaaaaa-0000-0000-0000-0000000000d3'
      and (v->>'departure_depart_on')::date = '2028-05-01', v::text);

  select detail into v_ev
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk_today')
     and action = 'edited'
     and detail->'changed_fields' ? 'departure_id'
   order by created_at desc
   limit 1;
  perform pg_temp.check('G45b an edited event records departure_id in changed_fields',
    v_ev is not null, coalesce(v_ev::text, 'no event'));
end $$;

-- G46: bk1 keeps departure DA1 while switching to tour TA2 -> departure_not_found.
select pg_temp.refused('G46 switching tour while keeping the old departure refused',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk1')),'{"tour_id":"aaaaaaaa-0000-0000-0000-000000000002"}','Staff1@Example.com')$q$,
  'departure_not_found');

-- G47: note text is never copied into the audit detail.
do $$ declare v jsonb; v_leak bigint; v_has_note bigint; begin
  v := public.crm_booking_update('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk1'),
    pg_temp.tok_b(pg_temp.bid('bk1')), '{"note":"SECRET-NOTE-TEXT"}', 'Staff1@Example.com');

  select count(*) into v_leak
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk1')
     and detail::text like '%SECRET-NOTE-TEXT%';

  select count(*) into v_has_note
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk1')
     and action = 'edited'
     and detail->'changed_fields' ? 'note';

  perform pg_temp.check('G47a note text never appears in the audit detail',
    v_leak = 0, format('leaks=%s', v_leak));
  perform pg_temp.check('G47b an edited event records note in changed_fields',
    v_has_note >= 1, format('events=%s', v_has_note));
end $$;

-- G48: party_size change is stored and the event records old/new values.
do $$ declare v jsonb; v_ev jsonb; begin
  v := public.crm_booking_update('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk1'),
    pg_temp.tok_b(pg_temp.bid('bk1')), '{"party_size":3}', 'Staff1@Example.com');
  perform pg_temp.check('G48a party_size 3 stored',
    (v->>'party_size')::int = 3, v::text);

  select detail into v_ev
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk1')
     and action = 'edited'
     and detail->'changed_fields' ? 'party_size'
   order by created_at desc
   limit 1;
  perform pg_temp.check('G48b the event records old_party_size 2 and new_party_size 3',
    v_ev is not null
      and (v_ev->>'old_party_size')::int = 2
      and (v_ev->>'new_party_size')::int = 3,
    coalesce(v_ev::text, 'no event'));
end $$;

-- ---------------------------------------------------------------------------
-- G7 set_paid / unset_paid on bk1
-- ---------------------------------------------------------------------------
do $$ declare v jsonb; begin
  v := public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk1'), 'deposit',
    pg_temp.tok_m(pg_temp.bid('bk1'), 'deposit'), '2028-02-01', 'staff', null, false, 'Staff1@Example.com');
  perform pg_temp.check('G50 staff set_paid deposit succeeds',
    (v->>'changed')::boolean = true
      and v->'milestone'->>'state' = 'paid'
      and v->'milestone'->>'paid_source' = 'staff'
      and (v->'milestone'->>'paid_on')::date = '2028-02-01',
    v::text);
end $$;

do $$ declare v_ev jsonb; begin
  select detail into v_ev
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk1')
     and action = 'milestone_paid'
     and milestone_kind = 'deposit'
   order by created_at desc
   limit 1;
  perform pg_temp.check('G51 a milestone_paid event for deposit records paid_source staff',
    v_ev is not null and v_ev->>'paid_source' = 'staff',
    coalesce(v_ev::text, 'no event'));
end $$;

do $$ declare v jsonb; begin
  v := public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk1'), 'deposit',
    pg_temp.tok_m(pg_temp.bid('bk1'), 'deposit'), '2028-02-01', 'staff', null, false, 'Staff1@Example.com');
  perform pg_temp.check('G52 set_paid on an already-paid milestone reports already_paid',
    (v->>'changed')::boolean = false and v->>'reason' = 'already_paid', v::text);
end $$;

select pg_temp.refused('G53 email source without a server detector refused',
  $q$select public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),'balance',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk1') and kind='balance'),'2028-02-01','email','msg-1:balance',false,'Staff1@Example.com')$q$,
  'email_source_requires_server_detector');

select pg_temp.refused('G54 email source with a null detector refused',
  $q$select public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),'balance',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk1') and kind='balance'),'2028-02-01','email','msg-1:balance',null,'Staff1@Example.com')$q$,
  'email_source_requires_server_detector');

select pg_temp.refused('G55 email source without evidence refused',
  $q$select public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),'balance',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk1') and kind='balance'),'2028-02-01','email',null,true,'Staff1@Example.com')$q$,
  'evidence_required');

select pg_temp.refused('G56 staff source with an evidence ref refused',
  $q$select public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),'balance',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk1') and kind='balance'),'2028-02-01','staff','msg-1:balance',false,'Staff1@Example.com')$q$,
  'evidence_only_for_email');

select pg_temp.refused('G57 set_paid with an invalid kind refused',
  $q$select public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),'x',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk1') and kind='balance'),'2028-02-01','staff',null,false,'Staff1@Example.com')$q$,
  'invalid_kind');

select pg_temp.refused('G58 set_paid with an invalid source refused',
  $q$select public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),'balance',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk1') and kind='balance'),'2028-02-01','phone',null,false,'Staff1@Example.com')$q$,
  'invalid_paid_source');

do $$ declare v jsonb; v_ev jsonb; begin
  v := public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk1'), 'balance',
    pg_temp.tok_m(pg_temp.bid('bk1'), 'balance'), '2028-02-01', 'email', 'msg-1:balance', true, 'payment-email-detect');
  perform pg_temp.check('G59a email set_paid balance succeeds with paid_source email',
    (v->>'changed')::boolean = true and v->'milestone'->>'paid_source' = 'email', v::text);

  select detail into v_ev
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk1')
     and action = 'milestone_paid'
     and milestone_kind = 'balance'
   order by created_at desc
   limit 1;
  perform pg_temp.check('G59b the milestone_paid event has source email and the detector actor',
    (select source from public.crm_booking_events
      where booking_id = pg_temp.bid('bk1') and action = 'milestone_paid' and milestone_kind = 'balance'
      order by created_at desc limit 1) = 'email'
      and (select actor_email from public.crm_booking_events
      where booking_id = pg_temp.bid('bk1') and action = 'milestone_paid' and milestone_kind = 'balance'
      order by created_at desc limit 1) = 'payment-email-detect',
    coalesce(v_ev::text, 'no event'));
end $$;

do $$ declare v jsonb; begin
  v := public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk_again'), 'deposit',
    pg_temp.tok_m(pg_temp.bid('bk_again'), 'deposit'), '2028-02-01', 'email', 'msg-1:balance', true, 'payment-email-detect');
  perform pg_temp.check('G60 reusing an evidence ref reports evidence_already_used and leaves the milestone unpaid',
    (v->>'changed')::boolean = false and v->>'reason' = 'evidence_already_used'
      and (select state from public.crm_booking_milestones
            where booking_id = pg_temp.bid('bk_again') and kind = 'deposit') = 'unpaid',
    v::text);
end $$;

do $$ declare v jsonb; begin
  v := public.crm_booking_unset_paid('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk1'), 'balance',
    pg_temp.tok_m(pg_temp.bid('bk1'), 'balance'), 'Staff1@Example.com');
  perform pg_temp.check('G61 unset_paid clears state/paid_on/paid_source but keeps the evidence ref',
    v->>'state' = 'unpaid' and v->>'paid_on' is null and v->>'paid_source' is null
      and v->>'paid_evidence_ref' = 'msg-1:balance',
    v::text);
end $$;

do $$ declare v_ev jsonb; begin
  select detail into v_ev
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk1')
     and action = 'milestone_unpaid'
     and milestone_kind = 'balance'
   order by created_at desc
   limit 1;
  perform pg_temp.check('G62 a milestone_unpaid event exists for bk1 balance',
    v_ev is not null, coalesce(v_ev::text, 'no event'));
end $$;

do $$ declare v jsonb; begin
  v := public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk1'), 'balance',
    pg_temp.tok_m(pg_temp.bid('bk1'), 'balance'), '2028-02-01', 'email', 'msg-1:balance', true, 'payment-email-detect');
  perform pg_temp.check('G63 re-ticking with the same evidence ref reports evidence_already_used',
    (v->>'changed')::boolean = false and v->>'reason' = 'evidence_already_used', v::text);
end $$;

select pg_temp.refused('G64 unset_paid on an unpaid milestone refused',
  $q$select public.crm_booking_unset_paid('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk1'),'balance',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk1') and kind='balance'),'Staff1@Example.com')$q$,
  'not_paid');

-- G65: the partial unique index on (client_id, paid_evidence_ref) is enforced at table level.
do $$ declare v_err text := 'no error'; v_state text; begin
  begin
    update public.crm_booking_milestones
       set state = 'paid',
           paid_on = '2028-02-01',
           paid_source = 'email',
           paid_evidence_ref = 'msg-1:balance'
     where booking_id = pg_temp.bid('bk_again')
       and kind = 'deposit';
  exception when unique_violation then v_err := 'unique_violation';
  end;

  select state into v_state
    from public.crm_booking_milestones
   where booking_id = pg_temp.bid('bk_again')
     and kind = 'deposit';

  perform pg_temp.check('G65 the evidence unique index rejects a duplicate at table level',
    v_err = 'unique_violation' and v_state = 'unpaid',
    format('error=%s state=%s', v_err, v_state));
end $$;

-- G66: a staff re-tick after an undo must NOT clear the kept evidence ref (the same email stays blocked).
do $$ declare v jsonb; v2 jsonb; begin
  v := public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk1'), 'balance',
    pg_temp.tok_m(pg_temp.bid('bk1'), 'balance'), '2028-02-02', 'staff', null, false, 'Staff1@Example.com');
  perform pg_temp.check('G66a staff re-tick keeps the stored evidence ref',
    (v->>'changed')::boolean = true and v->'milestone'->>'paid_evidence_ref' = 'msg-1:balance', v::text);
  v2 := public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk_again'), 'deposit',
    pg_temp.tok_m(pg_temp.bid('bk_again'), 'deposit'), '2028-02-01', 'email', 'msg-1:balance', true, 'payment-email-detect');
  perform pg_temp.check('G66b the same email still cannot tick another milestone',
    (v2->>'changed')::boolean = false and v2->>'reason' = 'evidence_already_used', v2::text);
  perform public.crm_booking_unset_paid('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk1'), 'balance',
    pg_temp.tok_m(pg_temp.bid('bk1'), 'balance'), 'Staff1@Example.com');
end $$;

-- end of chunk B
-- start of chunk C
-- Chunk C of supabase/tests/crm_booking_tracker.test.sql
-- Behaviour checks for supabase/migrations/20261012200000_crm_booking_tracker.sql
-- (run after the tour catalog migrations and their test files, on a THROWAWAY local Postgres only).
-- Chunks A and B defined the fixtures, ctx table and pg_temp helpers; this chunk reuses them directly.
-- This is the last chunk: it ends with the final report query and the final do-block.

-- ---------------------------------------------------------------------------
-- G8 override_due / confirm_departure
-- ---------------------------------------------------------------------------
do $$ declare v jsonb; v_ev jsonb; begin
  v := public.crm_booking_override_due('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk1'), 'balance',
    pg_temp.tok_m(pg_temp.bid('bk1'), 'balance'), '2028-01-15', 'Staff1@Example.com');
  perform pg_temp.check('G70a override_due sets due_override_on and the live depart_on snapshot',
    (v->>'due_override_on')::date = '2028-01-15'
      and (v->>'due_override_depart_on')::date = '2028-03-01', v::text);

  select detail into v_ev
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk1')
     and action = 'due_overridden'
     and milestone_kind = 'balance'
   order by created_at desc
   limit 1;
  perform pg_temp.check('G70b a due_overridden event exists for balance',
    v_ev is not null and (v_ev->>'new_due_override_on')::date = '2028-01-15',
    coalesce(v_ev::text, 'no event'));
end $$;

do $$ declare v jsonb; v_ev jsonb; begin
  v := public.crm_booking_override_due('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk1'), 'balance',
    pg_temp.tok_m(pg_temp.bid('bk1'), 'balance'), null, 'Staff1@Example.com');
  perform pg_temp.check('G71a override_due with null clears both override columns',
    v->>'due_override_on' is null and v->>'due_override_depart_on' is null, v::text);

  select detail into v_ev
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk1')
     and action = 'due_overridden'
     and milestone_kind = 'balance'
   order by created_at desc
   limit 1;
  perform pg_temp.check('G71b clearing writes another due_overridden event',
    v_ev is not null and v_ev->>'new_due_override_on' is null,
    coalesce(v_ev::text, 'no event'));
end $$;

do $$ declare v jsonb; v_ev jsonb; v_snap date; begin
  -- Re-set an override, then move the live catalog departure date.
  v := public.crm_booking_override_due('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk1'), 'balance',
    pg_temp.tok_m(pg_temp.bid('bk1'), 'balance'), '2028-01-15', 'Staff1@Example.com');
  update public.tour_catalog_departures set depart_on = '2028-03-08', return_on = '2028-03-17'
   where id = 'aaaaaaaa-0000-0000-0000-0000000000d1';

  select departure_depart_on into v_snap from public.crm_bookings where id = pg_temp.bid('bk1');
  perform pg_temp.check('G72a the booking snapshot is still 2028-03-01 after the catalog moved',
    v_snap = '2028-03-01', coalesce(v_snap::text, 'null'));

  v := public.crm_booking_confirm_departure('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk1'),
    pg_temp.tok_b(pg_temp.bid('bk1')), 'Staff1@Example.com');
  perform pg_temp.check('G72b confirm_departure re-reads the live depart_on 2028-03-08',
    (v->>'departure_depart_on')::date = '2028-03-08', v::text);

  select detail into v_ev
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk1')
     and action = 'departure_confirmed'
   order by created_at desc
   limit 1;
  perform pg_temp.check('G72c a departure_confirmed event records old and new snapshots',
    v_ev is not null
      and (v_ev->>'old_departure_depart_on')::date = '2028-03-01'
      and (v_ev->>'new_departure_depart_on')::date = '2028-03-08',
    coalesce(v_ev::text, 'no event'));
end $$;

do $$ declare v_before timestamptz; v_after timestamptz; v_ev_before bigint; v_ev_after bigint; v jsonb; begin
  v_before := pg_temp.tok_b(pg_temp.bid('bk1'));
  select count(*) into v_ev_before from public.crm_booking_events where booking_id = pg_temp.bid('bk1');
  v := public.crm_booking_confirm_departure('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk1'),
    v_before, 'Staff1@Example.com');
  v_after := pg_temp.tok_b(pg_temp.bid('bk1'));
  select count(*) into v_ev_after from public.crm_booking_events where booking_id = pg_temp.bid('bk1');
  perform pg_temp.check('G73 confirm_departure again is a no-op (updated_at and event count unchanged)',
    v_after = v_before and v_ev_after = v_ev_before,
    format('before=%s after=%s ev_before=%s ev_after=%s', v_before, v_after, v_ev_before, v_ev_after));
end $$;

select pg_temp.refused('G74 confirm_departure on a cancelled booking refused',
  $q$select public.crm_booking_confirm_departure('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_other'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_other')),'Staff1@Example.com')$q$,
  'booking_not_active');

do $$ begin
  perform pg_temp.mk('bk_nodep', 'cccccccc-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001', null, '2028-01-20', null, null, null);
end $$;

select pg_temp.refused('G75 confirm_departure on a booking with no departure refused',
  $q$select public.crm_booking_confirm_departure('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_nodep'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_nodep')),'Staff1@Example.com')$q$,
  'departure_not_found');

do $$ declare v_snap date; begin
  delete from public.tour_catalog_departures where id = 'aaaaaaaa-0000-0000-0000-0000000000d3';
  select departure_depart_on into v_snap from public.crm_bookings where id = pg_temp.bid('bk_blank');
  perform pg_temp.check('G76a the bk_blank snapshot survives the catalog delete',
    v_snap = '2028-05-01', coalesce(v_snap::text, 'null'));
end $$;

select pg_temp.refused('G76b confirm_departure when the departure row is gone refused',
  $q$select public.crm_booking_confirm_departure('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_blank'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_blank')),'Staff1@Example.com')$q$,
  'departure_not_found');

-- ---------------------------------------------------------------------------
-- G9 nudge on bk_today deposit
-- ---------------------------------------------------------------------------
do $$ declare v jsonb; v_today date := (now() at time zone 'Pacific/Auckland')::date; begin
  v := public.crm_booking_nudge('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk_today'), 'deposit',
    pg_temp.tok_m(pg_temp.bid('bk_today'), 'deposit'), 'nudged_today', null, 'Staff1@Example.com');
  perform pg_temp.check('G77 nudged_today sets nudged_on today and remind_after tomorrow',
    (v->>'nudged_on')::date = v_today and (v->>'remind_after')::date = v_today + 1, v::text);
end $$;

do $$ declare v jsonb; v_today date := (now() at time zone 'Pacific/Auckland')::date; begin
  v := public.crm_booking_nudge('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk_today'), 'deposit',
    pg_temp.tok_m(pg_temp.bid('bk_today'), 'deposit'), 'snooze', 7, 'Staff1@Example.com');
  perform pg_temp.check('G78 snooze 7 sets remind_after today + 7',
    (v->>'remind_after')::date = v_today + 7, v::text);
end $$;

select pg_temp.refused('G79 snooze with 5 days refused',
  $q$select public.crm_booking_nudge('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_today'),'deposit',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk_today') and kind='deposit'),'snooze',5,'Staff1@Example.com')$q$,
  'invalid_days');

do $$ declare v jsonb; begin
  v := public.crm_booking_nudge('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk_today'), 'deposit',
    pg_temp.tok_m(pg_temp.bid('bk_today'), 'deposit'), 'quiet', null, 'Staff1@Example.com');
  perform pg_temp.check('G80 quiet sets quiet true',
    (v->>'quiet')::boolean = true, v::text);
end $$;

select pg_temp.refused('G81 nudge with an invalid mode refused',
  $q$select public.crm_booking_nudge('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_today'),'deposit',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk_today') and kind='deposit'),'x',null,'Staff1@Example.com')$q$,
  'invalid_mode');

do $$ declare v_n bigint; begin
  select count(*) into v_n
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk_today')
     and action = 'edited'
     and milestone_kind = 'deposit';
  perform pg_temp.check('G82 nudge writes edited events with milestone_kind deposit (>= 3)',
    v_n >= 3, v_n::text);
end $$;

-- ---------------------------------------------------------------------------
-- G10 cancel
-- ---------------------------------------------------------------------------
select pg_temp.refused('G83 cancel with a blank note refused',
  $q$select public.crm_booking_cancel('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_today'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_today')),'   ','Staff1@Example.com')$q$,
  'invalid_cancel_note');

select pg_temp.refused('G84 cancel with a 201-character note refused',
  $q$select public.crm_booking_cancel('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_today'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_today')),repeat('x',201),'Staff1@Example.com')$q$,
  'invalid_cancel_note');

do $$ declare v jsonb; begin
  v := public.crm_booking_cancel('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk_today'),
    pg_temp.tok_b(pg_temp.bid('bk_today')), 'CANCEL-SECRET-NOTE', 'Staff1@Example.com');
  perform pg_temp.check('G85 cancel bk_today stores status cancelled and the note',
    v->>'status' = 'cancelled' and v->>'cancel_note' = 'CANCEL-SECRET-NOTE', v::text);
end $$;

do $$ declare v_ev bigint; v_leak bigint; begin
  select count(*) into v_ev
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk_today') and action = 'cancelled';
  select count(*) into v_leak
    from public.crm_booking_events
   where detail::text like '%CANCEL-SECRET-NOTE%' or detail::text like '%SECRET-NOTE-TEXT%';
  perform pg_temp.check('G86a a cancelled event exists for bk_today', v_ev >= 1, v_ev::text);
  perform pg_temp.check('G86b no event detail leaks the note texts', v_leak = 0, v_leak::text);
end $$;

select pg_temp.refused('G87a set_paid on a cancelled booking refused',
  $q$select public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_today'),'deposit',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk_today') and kind='deposit'),'2028-02-01','staff',null,false,'Staff1@Example.com')$q$,
  'booking_not_active');

select pg_temp.refused('G87b override_due on a cancelled booking refused',
  $q$select public.crm_booking_override_due('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_today'),'deposit',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk_today') and kind='deposit'),'2028-02-01','Staff1@Example.com')$q$,
  'booking_not_active');

select pg_temp.refused('G87c nudge on a cancelled booking refused',
  $q$select public.crm_booking_nudge('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_today'),'deposit',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk_today') and kind='deposit'),'nudged_today',null,'Staff1@Example.com')$q$,
  'booking_not_active');

select pg_temp.refused('G87d update on a cancelled booking refused',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_today'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_today')),'{"party_size":4}','Staff1@Example.com')$q$,
  'booking_not_active');

select pg_temp.refused('G87e cancel again refused',
  $q$select public.crm_booking_cancel('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_today'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_today')),'again','Staff1@Example.com')$q$,
  'booking_not_active');

do $$ declare v_err text := 'no error'; begin
  begin
    update public.crm_bookings set cancel_note = null where id = pg_temp.bid('bk_today');
  exception when check_violation then v_err := 'check_violation'; when others then v_err := sqlerrm; end;
  perform pg_temp.check('G88 a cancelled booking cannot have a null cancel_note', v_err = 'check_violation', v_err);
end $$;

-- ---------------------------------------------------------------------------
-- G11 security
-- ---------------------------------------------------------------------------
insert into aresults
  select 'G90 RLS is on for the four tracker tables', count(*) = 4 and bool_and(relrowsecurity), count(*)::text
    from pg_class where relname in ('crm_booking_members','crm_bookings','crm_booking_milestones','crm_booking_events');

insert into aresults
  select 'G91 each tracker table has exactly one policy, for service_role only',
         count(*) = 4 and bool_and(roles = '{service_role}'), string_agg(tablename || roles::text, ' ')
    from pg_policies where tablename in ('crm_booking_members','crm_bookings','crm_booking_milestones','crm_booking_events');

insert into aresults
  select format('G92 %s has no %s on %s', r.rolname, pr.priv, t.tbl),
         not has_table_privilege(r.rolname, 'public.' || t.tbl, pr.priv), ''
    from (values ('crm_booking_members'), ('crm_bookings'), ('crm_booking_milestones'), ('crm_booking_events')) as t(tbl)
    cross join (values ('anon'), ('authenticated')) as r(rolname)
    cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate')) as pr(priv);

insert into aresults select 'G93 no SECURITY DEFINER among crm_booking functions', count(*) = 0, coalesce(string_agg(proname, ','), '')
  from pg_proc where proname like 'crm\_booking\_%' and prosecdef;

insert into aresults
  select format('G94 %s has no EXECUTE on %s', r.rolname, p.oid::regprocedure),
         not has_function_privilege(r.rolname, p.oid, 'execute'), ''
    from pg_proc p
    cross join (values ('anon'), ('authenticated')) as r(rolname)
   where p.pronamespace = 'public'::regnamespace
     and p.proname like 'crm\_booking\_%'
     and p.prorettype <> 'trigger'::regtype;

insert into aresults
  select format('G94b PUBLIC has no EXECUTE on %s', p.oid::regprocedure),
         not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'), ''
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like 'crm\_booking\_%'
     and p.prorettype <> 'trigger'::regtype;

insert into aresults
  select format('G94c service_role has EXECUTE on %s', p.oid::regprocedure),
         has_function_privilege('service_role', p.oid, 'execute'), ''
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like 'crm\_booking\_%'
     and p.prorettype <> 'trigger'::regtype;

-- 17 from 20261012200000_crm_booking_tracker.sql + 2 from 20261013100000_crm_booking_origin_evidence.sql
-- (crm_booking_create_with_origin, crm_booking_origin_immutable). Any further function must be added here on purpose.
insert into aresults select 'G94d exactly 19 functions named crm_booking_% exist', count(*) = 19, count(*)::text
  from pg_proc where pronamespace = 'public'::regnamespace and proname like 'crm\_booking\_%';

set role anon;
select pg_temp.denied('G95 anon cannot read crm_booking_members', 'select count(*) from public.crm_booking_members');
select pg_temp.denied('G95 anon cannot read crm_bookings', 'select count(*) from public.crm_bookings');
select pg_temp.denied('G95 anon cannot read crm_booking_milestones', 'select count(*) from public.crm_booking_milestones');
select pg_temp.denied('G95 anon cannot read crm_booking_events', 'select count(*) from public.crm_booking_events');
select pg_temp.denied('G95 anon cannot call crm_booking_create',
  $q$select public.crm_booking_create('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',null,'2028-01-16',null,null,null,'x@y.zz')$q$);
select pg_temp.denied('G95 anon cannot call crm_booking_set_paid',
  $q$select public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','deposit',now(),'2028-02-01','staff',null,false,'x@y.zz')$q$);
select pg_temp.denied('G95 anon cannot call crm_booking_erase_actor_email',
  $q$select public.crm_booking_erase_actor_email('00000000-0000-0000-0000-0000000000a1','x@y.zz','x@y.zz')$q$);
reset role;

set role authenticated;
select pg_temp.denied('G95 authenticated cannot read crm_booking_members', 'select count(*) from public.crm_booking_members');
select pg_temp.denied('G95 authenticated cannot read crm_bookings', 'select count(*) from public.crm_bookings');
select pg_temp.denied('G95 authenticated cannot read crm_booking_milestones', 'select count(*) from public.crm_booking_milestones');
select pg_temp.denied('G95 authenticated cannot read crm_booking_events', 'select count(*) from public.crm_booking_events');
select pg_temp.denied('G95 authenticated cannot call crm_booking_create',
  $q$select public.crm_booking_create('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',null,'2028-01-16',null,null,null,'x@y.zz')$q$);
select pg_temp.denied('G95 authenticated cannot call crm_booking_set_paid',
  $q$select public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','deposit',now(),'2028-02-01','staff',null,false,'x@y.zz')$q$);
select pg_temp.denied('G95 authenticated cannot call crm_booking_erase_actor_email',
  $q$select public.crm_booking_erase_actor_email('00000000-0000-0000-0000-0000000000a1','x@y.zz','x@y.zz')$q$);
reset role;

-- ---------------------------------------------------------------------------
-- G12 events integrity
-- ---------------------------------------------------------------------------
select pg_temp.refused('G100 update of crm_booking_events detail refused',
  $q$update public.crm_booking_events set detail = '{}'$q$, 'crm_booking_events_append_only');
select pg_temp.refused('G100b update of crm_booking_events action refused',
  $q$update public.crm_booking_events set action = 'edited'$q$, 'crm_booking_events_append_only');
select pg_temp.refused('G101 delete from crm_booking_events refused',
  $q$delete from public.crm_booking_events$q$, 'crm_booking_events_append_only');
select pg_temp.refused('G102 truncate crm_booking_events refused',
  $q$truncate public.crm_booking_events$q$, 'crm_booking_events_append_only');
select pg_temp.refused('G103 update of actor_email without the erase flag refused',
  $q$update public.crm_booking_events set actor_email = null$q$, 'crm_booking_events_append_only');

do $$ declare v_err text := 'no error'; begin
  perform set_config('crm_booking.erase', 'on', true);
  begin
    update public.crm_booking_events set actor_email = null, detail = '{}';
  exception when others then v_err := sqlerrm; end;
  perform set_config('crm_booking.erase', '', true);
  perform pg_temp.check('G104 erase flag does not allow changing detail too',
    v_err = 'crm_booking_events_append_only', v_err);
end $$;

insert into aresults
  select 'G105 every events row has a client_id and a valid source',
         count(*) = 0, count(*)::text
    from public.crm_booking_events
   where client_id is null or source not in ('staff','email','system');

-- ---------------------------------------------------------------------------
-- G13 cascade & erase
-- ---------------------------------------------------------------------------
do $$ declare v_ev_before bigint; v_ev_after bigint; v_bk bigint; v_ms bigint; begin
  insert into public.contacts(id, client_id) values ('cccccccc-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000a1');
  perform pg_temp.mk('bk_cascade', 'cccccccc-0000-0000-0000-0000000000a9', 'aaaaaaaa-0000-0000-0000-000000000002', null, '2028-01-21', null, null, null);
  select count(*) into v_ev_before from public.crm_booking_events where booking_id = pg_temp.bid('bk_cascade');

  delete from public.contacts where id = 'cccccccc-0000-0000-0000-0000000000a9';

  select count(*) into v_bk from public.crm_bookings where id = pg_temp.bid('bk_cascade');
  select count(*) into v_ms from public.crm_booking_milestones where booking_id = pg_temp.bid('bk_cascade');
  select count(*) into v_ev_after from public.crm_booking_events where booking_id = pg_temp.bid('bk_cascade');

  perform pg_temp.check('G110a deleting the contact cascades the booking and its milestones',
    v_bk = 0 and v_ms = 0, format('bookings=%s milestones=%s', v_bk, v_ms));
  perform pg_temp.check('G110b the events rows for the deleted booking survive',
    v_ev_after >= v_ev_before and v_ev_before > 0, format('before=%s after=%s', v_ev_before, v_ev_after));
end $$;

do $$ declare v_n bigint; v_ret integer; v_after bigint; v_total_before bigint; v_total_after bigint; v_fp_before text; v_fp_after text; begin
  select count(*) into v_n from public.crm_booking_events where actor_email = 'staff1@example.com';
  select count(*) into v_total_before from public.crm_booking_events;
  select md5(string_agg(id::text || client_id::text || booking_id::text || coalesce(milestone_kind,'') || action || detail::text || source || created_at::text, '|' order by id))
    into v_fp_before from public.crm_booking_events;

  v_ret := public.crm_booking_erase_actor_email('00000000-0000-0000-0000-0000000000a1', ' Staff1@Example.com ', 'Admin@Example.com');

  select count(*) into v_after from public.crm_booking_events where actor_email = 'staff1@example.com';
  select count(*) into v_total_after from public.crm_booking_events;
  select md5(string_agg(id::text || client_id::text || booking_id::text || coalesce(milestone_kind,'') || action || detail::text || source || created_at::text, '|' order by id))
    into v_fp_after from public.crm_booking_events where action <> 'actor_erased';

  perform pg_temp.check('G111a erase returns the number of rows it cleared',
    v_ret = v_n and v_n > 0, format('returned=%s expected=%s', v_ret, v_n));
  perform pg_temp.check('G111b no events remain for that email', v_after = 0, v_after::text);
  perform pg_temp.check('G111c the total event count grows by exactly the one actor_erased event', v_total_after = v_total_before + 1,
    format('before=%s after=%s', v_total_before, v_total_after));
  perform pg_temp.check('G111d every other column is unchanged', v_fp_after = v_fp_before,
    format('before=%s after=%s', v_fp_before, v_fp_after));
end $$;

do $$ declare v_ret integer; v_before text; v_after text; begin
  select md5(string_agg(to_jsonb(e)::text, '|' order by e.id)) into v_before from public.crm_booking_events e where action <> 'actor_erased';
  v_ret := public.crm_booking_erase_actor_email('00000000-0000-0000-0000-0000000000b2', 'staff1@example.com', 'Admin@Example.com');
  select md5(string_agg(to_jsonb(e)::text, '|' order by e.id)) into v_after from public.crm_booking_events e where action <> 'actor_erased';
  perform pg_temp.check('G112 erase for client B returns 0 and changes no other event',
    v_ret = 0 and v_after = v_before, format('returned=%s', v_ret));
end $$;

select pg_temp.refused('G113 erase with a blank email refused',
  $q$select public.crm_booking_erase_actor_email('00000000-0000-0000-0000-0000000000a1','   ','Admin@Example.com')$q$,
  'invalid_email');

select pg_temp.refused('G114 the events table is still protected after an erase',
  $q$update public.crm_booking_events set detail = '{}'$q$, 'crm_booking_events_append_only');

-- ---------------------------------------------------------------------------
-- G14 members table
-- ---------------------------------------------------------------------------
do $$ declare v_err text; begin
  v_err := 'no error';
  begin
    insert into public.crm_booking_members(client_id, email, granted_by) values ('00000000-0000-0000-0000-0000000000a1', 'Mixed@Case.com', 'admin');
  exception when check_violation then v_err := 'check_violation'; when others then v_err := sqlerrm; end;
  perform pg_temp.check('G120a a mixed-case member email is refused', v_err = 'check_violation', v_err);

  v_err := 'no error';
  begin
    insert into public.crm_booking_members(client_id, email, granted_by) values ('00000000-0000-0000-0000-0000000000a1', 'ok@case.com', 'admin');
  exception when others then v_err := sqlerrm; end;
  perform pg_temp.check('G120b a lower-case member email is accepted', v_err = 'no error', v_err);

  v_err := 'no error';
  begin
    insert into public.crm_booking_members(client_id, email, granted_by) values ('00000000-0000-0000-0000-0000000000a1', 'ok@case.com', 'admin');
  exception when unique_violation then v_err := 'unique_violation'; when others then v_err := sqlerrm; end;
  perform pg_temp.check('G120c a duplicate (client, email) is refused', v_err = 'unique_violation', v_err);

  v_err := 'no error';
  begin
    insert into public.crm_booking_members(client_id, email, granted_by) values ('00000000-0000-0000-0000-0000000000a1', 'other@case.com', '   ');
  exception when check_violation then v_err := 'check_violation'; when others then v_err := sqlerrm; end;
  perform pg_temp.check('G120d a blank granted_by is refused', v_err = 'check_violation', v_err);

  delete from public.crm_booking_members where client_id = '00000000-0000-0000-0000-0000000000a1' and email = 'ok@case.com';
end $$;

-- ---------------------------------------------------------------------------
-- Final report
-- ---------------------------------------------------------------------------
-- Chunk D of supabase/tests/crm_booking_tracker.test.sql
-- Behaviour checks for supabase/migrations/20261012200000_crm_booking_tracker.sql
-- (run after the tour catalog migrations and their test files, on a THROWAWAY local Postgres only).
-- Chunks A, B and C defined the fixtures, ctx table and pg_temp helpers; this chunk reuses them
-- directly and is inserted just before the final report query and the final do-block.
-- State at this point: bk1 (active), bk_blank (active, ca3, TA2, its departure DA2 was deleted),
-- bk_again (active, ca1, TA1, DA1b, live depart_on 2028-04-01), bk_today (cancelled).

-- ---------------------------------------------------------------------------
-- S1 direct writes (run as superuser; the triggers must fire anyway)
-- ---------------------------------------------------------------------------
select pg_temp.refused('G130 direct insert with a client B contact refused',
  $q$insert into public.crm_bookings(client_id, contact_id, tour_id, booked_on, created_by) values ('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000b1','aaaaaaaa-0000-0000-0000-000000000001','2028-01-01','x@y.zz')$q$,
  'cross_client_reference:contact_id%');

select pg_temp.refused('G131 direct insert with a client B tour refused',
  $q$insert into public.crm_bookings(client_id, contact_id, tour_id, booked_on, created_by) values ('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-000000000001','2028-01-01','x@y.zz')$q$,
  'cross_client_reference:tour_id%');

select pg_temp.refused('G132 direct insert with a client B departure refused',
  $q$insert into public.crm_bookings(client_id, contact_id, tour_id, departure_id, departure_depart_on, booked_on, created_by) values ('00000000-0000-0000-0000-0000000000a1','cccccccc-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-0000000000d1','2028-03-01','2028-01-01','x@y.zz')$q$,
  'cross_client_reference:departure_id%');

select pg_temp.refused('G133 direct update to a client B tour refused',
  $q$update public.crm_bookings set tour_id = 'bbbbbbbb-0000-0000-0000-000000000001' where id = (select v::uuid from ctx where k='bk1')$q$,
  'cross_client_reference:tour_id%');

select pg_temp.refused('G134 direct update to a client B contact refused',
  $q$update public.crm_bookings set contact_id = 'cccccccc-0000-0000-0000-0000000000b1' where id = (select v::uuid from ctx where k='bk1')$q$,
  'cross_client_reference:contact_id%');

do $$ begin
  perform pg_temp.mk('bk_s1', 'cccccccc-0000-0000-0000-0000000000a3', 'aaaaaaaa-0000-0000-0000-000000000001', null, '2028-01-22', null, null, null);
  delete from public.crm_booking_milestones where booking_id = pg_temp.bid('bk_s1');
end $$;

select pg_temp.refused('G135 direct milestone insert with a client B client_id refused',
  $q$insert into public.crm_booking_milestones(booking_id, client_id, kind) values ((select v::uuid from ctx where k='bk_s1'),'00000000-0000-0000-0000-0000000000b2','deposit')$q$,
  'cross_client_reference:booking%');

select pg_temp.refused('G136 direct milestone update to a client B client_id refused',
  $q$update public.crm_booking_milestones set client_id = '00000000-0000-0000-0000-0000000000b2' where booking_id = (select v::uuid from ctx where k='bk1') and kind = 'deposit'$q$,
  'cross_client_reference:booking%');

do $$ declare v jsonb; begin
  update public.crm_bookings set party_size = 5 where id = pg_temp.bid('bk_blank');
  select to_jsonb(b) into v from public.crm_bookings b where b.id = pg_temp.bid('bk_blank');
  perform pg_temp.check('G137 a non-reference direct update still works when the catalog departure is gone',
    (v->>'party_size')::int = 5, v::text);
end $$;

do $$ declare v jsonb; begin
  insert into public.crm_booking_milestones(booking_id, client_id, kind)
  values (pg_temp.bid('bk_s1'), '00000000-0000-0000-0000-0000000000a1', 'deposit');
  select to_jsonb(m) into v from public.crm_booking_milestones m
   where m.booking_id = pg_temp.bid('bk_s1') and m.kind = 'deposit';
  perform pg_temp.check('G138 a direct milestone re-insert with the right client works',
    v is not null and v->>'state' = 'unpaid', coalesce(v::text, 'no row'));
end $$;

-- ---------------------------------------------------------------------------
-- S2 audit completeness
-- ---------------------------------------------------------------------------
do $$ declare v jsonb; v_created bigint; v_mc bigint; begin
  v := public.crm_booking_create('00000000-0000-0000-0000-0000000000a1',
    'cccccccc-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001',
    null, '2028-01-23', null, null, 'DEL-SECRET', 'Staff1@Example.com');
  insert into ctx(k, v) values ('bk_s2', v->>'id') on conflict (k) do update set v = excluded.v;

  select count(*) into v_created
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk_s2') and action = 'created';
  select count(*) into v_mc
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk_s2') and action = 'milestone_created';

  perform pg_temp.check('G140 a created booking writes one created and two milestone_created events',
    v_created = 1 and v_mc = 2, format('created=%s milestone_created=%s', v_created, v_mc));
end $$;

do $$ declare v_ev jsonb; v_n bigint; begin
  delete from public.crm_booking_milestones
   where booking_id = pg_temp.bid('bk_s2') and kind = 'balance';

  select count(*) into v_n
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk_s2') and action = 'milestone_deleted' and milestone_kind = 'balance';

  select detail into v_ev
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk_s2') and action = 'milestone_deleted' and milestone_kind = 'balance'
   order by created_at desc, id desc
   limit 1;

  perform pg_temp.check('G141 a direct milestone delete writes one milestone_deleted event for balance',
    v_n = 1 and v_ev is not null and v_ev->>'kind' = 'balance',
    format('events=%s detail=%s', v_n, coalesce(v_ev::text, 'no event')));
end $$;

do $$ declare v_bd bigint; v_md bigint; v_leak bigint; begin
  delete from public.crm_bookings where id = pg_temp.bid('bk_s2');

  select count(*) into v_bd
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk_s2') and action = 'booking_deleted';
  select count(*) into v_md
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk_s2') and action = 'milestone_deleted' and milestone_kind = 'deposit';
  select count(*) into v_leak
    from public.crm_booking_events
   where detail::text like '%DEL-SECRET%';

  perform pg_temp.check('G142a a direct booking delete writes one booking_deleted event',
    v_bd = 1, v_bd::text);
  perform pg_temp.check('G142b the cascaded deposit milestone writes a milestone_deleted event',
    v_md = 1, v_md::text);
  perform pg_temp.check('G142c no event detail leaks the booking note', v_leak = 0, v_leak::text);
end $$;

do $$ declare v_n bigint; begin
  select count(*) into v_n
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk_s2');
  perform pg_temp.check('G143 all events for the deleted booking survive (>= 4)',
    v_n >= 4, v_n::text);
end $$;

do $$ declare v_bk bigint; v_ms bigint; v_bd bigint; v_md bigint; v_leak bigint; begin
  insert into public.contacts(id, client_id) values ('cccccccc-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000a1');
  perform pg_temp.mk('bk_cc', 'cccccccc-0000-0000-0000-0000000000b9', 'aaaaaaaa-0000-0000-0000-000000000002', null, null, null, null, 'CC-SECRET');

  delete from public.contacts where id = 'cccccccc-0000-0000-0000-0000000000b9';

  select count(*) into v_bk from public.crm_bookings where id = pg_temp.bid('bk_cc');
  select count(*) into v_ms from public.crm_booking_milestones where booking_id = pg_temp.bid('bk_cc');
  select count(*) into v_bd from public.crm_booking_events where booking_id = pg_temp.bid('bk_cc') and action = 'booking_deleted';
  select count(*) into v_md from public.crm_booking_events where booking_id = pg_temp.bid('bk_cc') and action = 'milestone_deleted';
  select count(*) into v_leak from public.crm_booking_events where detail::text like '%CC-SECRET%';

  perform pg_temp.check('G144a the contact cascade removes the booking and its milestones',
    v_bk = 0 and v_ms = 0, format('bookings=%s milestones=%s', v_bk, v_ms));
  perform pg_temp.check('G144b the cascade writes one booking_deleted and two milestone_deleted events',
    v_bd = 1 and v_md = 2, format('booking_deleted=%s milestone_deleted=%s', v_bd, v_md));
  perform pg_temp.check('G144c no event detail leaks the booking note', v_leak = 0, v_leak::text);
end $$;

-- ---------------------------------------------------------------------------
-- S3 check constraint
-- ---------------------------------------------------------------------------
select pg_temp.refused('G150 an email tick without an evidence ref is refused by the check constraint',
  $q$update public.crm_booking_milestones set state = 'paid', paid_on = '2028-02-01', paid_source = 'email', paid_evidence_ref = null where booking_id = (select v::uuid from ctx where k='bk_again') and kind = 'deposit'$q$,
  'new row for relation "crm_booking_milestones" violates check constraint%');

do $$ declare v jsonb; begin
  update public.crm_booking_milestones
     set state = 'paid',
         paid_on = '2028-02-01',
         paid_source = 'staff',
         paid_evidence_ref = 'keep-ref-1'
   where booking_id = pg_temp.bid('bk_again')
     and kind = 'deposit';

  select to_jsonb(m) into v from public.crm_booking_milestones m
   where m.booking_id = pg_temp.bid('bk_again') and m.kind = 'deposit';

  perform pg_temp.check('G151 a staff tick may keep an old evidence ref',
    v is not null and v->>'state' = 'paid' and v->>'paid_source' = 'staff'
      and v->>'paid_evidence_ref' = 'keep-ref-1',
    coalesce(v::text, 'no row'));

  update public.crm_booking_milestones
     set state = 'unpaid',
         paid_on = null,
         paid_source = null,
         paid_evidence_ref = null
   where booking_id = pg_temp.bid('bk_again')
     and kind = 'deposit';
end $$;

-- ---------------------------------------------------------------------------
-- S4 setting residue
-- ---------------------------------------------------------------------------
do $$ declare v jsonb; v_ev jsonb; begin
  update public.tour_catalog_departures set depart_on = '2028-04-05'
   where id = 'aaaaaaaa-0000-0000-0000-0000000000d2';

  v := public.crm_booking_confirm_departure('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk_again'),
    pg_temp.tok_b(pg_temp.bid('bk_again')), 'Staff1@Example.com');

  perform pg_temp.check('G160a confirm_departure re-reads the moved live depart_on',
    (v->>'departure_depart_on')::date = '2028-04-05', v::text);

  perform pg_temp.check('G160b the function leaves no session settings behind',
    coalesce(current_setting('crm_booking.action', true), '') = ''
      and coalesce(current_setting('crm_booking.actor', true), '') = ''
      and coalesce(current_setting('crm_booking.source', true), '') = '',
    format('action=%s actor=%s source=%s',
      coalesce(current_setting('crm_booking.action', true), '<null>'),
      coalesce(current_setting('crm_booking.actor', true), '<null>'),
      coalesce(current_setting('crm_booking.source', true), '<null>')));

  update public.crm_bookings set party_size = 6 where id = pg_temp.bid('bk_again');

  select detail into v_ev
    from public.crm_booking_events
   where booking_id = pg_temp.bid('bk_again')
   order by created_at desc, id desc
   limit 1;

  perform pg_temp.check('G160c a later direct update is audited as system with a null actor',
    v_ev is not null
      and (select action from public.crm_booking_events
            where booking_id = pg_temp.bid('bk_again') order by created_at desc, id desc limit 1) = 'edited'
      and (select actor_email from public.crm_booking_events
            where booking_id = pg_temp.bid('bk_again') order by created_at desc, id desc limit 1) is null
      and (select source from public.crm_booking_events
            where booking_id = pg_temp.bid('bk_again') order by created_at desc, id desc limit 1) = 'system',
    coalesce(v_ev::text, 'no event'));
end $$;

do $$ declare v_ret integer; v_err text := 'no error'; begin
  v_ret := public.crm_booking_erase_actor_email('00000000-0000-0000-0000-0000000000a1', 'nobody@example.com', 'Admin@Example.com');

  begin
    update public.crm_booking_events set detail = '{}'::jsonb
     where id = (select id from public.crm_booking_events limit 1);
  exception when others then v_err := sqlerrm;
  end;

  perform pg_temp.check('G161a erasing an unknown email returns 0', v_ret = 0, v_ret::text);
  perform pg_temp.check('G161b the erase flag does not leak out of the function',
    v_err = 'crm_booking_events_append_only'
      and coalesce(current_setting('crm_booking.erase', true), '') = '',
    format('error=%s erase=%s', v_err, coalesce(current_setting('crm_booking.erase', true), '<null>')));
end $$;

do $$ declare v jsonb; begin
  v := public.crm_booking_nudge('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk1'), 'deposit',
    pg_temp.tok_m(pg_temp.bid('bk1'), 'deposit'), 'quiet', null, 'Staff1@Example.com');

  perform pg_temp.check('G162 nudge leaves no session settings behind',
    coalesce(current_setting('crm_booking.action', true), '') = ''
      and coalesce(current_setting('crm_booking.actor', true), '') = ''
      and coalesce(current_setting('crm_booking.source', true), '') = '',
    format('action=%s actor=%s source=%s',
      coalesce(current_setting('crm_booking.action', true), '<null>'),
      coalesce(current_setting('crm_booking.actor', true), '<null>'),
      coalesce(current_setting('crm_booking.source', true), '<null>')));
end $$;

-- ---------------------------------------------------------------------------
-- S5 erasure of created_by / granted_by
-- ---------------------------------------------------------------------------
do $$ declare v_pre bigint; v jsonb; v_before bigint; v_ret integer; v_after bigint; v_ev jsonb; v_new bigint; v_created_by text; v_created_by2 text; v_g1 text; v_g2 text; begin
  insert into public.crm_booking_members(client_id, email, granted_by) values
    ('00000000-0000-0000-0000-0000000000a1', 'm1@x.zz', 'Gone@Example.com'),
    ('00000000-0000-0000-0000-0000000000b2', 'm2@x.zz', 'Gone@Example.com');

  v := public.crm_booking_create('00000000-0000-0000-0000-0000000000a1',
    'cccccccc-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000002',
    null, null, null, null, null, 'Gone@Example.com');
  insert into ctx(k, v) values ('bk_gone', v->>'id') on conflict (k) do update set v = excluded.v;

  v := public.crm_booking_create('00000000-0000-0000-0000-0000000000a1',
    'cccccccc-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000002',
    null, null, null, null, null, 'gone@example.com.au');
  insert into ctx(k, v) values ('bk_gone2', v->>'id') on conflict (k) do update set v = excluded.v;

  select count(*) into v_before
    from public.crm_booking_events
   where client_id = '00000000-0000-0000-0000-0000000000a1' and actor_email = 'gone@example.com';

  select count(*) into v_pre from public.crm_booking_events where action = 'actor_erased';
  v_ret := public.crm_booking_erase_actor_email('00000000-0000-0000-0000-0000000000a1', ' GONE@example.com ', 'Admin@Example.com');

  select created_by into v_created_by from public.crm_bookings where id = pg_temp.bid('bk_gone');
  select created_by into v_created_by2 from public.crm_bookings where id = pg_temp.bid('bk_gone2');
  select granted_by into v_g1 from public.crm_booking_members
   where client_id = '00000000-0000-0000-0000-0000000000a1' and email = 'm1@x.zz';
  select granted_by into v_g2 from public.crm_booking_members
   where client_id = '00000000-0000-0000-0000-0000000000b2' and email = 'm2@x.zz';

  select count(*) into v_after
    from public.crm_booking_events
   where client_id = '00000000-0000-0000-0000-0000000000a1' and actor_email = 'gone@example.com';

  select count(*) - v_pre into v_new
    from public.crm_booking_events
   where action = 'actor_erased';

  select to_jsonb(e) into v_ev
    from public.crm_booking_events e
   where e.client_id = '00000000-0000-0000-0000-0000000000a1' and e.action = 'actor_erased'
   order by e.created_at desc, e.id desc
   limit 1;

  perform pg_temp.check('G170a erase returns the number of cleared events',
    v_ret = v_before and v_before > 0, format('returned=%s expected=%s', v_ret, v_before));
  perform pg_temp.check('G170b the erased booking created_by becomes (erased)',
    v_created_by = '(erased)', coalesce(v_created_by, 'null'));
  perform pg_temp.check('G170c the exact-match control booking is untouched',
    v_created_by2 = 'gone@example.com.au', coalesce(v_created_by2, 'null'));
  perform pg_temp.check('G170d the client A member granted_by becomes (erased)',
    v_g1 = '(erased)', coalesce(v_g1, 'null'));
  perform pg_temp.check('G170e the client B member is untouched',
    v_g2 = 'Gone@Example.com', coalesce(v_g2, 'null'));
  perform pg_temp.check('G170f no events remain for the erased email', v_after = 0, v_after::text);
  perform pg_temp.check('G170g exactly one new actor_erased event with the right shape',
    v_new = 1 and v_ev is not null
      and v_ev->>'booking_id' = '00000000-0000-0000-0000-000000000000'
      and v_ev->>'client_id' = '00000000-0000-0000-0000-0000000000a1'
      and (v_ev->'detail'->>'rows')::int = v_ret
      and v_ev->>'actor_email' = 'admin@example.com'
      and v_ev->>'source' = 'staff'
      and (v_ev->'detail')::text not like '%gone%',
    coalesce(v_ev::text, 'no event'));
end $$;

do $$ declare v_gone bigint; v_kept bigint; begin
  select count(*) into v_gone
    from public.crm_booking_events
   where client_id = '00000000-0000-0000-0000-0000000000a1' and actor_email = 'gone@example.com';
  select count(*) into v_kept
    from public.crm_booking_events
   where actor_email = 'gone@example.com.au';

  perform pg_temp.check('G171a no client A event keeps the erased email', v_gone = 0, v_gone::text);
  perform pg_temp.check('G171b the near-miss email is still present', v_kept > 0, v_kept::text);
end $$;

do $$ begin
  delete from public.crm_booking_members
   where (client_id = '00000000-0000-0000-0000-0000000000a1' and email = 'm1@x.zz')
      or (client_id = '00000000-0000-0000-0000-0000000000b2' and email = 'm2@x.zz');
  perform pg_temp.check('G172 the two test members are cleaned up',
    (select count(*) from public.crm_booking_members where email in ('m1@x.zz','m2@x.zz')) = 0, '');
end $$;

-- ---------------------------------------------------------------------------
-- S6 named patch errors
-- ---------------------------------------------------------------------------
select pg_temp.refused('G180 update with a malformed booked_on refused',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_blank'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_blank')),'{"booked_on":"not-a-date"}','Staff1@Example.com')$q$,
  'invalid_patch:booked_on');

select pg_temp.refused('G181 update with a malformed tour_id refused',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_blank'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_blank')),'{"tour_id":"zzz"}','Staff1@Example.com')$q$,
  'invalid_patch:tour_id');

select pg_temp.refused('G182 update with a malformed departure_id refused',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_blank'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_blank')),'{"departure_id":"zzz"}','Staff1@Example.com')$q$,
  'invalid_patch:departure_id');

select pg_temp.refused('G183 update with a non-numeric party_size refused',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_blank'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_blank')),'{"party_size":"abc"}','Staff1@Example.com')$q$,
  'invalid_patch:party_size');

select pg_temp.refused('G184 update with party_size 61 refused',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_blank'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_blank')),'{"party_size":61}','Staff1@Example.com')$q$,
  'invalid_patch:party_size');

select pg_temp.refused('G185 update with party_size 0 refused',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_blank'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_blank')),'{"party_size":0}','Staff1@Example.com')$q$,
  'invalid_patch:party_size');

select pg_temp.refused('G186 update with a non-boolean is_cruise refused',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_blank'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_blank')),'{"is_cruise":"maybe"}','Staff1@Example.com')$q$,
  'invalid_patch:is_cruise');

select pg_temp.refused('G187 update with a non-string note refused',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_blank'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_blank')),'{"note":123}','Staff1@Example.com')$q$,
  'invalid_patch:note');

select pg_temp.refused('G188 update with a 501-character note refused',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_blank'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_blank')),jsonb_build_object('note', repeat('x',501)),'Staff1@Example.com')$q$,
  'invalid_patch:note');

select pg_temp.refused('G189 update with an array patch refused',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_blank'),(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_blank')),'[1]','Staff1@Example.com')$q$,
  'invalid_patch:patch');

do $$ declare v jsonb; begin
  v := public.crm_booking_update('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk_blank'),
    pg_temp.tok_b(pg_temp.bid('bk_blank')), '{"party_size":7}', 'Staff1@Example.com');
  perform pg_temp.check('G190 a valid patch still works on bk_blank',
    (v->>'party_size')::int = 7, v::text);
end $$;

-- ---------------------------------------------------------------------------
-- S7 distinct concurrency tokens per object
-- ---------------------------------------------------------------------------
do $$ begin
  perform pg_temp.mk('bk_tok', 'cccccccc-0000-0000-0000-0000000000a3', 'aaaaaaaa-0000-0000-0000-000000000002', null, '2028-02-07', null, null, null);
end $$;

do $$ declare v_b timestamptz; v_d timestamptz; v_bal timestamptz; begin
  v_b := pg_temp.tok_b(pg_temp.bid('bk_tok'));
  v_d := pg_temp.tok_m(pg_temp.bid('bk_tok'), 'deposit');
  v_bal := pg_temp.tok_m(pg_temp.bid('bk_tok'), 'balance');
  perform pg_temp.check('G200 booking, deposit and balance updated_at are three distinct ordered tokens',
    v_b < v_d and v_d < v_bal,
    format('booking=%s deposit=%s balance=%s', v_b, v_d, v_bal));
end $$;

select pg_temp.refused('G201a nudge refuses the booking token',
  $q$select public.crm_booking_nudge('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_tok'),'deposit',(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_tok')),'quiet',null,'Staff1@Example.com')$q$,
  'conflict:stale:%');

select pg_temp.refused('G201b set_paid refuses the booking token',
  $q$select public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_tok'),'balance',(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_tok')),'2028-02-08','staff',null,false,'Staff1@Example.com')$q$,
  'conflict:stale:%');

select pg_temp.refused('G201c override_due refuses the booking token',
  $q$select public.crm_booking_override_due('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_tok'),'deposit',(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_tok')),'2028-02-09','Staff1@Example.com')$q$,
  'conflict:stale:%');

select pg_temp.refused('G201d unset_paid refuses the booking token',
  $q$select public.crm_booking_unset_paid('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_tok'),'deposit',(select updated_at from public.crm_bookings where id=(select v::uuid from ctx where k='bk_tok')),'Staff1@Example.com')$q$,
  'conflict:stale:%');

select pg_temp.refused('G202a nudge on balance refuses the deposit token',
  $q$select public.crm_booking_nudge('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_tok'),'balance',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk_tok') and kind='deposit'),'quiet',null,'Staff1@Example.com')$q$,
  'conflict:stale:%');

select pg_temp.refused('G202b nudge on deposit refuses the balance token',
  $q$select public.crm_booking_nudge('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_tok'),'deposit',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk_tok') and kind='balance'),'quiet',null,'Staff1@Example.com')$q$,
  'conflict:stale:%');

select pg_temp.refused('G202c set_paid on deposit refuses the balance token',
  $q$select public.crm_booking_set_paid('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_tok'),'deposit',(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk_tok') and kind='balance'),'2028-02-08','staff',null,false,'Staff1@Example.com')$q$,
  'conflict:stale:%');

select pg_temp.refused('G203a update refuses the deposit token',
  $q$select public.crm_booking_update('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_tok'),(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk_tok') and kind='deposit'),'{"party_size":3}','Staff1@Example.com')$q$,
  'conflict:stale:%');

select pg_temp.refused('G203b cancel refuses the deposit token',
  $q$select public.crm_booking_cancel('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_tok'),(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk_tok') and kind='deposit'),'nope','Staff1@Example.com')$q$,
  'conflict:stale:%');

select pg_temp.refused('G203c confirm_departure refuses the balance token',
  $q$select public.crm_booking_confirm_departure('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_tok'),(select updated_at from public.crm_booking_milestones where booking_id=(select v::uuid from ctx where k='bk_tok') and kind='balance'),'Staff1@Example.com')$q$,
  'conflict:stale:%');

do $$ declare v_old timestamptz; v jsonb; begin
  v_old := pg_temp.tok_m(pg_temp.bid('bk_tok'), 'deposit');
  v := public.crm_booking_nudge('00000000-0000-0000-0000-0000000000a1', pg_temp.bid('bk_tok'), 'deposit',
    v_old, 'nudged_today', null, 'Staff1@Example.com');
  perform pg_temp.check('G204a nudge with the current deposit token succeeds',
    (v->>'nudged_on') is not null, v::text);
end $$;

select pg_temp.refused('G204b nudge with the now-stale deposit token refused',
  $q$select public.crm_booking_nudge('00000000-0000-0000-0000-0000000000a1',(select v::uuid from ctx where k='bk_tok'),'deposit',(select v::timestamptz from ctx where k='old_tok'),'quiet',null,'Staff1@Example.com')$q$,
  'conflict:stale:%');

-- end of chunk D

select name, case when ok then 'PASS' else 'FAIL' end as r, left(detail, 160) as detail from aresults order by name;
do $$ begin if exists (select 1 from aresults where ok is not true) then raise exception 'crm booking tracker checks FAILED'; end if; end $$;
