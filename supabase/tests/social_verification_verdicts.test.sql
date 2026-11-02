-- T14 for social_verification_verdicts. Throwaway database only, after the P2 migration.
-- Fixture ids are synthetic. This file does not connect to a hosted database.

create temp table t14(name text primary key, ok boolean, detail text);

create function pg_temp.keep(p_name text, p_ok boolean, p_detail text) returns void
language sql as $$
  insert into t14 values (p_name, p_ok, p_detail);
$$;

create function pg_temp.want_state(p_name text, p_sql text, p_state text) returns void
language plpgsql as $$
declare v text := 'ok';
begin
  begin
    execute p_sql;
  exception when others then
    v := sqlstate;
  end;
  insert into t14 values (p_name, v = p_state, v);
end $$;

create function pg_temp.want_append_only(p_name text, p_sql text) returns void
language plpgsql as $$
declare v_state text := 'ok'; v_msg text := '';
begin
  begin
    execute p_sql;
  exception when others then
    v_state := sqlstate;
    v_msg := sqlerrm;
  end;
  insert into t14 values (
    p_name,
    v_state = '23514' and v_msg like '%append-only%',
    v_state || ' ' || v_msg
  );
end $$;

create function pg_temp.want_role_state(p_name text, p_role text, p_sql text, p_state text) returns void
language plpgsql as $$
declare v text := 'ok';
begin
  begin
    execute format('set local role %I', p_role);
    execute p_sql;
  exception when others then
    v := sqlstate;
  end;
  execute 'reset role';
  insert into t14 values (p_name, v = p_state, v);
end $$;

create function pg_temp.want_role_count(p_name text, p_role text, p_expected bigint) returns void
language plpgsql as $$
declare n bigint;
begin
  begin
    execute format('set local role %I', p_role);
    execute 'select count(*) from public.social_verification_verdicts' into n;
    execute 'reset role';
    insert into t14 values (p_name, n = p_expected, coalesce(n::text, 'null'));
  exception when others then
    execute 'reset role';
    insert into t14 values (p_name, false, sqlstate || ' ' || sqlerrm);
  end;
end $$;

create function pg_temp.put_verdict(
  p_request uuid,
  p_client uuid,
  p_type text,
  p_action uuid,
  p_period text,
  p_platform text,
  p_verdict text,
  p_read_point text,
  p_window integer,
  p_boost text,
  p_sample integer,
  p_observed numeric,
  p_cohort jsonb,
  p_baseline numeric,
  p_reasons text[],
  p_reason text,
  p_logic text
) returns void language plpgsql as $$
begin
  insert into public.social_verification_verdicts (
    request_id, client_id, record_type, content_action_id, period_key,
    platform, verdict, read_point, window_hours, boost_status, sample_size,
    observed_value, cohort_definition, baseline_value, not_comparable_reasons,
    reason, logic_version
  ) values (
    p_request, p_client, p_type, p_action, p_period,
    p_platform, p_verdict, p_read_point, p_window, p_boost, p_sample,
    p_observed, p_cohort, p_baseline, p_reasons, p_reason, p_logic
  );
end $$;

grant all on table public.social_verification_verdicts to service_role;

