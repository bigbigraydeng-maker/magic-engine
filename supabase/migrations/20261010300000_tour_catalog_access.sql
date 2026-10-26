-- service-role only; apply only after explicit PM approval.
-- Tour catalog access for client staff: explicit member list, per-client page settings,
-- publish requests, AI assistant daily limits, an append-only change log, actor and no-op
-- hardening of the edit/import functions, and length/shape CHECKs as a second line of defence.
-- Design doc: docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md §6.10 / §6.10.1
--
-- BEFORE APPLYING to any database that already holds catalog rows: run this READ-ONLY query first.
-- Section 6 adds CHECK constraints and validates them against the existing rows; one offending row
-- makes the whole migration fail. Every number below must be 0. If any is not, stop and fix the
-- data (with PM approval) before applying — do not loosen the constraint.
--
--   select
--     (select count(*) from public.tour_catalog_tours where length(name) > 200)                          as name_over_200,
--     (select count(*) from public.tour_catalog_tours where length(title) > 300)                         as title_over_300,
--     (select count(*) from public.tour_catalog_tours where length(short_description) > 3000)            as short_description_over_3000,
--     (select count(*) from public.tour_catalog_tours where length(duration_text) > 60)                  as duration_text_over_60,
--     (select count(*) from public.tour_catalog_tours where length(display_price_text) > 100)            as display_price_text_over_100,
--     (select count(*) from public.tour_catalog_tours where length(single_supplement) > 100)             as single_supplement_over_100,
--     (select count(*) from public.tour_catalog_tours where jsonb_typeof(highlights) is distinct from 'array')  as highlights_not_array,
--     (select count(*) from public.tour_catalog_tours where jsonb_typeof(itinerary) is distinct from 'array')   as itinerary_not_array,
--     (select count(*) from public.tour_catalog_tours where jsonb_typeof(inclusions) is distinct from 'array')  as inclusions_not_array,
--     (select count(*) from public.tour_catalog_tours where jsonb_typeof(exclusions) is distinct from 'array')  as exclusions_not_array,
--     (select count(*) from public.tour_catalog_tours where jsonb_typeof(tour_cities) is distinct from 'array') as tour_cities_not_array,
--     (select count(*) from public.tour_catalog_tours where octet_length(itinerary::text) > 300000)      as itinerary_over_300000_bytes,
--     (select count(*) from public.tour_catalog_departures where length(price_text_override) > 100)      as departure_price_over_100,
--     (select count(*) from public.tour_catalog_tours)                                                   as tours_checked,
--     (select count(*) from public.tour_catalog_departures)                                              as departures_checked;

-- ---------------------------------------------------------------------------
-- 1. Who may use the catalog besides Magic Engine global admins (default: nobody)
-- ---------------------------------------------------------------------------
create table public.tour_catalog_members (
  client_id uuid not null references public.clients(id),
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  granted_by text not null check (length(btrim(granted_by)) > 0),
  created_at timestamptz not null default now(),
  primary key (client_id, email)
);

alter table public.tour_catalog_members enable row level security;

create policy tour_catalog_members_service_role
  on public.tour_catalog_members
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.tour_catalog_members from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Per-client page settings (brand header + "channels connected" honesty switch)
-- ---------------------------------------------------------------------------
create table public.tour_catalog_settings (
  client_id uuid primary key references public.clients(id),
  logo_url text check (logo_url is null or (logo_url ~ '^https://' and length(logo_url) <= 500)),
  brand_primary text check (brand_primary is null or brand_primary ~ '^#[0-9a-fA-F]{6}$'),
  brand_secondary text check (brand_secondary is null or brand_secondary ~ '^#[0-9a-fA-F]{6}$'),
  channels_connected boolean not null default false,
  updated_by text not null,
  updated_at timestamptz not null default now()
);

alter table public.tour_catalog_settings enable row level security;

create policy tour_catalog_settings_service_role
  on public.tour_catalog_settings
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.tour_catalog_settings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. "Please publish" requests from client editors
-- ---------------------------------------------------------------------------
create table public.tour_catalog_publish_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  requested_by text not null check (length(btrim(requested_by)) > 0),
  draft_version bigint not null,
  note text not null default '' check (length(note) <= 500),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_version bigint
);

create index tour_catalog_publish_requests_client_created_idx
  on public.tour_catalog_publish_requests (client_id, created_at desc);

-- At most one unhandled request per client, guaranteed here rather than by the caller's read-then-write.
create unique index tour_catalog_publish_requests_one_open_idx
  on public.tour_catalog_publish_requests (client_id)
  where handled_at is null;

alter table public.tour_catalog_publish_requests enable row level security;

