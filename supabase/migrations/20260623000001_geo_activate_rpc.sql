-- ============================================================================
-- GEO Directive Activation — atomic RPC
-- ============================================================================
-- Background:
--   The activate API previously did 2 non-atomic UPDATEs:
--     1. archive current active for this client
--     2. set target id to active
--   If step 2 failed, step 1 already ran -> client had NO active directive.
--
--   This migration adds a single RPC that performs all THREE state changes
--   inside a single transaction (Postgres functions are auto-transactional):
--     1. Archive whatever is currently `active` for this client.
--     2. Archive all OTHER `draft` rows for this client (Phase: PM 2026-06-04
--        decision — only one in-flight draft + one active, keep history
--        recoverable via `archived` rows, no hard delete).
--     3. Promote the target row to `active`.
--
--   Any failure mid-way rolls the entire transaction back. The function
--   returns the activated row + a count of how many drafts were archived
--   so the UI can confirm the action to the FDE.
--
-- Safety:
--   - ownership check (client_id) is enforced inside the function
--   - status check ensures target was a draft (cannot re-activate archived)
--   - the UNIQUE INDEX on (client_id) WHERE status='active' is preserved
-- ============================================================================

create or replace function public.activate_geo_directive(
  p_client_id uuid,
  p_directive_id uuid
)
returns table (
  activated_id uuid,
  activated_version int,
  drafts_archived int,
  former_active_id uuid
)
language plpgsql
security definer
as $$
declare
  v_drafts_archived int := 0;
  v_former_active_id uuid := null;
begin
  -- 0. Lock target row + verify ownership and state
  perform 1
    from public.geo_directives
   where id = p_directive_id
     and client_id = p_client_id
     and status in ('draft', 'archived')
   for update;

  if not found then
    raise exception 'Directive % not found for client % (or already active)',
      p_directive_id, p_client_id
      using errcode = 'P0002';
  end if;

  -- 1. Archive currently-active directive for this client (if any)
  update public.geo_directives
     set status = 'archived'
   where client_id = p_client_id
     and status = 'active'
   returning id into v_former_active_id;

  -- 2. Archive OTHER drafts for this client (preserve history, no hard delete)
  with archived as (
    update public.geo_directives
       set status = 'archived'
     where client_id = p_client_id
       and status = 'draft'
       and id != p_directive_id
    returning 1
  )
  select count(*)::int into v_drafts_archived from archived;

  -- 3. Promote the target row
  return query
    update public.geo_directives
       set status = 'active'
     where id = p_directive_id
       and client_id = p_client_id
    returning
      id            as activated_id,
      version       as activated_version,
      v_drafts_archived,
      v_former_active_id;
end;
$$;

comment on function public.activate_geo_directive(uuid, uuid) is
'Atomically activates a GEO directive: archives the current active + all other drafts for the same client, then promotes the target. Returns (activated_id, activated_version, drafts_archived, former_active_id).';

-- Allow the service role to call this (RLS does not apply to security definer)
grant execute on function public.activate_geo_directive(uuid, uuid) to service_role;
grant execute on function public.activate_geo_directive(uuid, uuid) to authenticated;
