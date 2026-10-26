-- Behaviour checks for supabase/migrations/20261009100000_tour_catalog.sql.
-- Run on a THROWAWAY local Postgres only (never on a real project):
--   1) create stub roles service_role/anon/authenticated and a stub public.clients(id uuid primary key)
--      with rows 00000000-0000-0000-0000-0000000000a1 and ...b2, grant default privileges to service_role;
--   2) psql -v ON_ERROR_STOP=1 -f the migration; then psql -f this file.
-- Every line printed as PASS/FAIL at the end is one check; any FAIL means the functions are wrong.
\set A '00000000-0000-0000-0000-0000000000a1'
\set B '00000000-0000-0000-0000-0000000000b2'
create temp table results(name text, ok boolean, detail text); grant all on results to public;
create or replace function pg_temp.check(n text, c boolean, d text default '') returns void language sql as $$ insert into results values (n, c, d) $$;

insert into tour_catalog_tours(id, client_id, slug, destination, tier, name, manages_departures) values
 ('11111111-1111-1111-1111-111111111111', :'A', 'essentials', 'china', 'discovery', 'China Discovery — Best of China', true);

-- batch 1: two adds
insert into tour_catalog_import_batches(id, client_id, kind, file_sha256, plan) values
 ('b0000000-0000-0000-0000-000000000001', :'A', 'departures', repeat('a',64),
  '{"adds":[{"tourId":"11111111-1111-1111-1111-111111111111","departOn":"2027-03-11","returnOn":"2027-03-25","status":"open","internal":{"airline":"CA"}},{"tourId":"11111111-1111-1111-1111-111111111111","departOn":"2027-05-13","returnOn":"2027-05-27","status":"open","internal":{}}],"updates":[]}');

select pg_temp.check('T1 apply adds', (tour_catalog_apply_batch(:'A','b0000000-0000-0000-0000-000000000001','pm@x')->>'added')::int = 2);
select pg_temp.check('T1b two departures exist', (select count(*) from tour_catalog_departures)=2);
-- The exact number is not asserted: row triggers (20261010200000) bump the revision too; it is only compared for equality.
select pg_temp.check('T1c version went up', (select catalog_version from tour_catalog_state where client_id=:'A')>0);
select catalog_version as v_after_b1 from tour_catalog_state where client_id=:'A' \gset
select pg_temp.check('T1d status applied', (select status from tour_catalog_import_batches where id='b0000000-0000-0000-0000-000000000001')='applied');

do $$ begin
  perform tour_catalog_apply_batch('00000000-0000-0000-0000-0000000000a1','b0000000-0000-0000-0000-000000000001','pm@x');
  insert into results values ('T2 reapply rejected', false, 'no error');
exception when others then insert into results values ('T2 reapply rejected', sqlerrm='batch_not_applicable', sqlerrm); end $$;

-- batch 2: update one with correct expected updated_at
insert into tour_catalog_import_batches(id, client_id, kind, file_sha256, plan)
select 'b0000000-0000-0000-0000-000000000002', :'A', 'departures', repeat('b',64),
  jsonb_build_object('adds','[]'::jsonb,'updates', jsonb_build_array(jsonb_build_object('departureId', d.id,'expectedUpdatedAt', d.updated_at,'returnOn','2027-03-26','status','sold_out','internal','{"airline":"CA","capacity":20}'::jsonb)))
from tour_catalog_departures d where d.depart_on='2027-03-11';
select pg_temp.check('T3 apply update', (tour_catalog_apply_batch(:'A','b0000000-0000-0000-0000-000000000002','pm@x')->>'updated')::int = 1);
select pg_temp.check('T3b update took effect', (select status||return_on::text from tour_catalog_departures where depart_on='2027-03-11')='sold_out2027-03-26');
select pg_temp.check('T3c version went up', (select catalog_version from tour_catalog_state where client_id=:'A')>:v_after_b1);