insert into public.clients(id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');

insert into public.flywheel_actions(id, client_id, action_type, payload) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'social.publish_post', '{"idempotency_key":"post-1"}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'social.publish_story', '{"idempotency_key":"story-lite:item-1"}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'social.publish_story', '{"idempotency_key":"story-lite:item-1"}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'social.publish_story', null);

select pg_temp.put_verdict(
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'c1_fidelity',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  null, 'facebook', 'match', 't4',
  null, null, null, null, null, null, null, null, 'wp1.v1'
);

select pg_temp.want_append_only(
  'T14-01 update',
  $$update public.social_verification_verdicts set verdict = 'mismatch' where request_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'$$
);
select pg_temp.keep(
  'T14-01 row unchanged',
  (select verdict = 'match' from public.social_verification_verdicts where request_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
  'verdict moved'
);
select pg_temp.want_append_only(
  'T14-01 delete',
  $$delete from public.social_verification_verdicts where request_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'$$
);
select pg_temp.want_append_only('T14-01 truncate', $$truncate public.social_verification_verdicts$$);
select pg_temp.keep(
  'T14-01 still present',
  (select count(*) = 1 from public.social_verification_verdicts),
  'row missing after refused delete'
);

-- story_dm_count field matrix
select pg_temp.put_verdict(
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'story_dm_count',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  null, 'instagram', 'counted', 'dm24',
  24, null, null, 3, null, null, null, null, 'wp1.v1'
);
select pg_temp.put_verdict(
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'story_dm_count',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  null, 'instagram', 'not_readable', 'dm48',
  24, null, null, null, null, null, null, 'sync_not_caught_up', 'wp1.v1'
);
select pg_temp.want_state('T14-02 counted without observed', $$
  select pg_temp.put_verdict('cccccccc-cccc-4ccc-8ccc-cccccccccc11','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','story_dm_count','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',null,'instagram','counted','dm-bad',24,null,null,null,null,null,null,null,'wp1.v1')
$$, '23514');
select pg_temp.want_state('T14-02 counted with reason', $$
  select pg_temp.put_verdict('cccccccc-cccc-4ccc-8ccc-cccccccccc12','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','story_dm_count','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',null,'instagram','counted','dm-bad2',24,null,null,1,null,null,null,'nope','wp1.v1')
$$, '23514');
select pg_temp.want_state('T14-02 not_readable with observed', $$
  select pg_temp.put_verdict('cccccccc-cccc-4ccc-8ccc-cccccccccc13','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','story_dm_count','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',null,'instagram','not_readable','dm-bad3',24,null,null,1,null,null,null,'sync_not_caught_up','wp1.v1')
$$, '23514');
select pg_temp.want_state('T14-02 not_readable without reason', $$
  select pg_temp.put_verdict('cccccccc-cccc-4ccc-8ccc-cccccccccc14','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','story_dm_count','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',null,'instagram','not_readable','dm-bad4',24,null,null,null,null,null,null,null,'wp1.v1')
$$, '23514');
select pg_temp.want_state('T14-02 story missing window', $$
  select pg_temp.put_verdict('cccccccc-cccc-4ccc-8ccc-cccccccccc15','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','story_dm_count','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',null,'instagram','counted','dm-bad5',null,null,null,1,null,null,null,null,'wp1.v1')
$$, '23514');
select pg_temp.want_state('T14-02 story boost forbidden', $$
  select pg_temp.put_verdict('cccccccc-cccc-4ccc-8ccc-cccccccccc16','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','story_dm_count','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',null,'instagram','counted','dm-bad6',24,'boosted',null,1,null,null,null,null,'wp1.v1')
$$, '23514');
select pg_temp.want_state('T14-02 story sample forbidden', $$
  select pg_temp.put_verdict('cccccccc-cccc-4ccc-8ccc-cccccccccc17','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','story_dm_count','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',null,'instagram','counted','dm-bad7',24,null,1,1,null,null,null,null,'wp1.v1')
$$, '23514');
select pg_temp.want_state('T14-02 story baseline forbidden', $$
  select pg_temp.put_verdict('cccccccc-cccc-4ccc-8ccc-cccccccccc18','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','story_dm_count','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',null,'instagram','counted','dm-bad8',24,null,null,1,null,1,null,null,'wp1.v1')
$$, '23514');
select pg_temp.want_state('T14-02 story cohort forbidden', $$
  select pg_temp.put_verdict('cccccccc-cccc-4ccc-8ccc-cccccccccc19','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','story_dm_count','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',null,'instagram','counted','dm-bad9',24,null,null,1,'{}'::jsonb,null,null,null,'wp1.v1')
$$, '23514');
select pg_temp.want_state('T14-02 story period forbidden', $$
  select pg_temp.put_verdict('cccccccc-cccc-4ccc-8ccc-cccccccccc1a','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','story_dm_count','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','2026-w44','instagram','counted','dm-bad10',24,null,null,1,null,null,null,null,'wp1.v1')
$$, '23514');

-- c2 / c3 / boost shapes
select pg_temp.put_verdict(
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc4',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'c2_performance',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  null, 'facebook', 'not_comparable', 't72',
  null, null, null, null, null, null, array['different_offer'], null, 'wp1.v1'
);
select pg_temp.want_state('T14-02 not_comparable without reasons', $$
  select pg_temp.put_verdict('cccccccc-cccc-4ccc-8ccc-cccccccccc21','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','c2_performance','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',null,'facebook','not_comparable','t72b',null,null,null,null,null,null,null,null,'wp1.v1')
$$, '23514');
select pg_temp.put_verdict(
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc5',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'c3_goal_pace',
  null, '2026-w44', 'facebook', 'on_track', 'week',
  null, null, null, null, null, null, null, null, 'wp1.v1'
);
select pg_temp.keep(
  'T14-02 c3 subject key',
  (select subject_key = 'period:2026-w44' from public.social_verification_verdicts where request_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc5'),
  'subject_key'
);
select pg_temp.want_state('T14-02 c3 with content', $$
  select pg_temp.put_verdict('cccccccc-cccc-4ccc-8ccc-cccccccccc22','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','c3_goal_pace','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','2026-w45','facebook','behind','week2',null,null,null,null,null,null,null,null,'wp1.v1')
$$, '23514');
select pg_temp.put_verdict(
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc6',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'boost_check',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  null, 'facebook', 'boosted', 't72',
  null, 'boosted', null, null, null, null, null, null, 'wp1.v2'
);
select pg_temp.put_verdict(
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc7',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'boost_check',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  null, 'facebook', 'boost_unknown', 't4',
  null, 'boost_unknown', null, null, null, null, null, 'account_incomplete', 'wp1.v2'
);
select pg_temp.want_state('T14-02 boost_unknown without reason', $$
  select pg_temp.put_verdict('cccccccc-cccc-4ccc-8ccc-cccccccccc23','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','boost_check','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',null,'facebook','boost_unknown','t4b',null,'boost_unknown',null,null,null,null,null,null,'wp1.v3')
$$, '23514');
select pg_temp.want_state('T14-02 boost_status null rejected', $$
  select pg_temp.put_verdict('cccccccc-cccc-4ccc-8ccc-cccccccccc25','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','boost_check','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',null,'facebook','boosted','t4f',null,null,null,null,null,null,null,null,'wp1.v4')
$$, '23514');
select pg_temp.want_state('T14-02 boost observed forbidden', $$
  select pg_temp.put_verdict('cccccccc-cccc-4ccc-8ccc-cccccccccc24','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','boost_check','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',null,'facebook','not_boosted','t4c',null,'not_boosted',null,1,null,null,null,null,'wp1.v3')
$$, '23514');

select pg_temp.want_state('T14-03 same request id', $$
  select pg_temp.put_verdict('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','c1_fidelity','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',null,'facebook','mismatch','other',null,null,null,null,null,null,null,null,'wp1.v1')
$$, '23505');
select pg_temp.want_state('T14-04 same identity', $$
  select pg_temp.put_verdict('cccccccc-cccc-4ccc-8ccc-ccccccccccc8','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','c1_fidelity','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',null,'instagram','mismatch','t4',null,null,null,null,null,null,null,null,'wp1.v1')
$$, '23505');
select pg_temp.put_verdict(
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc9',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  'c1_fidelity',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
  null, 'facebook', 'match', 't4',
  null, null, null, null, null, null, null, null, 'wp1.v1'
);

select pg_temp.want_state(
  'T14-05 delete client with verdict',
  $$delete from public.clients where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$$,
  '23503'
);
select pg_temp.keep(
  'T14-05 client remains',
  (select count(*) = 1 from public.clients where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'client deleted'
);
delete from public.clients where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
select pg_temp.keep(
  'T14-05 client without verdict can be deleted',
  (select count(*) = 0 from public.clients where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  'empty client remained'
);
select pg_temp.want_state(
  'T14-05 delete referenced action',
  $$delete from public.flywheel_actions where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'$$,
  '23503'
);

select pg_temp.want_role_state(
  'T14-06 anon cannot read',
  'anon',
  $$select count(*) from public.social_verification_verdicts$$,
  '42501'
);
select pg_temp.want_role_state(
  'T14-06 authenticated cannot read',
  'authenticated',
  $$select count(*) from public.social_verification_verdicts$$,
  '42501'
);
grant select on public.social_verification_verdicts to anon;
select pg_temp.want_role_count('T14-06 anon with grant still sees nothing', 'anon', 0);
revoke select on public.social_verification_verdicts from anon;

select pg_temp.keep(
  'T14 policy is service_role only',
  (select roles::text = '{service_role}' and cmd = 'ALL' and qual = 'true' and with_check = 'true'
     from pg_policies where tablename = 'social_verification_verdicts'),
  'policy shape'
);
select pg_temp.keep(
  'T14 rls enabled',
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'social_verification_verdicts'),
  'rls'
);

select pg_temp.want_state('T14-09 tiktok', $$
  select pg_temp.put_verdict('cccccccc-cccc-4ccc-8ccc-cccccccccc31','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','c1_fidelity','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',null,'tiktok','match','t4d',null,null,null,null,null,null,null,null,'wp1.v1')
$$, '23514');

-- S2: story key is unique per client; post rows and null keys are outside the index.
insert into public.flywheel_actions(id, client_id, action_type, payload) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'social.publish_post', '{"idempotency_key":"post-1"}'::jsonb);
select pg_temp.want_state(
  'S2 duplicate story key',
  $$insert into public.flywheel_actions(id, client_id, action_type, payload) values
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'social.publish_story', '{"idempotency_key":"story-lite:item-1"}'::jsonb)$$,
  '23505'
);
insert into public.flywheel_actions(id, client_id, action_type, payload) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'social.publish_story', '{"idempotency_key":"story-lite:item-2"}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'social.publish_story', null);
select pg_temp.keep(
  'S2 first story row kept',
  (select count(*) = 1 from public.flywheel_actions
    where client_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      and action_type = 'social.publish_story'
      and payload ->> 'idempotency_key' = 'story-lite:item-1'),
  'story row count'
);

select pg_temp.want_role_state(
  'service_role insert allowed',
  'service_role',
  $$select pg_temp.put_verdict('cccccccc-cccc-4ccc-8ccc-cccccccccc41','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','c2_performance','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',null,'facebook','within','t4e',null,null,null,null,null,null,null,null,'wp1.v9')$$,
  'ok'
);
select pg_temp.want_role_state(
  'service_role update blocked by trigger',
  'service_role',
  $$update public.social_verification_verdicts set reason = 'changed' where request_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9'$$,
  '23514'
);

do $$
declare bad text; n int;
begin
  select count(*) into n from t14;
  select string_agg(name || '=' || detail, E'\n' order by name) into bad from t14 where ok is not true;
  if bad is not null then
    raise exception E'T14 failures (% of %):\n%', (select count(*) from t14 where ok is not true), n, bad;
  end if;
  raise notice 'T14 passed % checks', n;
end $$;
