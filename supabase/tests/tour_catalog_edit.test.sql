-- Behaviour checks for supabase/migrations/20261010150000_tour_catalog_edit.sql (run after the base migration
-- and after tour_catalog_functions.test.sql's setup, on a THROWAWAY local Postgres only).
create temp table eresults(name text, ok boolean, detail text); grant all on eresults to public;
insert into tour_catalog_tours(id, client_id, slug, destination, tier, name, manages_departures) values
 ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000a1', 'golden', 'china', 'discovery', 'China Discovery — Golden China', true);

do $$ declare v jsonb; u timestamptz; begin
  select updated_at into u from tour_catalog_tours where id='22222222-2222-2222-2222-222222222222';
  v := tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1','22222222-2222-2222-2222-222222222222',u,
       '{"display_price_text":"From NZD $4,999 per person","itinerary":[{"day":1,"title":"Auckland","description":"Fly"}],"max_group_size":12}','pm@x');
  insert into eresults values ('E1 update tour', v->>'display_price_text'='From NZD $4,999 per person' and (v->>'max_group_size')::int=12, '');
  insert into eresults select 'E1b change log written with actor', count(*)=1 and min(actor)='edit by pm@x', min(actor) from tour_catalog_change_log where entity_id='22222222-2222-2222-2222-222222222222' and action='update';
  insert into eresults select 'E1c log keeps before and after', bool_and(before->>'display_price_text' is null and after->>'display_price_text' is not null), '' from tour_catalog_change_log where entity_id='22222222-2222-2222-2222-222222222222' and action='update';
end $$;

do $$ begin
  perform tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1','22222222-2222-2222-2222-222222222222','2020-01-01','{"name":"x"}','pm@x');
  insert into eresults values ('E2 stale edit refused', false, 'no error');
exception when others then insert into eresults values ('E2 stale edit refused', sqlerrm like 'conflict:stale:%', sqlerrm); end $$;

do $$ declare u timestamptz; begin
  select updated_at into u from tour_catalog_tours where id='22222222-2222-2222-2222-222222222222';
  perform tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1','22222222-2222-2222-2222-222222222222',u,'{"slug":"hacked"}','pm@x');
  insert into eresults values ('E3 slug not editable', false, 'no error');
exception when others then insert into eresults values ('E3 slug not editable', sqlerrm='field_not_editable:slug', sqlerrm); end $$;

do $$ declare u timestamptz; begin
  select updated_at into u from tour_catalog_tours where id='22222222-2222-2222-2222-222222222222';
  perform tour_catalog_update_tour('00000000-0000-0000-0000-0000000000b2','22222222-2222-2222-2222-222222222222',u,'{"name":"x"}','pm@x');
  insert into eresults values ('E4 other client cannot edit', false, 'no error');
exception when others then insert into eresults values ('E4 other client cannot edit', sqlerrm='tour_not_found', sqlerrm); end $$;

do $$ declare u timestamptz; begin
  select updated_at into u from tour_catalog_tours where id='22222222-2222-2222-2222-222222222222';
  perform tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1','22222222-2222-2222-2222-222222222222',u,'{"name":null}','pm@x');
  insert into eresults values ('E5 name cannot be null', false, 'no error');
exception when others then insert into eresults values ('E5 name cannot be null', sqlerrm='invalid_null:name', sqlerrm); end $$;

do $$ declare v jsonb; begin
  v := tour_catalog_save_departure('00000000-0000-0000-0000-0000000000a1','22222222-2222-2222-2222-222222222222',null,null,
       '{"depart_on":"2027-03-11","return_on":"2027-03-25","price_text_override":"From NZD $4,080 per person"}','pm@x');
  insert into eresults values ('E6 create departure', v->>'status'='open' and v->>'status_source'='manual', v::text);
end $$;

do $$ begin
  perform tour_catalog_save_departure('00000000-0000-0000-0000-0000000000a1','22222222-2222-2222-2222-222222222222',null,null,'{"depart_on":"2027-03-11","return_on":"2027-03-25"}','pm@x');
  insert into eresults values ('E7 duplicate departure refused', false, 'no error');
