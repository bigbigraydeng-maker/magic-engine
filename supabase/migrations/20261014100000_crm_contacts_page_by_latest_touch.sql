-- service-role only; apply only after explicit PM approval (A-level: adds a function; READ-ONLY, no table or data change).
-- CRM 「全部客人」: one round trip that returns the ids of one page of guests, newest real interaction first, plus the
-- total number of guests matching the filters. Replaces three app-side steps (fetch all ids, scan touchpoints, count)
-- that cost ~1.5 s of the ~2 s list request (PM 2026-10-14: this page is used constantly and must be faster).
--
-- Ordering: latest touchpoint (max occurred_at over contact_touchpoints) newest first; people with no touchpoint
-- come last, newest first_seen_at first; id breaks ties so paging is stable. contacts.last_seen_at is NOT used: in
-- production 721 of 1159 guests have a last_seen_at older than their real latest touchpoint.
-- Filters mirror the route exactly: p_stages = contacts.stage in (...), p_q = case-insensitive substring of name /
-- phone / email, p_in_ids = only these ids (kind=trade), p_not_in_ids = never these ids (kind=retail). NULL = no filter.
--
-- Requires: contacts, contact_touchpoints (20260726000004/5) and contacts.stage (20260728000001).
--
-- ROLLBACK (do not run automatically):
--   drop function public.crm_contacts_page_by_latest_touch(uuid, text[], text, uuid[], uuid[], integer, integer);

create or replace function public.crm_contacts_page_by_latest_touch(
  p_client_id uuid,
  p_stages text[],
  p_q text,
  p_in_ids uuid[],
  p_not_in_ids uuid[],
  p_limit integer,
  p_offset integer
)
returns table (id uuid, total bigint)
language sql
stable
set search_path = public
as $$
  with last_touch as (
    select t.contact_id, max(t.occurred_at) as last_at
    from public.contact_touchpoints t
    where t.client_id = p_client_id
    group by t.contact_id
  ),
  filtered as (
    select c.id, c.first_seen_at, lt.last_at
    from public.contacts c
    left join last_touch lt on lt.contact_id = c.id
    where c.client_id = p_client_id
      and (p_stages is null or c.stage = any (p_stages))
      and (
        p_q is null
        or c.display_name ilike '%' || p_q || '%'
        or c.primary_phone ilike '%' || p_q || '%'
        or c.primary_email ilike '%' || p_q || '%'
      )
      and (p_in_ids is null or c.id = any (p_in_ids))
      and (p_not_in_ids is null or not (c.id = any (p_not_in_ids)))
  )
  select f.id, count(*) over () as total
  from filtered f
  order by f.last_at desc nulls last, f.first_seen_at desc nulls last, f.id
  limit least(greatest(coalesce(p_limit, 100), 0), 500)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

revoke all on function public.crm_contacts_page_by_latest_touch(uuid, text[], text, uuid[], uuid[], integer, integer)
  from public, anon, authenticated;
grant execute on function public.crm_contacts_page_by_latest_touch(uuid, text[], text, uuid[], uuid[], integer, integer)
  to service_role;