create policy tour_catalog_publish_requests_service_role
  on public.tour_catalog_publish_requests
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.tour_catalog_publish_requests from anon, authenticated;

-- Ask for a publish, atomically: the client's one open request is created, or — when one is already
-- open — replaced by this one (latest asker, draft revision, note and time). Returns the open row.
create function public.tour_catalog_request_publish(
  p_client_id uuid,
  p_requested_by text,
  p_draft_version bigint,
  p_note text
)
returns jsonb
language plpgsql
as $$
declare
  v_actor text := btrim(coalesce(p_requested_by, ''));
  v_note text := coalesce(p_note, '');
  v_row public.tour_catalog_publish_requests;
begin
  if v_actor = '' then
    raise exception 'invalid_actor';
  end if;

  if length(v_note) > 500 then
    raise exception 'invalid_note';
  end if;

  if p_client_id is null or p_draft_version is null then
    raise exception 'invalid_request';
  end if;

  insert into public.tour_catalog_publish_requests (client_id, requested_by, draft_version, note)
  values (p_client_id, v_actor, p_draft_version, v_note)
  on conflict (client_id) where handled_at is null do update
    set requested_by = excluded.requested_by,
        draft_version = excluded.draft_version,
        note = excluded.note,
        created_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'requested_by', v_row.requested_by,
    'draft_version', v_row.draft_version,
    'note', v_row.note,
    'created_at', v_row.created_at
  );
end;
$$;

revoke all on function public.tour_catalog_request_publish(uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.tour_catalog_request_publish(uuid, text, bigint, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. AI assistant usage: reserve-before-call counters per client / day / email
-- ---------------------------------------------------------------------------
create table public.tour_catalog_assistant_usage (
  client_id uuid not null references public.clients(id),
  day date not null,
  email text not null,
  calls integer not null default 0,
  cost_usd numeric(10,4) not null default 0,
  primary key (client_id, day, email)
);

alter table public.tour_catalog_assistant_usage enable row level security;

create policy tour_catalog_assistant_usage_service_role
  on public.tour_catalog_assistant_usage
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.tour_catalog_assistant_usage from anon, authenticated;

-- Atomically: refuse when the client's day is over its call or cost limit, or this email is over
-- its own limit; otherwise count one call. A refused call is not counted. Missing limits fail closed.
create function public.tour_catalog_assistant_reserve(
  p_client_id uuid,
  p_day date,
  p_email text,
  p_user_limit integer,
  p_client_limit integer,
  p_cost_limit numeric
)
returns boolean
language plpgsql
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_client_calls bigint;
  v_client_cost numeric;
  v_user_calls bigint;
begin
  if v_email = '' then
    raise exception 'invalid_actor';
  end if;

  if p_client_id is null or p_day is null
     or p_user_limit is null or p_client_limit is null or p_cost_limit is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_client_id::text || p_day::text, 0));

  select coalesce(sum(calls), 0), coalesce(sum(cost_usd), 0)
    into v_client_calls, v_client_cost
    from public.tour_catalog_assistant_usage
   where client_id = p_client_id
     and day = p_day;

  select coalesce(sum(calls), 0)
    into v_user_calls
    from public.tour_catalog_assistant_usage
   where client_id = p_client_id
     and day = p_day
     and email = v_email;

  if v_client_calls >= p_client_limit
     or v_client_cost >= p_cost_limit
     or v_user_calls >= p_user_limit then
    return false;
  end if;

  insert into public.tour_catalog_assistant_usage (client_id, day, email, calls)
  values (p_client_id, p_day, v_email, 1)
  on conflict (client_id, day, email) do update
    set calls = public.tour_catalog_assistant_usage.calls + 1;

  return true;
end;
$$;

revoke all on function public.tour_catalog_assistant_reserve(uuid, date, text, integer, integer, numeric) from public, anon, authenticated;
grant execute on function public.tour_catalog_assistant_reserve(uuid, date, text, integer, integer, numeric) to service_role;

-- Add what a call actually cost. Negative or null counts as 0; the row is created if missing.
create function public.tour_catalog_assistant_record_cost(
  p_client_id uuid,
  p_day date,
  p_email text,
  p_cost numeric
)
returns void
language plpgsql
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_cost numeric := greatest(coalesce(p_cost, 0), 0);
begin
  if v_email = '' then
    raise exception 'invalid_actor';
  end if;

  insert into public.tour_catalog_assistant_usage (client_id, day, email, calls, cost_usd)
  values (p_client_id, p_day, v_email, 0, v_cost)
  on conflict (client_id, day, email) do update
    set cost_usd = public.tour_catalog_assistant_usage.cost_usd + excluded.cost_usd;