exception when others then insert into eresults values ('E7 duplicate departure refused', sqlerrm='conflict:duplicate_departure', sqlerrm); end $$;

do $$ declare d record; v jsonb; begin
  select id, updated_at into d from tour_catalog_departures where depart_on='2027-03-11' and tour_id='22222222-2222-2222-2222-222222222222';
  v := tour_catalog_save_departure('00000000-0000-0000-0000-0000000000a1','22222222-2222-2222-2222-222222222222',d.id,d.updated_at,'{"status":"sold_out"}','pm@x');
  insert into eresults values ('E8 update departure status', v->>'status'='sold_out', '');
end $$;

do $$ declare d record; begin
  select id, updated_at into d from tour_catalog_departures where depart_on='2027-03-11' and tour_id='22222222-2222-2222-2222-222222222222';
  perform tour_catalog_save_departure('00000000-0000-0000-0000-0000000000a1','22222222-2222-2222-2222-222222222222',d.id,d.updated_at,'{"depart_on":"2027-04-01"}','pm@x');
  insert into eresults values ('E9 depart_on not editable', false, 'no error');
exception when others then insert into eresults values ('E9 depart_on not editable', sqlerrm='depart_on_not_editable', sqlerrm); end $$;

do $$ declare d record; begin
  select id, updated_at into d from tour_catalog_departures where depart_on='2027-03-11' and tour_id='22222222-2222-2222-2222-222222222222';
  perform tour_catalog_save_departure('00000000-0000-0000-0000-0000000000a1','22222222-2222-2222-2222-222222222222',d.id,d.updated_at,'{"return_on":"2027-03-01"}','pm@x');
  insert into eresults values ('E10 return before depart refused', false, 'no error');
exception when others then insert into eresults values ('E10 return before depart refused', sqlerrm='invalid_dates', sqlerrm); end $$;

insert into eresults select 'E11 departure create+update logged', count(*)=2, count(*)::text from tour_catalog_change_log where entity='departure' and entity_id in (select id from tour_catalog_departures where tour_id='22222222-2222-2222-2222-222222222222');
-- A no-op update (same values) must not add a log row.
update tour_catalog_departures set status = status where depart_on='2027-03-11' and tour_id='22222222-2222-2222-2222-222222222222';
insert into eresults select 'E12 no-op update not logged', count(*)=2, count(*)::text from tour_catalog_change_log where entity='departure' and entity_id in (select id from tour_catalog_departures where tour_id='22222222-2222-2222-2222-222222222222');

do $$ declare d record; begin
  select id into d from tour_catalog_departures where depart_on='2027-03-11' and tour_id='22222222-2222-2222-2222-222222222222';
  perform tour_catalog_save_departure('00000000-0000-0000-0000-0000000000a1','22222222-2222-2222-2222-222222222222',d.id,'2020-01-01','{"status":"open"}','pm@x');
  insert into eresults values ('E14 stale departure edit refused', false, 'no error');
exception when others then insert into eresults values ('E14 stale departure edit refused', sqlerrm like 'conflict:stale:%', sqlerrm); end $$;
-- Imports and rollbacks run by tour_catalog_functions.test.sql must be attributed, not logged as "system".
insert into eresults select 'E15 import and rollback attributed in the log',
  count(*) filter (where actor like 'import:% by %') > 0 and count(*) filter (where actor like 'rollback:%') > 0,
  string_agg(distinct actor, ' | ')
  from tour_catalog_change_log where entity = 'departure';

set role anon;
do $$ begin perform count(*) from tour_catalog_change_log; insert into eresults values ('E13 anon cannot read log', false, 'no error'); exception when insufficient_privilege then insert into eresults values ('E13 anon cannot read log', true, ''); end $$;
reset role;

select name, case when ok then 'PASS' else 'FAIL' end as r, detail from eresults order by name;
-- Exit non-zero (with psql -v ON_ERROR_STOP=1) when any check failed.
do $$ begin if exists (select 1 from eresults where not ok) then raise exception 'tour catalog edit checks FAILED'; end if; end $$;
