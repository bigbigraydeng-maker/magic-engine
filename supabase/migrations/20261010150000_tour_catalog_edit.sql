-- service-role only; apply only after explicit PM approval.
-- Admin editing for the tour catalog plus a change log written by triggers.
-- Design doc: docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md §6.6

create table public.tour_catalog_change_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  entity text not null check (entity in ('tour','departure')),
  entity_id uuid not null,
  action text not null check (action in ('insert','update','delete')),
  before jsonb,
  after jsonb,
  actor text not null,
  created_at timestamptz not null default now()
);

create index tour_catalog_change_log_client_entity_created_idx
  on public.tour_catalog_change_log (client_id, entity_id, created_at desc);

alter table public.tour_catalog_change_log enable row level security;

create policy tour_catalog_change_log_service_role
  on public.tour_catalog_change_log
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.tour_catalog_change_log from anon, authenticated;

create function public.tour_catalog_log_change()
returns trigger
language plpgsql
as $$
declare
  v_entity text;
  v_actor text;
begin
  v_entity := case
    when TG_TABLE_NAME = 'tour_catalog_tours' then 'tour'
    else 'departure'
  end;

  v_actor := coalesce(nullif(current_setting('tour_catalog.actor', true), ''), 'system');

  if TG_OP = 'INSERT' then
    insert into public.tour_catalog_change_log (
      client_id, entity, entity_id, action, before, after, actor
    )
    values (
      NEW.client_id, v_entity, NEW.id, 'insert', null, to_jsonb(NEW), v_actor
    );

    return NEW;
  elsif TG_OP = 'UPDATE' then
    if (to_jsonb(OLD) - 'updated_at') = (to_jsonb(NEW) - 'updated_at') then
      return NEW;
    end if;

    insert into public.tour_catalog_change_log (
      client_id, entity, entity_id, action, before, after, actor
    )
    values (
      NEW.client_id, v_entity, NEW.id, 'update', to_jsonb(OLD), to_jsonb(NEW), v_actor
    );

    return NEW;
  else
    insert into public.tour_catalog_change_log (
      client_id, entity, entity_id, action, before, after, actor
    )
    values (
      OLD.client_id, v_entity, OLD.id, 'delete', to_jsonb(OLD), null, v_actor
    );

    return OLD;
  end if;
end;
$$;

revoke all on function public.tour_catalog_log_change() from public, anon, authenticated;
grant execute on function public.tour_catalog_log_change() to service_role;

create trigger tour_catalog_tours_log_change
  after insert or update or delete on public.tour_catalog_tours
  for each row
  execute function public.tour_catalog_log_change();

create trigger tour_catalog_departures_log_change
  after insert or update or delete on public.tour_catalog_departures
  for each row
  execute function public.tour_catalog_log_change();

create function public.tour_catalog_update_tour(
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
  v_version bigint;
begin
  perform set_config('tour_catalog.actor', 'edit by ' || coalesce(p_actor, 'unknown'), true);

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

create function public.tour_catalog_save_departure(
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
begin
  perform set_config('tour_catalog.actor', 'edit by ' || coalesce(p_actor, 'unknown'), true);

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
        raise exception 'invalid_dates';
    end;
  end if;

  v_version := public.tour_catalog_bump_version(p_client_id);

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.tour_catalog_save_departure(uuid, uuid, uuid, timestamptz, jsonb, text) from public, anon, authenticated;
grant execute on function public.tour_catalog_save_departure(uuid, uuid, uuid, timestamptz, jsonb, text) to service_role;