end;
$$;

revoke all on function public.tour_catalog_assistant_record_cost(uuid, date, text, numeric) from public, anon, authenticated;
grant execute on function public.tour_catalog_assistant_record_cost(uuid, date, text, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- 5. The change log is history: rows can be added, never changed or removed
-- ---------------------------------------------------------------------------
create function public.tour_catalog_change_log_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'tour_catalog_change_log_append_only';
end;
$$;

create trigger tour_catalog_change_log_append_only_row
  before update or delete on public.tour_catalog_change_log
  for each row
  execute function public.tour_catalog_change_log_append_only();

create trigger tour_catalog_change_log_append_only_truncate
  before truncate on public.tour_catalog_change_log
  for each statement
  execute function public.tour_catalog_change_log_append_only();

revoke all on function public.tour_catalog_change_log_append_only() from public, anon, authenticated;
grant execute on function public.tour_catalog_change_log_append_only() to service_role;

-- ---------------------------------------------------------------------------
-- 6. Length / shape CHECKs (the API validates first; this is the second line)
-- ---------------------------------------------------------------------------
alter table public.tour_catalog_tours
  add constraint tour_catalog_tours_text_limits check (
    length(name) <= 200
    and (title is null or length(title) <= 300)
    and (short_description is null or length(short_description) <= 3000)
    and (duration_text is null or length(duration_text) <= 60)
    and (display_price_text is null or length(display_price_text) <= 100)
    and (single_supplement is null or length(single_supplement) <= 100)
  ) not valid;

alter table public.tour_catalog_tours
  add constraint tour_catalog_tours_jsonb_arrays check (
    jsonb_typeof(highlights) = 'array'
    and jsonb_typeof(itinerary) = 'array'
    and jsonb_typeof(inclusions) = 'array'
    and jsonb_typeof(exclusions) = 'array'
    and jsonb_typeof(tour_cities) = 'array'
    -- Size of the JSON text, not pg_column_size(): the latter measures the stored (possibly
    -- compressed) form, so the same value could pass or fail depending on how it is stored.
    and octet_length(itinerary::text) <= 300000
  ) not valid;

alter table public.tour_catalog_departures
  add constraint tour_catalog_departures_price_text_len check (
    price_text_override is null or length(price_text_override) <= 100
  ) not valid;

alter table public.tour_catalog_tours validate constraint tour_catalog_tours_text_limits;
alter table public.tour_catalog_tours validate constraint tour_catalog_tours_jsonb_arrays;
alter table public.tour_catalog_departures validate constraint tour_catalog_departures_price_text_len;

-- ---------------------------------------------------------------------------
-- 7. Edit functions: blank actor refused; a save that changes nothing writes nothing
--    (no revision bump, no change-log row, updated_at untouched). Everything else is unchanged
--    from 20261010150000_tour_catalog_edit.sql.
-- ---------------------------------------------------------------------------
create or replace function public.tour_catalog_update_tour(
  p_client_id uuid,
  p_tour_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_actor text
)
returns jsonb
language plpgsql
as $$
declare
  v_key text;
  v_row public.tour_catalog_tours;
  v_next public.tour_catalog_tours;
  v_version bigint;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'invalid_actor';
  end if;

  perform set_config('tour_catalog.actor', 'edit by ' || p_actor, true);

  for v_key in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb))
  loop
    if v_key not in (
      'name', 'title', 'short_description', 'duration_text', 'display_price_text',
      'highlights', 'itinerary', 'inclusions', 'exclusions', 'tour_cities',
      'single_supplement', 'max_group_size', 'is_active', 'manages_departures'
    ) then
      raise exception 'field_not_editable:%', v_key;
    end if;
  end loop;

  if p_patch ? 'name' and p_patch->'name' = 'null'::jsonb then
    raise exception 'invalid_null:%', 'name';
  end if;

  if p_patch ? 'is_active' and p_patch->'is_active' = 'null'::jsonb then
    raise exception 'invalid_null:%', 'is_active';
  end if;

  if p_patch ? 'manages_departures' and p_patch->'manages_departures' = 'null'::jsonb then
    raise exception 'invalid_null:%', 'manages_departures';
  end if;

  select *
    into v_row
    from public.tour_catalog_tours
   where id = p_tour_id
     and client_id = p_client_id
   for update;

  if not found then
    raise exception 'tour_not_found';
  end if;

  if v_row.updated_at <> p_expected_updated_at then
    raise exception 'conflict:stale:%', p_tour_id;
  end if;

  -- What the row would become. The expressions mirror the UPDATE below one for one.
  v_next := v_row;
  v_next.name := case when p_patch ? 'name' then p_patch->>'name' else v_row.name end;
  v_next.title := case when p_patch ? 'title' then p_patch->>'title' else v_row.title end;
  v_next.short_description := case when p_patch ? 'short_description' then p_patch->>'short_description' else v_row.short_description end;
  v_next.duration_text := case when p_patch ? 'duration_text' then p_patch->>'duration_text' else v_row.duration_text end;
  v_next.display_price_text := case when p_patch ? 'display_price_text' then p_patch->>'display_price_text' else v_row.display_price_text end;
  v_next.highlights := case when p_patch ? 'highlights' then coalesce(p_patch->'highlights', '[]'::jsonb) else v_row.highlights end;
  v_next.itinerary := case when p_patch ? 'itinerary' then coalesce(p_patch->'itinerary', '[]'::jsonb) else v_row.itinerary end;
  v_next.inclusions := case when p_patch ? 'inclusions' then coalesce(p_patch->'inclusions', '[]'::jsonb) else v_row.inclusions end;
  v_next.exclusions := case when p_patch ? 'exclusions' then coalesce(p_patch->'exclusions', '[]'::jsonb) else v_row.exclusions end;
  v_next.tour_cities := case when p_patch ? 'tour_cities' then coalesce(p_patch->'tour_cities', '[]'::jsonb) else v_row.tour_cities end;
  v_next.single_supplement := case when p_patch ? 'single_supplement' then p_patch->>'single_supplement' else v_row.single_supplement end;
  v_next.max_group_size := case when p_patch ? 'max_group_size' then (p_patch->>'max_group_size')::integer else v_row.max_group_size end;
  v_next.is_active := case when p_patch ? 'is_active' then (p_patch->>'is_active')::boolean else v_row.is_active end;
  v_next.manages_departures := case when p_patch ? 'manages_departures' then (p_patch->>'manages_departures')::boolean else v_row.manages_departures end;

  if to_jsonb(v_next) = to_jsonb(v_row) then
    return to_jsonb(v_row);
  end if;

  update public.tour_catalog_tours
     set name = case when p_patch ? 'name' then p_patch->>'name' else name end,
         title = case when p_patch ? 'title' then p_patch->>'title' else title end,
         short_description = case when p_patch ? 'short_description' then p_patch->>'short_description' else short_description end,
         duration_text = case when p_patch ? 'duration_text' then p_patch->>'duration_text' else duration_text end,
         display_price_text = case when p_patch ? 'display_price_text' then p_patch->>'display_price_text' else display_price_text end,
         highlights = case when p_patch ? 'highlights' then coalesce(p_patch->'highlights', '[]'::jsonb) else highlights end,
         itinerary = case when p_patch ? 'itinerary' then coalesce(p_patch->'itinerary', '[]'::jsonb) else itinerary end,
         inclusions = case when p_patch ? 'inclusions' then coalesce(p_patch->'inclusions', '[]'::jsonb) else inclusions end,
         exclusions = case when p_patch ? 'exclusions' then coalesce(p_patch->'exclusions', '[]'::jsonb) else exclusions end,
         tour_cities = case when p_patch ? 'tour_cities' then coalesce(p_patch->'tour_cities', '[]'::jsonb) else tour_cities end,
         single_supplement = case when p_patch ? 'single_supplement' then p_patch->>'single_supplement' else single_supplement end,
         max_group_size = case when p_patch ? 'max_group_size' then (p_patch->>'max_group_size')::integer else max_group_size end,
         is_active = case when p_patch ? 'is_active' then (p_patch->>'is_active')::boolean else is_active end,
         manages_departures = case when p_patch ? 'manages_departures' then (p_patch->>'manages_departures')::boolean else manages_departures end
   where id = p_tour_id
     and client_id = p_client_id
   returning * into v_row;

  v_version := public.tour_catalog_bump_version(p_client_id);

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.tour_catalog_update_tour(uuid, uuid, timestamptz, jsonb, text) from public, anon, authenticated;
grant execute on function public.tour_catalog_update_tour(uuid, uuid, timestamptz, jsonb, text) to service_role;