-- batch 3: stale expected + an add in same batch -> all-or-nothing
insert into tour_catalog_import_batches(id, client_id, kind, file_sha256, plan)
select 'b0000000-0000-0000-0000-000000000003', :'A', 'departures', repeat('c',64),
  jsonb_build_object('adds', jsonb_build_array(jsonb_build_object('tourId','11111111-1111-1111-1111-111111111111','departOn','2027-09-09','returnOn','2027-09-23','status','open','internal','{}'::jsonb)),
   'updates', jsonb_build_array(jsonb_build_object('departureId', d.id,'expectedUpdatedAt','2020-01-01T00:00:00Z','returnOn','2027-05-28','status','open','internal','{}'::jsonb)))
from tour_catalog_departures d where d.depart_on='2027-05-13';
do $$ begin
  perform tour_catalog_apply_batch('00000000-0000-0000-0000-0000000000a1','b0000000-0000-0000-0000-000000000003','pm@x');
  insert into results values ('T4 stale rejected', false, 'no error');
exception when others then insert into results values ('T4 stale rejected', sqlerrm like 'conflict:stale:%', sqlerrm); end $$;
select pg_temp.check('T4b nothing partially applied', (select count(*) from tour_catalog_departures where depart_on='2027-09-09')=0 and (select status from tour_catalog_import_batches where id='b0000000-0000-0000-0000-000000000003')='previewed');

-- batch 4: add duplicate of existing (tour, date)
insert into tour_catalog_import_batches(id, client_id, kind, file_sha256, plan) values
 ('b0000000-0000-0000-0000-000000000004', :'A', 'departures', repeat('d',64),
  '{"adds":[{"tourId":"11111111-1111-1111-1111-111111111111","departOn":"2027-05-13","returnOn":"2027-05-27","status":"open","internal":{}}],"updates":[]}');
do $$ begin
  perform tour_catalog_apply_batch('00000000-0000-0000-0000-0000000000a1','b0000000-0000-0000-0000-000000000004','pm@x');
  insert into results values ('T5 duplicate add rejected', false, 'no error');
exception when others then insert into results values ('T5 duplicate add rejected', sqlerrm like 'conflict:add:%', sqlerrm); end $$;

-- wrong client
do $$ begin
  perform tour_catalog_apply_batch('00000000-0000-0000-0000-0000000000b2','b0000000-0000-0000-0000-000000000004','pm@x');
  insert into results values ('T6 wrong client rejected', false, 'no error');
exception when others then insert into results values ('T6 wrong client rejected', sqlerrm='batch_not_applicable', sqlerrm); end $$;

-- foreign client's tour in an add
insert into tour_catalog_import_batches(id, client_id, kind, file_sha256, plan) values
 ('b0000000-0000-0000-0000-000000000005', :'B', 'departures', repeat('e',64),
  '{"adds":[{"tourId":"11111111-1111-1111-1111-111111111111","departOn":"2027-06-06","returnOn":"2027-06-16","status":"open","internal":{}}],"updates":[]}');
do $$ begin
  perform tour_catalog_apply_batch('00000000-0000-0000-0000-0000000000b2','b0000000-0000-0000-0000-000000000005','pm@x');
  insert into results values ('T7 cross-client tour rejected', false, 'no error');
exception when others then insert into results values ('T7 cross-client tour rejected', sqlerrm='tour_not_in_client', sqlerrm); end $$;

-- rollback batch 2 (update) -> restores
select catalog_version as v_before_rb from tour_catalog_state where client_id=:'A' \gset
select pg_temp.check('T8 rollback update', (tour_catalog_rollback_batch(:'A','b0000000-0000-0000-0000-000000000002','pm@x')->>'catalogVersion')::int > :v_before_rb);
select pg_temp.check('T8b restored', (select status||return_on::text from tour_catalog_departures where depart_on='2027-03-11')='open2027-03-25');

-- manual edit then rollback batch 1 -> conflict, nothing deleted
update tour_catalog_departures set price_text_override='NZD $1' where depart_on='2027-05-13';
do $$ begin
  perform tour_catalog_rollback_batch('00000000-0000-0000-0000-0000000000a1','b0000000-0000-0000-0000-000000000001','pm@x');
  insert into results values ('T9 rollback blocked by manual edit', false, 'no error');
