-- service-role only; apply only after explicit PM approval.
-- Publish/revert for the tour catalog: immutable published snapshots, an append-only guard,
-- a draft revision bump on every working-table write, and publish/revert functions.
-- Design doc: docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md §6.8 / §6.8.1

alter table public.tour_catalog_state
  add column published_version bigint not null default 0;

create table public.tour_catalog_published (
  client_id uuid not null references public.clients(id),
  version bigint not null check (version > 0),
  snapshot jsonb not null,
  summary jsonb not null default '{}',
  note text not null default '',
  published_by text not null check (length(btrim(published_by)) > 0),
  source_version bigint,
  draft_version bigint not null,
  created_at timestamptz not null default now(),
  primary key (client_id, version)
);

alter table public.tour_catalog_published enable row level security;

create policy tour_catalog_published_service_role
  on public.tour_catalog_published
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.tour_catalog_published from anon, authenticated;

-- Published snapshots are immutable history: once written they must never change or disappear.
create function public.tour_catalog_published_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'tour_catalog_published_append_only';
end;
$$;

create trigger tour_catalog_published_append_only_row
  before update or delete on public.tour_catalog_published
  for each row
  execute function public.tour_catalog_published_append_only();

create trigger tour_catalog_published_append_only_truncate
  before truncate on public.tour_catalog_published
  for each statement
  execute function public.tour_catalog_published_append_only();

revoke all on function public.tour_catalog_published_append_only() from public, anon, authenticated;
grant execute on function public.tour_catalog_published_append_only() to service_role;

-- A published row may only be the next version for its client. Both functions below insert the
-- row first and move tour_catalog_state.published_version afterwards (under the state row lock),
-- so the normal path always satisfies this; a direct insert with a made-up version does not.
create function public.tour_catalog_published_check_version()
returns trigger
language plpgsql
as $$
begin
  if NEW.version is distinct from coalesce(
       (select s.published_version from public.tour_catalog_state s where s.client_id = NEW.client_id), 0
     ) + 1 then
    raise exception 'tour_catalog_published_bad_version';
  end if;
  return NEW;
end;
$$;

create trigger tour_catalog_published_check_version_row
  before insert on public.tour_catalog_published
  for each row
  execute function public.tour_catalog_published_check_version();

revoke all on function public.tour_catalog_published_check_version() from public, anon, authenticated;
grant execute on function public.tour_catalog_published_check_version() to service_role;

-- TRUNCATE fires no row triggers, so it would empty the draft without bumping the revision
-- (and without any change record). The working tables refuse it outright.
create function public.tour_catalog_truncate_forbidden()
returns trigger
language plpgsql
as $$
begin
  raise exception 'tour_catalog_truncate_forbidden';
end;
$$;

create trigger tour_catalog_tours_no_truncate
  before truncate on public.tour_catalog_tours
  for each statement
  execute function public.tour_catalog_truncate_forbidden();

create trigger tour_catalog_departures_no_truncate
  before truncate on public.tour_catalog_departures
  for each statement
  execute function public.tour_catalog_truncate_forbidden();

revoke all on function public.tour_catalog_truncate_forbidden() from public, anon, authenticated;
grant execute on function public.tour_catalog_truncate_forbidden() to service_role;

-- Bumping the draft revision on every working-table write makes the publish-time
-- version comparison a real gate: any edit between read and publish invalidates it.
create function public.tour_catalog_bump_on_write()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE' then
    perform public.tour_catalog_bump_version(OLD.client_id);
    return OLD;
  end if;

  perform public.tour_catalog_bump_version(NEW.client_id);
  return NEW;
end;
$$;

create trigger tour_catalog_tours_bump_on_write
  after insert or update or delete on public.tour_catalog_tours
  for each row
  execute function public.tour_catalog_bump_on_write();

create trigger tour_catalog_departures_bump_on_write
  after insert or update or delete on public.tour_catalog_departures
  for each row
  execute function public.tour_catalog_bump_on_write();

revoke all on function public.tour_catalog_bump_on_write() from public, anon, authenticated;
grant execute on function public.tour_catalog_bump_on_write() to service_role;

