-- Behaviour checks for supabase/migrations/20261014100000_crm_contacts_page_by_latest_touch.sql
-- Run on a THROWAWAY local Postgres only, after migrations 20260726000004, 20260726000005, 20260728000001 (contacts,
-- contact_touchpoints, contacts.stage) and the migration under test. Run with psql -v ON_ERROR_STOP=1.
-- Every PASS/FAIL line is one check; any FAIL raises at the end.

create temp table pres(name text, ok boolean, detail text);
create function pg_temp.pcheck(n text, c boolean, d text default '') returns void language sql as $$
  insert into pres values (n, coalesce(c, false), d) $$;

-- Fixtures: client A has five guests, client B one.
insert into public.clients(id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b2') on conflict do nothing;
insert into public.contacts(id, client_id, display_name, primary_phone, primary_email, stage, first_seen_at) values
 ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Old Guest',    '+6421000001', 'old@example.com',   'quoted',       '2026-01-01'),
 ('c0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'Newer Guest',  '+6421000002', 'newer@example.com', null,           '2026-10-01'),
 ('c0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'Quiet Guest',  null,          null,                'deposit_paid', '2026-09-01'),
 ('c0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', 'Never Touched','+6421000004', null,                null,           '2026-08-01'),
 ('c0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a1', 'Mid Guest',    null,          'mid@example.com',   'quoted',       '2026-06-01'),
 ('c0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'Other Client', null,          null,                null,           '2026-10-10');
-- Old Guest has the NEWEST touchpoint (today); Quiet Guest an older one; Mid Guest the oldest; Newer Guest one in between.
insert into public.contact_touchpoints(client_id, contact_id, channel, direction, occurred_at, source, source_ref) values
 ('00000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000000001', 'email', 'inbound',  '2026-10-14T01:00:00Z', 't', '1'),
 ('00000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000000001', 'email', 'inbound',  '2026-02-01T00:00:00Z', 't', '2'),
 ('00000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000000002', 'phone', 'outbound', '2026-10-05T00:00:00Z', 't', '3'),
 ('00000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000000003', 'email', 'inbound',  '2026-10-10T00:00:00Z', 't', '4'),
 ('00000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000000005', 'email', 'inbound',  '2026-03-01T00:00:00Z', 't', '5'),
 ('00000000-0000-0000-0000-0000000000b2', 'c0000000-0000-0000-0000-0000000000b1', 'email', 'inbound',  '2026-10-14T05:00:00Z', 't', '6');

create function pg_temp.ids(p_stages text[] default null, p_q text default null, p_in uuid[] default null, p_not uuid[] default null,
                            p_limit int default 100, p_offset int default 0) returns text language sql as $$
  select coalesce(string_agg(right(id::text, 2), ',' order by ord), '') from (
    select id, row_number() over () as ord from public.crm_contacts_page_by_latest_touch(
      '00000000-0000-0000-0000-0000000000a1', p_stages, p_q, p_in, p_not, p_limit, p_offset)) s $$;

-- 1. newest real interaction first; people with no touchpoint last, newest first_seen first
select pg_temp.pcheck('order: latest touch desc, untouched last by first_seen desc', pg_temp.ids() = '01,03,02,05,04', pg_temp.ids());
-- 2. client isolation: the other client's guest never appears and does not count
select pg_temp.pcheck('client isolation', pg_temp.ids() not like '%b1%' and
  (select max(total) from public.crm_contacts_page_by_latest_touch('00000000-0000-0000-0000-0000000000a1', null, null, null, null, 100, 0)) = 5);
-- 3. total counts all matches, independent of limit/offset
select pg_temp.pcheck('total ignores paging', (select max(total) from public.crm_contacts_page_by_latest_touch('00000000-0000-0000-0000-0000000000a1', null, null, null, null, 2, 0)) = 5);
-- 4. paging is stable and continuous
select pg_temp.pcheck('page 1 of 2', pg_temp.ids(p_limit => 2, p_offset => 0) = '01,03', pg_temp.ids(p_limit => 2, p_offset => 0));
select pg_temp.pcheck('page 2 of 2', pg_temp.ids(p_limit => 2, p_offset => 2) = '02,05', pg_temp.ids(p_limit => 2, p_offset => 2));
select pg_temp.pcheck('page 3 of 2', pg_temp.ids(p_limit => 2, p_offset => 4) = '04', pg_temp.ids(p_limit => 2, p_offset => 4));
-- 5. stage filter (null stage never matches a stage list, same as the old .in())
select pg_temp.pcheck('stage filter', pg_temp.ids(p_stages => array['quoted','deposit_paid']) = '01,03,05', pg_temp.ids(p_stages => array['quoted','deposit_paid']));
-- 6. search: name / phone / email, case-insensitive substring
select pg_temp.pcheck('search by name', pg_temp.ids(p_q => 'guest') = '01,03,02,05' and pg_temp.ids(p_q => 'GUEST') = '01,03,02,05');
select pg_temp.pcheck('search by phone', pg_temp.ids(p_q => '6421000002') = '02', pg_temp.ids(p_q => '6421000002'));
select pg_temp.pcheck('search by email', pg_temp.ids(p_q => 'mid@') = '05', pg_temp.ids(p_q => 'mid@'));
select pg_temp.pcheck('search no match', pg_temp.ids(p_q => 'zzz') = '');
-- 7. id restriction and exclusion (kind=trade / kind=retail)
select pg_temp.pcheck('in ids only', pg_temp.ids(p_in => array['c0000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000001']::uuid[]) = '01,04');
select pg_temp.pcheck('not in ids', pg_temp.ids(p_not => array['c0000000-0000-0000-0000-000000000001']::uuid[]) = '03,02,05,04');
-- 8. limit is capped at 500 and null/negative are safe
select pg_temp.pcheck('limit null is safe', pg_temp.ids(p_limit => null) = '01,03,02,05,04');
select pg_temp.pcheck('negative limit -> none', pg_temp.ids(p_limit => -5) = '');
-- 8b. wildcard characters in the search term behave like the old ilike (they are wildcards), empty id list matches nobody,
--     an offset past the end returns an empty page, paging past int range does not corrupt results
select pg_temp.pcheck('percent in q is a wildcard like before', pg_temp.ids(p_q => '%') = '01,03,02,05,04', pg_temp.ids(p_q => '%'));
select pg_temp.pcheck('empty in-list matches nobody', pg_temp.ids(p_in => array[]::uuid[]) = '');
select pg_temp.pcheck('offset past the end is an empty page', pg_temp.ids(p_limit => 2, p_offset => 99) = '');
insert into public.contacts(id, client_id, display_name, first_seen_at) values
  ('c0000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000a1', 'Tie 1', '2026-05-05'),
  ('c0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000a1', 'Tie 2', '2026-05-05'),
  ('c0000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000a1', 'Tie 3', '2026-05-05');
insert into public.contact_touchpoints(client_id, contact_id, channel, direction, occurred_at, source, source_ref)
  select '00000000-0000-0000-0000-0000000000a1', id, 'email', 'inbound', '2026-04-04T00:00:00Z', 't', 'tie-' || id::text
  from public.contacts where display_name like 'Tie %';
select pg_temp.pcheck('tie paging is exact (3 ties over 2 pages)',
  pg_temp.ids(p_q => 'Tie', p_limit => 2, p_offset => 0) = '11,12' and pg_temp.ids(p_q => 'Tie', p_limit => 2, p_offset => 2) = '13',
  pg_temp.ids(p_q => 'Tie', p_limit => 2, p_offset => 0) || ' | ' || pg_temp.ids(p_q => 'Tie', p_limit => 2, p_offset => 2));

-- 9. function is read-only (stable) and locked down
select pg_temp.pcheck('stable', (select provolatile from pg_proc where proname = 'crm_contacts_page_by_latest_touch') = 's');
select pg_temp.pcheck('anon/authenticated cannot execute',
  not has_function_privilege('anon', 'public.crm_contacts_page_by_latest_touch(uuid,text[],text,uuid[],uuid[],integer,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.crm_contacts_page_by_latest_touch(uuid,text[],text,uuid[],uuid[],integer,integer)', 'execute')
  and has_function_privilege('service_role', 'public.crm_contacts_page_by_latest_touch(uuid,text[],text,uuid[],uuid[],integer,integer)', 'execute'));

select case when ok then 'PASS' else 'FAIL' end as result, name, detail from pres order by ok, name;
do $$ begin
  if exists (select 1 from pres where not ok) then raise exception 'crm_contacts_page.test.sql: % check(s) FAILED', (select count(*) from pres where not ok); end if;
end $$;