exception when others then insert into results values ('T9 rollback blocked by manual edit', sqlerrm like 'conflict:modified:%', sqlerrm); end $$;
select pg_temp.check('T9b nothing deleted', (select count(*) from tour_catalog_departures)=2 and (select status from tour_catalog_import_batches where id='b0000000-0000-0000-0000-000000000001')='applied');

-- clean manual edit? updated_at already changed; so batch1 can never roll back now (expected)
-- rollback twice
do $$ begin
  perform tour_catalog_rollback_batch('00000000-0000-0000-0000-0000000000a1','b0000000-0000-0000-0000-000000000002','pm@x');
  insert into results values ('T10 double rollback rejected', false, 'no error');
exception when others then insert into results values ('T10 double rollback rejected', sqlerrm='batch_not_rollbackable', sqlerrm); end $$;

-- plain rollback of an untouched add-only batch
insert into tour_catalog_import_batches(id, client_id, kind, file_sha256, plan) values
 ('b0000000-0000-0000-0000-000000000006', :'A', 'departures', repeat('f',64),
  '{"adds":[{"tourId":"11111111-1111-1111-1111-111111111111","departOn":"2027-10-28","returnOn":"2027-11-11","status":"open","internal":{}}],"updates":[]}');
select tour_catalog_apply_batch(:'A','b0000000-0000-0000-0000-000000000006','pm@x');
select tour_catalog_rollback_batch(:'A','b0000000-0000-0000-0000-000000000006','pm@x');
select pg_temp.check('T11b row gone', (select count(*) from tour_catalog_departures where depart_on='2027-10-28')=0);
select pg_temp.check('T11c version never decreases', (select catalog_version from tour_catalog_state where client_id=:'A')>:v_before_rb, (select catalog_version::text from tour_catalog_state where client_id=:'A'));

-- Rolled-back batches are history: the same file may be previewed again as a new row,
-- but a second live (previewed/applied) batch for the same file is refused.
do $$ begin
  insert into tour_catalog_import_batches(client_id, kind, file_sha256) values ('00000000-0000-0000-0000-0000000000a1','departures',repeat('b',64));
  insert into results values ('T15 re-preview after rollback allowed', true, '');
exception when others then insert into results values ('T15 re-preview after rollback allowed', false, sqlerrm); end $$;
do $$ begin
  insert into tour_catalog_import_batches(client_id, kind, file_sha256) values ('00000000-0000-0000-0000-0000000000a1','departures',repeat('a',64));
  insert into results values ('T16 second live batch for applied file refused', false, 'no error');
exception when unique_violation then insert into results values ('T16 second live batch for applied file refused', true, ''); end $$;
-- Rollback scoped by client: another client cannot roll back this client's batch.
do $$ begin
  perform tour_catalog_rollback_batch('00000000-0000-0000-0000-0000000000b2','b0000000-0000-0000-0000-000000000001','pm@x');
  insert into results values ('T17 cross-client rollback refused', false, 'no error');
exception when others then insert into results values ('T17 cross-client rollback refused', sqlerrm='batch_not_rollbackable', sqlerrm); end $$;

-- Permissions
set role anon;
do $$ begin perform count(*) from tour_catalog_tours; insert into results values ('T12 anon cannot read', false, 'no error'); exception when insufficient_privilege then insert into results values ('T12 anon cannot read', true, ''); end $$;
do $$ begin perform tour_catalog_apply_batch('00000000-0000-0000-0000-0000000000a1','b0000000-0000-0000-0000-000000000004','x'); insert into results values ('T13 anon cannot call apply', false, 'no error'); exception when insufficient_privilege then insert into results values ('T13 anon cannot call apply', true, ''); end $$;
reset role;
set role service_role;
do $$ begin perform count(*) from tour_catalog_tours; insert into results values ('T14 service_role can read', true, ''); exception when others then insert into results values ('T14 service_role can read', false, sqlerrm); end $$;
reset role;

select name, case when ok then 'PASS' else 'FAIL' end as r, detail from results order by name;
-- Exit non-zero (with psql -v ON_ERROR_STOP=1) when any check failed.
do $$ begin if exists (select 1 from results where not ok) then raise exception 'tour catalog function checks FAILED'; end if; end $$;