create function public.tour_catalog_publish(
  p_client_id uuid,
  p_expected_draft_version bigint,
  p_expected_published_version bigint,
  p_actor text,
  p_note text,
  p_summary jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_draft bigint;
  v_published bigint;
  v_tours jsonb;
  v_departures jsonb;
  v_snapshot jsonb;
  v_new bigint;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'invalid_actor';
  end if;

  insert into public.tour_catalog_state (client_id, catalog_version)
  values (p_client_id, 0)
  on conflict (client_id) do nothing;

  select catalog_version, published_version
    into v_draft, v_published
    from public.tour_catalog_state
   where client_id = p_client_id
   for update;

  if v_draft is distinct from p_expected_draft_version
     or v_published is distinct from p_expected_published_version then
    raise exception 'conflict:stale';
  end if;

  v_tours := (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.sort_order, t.name, t.id), '[]'::jsonb)
      from public.tour_catalog_tours t
     where t.client_id = p_client_id
  );

  v_departures := (
    select coalesce(jsonb_agg((to_jsonb(d) - 'internal') order by d.depart_on, d.id), '[]'::jsonb)
      from public.tour_catalog_departures d
     where d.client_id = p_client_id
  );

  v_snapshot := jsonb_build_object(
    'schema_version', 1,
    'tours', v_tours,
    'departures', v_departures
  );

  v_new := v_published + 1;

  insert into public.tour_catalog_published (
    client_id, version, snapshot, summary, note, published_by, source_version, draft_version
  )
  values (
    p_client_id, v_new, v_snapshot, coalesce(p_summary, '{}'::jsonb), coalesce(p_note, ''),
    btrim(p_actor), null, v_draft
  );

  update public.tour_catalog_state
     set published_version = v_new,
         updated_at = now()
   where client_id = p_client_id;

  return jsonb_build_object('version', v_new);
end;
$$;

revoke all on function public.tour_catalog_publish(uuid, bigint, bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.tour_catalog_publish(uuid, bigint, bigint, text, text, jsonb) to service_role;

create function public.tour_catalog_revert_published(
  p_client_id uuid,
  p_target_version bigint,
  p_expected_published_version bigint,
  p_actor text,
  p_note text,
  p_summary jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_draft bigint;
  v_published bigint;
  v_target jsonb;
  v_current jsonb;
  v_departures jsonb;
  v_snapshot jsonb;
  v_new bigint;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'invalid_actor';
  end if;

  insert into public.tour_catalog_state (client_id, catalog_version)
  values (p_client_id, 0)
  on conflict (client_id) do nothing;

  select catalog_version, published_version
    into v_draft, v_published
    from public.tour_catalog_state
   where client_id = p_client_id
   for update;

  if v_published is distinct from p_expected_published_version then
    raise exception 'conflict:stale';
  end if;

  if p_target_version = v_published then
    raise exception 'already_current';
  end if;

  select snapshot
    into v_target
    from public.tour_catalog_published
   where client_id = p_client_id
     and version = p_target_version;

  if not found then
    raise exception 'version_not_found';
  end if;

  select snapshot
    into v_current
    from public.tour_catalog_published
   where client_id = p_client_id
     and version = v_published;

  if not found then
    raise exception 'version_not_found';
  end if;

  -- Revert restores the target's departures in their original order. Departure STATUS rule
  -- (must stay identical to keepCurrentStatuses in src/lib/tour-catalog/publish.ts):
  --   1. match each target departure to the currently published one by id, else by
  --      (tour_id, depart_on) — undoing an import and importing again gives the same day a new id;
  --   2. matched → keep the CURRENT status/status_source/status_as_of (sold out / cancelled are
  --      facts and must not roll back);
  --   3. not matched either way → the departure comes back as 'closed', never bookable: it was
  --      deleted or cancelled since and must not reappear open.
  select coalesce(jsonb_agg(
           case when c.d is null
                then t.d || jsonb_build_object('status', 'closed', 'status_source', 'revert', 'status_as_of', now())
                else t.d || jsonb_build_object('status', c.d->'status', 'status_source', c.d->'status_source', 'status_as_of', c.d->'status_as_of')
           end order by t.ord), '[]'::jsonb)
    into v_departures
    from jsonb_array_elements(coalesce(v_target->'departures', '[]'::jsonb)) with ordinality as t(d, ord)
    left join lateral (
      select coalesce(
        (select x.d
           from jsonb_array_elements(coalesce(v_current->'departures', '[]'::jsonb)) as x(d)
          where x.d->>'id' = t.d->>'id'
          order by x.d->>'id'
          limit 1),
        (select x.d
           from jsonb_array_elements(coalesce(v_current->'departures', '[]'::jsonb)) as x(d)
          where x.d->>'tour_id' = t.d->>'tour_id'
            and x.d->>'depart_on' = t.d->>'depart_on'
          order by x.d->>'id'
          limit 1)
      ) as d
    ) as c on true;

  v_snapshot := jsonb_set(v_target, '{departures}', v_departures, true);

  v_new := v_published + 1;

  insert into public.tour_catalog_published (
    client_id, version, snapshot, summary, note, published_by, source_version, draft_version
  )
  values (
    p_client_id, v_new, v_snapshot, coalesce(p_summary, '{}'::jsonb), coalesce(p_note, ''),
    btrim(p_actor), p_target_version, v_draft
  );

  update public.tour_catalog_state
     set published_version = v_new,
         updated_at = now()
   where client_id = p_client_id;

  return jsonb_build_object('version', v_new);
end;
$$;

revoke all on function public.tour_catalog_revert_published(uuid, bigint, bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.tour_catalog_revert_published(uuid, bigint, bigint, text, text, jsonb) to service_role;
