-- service-role only; apply only after explicit PM approval.
-- Tour catalog: the remaining website tour-page fields (images, SEO, tags, FAQs, sold-out banner,
-- reviews, quick answer), a per-client image host allow-list, and a data-driven update function.
-- Design doc: docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md §6.11 / §6.11.1
-- No new tables, so no new RLS policy: the existing service_role-only policies and grants apply.

-- ---------------------------------------------------------------------------
-- 1. New content columns on tours
-- ---------------------------------------------------------------------------
alter table public.tour_catalog_tours
  add column hero_image text,
  add column gallery jsonb not null default '[]',
  add column meta_title text,
  add column meta_description text,
  add column tags jsonb not null default '[]',
  add column faqs jsonb not null default '[]',
  add column sold_out boolean not null default false,
  add column single_supplement_note text,
  add column rating numeric(2,1),
  add column review_count integer,
  add column review_summary text,
  add column quick_answer text,
  -- Website-only pass-through (e.g. related_blog_slugs): read in, written out, never editable.
  add column site_extras jsonb not null default '{}';

-- One CHECK per column so a refusal names the field. These are one notch wider than the API
-- limits (the API validates first; this is the second line). `case` keeps jsonb_array_length()
-- away from non-arrays: AND does not promise evaluation order.
alter table public.tour_catalog_tours
  add constraint tour_catalog_tours_hero_image_chk check (
    hero_image is null or (length(hero_image) <= 500 and (hero_image like '/%' or hero_image like 'https://%'))
  ),
  add constraint tour_catalog_tours_gallery_chk check (
    case when jsonb_typeof(gallery) = 'array' then jsonb_array_length(gallery) <= 60 else false end
  ),
  add constraint tour_catalog_tours_tags_chk check (
    case when jsonb_typeof(tags) = 'array' then jsonb_array_length(tags) <= 60 else false end
  ),
  add constraint tour_catalog_tours_faqs_chk check (
    jsonb_typeof(faqs) = 'array' and octet_length(faqs::text) <= 150000
  ),
  add constraint tour_catalog_tours_meta_title_chk check (meta_title is null or length(meta_title) <= 300),
  add constraint tour_catalog_tours_meta_description_chk check (meta_description is null or length(meta_description) <= 1000),
  add constraint tour_catalog_tours_quick_answer_chk check (quick_answer is null or length(quick_answer) <= 3000),
  add constraint tour_catalog_tours_review_summary_chk check (review_summary is null or length(review_summary) <= 500),
  add constraint tour_catalog_tours_single_supplement_note_chk check (
    single_supplement_note is null or length(single_supplement_note) <= 500
  ),
  add constraint tour_catalog_tours_rating_chk check (rating is null or (rating >= 0 and rating <= 5)),
  add constraint tour_catalog_tours_review_count_chk check (review_count is null or review_count >= 0),
  add constraint tour_catalog_tours_site_extras_chk check (
    jsonb_typeof(site_extras) = 'object' and octet_length(site_extras::text) <= 20000
  );

-- ---------------------------------------------------------------------------
-- 2. Image host allow-list (only a global admin changes it, through the settings route)
-- ---------------------------------------------------------------------------
alter table public.tour_catalog_settings
  add column image_hosts jsonb not null default '[]';

alter table public.tour_catalog_settings
  add constraint tour_catalog_settings_image_hosts_chk check (
    case when jsonb_typeof(image_hosts) = 'array' then jsonb_array_length(image_hosts) <= 10 else false end
  );

-- ---------------------------------------------------------------------------
-- 3. tour_catalog_update_tour, data-driven
--    Same signature, same return value and the same behaviour as in
--    20261010300000_tour_catalog_access.sql: blank actor refused, unknown key refused, stale token
--    refused, client_id filter, and a save that changes nothing writes nothing (no UPDATE, no
--    revision bump, no change-log row). What changed is HOW: the editable columns are listed once
--    (c_editable) and the assignments are generated from the patch, instead of each field being
--    written out twice (design §6.11.1 item 4: a missed line there meant "judged unchanged, edit
--    silently dropped"). Patch keys are column names; the API maps camelCase → column in one place
--    (tourPatchToDb in src/lib/tour-catalog/edit-validation.ts).
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
  -- The ONE list of columns this function may write. Not here = not editable
  -- (slug, destination, tier, sort_order, site_extras, id, client_id, timestamps).
  c_editable constant text[] := array[
    'name', 'title', 'short_description', 'duration_text', 'display_price_text',
    'highlights', 'itinerary', 'inclusions', 'exclusions', 'tour_cities',
    'single_supplement', 'max_group_size', 'is_active', 'manages_departures',
    'hero_image', 'gallery', 'meta_title', 'meta_description', 'tags', 'faqs',
    'sold_out', 'single_supplement_note', 'rating', 'review_count', 'review_summary', 'quick_answer'
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