create or replace function public.tour_catalog_save_departure(
  p_client_id uuid,
  p_tour_id uuid,
  p_departure_id uuid,
  p_expected_updated_at timestamptz,
  p_fields jsonb,
  p_actor text
)
returns jsonb
language plpgsql
as $$
declare
  v_key text;
  v_row public.tour_catalog_departures;
  v_current_status text;
  v_version bigint;
  v_constraint text;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'invalid_actor';
  end if;

  perform set_config('tour_catalog.actor', 'edit by ' || p_actor, true);

  if not exists (
    select 1 from public.tour_catalog_tours
     where id = p_tour_id and client_id = p_client_id
  ) then
    raise exception 'tour_not_found';
  end if;

  if p_departure_id is null then
    for v_key in select jsonb_object_keys(coalesce(p_fields, '{}'::jsonb))
    loop
      if v_key not in ('depart_on', 'return_on', 'status', 'price_text_override') then
        raise exception 'field_not_editable:%', v_key;
      end if;
    end loop;

    if not (p_fields ? 'depart_on') or p_fields->'depart_on' = 'null'::jsonb then
      raise exception 'depart_on_required';
    end if;

    begin
      insert into public.tour_catalog_departures (
        tour_id, client_id, depart_on, return_on, status, price_text_override, status_source
      )
      values (
        p_tour_id,
        p_client_id,
        (p_fields->>'depart_on')::date,
        nullif(p_fields->>'return_on', '')::date,
        coalesce(p_fields->>'status', 'open'),
        p_fields->>'price_text_override',
        'manual'
      )
      returning * into v_row;
    exception
      when unique_violation then
        raise exception 'conflict:duplicate_departure';
      when check_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint = 'tour_catalog_departures_price_text_len' then
          raise exception 'invalid_price_text';
        end if;
        raise exception 'invalid_dates';
    end;
  else
    for v_key in select jsonb_object_keys(coalesce(p_fields, '{}'::jsonb))
    loop
      if v_key = 'depart_on' then
        raise exception 'depart_on_not_editable';
      end if;

      if v_key not in ('return_on', 'status', 'price_text_override') then
        raise exception 'field_not_editable:%', v_key;
      end if;
    end loop;

    select *
      into v_row
      from public.tour_catalog_departures
     where id = p_departure_id
       and client_id = p_client_id
       and tour_id = p_tour_id
     for update;

    if not found then
      raise exception 'departure_not_found';
    end if;

    if v_row.updated_at <> p_expected_updated_at then
      raise exception 'conflict:stale:%', p_departure_id;
    end if;

    v_current_status := v_row.status;

    -- Nothing would change (same three editable values; status_source / status_as_of only move
    -- when the status does) → write nothing.
    if (case when p_fields ? 'return_on' then nullif(p_fields->>'return_on', '')::date else v_row.return_on end)
         is not distinct from v_row.return_on
       and (case when p_fields ? 'status' then p_fields->>'status' else v_row.status end)
         is not distinct from v_row.status
       and (case when p_fields ? 'price_text_override' then p_fields->>'price_text_override' else v_row.price_text_override end)
         is not distinct from v_row.price_text_override then
      return to_jsonb(v_row);
    end if;

    begin
      update public.tour_catalog_departures
         set return_on = case when p_fields ? 'return_on' then nullif(p_fields->>'return_on', '')::date else return_on end,
             status = case when p_fields ? 'status' then p_fields->>'status' else status end,
             price_text_override = case when p_fields ? 'price_text_override' then p_fields->>'price_text_override' else price_text_override end,
             status_source = case
               when p_fields ? 'status' and p_fields->>'status' is distinct from v_current_status then 'manual'
               else status_source
             end,
             status_as_of = case
               when p_fields ? 'status' and p_fields->>'status' is distinct from v_current_status then now()
               else status_as_of
             end
       where id = p_departure_id
         and client_id = p_client_id
       returning * into v_row;
    exception
      when check_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint = 'tour_catalog_departures_price_text_len' then
          raise exception 'invalid_price_text';
        end if;
        raise exception 'invalid_dates';
    end;
  end if;

  v_version := public.tour_catalog_bump_version(p_client_id);

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.tour_catalog_save_departure(uuid, uuid, uuid, timestamptz, jsonb, text) from public, anon, authenticated;
grant execute on function public.tour_catalog_save_departure(uuid, uuid, uuid, timestamptz, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Import apply / rollback: blank actor refused (no more 'unknown'). Bodies are otherwise
--    identical to 20261009100000_tour_catalog.sql.
-- ---------------------------------------------------------------------------
create or replace function public.tour_catalog_apply_batch(
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
  if p_applied_by is null or length(btrim(p_applied_by)) = 0 then
    raise exception 'invalid_actor';
  end if;

  perform set_config('tour_catalog.actor', 'import:' || p_batch_id || ' by ' || p_applied_by, true);

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

create or replace function public.tour_catalog_rollback_batch(
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
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'invalid_actor';
  end if;

  perform set_config('tour_catalog.actor', 'rollback:' || p_batch_id || ' by ' || p_actor, true);

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
