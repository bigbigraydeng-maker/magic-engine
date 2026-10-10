-- Behaviour checks for supabase/migrations/20261010200000_tour_catalog_publish.sql (run after the base
-- migration and after tour_catalog_edit.test.sql, on a THROWAWAY local Postgres only).
create temp table presults(name text, ok boolean, detail text); grant all on presults to public;

insert into clients(id) values ('00000000-0000-0000-0000-0000000000c3') on conflict do nothing;

-- P01 First publish for a client with NO state row.
do $$ declare v jsonb; v_pub bigint; v_snap jsonb; begin
  v := tour_catalog_publish('00000000-0000-0000-0000-0000000000c3', 0, 0, 'pm@x', 'first', '{}');
  select published_version into v_pub from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000c3';
  select snapshot into v_snap from tour_catalog_published where client_id='00000000-0000-0000-0000-0000000000c3' and version=1;
  insert into presults values ('P01 first publish for client with no state row',
    (v->>'version')::bigint = 1 and v_pub = 1
      and v_snap->>'schema_version' = '1'
      and v_snap->'tours' = '[]'::jsonb
      and v_snap->'departures' = '[]'::jsonb,
    v::text);
end $$;

-- P02 Direct ("seed style") inserts bump the draft revision.
do $$ declare v_before bigint; v_after bigint; v_after2 bigint; v_after3 bigint; begin
  select catalog_version into v_before from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000b2';
  v_before := coalesce(v_before, 0);

  insert into tour_catalog_tours(id, client_id, slug, destination, tier, name)
    values ('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-0000000000a1', 'pub-other-client', 'china', 'discovery', 'Other client tour');
  insert into tour_catalog_tours(id, client_id, slug, destination, tier, name, display_price_text, manages_departures)
    values ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-0000000000b2', 'pub-golden', 'china', 'discovery', 'Golden v1', 'From NZD $1,000 per person', true);
  insert into tour_catalog_departures(id, tour_id, client_id, depart_on, return_on, status, status_source, internal)
    values ('44444444-4444-4444-4444-444444444441', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-0000000000b2', '2027-03-11', '2027-03-25', 'open', 'manual', '{"airline":"CA"}');

  select catalog_version into v_after from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000b2';

  update tour_catalog_tours set sort_order = 1 where id = '33333333-3333-3333-3333-333333333333';
  select catalog_version into v_after2 from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000b2';

  insert into tour_catalog_departures(id, tour_id, client_id, depart_on, return_on, status, status_source)
    values ('44444444-4444-4444-4444-4444444444ff', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-0000000000b2', '2027-12-01', '2027-12-15', 'open', 'manual');
  delete from tour_catalog_departures where id = '44444444-4444-4444-4444-4444444444ff';
  select catalog_version into v_after3 from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000b2';

  insert into presults values ('P02 direct inserts bump the draft revision',
    v_after > v_before and v_after2 > v_after and v_after3 > v_after2,
    format('before=%s after_insert=%s after_update=%s after_delete=%s', v_before, v_after, v_after2, v_after3));
end $$;

-- P03 Wrong expected draft version refused.
do $$ declare v_draft bigint; v_pub bigint; v_count int; begin
  select catalog_version, published_version into v_draft, v_pub from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000b2';
  perform tour_catalog_publish('00000000-0000-0000-0000-0000000000b2', v_draft + 1, 0, 'pm@x', '', '{}');
  insert into presults values ('P03 wrong expected draft version refused', false, 'no error');
exception when others then
  select count(*) into v_count from tour_catalog_published where client_id='00000000-0000-0000-0000-0000000000b2';
  insert into presults values ('P03 wrong expected draft version refused', sqlerrm = 'conflict:stale' and v_count = 0, sqlerrm);
end $$;

-- P04 Wrong expected published version refused.
do $$ declare v_draft bigint; v_pub bigint; begin
  select catalog_version, published_version into v_draft, v_pub from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000b2';
  perform tour_catalog_publish('00000000-0000-0000-0000-0000000000b2', v_draft, 5, 'pm@x', '', '{}');
  insert into presults values ('P04 wrong expected published version refused', false, 'no error');
exception when others then insert into presults values ('P04 wrong expected published version refused', sqlerrm = 'conflict:stale', sqlerrm); end $$;

-- P05 Empty or blank actor refused.
do $$ declare v_draft bigint; v_pub bigint; v_blank text; v_null text; begin
  select catalog_version, published_version into v_draft, v_pub from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000b2';
  begin
    perform tour_catalog_publish('00000000-0000-0000-0000-0000000000b2', v_draft, 0, '   ', '', '{}');
    v_blank := 'no error';
  exception when others then v_blank := sqlerrm; end;
  begin
    perform tour_catalog_publish('00000000-0000-0000-0000-0000000000b2', v_draft, 0, null, '', '{}');
    v_null := 'no error';
  exception when others then v_null := sqlerrm; end;
  insert into presults values ('P05 empty or blank actor refused',
    v_blank = 'invalid_actor' and v_null = 'invalid_actor',
    format('blank=%s null=%s', v_blank, v_null));
end $$;

-- P06 Publish B v1 succeeds with correct expectations.
do $$ declare v_draft bigint; v_pub bigint; v jsonb; r record; begin
  select catalog_version, published_version into v_draft, v_pub from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000b2';
  v := tour_catalog_publish('00000000-0000-0000-0000-0000000000b2', v_draft, 0, 'pm@x', 'v1', '{"changeCount":3}'::jsonb);
  select published_version into v_pub from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000b2';
  select draft_version, source_version, published_by, note, summary into r from tour_catalog_published where client_id='00000000-0000-0000-0000-0000000000b2' and version=1;
  insert into presults values ('P06 publish B v1 succeeds',
    (v->>'version')::bigint = 1 and v_pub = 1
      and r.draft_version = v_draft and r.source_version is null
      and r.published_by = 'pm@x' and r.note = 'v1' and r.summary->>'changeCount' = '3',
    v::text);
end $$;

-- P07 Snapshot content.
do $$ declare v_snap jsonb; begin
  select snapshot into v_snap from tour_catalog_published where client_id='00000000-0000-0000-0000-0000000000b2' and version=1;
  insert into presults values ('P07 snapshot content',
    v_snap->>'schema_version' = '1'
      and jsonb_array_length(v_snap->'tours') = 1
      and jsonb_array_length(v_snap->'departures') = 1
      and not ((v_snap->'departures'->0) ? 'internal')
      and v_snap->'departures'->0->>'status' = 'open'
      and v_snap->'tours'->0->>'name' = 'Golden v1',
    v_snap::text);
end $$;

-- P08 Other clients' data stays out.
do $$ declare v_snap jsonb; v_ok boolean; begin
  select snapshot into v_snap from tour_catalog_published where client_id='00000000-0000-0000-0000-0000000000b2' and version=1;
  select not exists (
           select 1 from jsonb_array_elements(v_snap->'tours') t where t->>'id' = '55555555-5555-5555-5555-555555555555'
         )
         and not exists (
           select 1 from jsonb_array_elements(v_snap->'tours') t where t->>'client_id' <> '00000000-0000-0000-0000-0000000000b2'
         )
         and not exists (
           select 1 from jsonb_array_elements(v_snap->'departures') d where d->>'client_id' <> '00000000-0000-0000-0000-0000000000b2'
         )
    into v_ok;
  insert into presults values ('P08 other clients data stays out', v_ok, '');
end $$;

-- P09 Editing the draft after publishing does not change the published row.
do $$ declare v_snap jsonb; begin
  update tour_catalog_tours set name = 'Golden v2', display_price_text = 'From NZD $2,000 per person' where id = '33333333-3333-3333-3333-333333333333';
  update tour_catalog_departures set status = 'sold_out', status_source = 'manual-test' where id = '44444444-4444-4444-4444-444444444441';
  insert into tour_catalog_departures(id, tour_id, client_id, depart_on, return_on, status, status_source)
    values ('44444444-4444-4444-4444-444444444442', '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-0000000000b2', '2027-05-13', '2027-05-27', 'open', 'manual');

  select snapshot into v_snap from tour_catalog_published where client_id='00000000-0000-0000-0000-0000000000b2' and version=1;
  insert into presults values ('P09 editing draft does not change published row',
    v_snap->'tours'->0->>'name' = 'Golden v1'
      and v_snap->'departures'->0->>'status' = 'open'
      and jsonb_array_length(v_snap->'departures') = 1,
    v_snap::text);
end $$;

-- P10 Publish B v2.
do $$ declare v_draft bigint; v_pub bigint; v jsonb; v_snap jsonb; begin
  select catalog_version, published_version into v_draft, v_pub from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000b2';
  v := tour_catalog_publish('00000000-0000-0000-0000-0000000000b2', v_draft, 1, 'pm@x', 'v2', '{}');
  select snapshot into v_snap from tour_catalog_published where client_id='00000000-0000-0000-0000-0000000000b2' and version=2;
  insert into presults values ('P10 publish B v2',
    (v->>'version')::bigint = 2
      and v_snap->'tours'->0->>'name' = 'Golden v2'
      and jsonb_array_length(v_snap->'departures') = 2
      and exists (select 1 from jsonb_array_elements(v_snap->'departures') d where d->>'id' = '44444444-4444-4444-4444-444444444441' and d->>'status' = 'sold_out'),
    v::text);
end $$;

-- P11 UPDATE on tour_catalog_published refused.
do $$ begin
  update tour_catalog_published set note = 'x' where client_id='00000000-0000-0000-0000-0000000000b2' and version=1;
  insert into presults values ('P11 update published refused', false, 'no error');
exception when others then insert into presults values ('P11 update published refused', sqlerrm = 'tour_catalog_published_append_only', sqlerrm); end $$;

-- P12 DELETE refused.
do $$ begin
  delete from tour_catalog_published where client_id='00000000-0000-0000-0000-0000000000b2' and version=1;
  insert into presults values ('P12 delete published refused', false, 'no error');
exception when others then insert into presults values ('P12 delete published refused', sqlerrm = 'tour_catalog_published_append_only', sqlerrm); end $$;

-- P13 TRUNCATE refused.
do $$ begin
  truncate tour_catalog_published;
  insert into presults values ('P13 truncate published refused', false, 'no error');
exception when others then insert into presults values ('P13 truncate published refused', sqlerrm = 'tour_catalog_published_append_only', sqlerrm); end $$;

-- P14 Revert with a wrong expected published version refused.
do $$ begin
  perform tour_catalog_revert_published('00000000-0000-0000-0000-0000000000b2', 1, 1, 'pm@x', '', '{}');
  insert into presults values ('P14 revert wrong expected published version refused', false, 'no error');
exception when others then insert into presults values ('P14 revert wrong expected published version refused', sqlerrm = 'conflict:stale', sqlerrm); end $$;

-- P15 Revert to the current version refused.
do $$ begin
  perform tour_catalog_revert_published('00000000-0000-0000-0000-0000000000b2', 2, 2, 'pm@x', '', '{}');
  insert into presults values ('P15 revert to current version refused', false, 'no error');
exception when others then insert into presults values ('P15 revert to current version refused', sqlerrm = 'already_current', sqlerrm); end $$;

-- P16 Revert to a missing version refused.
do $$ begin
  perform tour_catalog_revert_published('00000000-0000-0000-0000-0000000000b2', 99, 2, 'pm@x', '', '{}');
  insert into presults values ('P16 revert to missing version refused', false, 'no error');
exception when others then insert into presults values ('P16 revert to missing version refused', sqlerrm = 'version_not_found', sqlerrm); end $$;

-- P17 Revert with blank actor refused.
do $$ begin
  perform tour_catalog_revert_published('00000000-0000-0000-0000-0000000000b2', 1, 2, '   ', '', '{}');
  insert into presults values ('P17 revert blank actor refused', false, 'no error');
exception when others then insert into presults values ('P17 revert blank actor refused', sqlerrm = 'invalid_actor', sqlerrm); end $$;

-- P18 Revert B to v1.
do $$ declare v_draft bigint; v_pub bigint; v jsonb; r record; begin
  select catalog_version, published_version into v_draft, v_pub from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000b2';
  v := tour_catalog_revert_published('00000000-0000-0000-0000-0000000000b2', 1, 2, 'pm@x', 'back', '{}');
  select published_version into v_pub from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000b2';
  select source_version, draft_version into r from tour_catalog_published where client_id='00000000-0000-0000-0000-0000000000b2' and version=3;
  insert into presults values ('P18 revert B to v1',
    (v->>'version')::bigint = 3 and v_pub = 3
      and r.source_version = 1 and r.draft_version = v_draft,
    v::text);
end $$;

-- P19 Revert restores text and price.
do $$ declare v_snap jsonb; begin
  select snapshot into v_snap from tour_catalog_published where client_id='00000000-0000-0000-0000-0000000000b2' and version=3;
  insert into presults values ('P19 revert restores text and price',
    v_snap->'tours'->0->>'name' = 'Golden v1'
      and v_snap->'tours'->0->>'display_price_text' = 'From NZD $1,000 per person'
      and jsonb_array_length(v_snap->'departures') = 1,
    v_snap::text);
end $$;

-- P20 Revert keeps the CURRENT status of departures present in both versions.
do $$ declare v_snap jsonb; begin
  select snapshot into v_snap from tour_catalog_published where client_id='00000000-0000-0000-0000-0000000000b2' and version=3;
  insert into presults values ('P20 revert keeps current departure status',
    exists (select 1 from jsonb_array_elements(v_snap->'departures') d
             where d->>'id' = '44444444-4444-4444-4444-444444444441'
               and d->>'status' = 'sold_out'
               and d->>'status_source' = 'manual-test'),
    v_snap::text);
end $$;

-- P21 Revert does not touch the working tables.
do $$ declare v_name text; v_count int; begin
  select name into v_name from tour_catalog_tours where id = '33333333-3333-3333-3333-333333333333';
  select count(*) into v_count from tour_catalog_departures where client_id = '00000000-0000-0000-0000-0000000000b2';
  insert into presults values ('P21 revert does not touch working tables',
    v_name = 'Golden v2' and v_count = 2,
    format('name=%s departures=%s', v_name, v_count));
end $$;

-- P22 Old versions unchanged.
do $$ declare v1 jsonb; v2 jsonb; begin
  select snapshot into v1 from tour_catalog_published where client_id='00000000-0000-0000-0000-0000000000b2' and version=1;
  select snapshot into v2 from tour_catalog_published where client_id='00000000-0000-0000-0000-0000000000b2' and version=2;
  insert into presults values ('P22 old versions unchanged',
    v1->'departures'->0->>'status' = 'open'
      and jsonb_array_length(v2->'departures') = 2,
    '');
end $$;

-- P23 anon cannot read the table.
set role anon;
do $$ begin perform count(*) from tour_catalog_published; insert into presults values ('P23 anon cannot read published', false, 'no error'); exception when insufficient_privilege then insert into presults values ('P23 anon cannot read published', true, ''); when others then insert into presults values ('P23 anon cannot read published', false, sqlerrm); end $$;
reset role;

-- P24 anon cannot call tour_catalog_publish.
set role anon;
do $$ begin perform tour_catalog_publish('00000000-0000-0000-0000-0000000000c3', 0, 1, 'pm@x', '', '{}'); insert into presults values ('P24 anon cannot call publish', false, 'no error'); exception when insufficient_privilege then insert into presults values ('P24 anon cannot call publish', true, ''); when others then insert into presults values ('P24 anon cannot call publish', false, sqlerrm); end $$;
reset role;

-- P25 anon cannot call tour_catalog_revert_published.
set role anon;
do $$ begin perform tour_catalog_revert_published('00000000-0000-0000-0000-0000000000b2', 1, 3, 'pm@x', '', '{}'); insert into presults values ('P25 anon cannot call revert', false, 'no error'); exception when insufficient_privilege then insert into presults values ('P25 anon cannot call revert', true, ''); when others then insert into presults values ('P25 anon cannot call revert', false, sqlerrm); end $$;
reset role;

-- P26 service_role can read the table and call publish.
set role service_role;
do $$ declare v_count int; v_draft bigint; v jsonb; begin
  select count(*) into v_count from tour_catalog_published;
  select catalog_version into v_draft from tour_catalog_state where client_id='00000000-0000-0000-0000-0000000000c3';
  v := tour_catalog_publish('00000000-0000-0000-0000-0000000000c3', v_draft, 1, 'svc@x', 'by service role', '{}');
  insert into presults values ('P26 service_role can read and publish',
    v_count > 0 and (v->>'version')::bigint = 2,
    format('count=%s version=%s', v_count, v->>'version'));
end $$;
reset role;

select name, case when ok then 'PASS' else 'FAIL' end as r, detail from presults order by name;
-- Exit non-zero (with psql -v ON_ERROR_STOP=1) when any check failed.
do $$ begin if exists (select 1 from presults where not ok) then raise exception 'tour catalog publish checks FAILED'; end if; end $$;
