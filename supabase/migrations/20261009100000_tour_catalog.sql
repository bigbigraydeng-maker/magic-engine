-- service-role only; apply only after explicit PM approval.
-- Display-layer tour catalog: tours, aliases, departures, import batches, and per-client state.
-- No orders, payments, seat counts, or quotes are stored here.
-- Design doc: docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md

create table public.tour_catalog_tours (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  slug text not null,
  destination text not null,
  tier text not null,
  name text not null,
  title text,
  short_description text,
  duration_text text,
  display_price_text text,
  highlights jsonb not null default '[]',
  itinerary jsonb not null default '[]',
  inclusions jsonb not null default '[]',
  exclusions jsonb not null default '[]',
  tour_cities jsonb not null default '[]',
  single_supplement text,
  max_group_size integer check (max_group_size is null or max_group_size > 0),
  is_active boolean not null default true,
  manages_departures boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, destination, tier, slug)
);

alter table public.tour_catalog_tours enable row level security;

create policy tour_catalog_tours_service_role
  on public.tour_catalog_tours
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.tour_catalog_tours from anon, authenticated;

create table public.tour_catalog_aliases (
  client_id uuid not null references public.clients(id),
  alias_norm text not null check (alias_norm = btrim(alias_norm) and alias_norm <> ''),
  tour_id uuid not null references public.tour_catalog_tours(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, alias_norm)
);

alter table public.tour_catalog_aliases enable row level security;

create policy tour_catalog_aliases_service_role
  on public.tour_catalog_aliases
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.tour_catalog_aliases from anon, authenticated;

create table public.tour_catalog_departures (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.tour_catalog_tours(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  depart_on date not null,
  return_on date,
  price_text_override text,
  status text not null default 'open' check (status in ('open','limited','sold_out','closed','cancelled')),
  status_source text not null default 'manual',
  status_as_of timestamptz not null default now(),
  internal jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tour_id, depart_on),
  check (return_on is null or return_on >= depart_on)
);

create index tour_catalog_departures_client_depart_idx
  on public.tour_catalog_departures (client_id, depart_on);

alter table public.tour_catalog_departures enable row level security;

create policy tour_catalog_departures_service_role
  on public.tour_catalog_departures
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.tour_catalog_departures from anon, authenticated;

create table public.tour_catalog_import_batches (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  kind text not null check (kind in ('departures','status')),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  row_counts jsonb not null default '{}',
  plan jsonb not null default '{}',
  before jsonb not null default '{}',
  after jsonb not null default '{}',
  status text not null default 'previewed' check (status in ('previewed','applied','rolled_back','rejected')),
  applied_by text,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  rolled_back_at timestamptz
);

-- The same file may be re-imported after a rollback; rolled-back batches stay as history.
create unique index tour_catalog_import_batches_live_file_uidx
  on public.tour_catalog_import_batches (client_id, kind, file_sha256)
  where status in ('previewed', 'applied');

alter table public.tour_catalog_import_batches enable row level security;

create policy tour_catalog_import_batches_service_role
  on public.tour_catalog_import_batches
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.tour_catalog_import_batches from anon, authenticated;

