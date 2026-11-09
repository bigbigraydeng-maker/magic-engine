-- Read-only batch for the priority list. The application authorizes the client
-- before calling; this invoker function is executable only by service_role.
-- Rollback: DROP FUNCTION public.crm_priority_touchpoint_batch(uuid, integer);
create or replace function public.crm_priority_touchpoint_batch(p_client_id uuid, p_offset integer)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.occurred_at desc, r.id desc), '[]'::jsonb)
  from (
    select id, contact_id, channel, direction, occurred_at, created_at, raw, metadata, source
    from public.contact_touchpoints
    where client_id = p_client_id
    order by occurred_at desc, id desc
    limit 10000 offset greatest(coalesce(p_offset, 0), 0)
  ) r
$$;

revoke all on function public.crm_priority_touchpoint_batch(uuid, integer) from public, anon, authenticated;
grant execute on function public.crm_priority_touchpoint_batch(uuid, integer) to service_role;
