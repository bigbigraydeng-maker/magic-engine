-- Let the tour-catalog editor save the tour's site_extras column (route variants, e.g. Panorama's
-- October 2027 route). Nothing else changes: this is tour_catalog_update_tour exactly as defined
-- in 20261010400000_tour_catalog_content.sql, with 'site_extras' added to the one list of columns
-- the function may write (c_editable). Existing rows and data are not touched. The table's own
-- check constraint (an object, at most 20000 bytes) still guards the value.
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
  -- The ONE list of columns this function may write. Not here = not editable
  -- (slug, destination, tier, sort_order, id, client_id, timestamps).
  c_editable constant text[] := array[
    'name', 'title', 'short_description', 'duration_text', 'display_price_text',
    'highlights', 'itinerary', 'inclusions', 'exclusions', 'tour_cities',
    'single_supplement', 'max_group_size', 'is_active', 'manages_departures',
    'hero_image', 'gallery', 'meta_title', 'meta_description', 'tags', 'faqs',
    'sold_out', 'single_supplement_note', 'rating', 'review_count', 'review_summary', 'quick_answer',
    'site_extras'
  ];
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_key text;
  v_not_null boolean;
  v_type text;
  v_row public.tour_catalog_tours;
  v_next public.tour_catalog_tours;
  v_set text;
  v_constraint text;
  v_column text;
  v_version bigint;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'invalid_actor';
  end if;

  perform set_config('tour_catalog.actor', 'edit by ' || p_actor, true);

  for v_key in select jsonb_object_keys(v_patch)
  loop
    if not (v_key = any (c_editable)) then
      raise exception 'field_not_editable:%', v_key;
    end if;
  end loop;

  -- JSON null into a NOT NULL column: refused up front, by what the column itself says.
  for v_key in select jsonb_object_keys(v_patch)
  loop
    if v_patch->v_key = 'null'::jsonb then
      select a.attnotnull, format_type(a.atttypid, null)
        into v_not_null, v_type
        from pg_attribute a
       where a.attrelid = 'public.tour_catalog_tours'::regclass
         and a.attname = v_key
         and not a.attisdropped;
      if v_not_null and v_type = 'jsonb' then
        -- Same outcome as before this migration, when a JSON null in a list column hit the "is an array" CHECK.
        raise exception 'invalid_value:%', v_key using errcode = 'check_violation';
      elsif v_not_null then
        raise exception 'invalid_null:%', v_key;
      end if;
    end if;
  end loop;

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

  -- What the row would become: every key in the patch (all on the list by now) replaces that
  -- column, converted to the column's own type; every other column keeps its value.
  begin
    v_next := jsonb_populate_record(v_row, v_patch);
  exception when data_exception then
    raise exception 'invalid_value:type';
  end;

  if to_jsonb(v_next) = to_jsonb(v_row) then
    return to_jsonb(v_row);
  end if;

  select string_agg(format('%1$I = ($1).%1$I', k), ', ')
    into v_set
    from jsonb_object_keys(v_patch) as k;

  begin
    execute format(
      'update public.tour_catalog_tours set %s where id = $2 and client_id = $3 returning *',
      v_set
    )
    into v_row
    using v_next, p_tour_id, p_client_id;
  exception
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      raise exception 'invalid_value:%', v_constraint using errcode = 'check_violation';
    when not_null_violation then
      get stacked diagnostics v_column = column_name;
      raise exception 'invalid_null:%', v_column;
  end;

  v_version := public.tour_catalog_bump_version(p_client_id);

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.tour_catalog_update_tour(uuid, uuid, timestamptz, jsonb, text) from public, anon, authenticated;
grant execute on function public.tour_catalog_update_tour(uuid, uuid, timestamptz, jsonb, text) to service_role;
