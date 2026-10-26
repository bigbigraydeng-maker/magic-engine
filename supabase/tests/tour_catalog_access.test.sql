-- Behaviour checks for supabase/migrations/20261010300000_tour_catalog_access.sql (run after the three
-- earlier migrations and their test files, on a THROWAWAY local Postgres only).
-- A = client a1, B = client b2. Every "refused" check also proves the other client's rows did not move.
create temp table aresults(name text, ok boolean, detail text); grant all on aresults to public;

insert into tour_catalog_tours(id, client_id, slug, destination, tier, name, manages_departures) values
 ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'acc-a', 'china', 'access', 'Access A tour', true),
 ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'acc-b', 'china', 'access', 'Access B tour', true);
insert into tour_catalog_departures(id, tour_id, client_id, depart_on, return_on, status, status_source) values
 ('aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '2028-03-01', '2028-03-10', 'open', 'manual'),
 ('bbbbbbbb-0000-0000-0000-0000000000d1', 'bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', '2028-03-01', '2028-03-10', 'open', 'manual');

-- Fingerprint of everything client B owns in the working tables and the change log.
create function pg_temp.b_state() returns text language sql as $$
  select md5(
    coalesce((select string_agg(to_jsonb(t)::text, '|' order by t.id) from tour_catalog_tours t where t.client_id = '00000000-0000-0000-0000-0000000000b2'), '') ||
    coalesce((select string_agg(to_jsonb(d)::text, '|' order by d.id) from tour_catalog_departures d where d.client_id = '00000000-0000-0000-0000-0000000000b2'), '') ||
    (select count(*)::text from tour_catalog_change_log l where l.client_id = '00000000-0000-0000-0000-0000000000b2') ||
    coalesce((select catalog_version::text || '/' || published_version::text from tour_catalog_state where client_id = '00000000-0000-0000-0000-0000000000b2'), 'none') ||
    (select count(*)::text from tour_catalog_published p where p.client_id = '00000000-0000-0000-0000-0000000000b2') ||
    coalesce((select string_agg(b.id::text || b.status, '|' order by b.id) from tour_catalog_import_batches b where b.client_id = '00000000-0000-0000-0000-0000000000b2'), '')
  );
$$;

-- Runs one statement that must fail with exactly p_expected, and must leave client B untouched.
create function pg_temp.refused(p_name text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v_before text := pg_temp.b_state(); v_err text := 'no error';
begin
  begin
    execute p_sql;
  exception when others then v_err := sqlerrm;
  end;
  insert into aresults values (p_name, v_err like p_expected and pg_temp.b_state() = v_before,
    format('error=%s b_unchanged=%s', v_err, pg_temp.b_state() = v_before));
end $$;

-- ---------------------------------------------------------------------------
-- A1–A5 cross-client edits
-- ---------------------------------------------------------------------------
select pg_temp.refused('A01 A client + B tour: update_tour refused',
  $q$select tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-000000000001',(select updated_at from tour_catalog_tours where id='bbbbbbbb-0000-0000-0000-000000000001'),'{"name":"hacked"}','a@x')$q$,
  'tour_not_found');
select pg_temp.refused('A02 A client + B tour: new departure refused',
  $q$select tour_catalog_save_departure('00000000-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-000000000001',null,null,'{"depart_on":"2028-05-01"}','a@x')$q$,
  'tour_not_found');
select pg_temp.refused('A03 A client + A tour + B departure refused',
  $q$select tour_catalog_save_departure('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-0000000000d1',(select updated_at from tour_catalog_departures where id='bbbbbbbb-0000-0000-0000-0000000000d1'),'{"status":"sold_out"}','a@x')$q$,
  'departure_not_found');
select pg_temp.refused('A04 A client + B tour + B departure refused',
  $q$select tour_catalog_save_departure('00000000-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-0000000000d1',(select updated_at from tour_catalog_departures where id='bbbbbbbb-0000-0000-0000-0000000000d1'),'{"status":"sold_out"}','a@x')$q$,
  'tour_not_found');
select pg_temp.refused('A05 A client + B tour + A departure refused',
  $q$select tour_catalog_save_departure('00000000-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000d1',(select updated_at from tour_catalog_departures where id='aaaaaaaa-0000-0000-0000-0000000000d1'),'{"status":"sold_out"}','a@x')$q$,
  'tour_not_found');
insert into aresults select 'A05b A departure untouched by the mismatched calls', status = 'open', status
  from tour_catalog_departures where id = 'aaaaaaaa-0000-0000-0000-0000000000d1';

-- ---------------------------------------------------------------------------
-- A6 fields that must never be patchable
-- ---------------------------------------------------------------------------
do $$ declare k text; begin
  foreach k in array array['tour_id','client_id','id','internal','status_source','slug','sort_order','depart_on'] loop
    perform pg_temp.refused('A06 tour patch cannot carry ' || k,
      format($q$select tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',(select updated_at from tour_catalog_tours where id='aaaaaaaa-0000-0000-0000-000000000001'),jsonb_build_object(%L,'x'),'a@x')$q$, k),
      'field_not_editable:' || k);
    perform pg_temp.refused('A06 departure patch cannot carry ' || k,
      format($q$select tour_catalog_save_departure('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000d1',(select updated_at from tour_catalog_departures where id='aaaaaaaa-0000-0000-0000-0000000000d1'),jsonb_build_object(%L,'x'),'a@x')$q$, k),
      case when k = 'depart_on' then 'depart_on_not_editable' else 'field_not_editable:' || k end);
    if k <> 'depart_on' then
      perform pg_temp.refused('A06 new departure cannot carry ' || k,
        format($q$select tour_catalog_save_departure('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',null,null,jsonb_build_object('depart_on','2028-09-09',%L,'x'),'a@x')$q$, k),
        'field_not_editable:' || k);
    end if;
  end loop;
end $$;
insert into aresults select 'A06b A tour and departure unchanged after refused patches',
  (select slug = 'acc-a' and sort_order = 0 and name = 'Access A tour' from tour_catalog_tours where id='aaaaaaaa-0000-0000-0000-000000000001')
  and (select count(*) = 1 from tour_catalog_departures where tour_id='aaaaaaaa-0000-0000-0000-000000000001'), '';

-- ---------------------------------------------------------------------------
-- A7 cross-client import apply / rollback
-- ---------------------------------------------------------------------------
insert into tour_catalog_import_batches(id, client_id, kind, file_sha256, plan) values
 ('bbbbbbbb-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'departures', repeat('1',64),
  '{"adds":[{"tourId":"bbbbbbbb-0000-0000-0000-000000000001","departOn":"2028-06-06","returnOn":"2028-06-16","status":"open","internal":{}}],"updates":[]}'),
 ('bbbbbbbb-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', 'departures', repeat('2',64),
  '{"adds":[{"tourId":"bbbbbbbb-0000-0000-0000-000000000001","departOn":"2028-07-07","returnOn":"2028-07-17","status":"open","internal":{}}],"updates":[]}');
select tour_catalog_apply_batch('00000000-0000-0000-0000-0000000000b2','bbbbbbbb-0000-0000-0000-0000000000b2','b@x');
select pg_temp.refused('A07 A cannot apply B''s previewed batch',
  $q$select tour_catalog_apply_batch('00000000-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-0000000000b1','a@x')$q$, 'batch_not_applicable');
select pg_temp.refused('A07b A cannot roll back B''s applied batch',
  $q$select tour_catalog_rollback_batch('00000000-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-0000000000b2','a@x')$q$, 'batch_not_rollbackable');

-- ---------------------------------------------------------------------------
-- A8 revert with a version number only B has
-- ---------------------------------------------------------------------------
do $$ declare v_b bigint; v_a bigint; begin
  -- Make sure B has at least two published versions more than A.
  perform tour_catalog_publish('00000000-0000-0000-0000-0000000000b2',
    (select catalog_version from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000b2'),
    (select published_version from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000b2'), 'b@x', '', '{}');
  insert into tour_catalog_state(client_id, catalog_version) values ('00000000-0000-0000-0000-0000000000a1', 0) on conflict do nothing;
  select published_version into v_a from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000a1';
  if v_a = 0 then
    perform tour_catalog_publish('00000000-0000-0000-0000-0000000000a1',
      (select catalog_version from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000a1'), 0, 'a@x', '', '{}');
    v_a := 1;
  end if;
  select published_version into v_b from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000b2';
  while v_b <= v_a loop
    perform tour_catalog_publish('00000000-0000-0000-0000-0000000000b2',
      (select catalog_version from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000b2'), v_b, 'b@x', '', '{}');
    v_b := v_b + 1;
  end loop;
  perform pg_temp.refused('A08 A cannot revert to a version only B has',
    format($q$select tour_catalog_revert_published('00000000-0000-0000-0000-0000000000a1', %s, %s, 'a@x', '', '{}')$q$, v_b, v_a),
    'version_not_found');
  insert into aresults select 'A08b A published version did not move', published_version = v_a, published_version::text
    from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000a1';
end $$;

-- ---------------------------------------------------------------------------
-- A9 a save that changes nothing writes nothing
-- ---------------------------------------------------------------------------
do $$ declare u timestamptz; v jsonb; v_ver bigint; v_logs bigint; begin
  select updated_at into u from tour_catalog_tours where id='aaaaaaaa-0000-0000-0000-000000000001';
  v := tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',u,
       '{"display_price_text":"From NZD $4,080 per person","highlights":["Great Wall"],"max_group_size":16}','a@x');
  select updated_at into u from tour_catalog_tours where id='aaaaaaaa-0000-0000-0000-000000000001';
  select catalog_version into v_ver from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000a1';
  select count(*) into v_logs from tour_catalog_change_log where client_id='00000000-0000-0000-0000-0000000000a1';

  v := tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',u,
       '{"display_price_text":"From NZD $4,080 per person","highlights":["Great Wall"],"max_group_size":16,"name":"Access A tour","title":null,"is_active":true}','other@x');
  insert into aresults values ('A09 same-value tour patch returns the current row',
    v->>'display_price_text' = 'From NZD $4,080 per person' and (v->>'updated_at')::timestamptz = u, v->>'updated_at');
  insert into aresults select 'A09b same-value tour patch: revision, updated_at, log rows all unchanged',
    (select catalog_version from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000a1') = v_ver
    and (select updated_at from tour_catalog_tours where id='aaaaaaaa-0000-0000-0000-000000000001') = u
    and (select count(*) from tour_catalog_change_log where client_id='00000000-0000-0000-0000-0000000000a1') = v_logs, '';

  v := tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',u,'{}','other@x');
  insert into aresults select 'A09c empty tour patch writes nothing',
    (select catalog_version from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000a1') = v_ver
    and (select count(*) from tour_catalog_change_log where client_id='00000000-0000-0000-0000-0000000000a1') = v_logs, '';

  begin
    perform tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','2020-01-01','{"name":"Access A tour"}','other@x');
    insert into aresults values ('A09d same-value patch with a stale token still conflicts', false, 'no error');
  exception when others then
    insert into aresults values ('A09d same-value patch with a stale token still conflicts', sqlerrm like 'conflict:stale:%', sqlerrm);
  end;

  v := tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',u,'{"max_group_size":18}','a@x');
  insert into aresults select 'A09e a real change still bumps and logs',
    (select catalog_version from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000a1') > v_ver
    and (select count(*) from tour_catalog_change_log where client_id='00000000-0000-0000-0000-0000000000a1') = v_logs + 1
    and (v->>'max_group_size')::int = 18, '';
end $$;

do $$ declare d record; v jsonb; v_ver bigint; v_logs bigint; begin
  select * into d from tour_catalog_departures where id='aaaaaaaa-0000-0000-0000-0000000000d1';
  select catalog_version into v_ver from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000a1';
  select count(*) into v_logs from tour_catalog_change_log where client_id='00000000-0000-0000-0000-0000000000a1';
  v := tour_catalog_save_departure('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',d.id,d.updated_at,
       '{"status":"open","return_on":"2028-03-10","price_text_override":null}','other@x');
  insert into aresults select 'A10 same-value departure patch: revision, updated_at, status_as_of, log rows unchanged',
    (select catalog_version from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000a1') = v_ver
    and (select updated_at = d.updated_at and status_as_of = d.status_as_of from tour_catalog_departures where id = d.id)
    and (select count(*) from tour_catalog_change_log where client_id='00000000-0000-0000-0000-0000000000a1') = v_logs
    and (v->>'updated_at')::timestamptz = d.updated_at, '';
  begin
    perform tour_catalog_save_departure('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',d.id,'2020-01-01','{"status":"open"}','other@x');
    insert into aresults values ('A10b same-value departure patch with a stale token still conflicts', false, 'no error');
  exception when others then
    insert into aresults values ('A10b same-value departure patch with a stale token still conflicts', sqlerrm like 'conflict:stale:%', sqlerrm);
  end;
  v := tour_catalog_save_departure('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',d.id,d.updated_at,'{"status":"limited"}','a@x');
  insert into aresults select 'A10c a real departure change still bumps and logs',
    v->>'status' = 'limited' and v->>'status_source' = 'manual'
    and (select catalog_version from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000a1') > v_ver
    and (select count(*) from tour_catalog_change_log where client_id='00000000-0000-0000-0000-0000000000a1') = v_logs + 1, '';
end $$;

-- ---------------------------------------------------------------------------
-- A11 blank actor refused by all four functions (null / '' / spaces)
-- ---------------------------------------------------------------------------
insert into tour_catalog_import_batches(id, client_id, kind, file_sha256, plan) values
 ('aaaaaaaa-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'departures', repeat('3',64),
  '{"adds":[{"tourId":"aaaaaaaa-0000-0000-0000-000000000001","departOn":"2028-08-08","returnOn":"2028-08-18","status":"open","internal":{}}],"updates":[]}'),
 ('aaaaaaaa-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'departures', repeat('4',64),
  '{"adds":[{"tourId":"aaaaaaaa-0000-0000-0000-000000000001","departOn":"2028-08-09","returnOn":"2028-08-19","status":"open","internal":{}}],"updates":[]}');
select tour_catalog_apply_batch('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-0000000000b2','a@x');
do $$ declare a text; label text; v_logs bigint; begin
  select count(*) into v_logs from tour_catalog_change_log;
  foreach a in array array['NULL', $q$''$q$, $q$'   '$q$] loop
    label := case a when 'NULL' then 'null' when $q$''$q$ then 'empty' else 'spaces' end;
    perform pg_temp.refused('A11 update_tour refuses actor ' || label,
      format($q$select tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',(select updated_at from tour_catalog_tours where id='aaaaaaaa-0000-0000-0000-000000000001'),'{"name":"renamed"}',%s)$q$, a),
      'invalid_actor');
    perform pg_temp.refused('A11 save_departure refuses actor ' || label,
      format($q$select tour_catalog_save_departure('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',null,null,'{"depart_on":"2028-11-11"}',%s)$q$, a),
      'invalid_actor');
    perform pg_temp.refused('A11 apply_batch refuses actor ' || label,
      format($q$select tour_catalog_apply_batch('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-0000000000b1',%s)$q$, a),
      'invalid_actor');
    perform pg_temp.refused('A11 rollback_batch refuses actor ' || label,
      format($q$select tour_catalog_rollback_batch('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-0000000000b2',%s)$q$, a),
      'invalid_actor');
  end loop;
  insert into aresults select 'A11b nothing was written by the blank-actor calls',
    (select count(*) from tour_catalog_change_log) = v_logs
    and (select name from tour_catalog_tours where id='aaaaaaaa-0000-0000-0000-000000000001') = 'Access A tour'
    and (select status from tour_catalog_import_batches where id='aaaaaaaa-0000-0000-0000-0000000000b1') = 'previewed'
    and (select status from tour_catalog_import_batches where id='aaaaaaaa-0000-0000-0000-0000000000b2') = 'applied', '';
  insert into aresults select 'A11c no change-log row is attributed to unknown',
    count(*) = 0, count(*)::text from tour_catalog_change_log where actor like '%unknown%';
end $$;

-- ---------------------------------------------------------------------------
-- A12 change log is append-only
-- ---------------------------------------------------------------------------
do $$ declare v_n bigint; v_err text; begin
  select count(*) into v_n from tour_catalog_change_log;
  begin update tour_catalog_change_log set actor = 'someone else'; v_err := 'no error'; exception when others then v_err := sqlerrm; end;
  insert into aresults values ('A12 change log UPDATE refused', v_err = 'tour_catalog_change_log_append_only', v_err);
  begin delete from tour_catalog_change_log; v_err := 'no error'; exception when others then v_err := sqlerrm; end;
  insert into aresults values ('A12b change log DELETE refused', v_err = 'tour_catalog_change_log_append_only', v_err);
  -- The inner block is a subtransaction: even if TRUNCATE were allowed it would be rolled back by the raise below.
  begin
    truncate tour_catalog_change_log;
    raise exception 'truncate_was_allowed';
  exception when others then v_err := sqlerrm; end;
  insert into aresults values ('A12c change log TRUNCATE refused', v_err = 'tour_catalog_change_log_append_only', v_err);
  insert into aresults select 'A12d change log row count unchanged', count(*) = v_n, count(*)::text from tour_catalog_change_log;
end $$;
set role service_role;
do $$ declare v_err text; begin
  begin delete from tour_catalog_change_log where true; v_err := 'no error'; exception when others then v_err := sqlerrm; end;
  insert into aresults values ('A12e service_role DELETE on the change log refused too', v_err = 'tour_catalog_change_log_append_only', v_err);
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- A13 length / shape CHECKs
-- ---------------------------------------------------------------------------
do $$ declare r record; v_err text; begin
  for r in select * from (values
    ('name 201 chars',              format('update tour_catalog_tours set name = repeat(''x'', 201) where id = %L', 'aaaaaaaa-0000-0000-0000-000000000001')),
    ('title 301 chars',             format('update tour_catalog_tours set title = repeat(''x'', 301) where id = %L', 'aaaaaaaa-0000-0000-0000-000000000001')),
    ('short_description 3001',      format('update tour_catalog_tours set short_description = repeat(''x'', 3001) where id = %L', 'aaaaaaaa-0000-0000-0000-000000000001')),
    ('duration_text 61',            format('update tour_catalog_tours set duration_text = repeat(''x'', 61) where id = %L', 'aaaaaaaa-0000-0000-0000-000000000001')),
    ('display_price_text 101',      format('update tour_catalog_tours set display_price_text = repeat(''x'', 101) where id = %L', 'aaaaaaaa-0000-0000-0000-000000000001')),
    ('single_supplement 101',       format('update tour_catalog_tours set single_supplement = repeat(''x'', 101) where id = %L', 'aaaaaaaa-0000-0000-0000-000000000001')),
    ('highlights not an array',     format('update tour_catalog_tours set highlights = ''{"a":1}'' where id = %L', 'aaaaaaaa-0000-0000-0000-000000000001')),
    ('itinerary not an array',      format('update tour_catalog_tours set itinerary = ''"text"'' where id = %L', 'aaaaaaaa-0000-0000-0000-000000000001')),
    ('inclusions not an array',     format('update tour_catalog_tours set inclusions = ''1'' where id = %L', 'aaaaaaaa-0000-0000-0000-000000000001')),
    ('exclusions not an array',     format('update tour_catalog_tours set exclusions = ''null'' where id = %L', 'aaaaaaaa-0000-0000-0000-000000000001')),
    ('tour_cities not an array',    format('update tour_catalog_tours set tour_cities = ''true'' where id = %L', 'aaaaaaaa-0000-0000-0000-000000000001')),
    ('itinerary too large',         format('update tour_catalog_tours set itinerary = (select jsonb_agg(md5(g::text) || md5((g * 7)::text)) from generate_series(1, 20000) g) where id = %L', 'aaaaaaaa-0000-0000-0000-000000000001')),
    ('itinerary large but highly compressible (400 KB of one letter)', format('update tour_catalog_tours set itinerary = jsonb_build_array(repeat(''x'', 400000)) where id = %L', 'aaaaaaaa-0000-0000-0000-000000000001')),
    ('itinerary one byte over (300001 bytes of text)', format('update tour_catalog_tours set itinerary = jsonb_build_array(repeat(''x'', 299997)) where id = %L', 'aaaaaaaa-0000-0000-0000-000000000001')),
    ('departure price 101',         format('update tour_catalog_departures set price_text_override = repeat(''x'', 101) where id = %L', 'aaaaaaaa-0000-0000-0000-0000000000d1'))
  ) as t(label, stmt) loop
    begin execute r.stmt; v_err := 'no error'; exception when check_violation then v_err := 'check_violation'; when others then v_err := sqlerrm; end;
    insert into aresults values ('A13 CHECK refuses ' || r.label, v_err = 'check_violation', v_err);
  end loop;
  -- Through the edit functions the same limits surface as errors, never as silent truncation.
  begin
    perform tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',
      (select updated_at from tour_catalog_tours where id='aaaaaaaa-0000-0000-0000-000000000001'), jsonb_build_object('highlights', jsonb_build_object('a', 1)), 'a@x');
    v_err := 'no error';
  exception when check_violation then v_err := 'check_violation'; when others then v_err := sqlerrm; end;
  insert into aresults values ('A13b update_tour with a non-array list refused', v_err = 'check_violation', v_err);
  begin
    perform tour_catalog_save_departure('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',null,null,
      jsonb_build_object('depart_on', '2028-12-12', 'price_text_override', repeat('x', 101)), 'a@x');
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  insert into aresults values ('A13c save_departure with a 101-char price refused as invalid_price_text', v_err = 'invalid_price_text', v_err);
  insert into aresults select 'A13d boundary values are accepted', true, '' from (
    select tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',
      (select updated_at from tour_catalog_tours where id='aaaaaaaa-0000-0000-0000-000000000001'),
      jsonb_build_object('title', repeat('x', 300), 'duration_text', repeat('x', 60), 'single_supplement', repeat('x', 100)), 'a@x')) s;
end $$;

-- A13e the itinerary limit is on the JSON text: exactly 300000 bytes is accepted, stored compressed or not.
do $$ declare v_err text := 'no error'; v_len integer; begin
  begin
    update tour_catalog_tours set itinerary = jsonb_build_array(repeat('x', 299996)) where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  exception when others then v_err := sqlerrm; end;
  select octet_length(itinerary::text) into v_len from tour_catalog_tours where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  insert into aresults values ('A13e itinerary of exactly 300000 bytes of text is accepted', v_err = 'no error' and v_len = 300000, format('%s len=%s', v_err, v_len));
  update tour_catalog_tours set itinerary = '[]' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  insert into aresults select 'A13f the constraint measures octet_length of the text, not pg_column_size',
    pg_get_constraintdef(oid) like '%octet_length%' and pg_get_constraintdef(oid) not like '%pg_column_size%', pg_get_constraintdef(oid)
    from pg_constraint where conname = 'tour_catalog_tours_jsonb_arrays';
end $$;

-- ---------------------------------------------------------------------------
-- A14 members / settings CHECKs
-- ---------------------------------------------------------------------------
do $$ declare r record; v_err text; begin
  for r in select * from (values
    ('member email upper case',   $q$insert into tour_catalog_members(client_id, email, granted_by) values ('00000000-0000-0000-0000-0000000000a1', 'Staff@Example.com', 'admin@x')$q$),
    ('member email leading space',$q$insert into tour_catalog_members(client_id, email, granted_by) values ('00000000-0000-0000-0000-0000000000a1', ' staff@example.com', 'admin@x')$q$),
    ('member email trailing space',$q$insert into tour_catalog_members(client_id, email, granted_by) values ('00000000-0000-0000-0000-0000000000a1', 'staff@example.com ', 'admin@x')$q$),
    ('member email too short',    $q$insert into tour_catalog_members(client_id, email, granted_by) values ('00000000-0000-0000-0000-0000000000a1', 'a@', 'admin@x')$q$),
    ('member email too long',     $q$insert into tour_catalog_members(client_id, email, granted_by) values ('00000000-0000-0000-0000-0000000000a1', repeat('a', 250) || '@x.co', 'admin@x')$q$),
    ('member blank granted_by',   $q$insert into tour_catalog_members(client_id, email, granted_by) values ('00000000-0000-0000-0000-0000000000a1', 'staff@example.com', '  ')$q$),
    ('settings bad colour word',  $q$insert into tour_catalog_settings(client_id, brand_primary, updated_by) values ('00000000-0000-0000-0000-0000000000a1', 'red', 'admin@x')$q$),
    ('settings 3-digit colour',   $q$insert into tour_catalog_settings(client_id, brand_primary, updated_by) values ('00000000-0000-0000-0000-0000000000a1', '#B61', 'admin@x')$q$),
    ('settings colour with css',  $q$insert into tour_catalog_settings(client_id, brand_secondary, updated_by) values ('00000000-0000-0000-0000-0000000000a1', '#B61E2E;x', 'admin@x')$q$),
    ('settings http logo',        $q$insert into tour_catalog_settings(client_id, logo_url, updated_by) values ('00000000-0000-0000-0000-0000000000a1', 'http://example.com/logo.png', 'admin@x')$q$),
    ('settings javascript logo',  $q$insert into tour_catalog_settings(client_id, logo_url, updated_by) values ('00000000-0000-0000-0000-0000000000a1', 'javascript:alert(1)', 'admin@x')$q$),
    ('settings logo too long',    $q$insert into tour_catalog_settings(client_id, logo_url, updated_by) values ('00000000-0000-0000-0000-0000000000a1', 'https://example.com/' || repeat('a', 500), 'admin@x')$q$),
    ('publish request note 501',  $q$insert into tour_catalog_publish_requests(client_id, requested_by, draft_version, note) values ('00000000-0000-0000-0000-0000000000a1', 'staff@example.com', 1, repeat('x', 501))$q$),
    ('publish request blank requester', $q$insert into tour_catalog_publish_requests(client_id, requested_by, draft_version) values ('00000000-0000-0000-0000-0000000000a1', ' ', 1)$q$)
  ) as t(label, stmt) loop
    begin execute r.stmt; v_err := 'no error'; exception when check_violation then v_err := 'check_violation'; when others then v_err := sqlerrm; end;
    insert into aresults values ('A14 CHECK refuses ' || r.label, v_err = 'check_violation', v_err);
  end loop;
  insert into tour_catalog_members(client_id, email, granted_by) values ('00000000-0000-0000-0000-0000000000a1', 'staff@example.com', 'admin@x');
  insert into tour_catalog_settings(client_id, logo_url, brand_primary, brand_secondary, updated_by)
    values ('00000000-0000-0000-0000-0000000000a1', 'https://example.com/logo.png', '#B61E2E', '#d6a756', 'admin@x');
  insert into aresults select 'A14b valid member and settings rows accepted',
    (select count(*) from tour_catalog_members) = 1 and (select channels_connected = false from tour_catalog_settings), '';
end $$;

-- ---------------------------------------------------------------------------
-- A14c–A14k publish requests: one open request per client, guaranteed by the database
-- ---------------------------------------------------------------------------
do $$ declare v_first jsonb; v_second jsonb; v_third jsonb; v_err text; v_b text := pg_temp.b_state(); r record; begin
  v_first := tour_catalog_request_publish('00000000-0000-0000-0000-0000000000a1', 'one@example.com', 3, 'first');
  v_second := tour_catalog_request_publish('00000000-0000-0000-0000-0000000000a1', '  two@example.com ', 5, 'second');
  insert into aresults select 'A14c two requests in a row leave exactly one row for the client', count(*) = 1, count(*)::text
    from tour_catalog_publish_requests where client_id = '00000000-0000-0000-0000-0000000000a1';
  insert into aresults select 'A14d the surviving row carries the second request (who, draft, note), still open',
    requested_by = 'two@example.com' and draft_version = 5 and note = 'second' and handled_at is null,
    format('%s/%s/%s', requested_by, draft_version, note)
    from tour_catalog_publish_requests where client_id = '00000000-0000-0000-0000-0000000000a1';
  insert into aresults values ('A14e the function returns the open row, same id both times',
    v_first->>'id' = v_second->>'id' and v_second->>'requested_by' = 'two@example.com' and (v_second->>'draft_version')::bigint = 5
      and v_second->>'note' = 'second' and v_second ? 'created_at', v_second::text);

  begin
    insert into tour_catalog_publish_requests(client_id, requested_by, draft_version) values ('00000000-0000-0000-0000-0000000000a1', 'three@example.com', 6);
    v_err := 'no error';
  exception when unique_violation then v_err := 'unique_violation'; when others then v_err := sqlerrm; end;
  insert into aresults values ('A14f a direct insert of a second open row is refused by the unique index', v_err = 'unique_violation', v_err);

  -- Another client has its own open request.
  perform tour_catalog_request_publish('00000000-0000-0000-0000-0000000000b2', 'b@example.com', 1, '');
  insert into aresults select 'A14g another client gets its own open row', count(*) = 2, count(*)::text
    from tour_catalog_publish_requests where handled_at is null;
  delete from tour_catalog_publish_requests where client_id = '00000000-0000-0000-0000-0000000000b2';

  -- Once handled, a new request is a new row; the handled one is kept as it was.
  update tour_catalog_publish_requests set handled_at = now(), handled_version = 1
   where client_id = '00000000-0000-0000-0000-0000000000a1' and handled_at is null;
  v_third := tour_catalog_request_publish('00000000-0000-0000-0000-0000000000a1', 'three@example.com', 7, null);
  insert into aresults select 'A14h after the open request is handled a new one can be made (2 rows: 1 handled, 1 open)',
    count(*) = 2 and count(*) filter (where handled_at is null) = 1
      and bool_or(handled_at is not null and requested_by = 'two@example.com' and note = 'second'), count(*)::text
    from tour_catalog_publish_requests where client_id = '00000000-0000-0000-0000-0000000000a1';
  insert into aresults values ('A14i the new request is a different row and a null note is stored as empty',
    v_third->>'id' <> v_second->>'id' and v_third->>'note' = '', v_third::text);

  for r in select * from (values
    ('null actor',   $q$select tour_catalog_request_publish('00000000-0000-0000-0000-0000000000a1', null, 1, '')$q$, 'invalid_actor'),
    ('empty actor',  $q$select tour_catalog_request_publish('00000000-0000-0000-0000-0000000000a1', '', 1, '')$q$, 'invalid_actor'),
    ('blank actor',  $q$select tour_catalog_request_publish('00000000-0000-0000-0000-0000000000a1', '   ', 1, '')$q$, 'invalid_actor'),
    ('note 501',     $q$select tour_catalog_request_publish('00000000-0000-0000-0000-0000000000a1', 'x@example.com', 1, repeat('x', 501))$q$, 'invalid_note'),
    ('null draft',   $q$select tour_catalog_request_publish('00000000-0000-0000-0000-0000000000a1', 'x@example.com', null, '')$q$, 'invalid_request'),
    ('null client',  $q$select tour_catalog_request_publish(null, 'x@example.com', 1, '')$q$, 'invalid_request')
  ) as t(label, stmt, expected) loop
    begin execute r.stmt; v_err := 'no error'; exception when others then v_err := sqlerrm; end;
    insert into aresults values ('A14j request_publish refuses ' || r.label, v_err = r.expected, v_err);
  end loop;
  insert into aresults select 'A14k refused requests changed nothing (still three@, draft 7) and a 500-char note is accepted',
    (select requested_by = 'three@example.com' and draft_version = 7 from tour_catalog_publish_requests
      where client_id = '00000000-0000-0000-0000-0000000000a1' and handled_at is null)
    and (tour_catalog_request_publish('00000000-0000-0000-0000-0000000000a1', 'three@example.com', 7, repeat('n', 500))->>'note') = repeat('n', 500)
    and pg_temp.b_state() = v_b, '';
  delete from tour_catalog_publish_requests where client_id = '00000000-0000-0000-0000-0000000000a1';
end $$;

-- ---------------------------------------------------------------------------
-- A15 assistant limits
-- ---------------------------------------------------------------------------
do $$ declare ok1 boolean; ok2 boolean; ok3 boolean; v_err text; begin
  -- per-user limit 2, client limit 3, cost limit 1.00
  ok1 := tour_catalog_assistant_reserve('00000000-0000-0000-0000-0000000000a1', '2028-01-01', 'One@Example.com ', 2, 3, 1.00);
  ok2 := tour_catalog_assistant_reserve('00000000-0000-0000-0000-0000000000a1', '2028-01-01', 'one@example.com', 2, 3, 1.00);
  ok3 := tour_catalog_assistant_reserve('00000000-0000-0000-0000-0000000000a1', '2028-01-01', 'one@example.com', 2, 3, 1.00);
  insert into aresults select 'A15 per-user limit: third call refused and not counted (email normalised)',
    ok1 and ok2 and not ok3 and (select calls from tour_catalog_assistant_usage where client_id='00000000-0000-0000-0000-0000000000a1' and day='2028-01-01' and email='one@example.com') = 2,
    format('%s %s %s', ok1, ok2, ok3);

  ok1 := tour_catalog_assistant_reserve('00000000-0000-0000-0000-0000000000a1', '2028-01-01', 'two@example.com', 2, 3, 1.00);
  ok2 := tour_catalog_assistant_reserve('00000000-0000-0000-0000-0000000000a1', '2028-01-01', 'two@example.com', 2, 3, 1.00);
  ok3 := tour_catalog_assistant_reserve('00000000-0000-0000-0000-0000000000a1', '2028-01-01', 'three@example.com', 2, 3, 1.00);
  insert into aresults select 'A15b client limit: once reached, other emails are refused too',
    ok1 and not ok2 and not ok3 and (select sum(calls) from tour_catalog_assistant_usage where client_id='00000000-0000-0000-0000-0000000000a1' and day='2028-01-01') = 3,
    format('%s %s %s', ok1, ok2, ok3);

  insert into aresults select 'A15c another client is counted separately',
    tour_catalog_assistant_reserve('00000000-0000-0000-0000-0000000000b2', '2028-01-01', 'one@example.com', 2, 3, 1.00), '';
  ok1 := tour_catalog_assistant_reserve('00000000-0000-0000-0000-0000000000a1', '2028-01-02', 'one@example.com', 2, 3, 1.00);
  insert into aresults select 'A15d a new day starts from zero',
    ok1 and (select calls from tour_catalog_assistant_usage where client_id='00000000-0000-0000-0000-0000000000a1' and day='2028-01-02' and email='one@example.com') = 1, '';

  -- cost limit: day 3, record 0.60 + 0.40 = 1.00 → next reserve refused for anyone
  ok1 := tour_catalog_assistant_reserve('00000000-0000-0000-0000-0000000000a1', '2028-01-03', 'one@example.com', 40, 150, 1.00);
  perform tour_catalog_assistant_record_cost('00000000-0000-0000-0000-0000000000a1', '2028-01-03', 'one@example.com', 0.60);
  ok2 := tour_catalog_assistant_reserve('00000000-0000-0000-0000-0000000000a1', '2028-01-03', 'two@example.com', 40, 150, 1.00);
  perform tour_catalog_assistant_record_cost('00000000-0000-0000-0000-0000000000a1', '2028-01-03', 'Four@Example.com', 0.40);
  ok3 := tour_catalog_assistant_reserve('00000000-0000-0000-0000-0000000000a1', '2028-01-03', 'three@example.com', 40, 150, 1.00);
  insert into aresults select 'A15e cost limit: refused once the day''s spend reaches the cap',
    ok1 and ok2 and not ok3
    and (select sum(cost_usd) from tour_catalog_assistant_usage where client_id='00000000-0000-0000-0000-0000000000a1' and day='2028-01-03') = 1.00
    and (select calls = 0 and cost_usd = 0.40 from tour_catalog_assistant_usage where client_id='00000000-0000-0000-0000-0000000000a1' and day='2028-01-03' and email='four@example.com'),
    format('%s %s %s', ok1, ok2, ok3);

  perform tour_catalog_assistant_record_cost('00000000-0000-0000-0000-0000000000a1', '2028-01-04', 'one@example.com', -5);
  perform tour_catalog_assistant_record_cost('00000000-0000-0000-0000-0000000000a1', '2028-01-04', 'one@example.com', null);
  insert into aresults select 'A15f negative or null cost counts as 0', cost_usd = 0, cost_usd::text
    from tour_catalog_assistant_usage where client_id='00000000-0000-0000-0000-0000000000a1' and day='2028-01-04' and email='one@example.com';

  insert into aresults select 'A15g a missing limit fails closed',
    not tour_catalog_assistant_reserve('00000000-0000-0000-0000-0000000000a1', '2028-01-05', 'one@example.com', null, 3, 1.00)
    and not tour_catalog_assistant_reserve('00000000-0000-0000-0000-0000000000a1', '2028-01-05', 'one@example.com', 2, null, 1.00)
    and not tour_catalog_assistant_reserve('00000000-0000-0000-0000-0000000000a1', '2028-01-05', 'one@example.com', 2, 3, null)
    and not exists (select 1 from tour_catalog_assistant_usage where day = '2028-01-05'), '';
  begin
    perform tour_catalog_assistant_reserve('00000000-0000-0000-0000-0000000000a1', '2028-01-05', '  ', 2, 3, 1.00);
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  insert into aresults values ('A15h reserve with a blank email refused', v_err = 'invalid_actor', v_err);
end $$;

-- ---------------------------------------------------------------------------
-- A16 anon / authenticated have nothing; service_role works
-- ---------------------------------------------------------------------------
create function pg_temp.denied(p_name text, p_sql text) returns void language plpgsql as $$
declare v_err text := 'no error';
begin
  begin execute p_sql; exception when insufficient_privilege then v_err := 'insufficient_privilege'; when others then v_err := sqlerrm; end;
  insert into aresults values (p_name, v_err = 'insufficient_privilege', v_err);
end $$;

set role anon;
select pg_temp.denied('A16 anon cannot read tour_catalog_members', 'select count(*) from tour_catalog_members');
select pg_temp.denied('A16 anon cannot write tour_catalog_members', $q$insert into tour_catalog_members(client_id, email, granted_by) values ('00000000-0000-0000-0000-0000000000a1','x@y.zz','x')$q$);
select pg_temp.denied('A16 anon cannot read tour_catalog_settings', 'select count(*) from tour_catalog_settings');
select pg_temp.denied('A16 anon cannot read tour_catalog_publish_requests', 'select count(*) from tour_catalog_publish_requests');
select pg_temp.denied('A16 anon cannot read tour_catalog_assistant_usage', 'select count(*) from tour_catalog_assistant_usage');
select pg_temp.denied('A16 anon cannot call assistant_reserve', $q$select tour_catalog_assistant_reserve('00000000-0000-0000-0000-0000000000a1','2028-02-01','x@y.zz',1,1,1)$q$);
select pg_temp.denied('A16 anon cannot call assistant_record_cost', $q$select tour_catalog_assistant_record_cost('00000000-0000-0000-0000-0000000000a1','2028-02-01','x@y.zz',1)$q$);
select pg_temp.denied('A16 anon cannot call request_publish', $q$select tour_catalog_request_publish('00000000-0000-0000-0000-0000000000a1','x@y.zz',1,'')$q$);
select pg_temp.denied('A16 anon cannot call change_log_append_only', 'select tour_catalog_change_log_append_only()');
select pg_temp.denied('A16 anon cannot call update_tour (after create or replace)', $q$select tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',now(),'{}','x')$q$);
select pg_temp.denied('A16 anon cannot call save_departure (after create or replace)', $q$select tour_catalog_save_departure('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',null,null,'{}','x')$q$);
select pg_temp.denied('A16 anon cannot call apply_batch (after create or replace)', $q$select tour_catalog_apply_batch('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-0000000000b1','x')$q$);
select pg_temp.denied('A16 anon cannot call rollback_batch (after create or replace)', $q$select tour_catalog_rollback_batch('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-0000000000b2','x')$q$);
reset role;
set role authenticated;
select pg_temp.denied('A17 authenticated cannot read tour_catalog_members', 'select count(*) from tour_catalog_members');
select pg_temp.denied('A17 authenticated cannot write tour_catalog_members', $q$insert into tour_catalog_members(client_id, email, granted_by) values ('00000000-0000-0000-0000-0000000000a1','x@y.zz','x')$q$);
select pg_temp.denied('A17 authenticated cannot read tour_catalog_settings', 'select count(*) from tour_catalog_settings');
select pg_temp.denied('A17 authenticated cannot write tour_catalog_settings', $q$update tour_catalog_settings set channels_connected = true$q$);
select pg_temp.denied('A17 authenticated cannot read tour_catalog_publish_requests', 'select count(*) from tour_catalog_publish_requests');
select pg_temp.denied('A17 authenticated cannot read tour_catalog_assistant_usage', 'select count(*) from tour_catalog_assistant_usage');
select pg_temp.denied('A17 authenticated cannot call assistant_reserve', $q$select tour_catalog_assistant_reserve('00000000-0000-0000-0000-0000000000a1','2028-02-01','x@y.zz',1,1,1)$q$);
select pg_temp.denied('A17 authenticated cannot call assistant_record_cost', $q$select tour_catalog_assistant_record_cost('00000000-0000-0000-0000-0000000000a1','2028-02-01','x@y.zz',1)$q$);
select pg_temp.denied('A17 authenticated cannot call request_publish', $q$select tour_catalog_request_publish('00000000-0000-0000-0000-0000000000a1','x@y.zz',1,'')$q$);
select pg_temp.denied('A17 authenticated cannot call change_log_append_only', 'select tour_catalog_change_log_append_only()');
select pg_temp.denied('A17 authenticated cannot call update_tour (after create or replace)', $q$select tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',now(),'{}','x')$q$);
reset role;
set role service_role;
do $$ declare v_err text := ''; begin
  begin
    perform count(*) from tour_catalog_members;
    perform count(*) from tour_catalog_settings;
    perform count(*) from tour_catalog_publish_requests;
    perform count(*) from tour_catalog_assistant_usage;
    perform tour_catalog_assistant_reserve('00000000-0000-0000-0000-0000000000a1','2028-02-02','svc@example.com',1,1,1);
    perform tour_catalog_assistant_record_cost('00000000-0000-0000-0000-0000000000a1','2028-02-02','svc@example.com',0.01);
    perform tour_catalog_request_publish('00000000-0000-0000-0000-0000000000a1','svc@example.com',1,'');
    delete from tour_catalog_publish_requests where client_id = '00000000-0000-0000-0000-0000000000a1';
  exception when others then v_err := sqlerrm; end;
  insert into aresults values ('A18 service_role can use the new tables and functions', v_err = '', v_err);
end $$;
reset role;
-- The "cannot call" checks above can also pass because the function body hits a table the role
-- cannot read. These look at the grants themselves, one function and one table at a time.
insert into aresults
  select format('A20 %s has no EXECUTE on %s', r.rolname, p.oid::regprocedure),
         not has_function_privilege(r.rolname, p.oid, 'execute'), ''
    from pg_proc p
    cross join (values ('anon'), ('authenticated')) as r(rolname)
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('tour_catalog_assistant_reserve', 'tour_catalog_assistant_record_cost', 'tour_catalog_request_publish',
                       'tour_catalog_change_log_append_only', 'tour_catalog_update_tour',
                       'tour_catalog_save_departure', 'tour_catalog_apply_batch', 'tour_catalog_rollback_batch');
insert into aresults
  select format('A20b PUBLIC has no EXECUTE on %s', p.oid::regprocedure),
         not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'), ''
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('tour_catalog_assistant_reserve', 'tour_catalog_assistant_record_cost', 'tour_catalog_request_publish',
                       'tour_catalog_change_log_append_only', 'tour_catalog_update_tour',
                       'tour_catalog_save_departure', 'tour_catalog_apply_batch', 'tour_catalog_rollback_batch');
insert into aresults select 'A20c all eight functions were found by the grant checks', count(*) = 8, count(*)::text
  from pg_proc p where p.pronamespace = 'public'::regnamespace
   and p.proname in ('tour_catalog_assistant_reserve', 'tour_catalog_assistant_record_cost', 'tour_catalog_request_publish',
                     'tour_catalog_change_log_append_only', 'tour_catalog_update_tour',
                     'tour_catalog_save_departure', 'tour_catalog_apply_batch', 'tour_catalog_rollback_batch');
insert into aresults
  select format('A20d service_role has EXECUTE on %s', p.oid::regprocedure), has_function_privilege('service_role', p.oid, 'execute'), ''
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('tour_catalog_assistant_reserve', 'tour_catalog_assistant_record_cost', 'tour_catalog_request_publish',
                       'tour_catalog_update_tour', 'tour_catalog_save_departure', 'tour_catalog_apply_batch', 'tour_catalog_rollback_batch');
insert into aresults
  select format('A21 %s has no %s on %s', r.rolname, pr.priv, t.tbl),
         not has_table_privilege(r.rolname, 'public.' || t.tbl, pr.priv), ''
    from (values ('tour_catalog_members'), ('tour_catalog_settings'), ('tour_catalog_publish_requests'), ('tour_catalog_assistant_usage')) as t(tbl)
    cross join (values ('anon'), ('authenticated')) as r(rolname)
    cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate')) as pr(priv);

insert into aresults select 'A19 RLS is on for the four new tables', count(*) = 4 and bool_and(relrowsecurity), count(*)::text
  from pg_class where relname in ('tour_catalog_members','tour_catalog_settings','tour_catalog_publish_requests','tour_catalog_assistant_usage');
insert into aresults select 'A19b each new table has exactly one policy, for service_role only', count(*) = 4 and bool_and(roles = '{service_role}'), string_agg(tablename || roles::text, ' ')
  from pg_policies where tablename in ('tour_catalog_members','tour_catalog_settings','tour_catalog_publish_requests','tour_catalog_assistant_usage');
insert into aresults select 'A19c no SECURITY DEFINER among tour_catalog functions', count(*) = 0, coalesce(string_agg(proname, ','), '')
  from pg_proc where proname like 'tour\_catalog\_%' and prosecdef;

select name, case when ok then 'PASS' else 'FAIL' end as r, left(detail, 160) as detail from aresults order by name;
-- Exit non-zero (with psql -v ON_ERROR_STOP=1) when any check failed. A NULL verdict counts as a failure.
do $$ begin if exists (select 1 from aresults where ok is not true) then raise exception 'tour catalog access checks FAILED'; end if; end $$;