create table public.tour_catalog_state (
  client_id uuid primary key references public.clients(id),
  catalog_version bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.tour_catalog_state enable row level security;

create policy tour_catalog_state_service_role
  on public.tour_catalog_state
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.tour_catalog_state from anon, authenticated;

create function public.tour_catalog_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger tour_catalog_tours_touch_updated_at
  before update on public.tour_catalog_tours
  for each row
  execute function public.tour_catalog_touch_updated_at();

create trigger tour_catalog_departures_touch_updated_at
  before update on public.tour_catalog_departures
  for each row
  execute function public.tour_catalog_touch_updated_at();

revoke all on function public.tour_catalog_touch_updated_at() from public, anon, authenticated;
grant execute on function public.tour_catalog_touch_updated_at() to service_role;

create function public.tour_catalog_bump_version(p_client_id uuid)
returns bigint
language plpgsql
as $$
declare
  v_version bigint;
begin
  insert into public.tour_catalog_state (client_id, catalog_version)
  values (p_client_id, 1)
  on conflict (client_id) do update
    set catalog_version = public.tour_catalog_state.catalog_version + 1,
        updated_at = now()
  returning catalog_version into v_version;

  return v_version;
end;
$$;

revoke all on function public.tour_catalog_bump_version(uuid) from public, anon, authenticated;
grant execute on function public.tour_catalog_bump_version(uuid) to service_role;

create function public.tour_catalog_apply_batch(
  p_client_id uuid,
  p_batch_id uuid,
  p_applied_by text
)
returns jsonb
language plpgsql
as $$
declare
  v_batch public.tour_catalog_import_batches;
  v_add jsonb;
  v_upd jsonb;
  v_tour_id uuid;
  v_depart_on date;
  v_return_on date;
  v_status text;
  v_internal jsonb;
  v_departure_id uuid;
  v_expected_updated_at timestamptz;
  v_row public.tour_catalog_departures;
  v_added_rows jsonb := '[]'::jsonb;
  v_before_rows jsonb := '[]'::jsonb;
  v_after_updated_rows jsonb := '[]'::jsonb;
  v_added_count integer := 0;
  v_updated_count integer := 0;
  v_version bigint;
begin
  perform set_config('tour_catalog.actor', 'import:' || p_batch_id || ' by ' || coalesce(p_applied_by, 'unknown'), true);

  select *
    into v_batch
    from public.tour_catalog_import_batches
   where id = p_batch_id
     and client_id = p_client_id
   for update;

  if not found or v_batch.status <> 'previewed' then
    raise exception 'batch_not_applicable';
  end if;

  for v_add in
    select value from jsonb_array_elements(coalesce(v_batch.plan->'adds', '[]'::jsonb))
  loop
    v_tour_id := (v_add->>'tourId')::uuid;
    v_depart_on := (v_add->>'departOn')::date;
    v_return_on := nullif(v_add->>'returnOn', '')::date;
    v_status := v_add->>'status';
    v_internal := coalesce(v_add->'internal', '{}'::jsonb);

    if not exists (
      select 1 from public.tour_catalog_tours
       where id = v_tour_id and client_id = p_client_id
    ) then
      raise exception 'tour_not_in_client';
    end if;

    begin
      insert into public.tour_catalog_departures (
        tour_id, client_id, depart_on, return_on, status, status_source, internal
      )
      values (
        v_tour_id, p_client_id, v_depart_on, v_return_on, v_status,
        'csv:' || p_batch_id::text, v_internal
      )
      returning * into v_row;
    exception
      when unique_violation then
        raise exception 'conflict:add:%:%', v_tour_id, v_depart_on;
    end;

    v_added_rows := v_added_rows || to_jsonb(v_row);
    v_added_count := v_added_count + 1;
  end loop;

  for v_upd in
    select value from jsonb_array_elements(coalesce(v_batch.plan->'updates', '[]'::jsonb))
  loop
    v_departure_id := (v_upd->>'departureId')::uuid;
    v_expected_updated_at := (v_upd->>'expectedUpdatedAt')::timestamptz;
    v_return_on := nullif(v_upd->>'returnOn', '')::date;
    v_status := v_upd->>'status';
    v_internal := coalesce(v_upd->'internal', '{}'::jsonb);

    select *
      into v_row
      from public.tour_catalog_departures
     where id = v_departure_id
       and client_id = p_client_id
     for update;

    if not found then
      raise exception 'conflict:missing:%', v_departure_id;
    end if;

    if v_row.updated_at <> v_expected_updated_at then
      raise exception 'conflict:stale:%', v_departure_id;
    end if;

    v_before_rows := v_before_rows || to_jsonb(v_row);

    update public.tour_catalog_departures
       set return_on = v_return_on,
           status = v_status,
           internal = v_internal,
           status_source = 'csv:' || p_batch_id::text,
           status_as_of = now()
     where id = v_departure_id
     returning * into v_row;

    v_after_updated_rows := v_after_updated_rows || to_jsonb(v_row);
    v_updated_count := v_updated_count + 1;
  end loop;

  update public.tour_catalog_import_batches
     set before = jsonb_build_object('updated', v_before_rows),
         after = jsonb_build_object('added', v_added_rows, 'updated', v_after_updated_rows),
         status = 'applied',
         applied_by = p_applied_by,
         applied_at = now()
   where id = p_batch_id
     and client_id = p_client_id;

  v_version := public.tour_catalog_bump_version(p_client_id);

  return jsonb_build_object(
    'added', v_added_count,
    'updated', v_updated_count,
    'catalogVersion', v_version
  );
end;
$$;

revoke all on function public.tour_catalog_apply_batch(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tour_catalog_apply_batch(uuid, uuid, text) to service_role;

create function public.tour_catalog_rollback_batch(
  p_client_id uuid,
  p_batch_id uuid,
  p_actor text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_batch public.tour_catalog_import_batches;
  v_row jsonb;
  v_departure_id uuid;
  v_expected_updated_at timestamptz;
  v_current public.tour_catalog_departures;
  v_added_count integer := 0;
  v_updated_count integer := 0;
  v_version bigint;
begin
  perform set_config('tour_catalog.actor', 'rollback:' || p_batch_id || ' by ' || coalesce(p_actor, 'unknown'), true);

  select *
    into v_batch
    from public.tour_catalog_import_batches
   where id = p_batch_id
     and client_id = p_client_id
   for update;

  if not found or v_batch.status <> 'applied' then
    raise exception 'batch_not_rollbackable';
  end if;

  for v_row in
    select value from jsonb_array_elements(coalesce(v_batch.after->'added', '[]'::jsonb))
  loop
    v_departure_id := (v_row->>'id')::uuid;
    v_expected_updated_at := (v_row->>'updated_at')::timestamptz;

    select *
      into v_current
      from public.tour_catalog_departures
     where id = v_departure_id
       and client_id = p_client_id
     for update;

    if not found then
      raise exception 'conflict:missing:%', v_departure_id;
    end if;

    if v_current.updated_at <> v_expected_updated_at then
      raise exception 'conflict:modified:%', v_departure_id;
    end if;
  end loop;

  for v_row in
    select value from jsonb_array_elements(coalesce(v_batch.after->'updated', '[]'::jsonb))
  loop
    v_departure_id := (v_row->>'id')::uuid;
    v_expected_updated_at := (v_row->>'updated_at')::timestamptz;

    select *
      into v_current
      from public.tour_catalog_departures
     where id = v_departure_id
       and client_id = p_client_id
     for update;

    if not found then
      raise exception 'conflict:missing:%', v_departure_id;
    end if;

    if v_current.updated_at <> v_expected_updated_at then
      raise exception 'conflict:modified:%', v_departure_id;
    end if;
  end loop;

  for v_row in
    select value from jsonb_array_elements(coalesce(v_batch.after->'added', '[]'::jsonb))
  loop
    v_departure_id := (v_row->>'id')::uuid;

    delete from public.tour_catalog_departures
     where id = v_departure_id
       and client_id = p_client_id;

    v_added_count := v_added_count + 1;
  end loop;

  for v_row in
    select value from jsonb_array_elements(coalesce(v_batch.before->'updated', '[]'::jsonb))
  loop
    v_departure_id := (v_row->>'id')::uuid;

    update public.tour_catalog_departures
       set return_on = nullif(v_row->>'return_on', '')::date,
           price_text_override = v_row->>'price_text_override',
           status = v_row->>'status',
           status_source = v_row->>'status_source',
           status_as_of = (v_row->>'status_as_of')::timestamptz,
           internal = coalesce(v_row->'internal', '{}'::jsonb)
     where id = v_departure_id
       and client_id = p_client_id;

    v_updated_count := v_updated_count + 1;
  end loop;

  update public.tour_catalog_import_batches
     set status = 'rolled_back',
         rolled_back_at = now()
   where id = p_batch_id
     and client_id = p_client_id;

  v_version := public.tour_catalog_bump_version(p_client_id);

  return jsonb_build_object(
    'added', v_added_count,
    'updated', v_updated_count,
    'catalogVersion', v_version
  );
end;
$$;

revoke all on function public.tour_catalog_rollback_batch(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tour_catalog_rollback_batch(uuid, uuid, text) to service_role;
