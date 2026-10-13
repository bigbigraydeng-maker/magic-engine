-- Behaviour checks for supabase/migrations/20261010400000_tour_catalog_content.sql (run after the four
-- earlier migrations and their test files, on a THROWAWAY local Postgres only).
-- A = client a1, B = client b2.
create temp table cresults(name text, ok boolean, detail text); grant all on cresults to public;

insert into tour_catalog_tours(id, client_id, slug, destination, tier, name, manages_departures) values
 ('cccccccc-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'content-a', 'china', 'content', 'Content A tour', true),
 ('dddddddd-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'content-b', 'china', 'content', 'Content B tour', true);

create function pg_temp.a_updated() returns timestamptz language sql as $$
  select updated_at from tour_catalog_tours where id = 'cccccccc-0000-0000-0000-000000000001' $$;
create function pg_temp.a_version() returns bigint language sql as $$
  select catalog_version from tour_catalog_state where client_id = '00000000-0000-0000-0000-0000000000a1' $$;
create function pg_temp.a_logs() returns bigint language sql as $$
  select count(*) from tour_catalog_change_log where entity_id = 'cccccccc-0000-0000-0000-000000000001' $$;
create function pg_temp.b_row() returns text language sql as $$
  select md5(to_jsonb(t)::text) || (select count(*) from tour_catalog_change_log l where l.client_id = '00000000-0000-0000-0000-0000000000b2')::text
    from tour_catalog_tours t where t.id = 'dddddddd-0000-0000-0000-000000000001' $$;

-- One patch against tour A that must fail with p_expected (LIKE pattern) and, when p_state is given,
-- with that SQLSTATE; the row, the revision and the change log must not move.
create function pg_temp.a_refused(p_name text, p_patch jsonb, p_expected text, p_state text default null) returns void language plpgsql as $$
declare v_err text := 'no error'; v_state text := ''; v_row text; v_ver bigint := pg_temp.a_version(); v_logs bigint := pg_temp.a_logs(); v_same boolean;
begin
  select md5(to_jsonb(t)::text) into v_row from tour_catalog_tours t where t.id = 'cccccccc-0000-0000-0000-000000000001';
  begin
    perform tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-000000000001', pg_temp.a_updated(), p_patch, 'a@x');
  exception when others then v_err := sqlerrm; v_state := sqlstate;
  end;
  select md5(to_jsonb(t)::text) = v_row into v_same from tour_catalog_tours t where t.id = 'cccccccc-0000-0000-0000-000000000001';
  insert into cresults values (p_name,
    v_err like p_expected and (p_state is null or v_state = p_state) and v_same and pg_temp.a_version() = v_ver and pg_temp.a_logs() = v_logs,
    format('error=%s state=%s row_same=%s', v_err, v_state, v_same));
end $$;

-- ---------------------------------------------------------------------------
-- C1 every column on the function's list: a changing patch really changes the row, bumps the
--    revision and writes one change-log row; the same patch again changes nothing at all.
-- ---------------------------------------------------------------------------
create temp table ccols(col text primary key, val jsonb);
insert into ccols values
 ('name', '"Content A renamed"'),
 ('title', '"A title"'),
 ('short_description', '"Two lines\nof text"'),
 ('duration_text', '"9 Days"'),
 ('display_price_text', '"From NZD $4,080 per person"'),
 ('highlights', '["Great Wall","Bund"]'),
 ('itinerary', '[{"day":1,"title":"Arrive","description":"d","meals":["Dinner"],"accommodation":"Sample Hotel","festiveLabel":"Lantern Festival","operatorLogo":{"src":"/images/airline.png","alt":"Sample Air"}}]'),
 ('inclusions', '["Flights"]'),
 ('exclusions', '["Tips"]'),
 ('tour_cities', '["Beijing","Xi''an"]'),
 ('single_supplement', '"NZD $900"'),
 ('max_group_size', '16'),
 ('is_active', 'false'),
 ('manages_departures', 'false'),
 ('hero_image', '"/images/tours/hero.jpg"'),
 ('gallery', '["/images/tours/a.jpg","https://img.example.com/b.webp"]'),
 ('meta_title', '"Sample tour | 9 Days"'),
 ('meta_description', '"A sample description."'),
 ('tags', '["small group","fully inclusive"]'),
 ('faqs', '[{"question":"Is a visa needed?","answer":"Usually yes.","link":{"href":"/visa","label":"Visa guide"}},{"question":"Q2","answer":"A2","link":null}]'),
 ('sold_out', 'true'),
 ('single_supplement_note', '"Limited single rooms"'),
 ('rating', '4.8'),
 ('review_count', '127'),
 ('review_summary', '"A memorable trip"'),
 ('quick_answer', '"Nine days, two cities."');

do $$ declare r record; v jsonb; v_ver bigint; v_logs bigint; v_u timestamptz; v_listed text[]; v_tested text[]; begin
  -- The test list must be exactly the function's own list, so a column added to the function
  -- without a case here turns this red.
  select array_agg(m[1] order by m[1]) into v_listed
    from regexp_matches(
      substring(pg_get_functiondef('public.tour_catalog_update_tour(uuid,uuid,timestamptz,jsonb,text)'::regprocedure)
                from 'c_editable constant text\[\] := array\[(.*?)\];'),
      '''([a-z_]+)''', 'g') as m;
  select array_agg(col order by col) into v_tested from ccols;
  insert into cresults values ('C1a the cases below cover exactly the function''s editable list', v_listed = v_tested and array_length(v_listed, 1) = 26,
    format('listed=%s tested=%s', array_length(v_listed, 1), array_length(v_tested, 1)));

  insert into cresults select 'C1b every table column is either editable or deliberately not',
    coalesce(array_agg(a.attname::text order by a.attname::text) filter (where not (a.attname::text = any (v_listed))), '{}')
      = array['client_id','created_at','destination','id','site_extras','slug','sort_order','tier','updated_at'],
    coalesce(string_agg(a.attname::text, ',' order by a.attname::text) filter (where not (a.attname::text = any (v_listed))), '')
    from pg_attribute a where a.attrelid = 'public.tour_catalog_tours'::regclass and a.attnum > 0 and not a.attisdropped;

  for r in select * from ccols order by col loop
    v_ver := coalesce(pg_temp.a_version(), 0); v_logs := pg_temp.a_logs();
    v := tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-000000000001', pg_temp.a_updated(), jsonb_build_object(r.col, r.val), 'a@x');
    insert into cresults select 'C1 ' || r.col || ': changing patch is stored, returned, bumps the revision, logs one row',
      to_jsonb(t)->r.col = r.val and v->r.col = r.val and pg_temp.a_version() > v_ver and pg_temp.a_logs() = v_logs + 1
        and exists (select 1 from tour_catalog_change_log l where l.entity_id = t.id and l.action = 'update' and l.actor = 'edit by a@x'
                     and l.after->r.col = r.val and l.before->r.col is distinct from r.val),
      format('stored=%s', left((to_jsonb(t)->r.col)::text, 60))
      from tour_catalog_tours t where t.id = 'cccccccc-0000-0000-0000-000000000001';

    v_ver := pg_temp.a_version(); v_logs := pg_temp.a_logs(); v_u := pg_temp.a_updated();
    v := tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-000000000001', v_u, jsonb_build_object(r.col, r.val), 'other@x');
    insert into cresults values ('C1 ' || r.col || ': same patch again writes nothing',
      v->r.col = r.val and pg_temp.a_version() = v_ver and pg_temp.a_logs() = v_logs and pg_temp.a_updated() = v_u,
      format('version %s→%s logs %s→%s', v_ver, pg_temp.a_version(), v_logs, pg_temp.a_logs()));
  end loop;
end $$;

-- C2 several keys at once: one changed + others equal → one write; all equal (jsonb key order differs) → none
do $$ declare v jsonb; v_ver bigint; v_logs bigint; v_u timestamptz; begin
  v_ver := pg_temp.a_version(); v_logs := pg_temp.a_logs();
  v := tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-000000000001', pg_temp.a_updated(),
    '{"sold_out":false,"rating":4.8,"hero_image":"/images/tours/hero.jpg","tags":["small group","fully inclusive"]}', 'a@x');
  insert into cresults values ('C2a mixed patch: the one changed key is written, one log row',
    (v->>'sold_out')::boolean = false and pg_temp.a_logs() = v_logs + 1 and pg_temp.a_version() > v_ver, v->>'sold_out');
  v_ver := pg_temp.a_version(); v_logs := pg_temp.a_logs(); v_u := pg_temp.a_updated();
  v := tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-000000000001', v_u,
    '{"rating":4.80,"faqs":[{"link":{"label":"Visa guide","href":"/visa"},"answer":"Usually yes.","question":"Is a visa needed?"},{"answer":"A2","link":null,"question":"Q2"}]}', 'a@x');
  insert into cresults values ('C2b equal values written differently (4.80, reordered object keys) write nothing',
    pg_temp.a_version() = v_ver and pg_temp.a_logs() = v_logs and pg_temp.a_updated() = v_u, '');
  v := tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-000000000001', pg_temp.a_updated(),
    '{"hero_image":null,"rating":null,"review_count":null,"meta_title":null}', 'a@x');
  insert into cresults values ('C2c nullable new columns can be cleared with null',
    v->'hero_image' = 'null' and v->'rating' = 'null' and v->'review_count' = 'null' and v->'meta_title' = 'null', v::text);
end $$;

-- C3 rating 4.85: numeric(2,1) rounds half away from zero, so the database stores 4.9.
--    (The API refuses more than one decimal before it gets here; this documents the second line.)
do $$ declare v jsonb; begin
  v := tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-000000000001', pg_temp.a_updated(), '{"rating":4.85}', 'a@x');
  insert into cresults select 'C3 rating 4.85 is stored as 4.9 (rounded by numeric(2,1), not refused)', t.rating = 4.9 and (v->>'rating')::numeric = 4.9, t.rating::text
    from tour_catalog_tours t where t.id = 'cccccccc-0000-0000-0000-000000000001';
  v := tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-000000000001', pg_temp.a_updated(), '{"rating":4.94}', 'a@x');
  insert into cresults values ('C3b rating 4.94 rounds to the stored 4.9 → judged unchanged, nothing written', (v->>'rating')::numeric = 4.9, v->>'rating');
end $$;

-- ---------------------------------------------------------------------------
-- C4 keys that are not on the list
-- ---------------------------------------------------------------------------
do $$ declare k text; begin
  foreach k in array array['site_extras','siteExtras','slug','destination','tier','sort_order','clientId','client_id','id','created_at','updated_at','heroImage','soldOut','no_such_key',''] loop
    perform pg_temp.a_refused('C4 patch cannot carry "' || k || '"', jsonb_build_object(k, 'x'), 'field_not_editable:' || k);
  end loop;
  perform pg_temp.a_refused('C4b a listed key next to an unlisted one: whole patch refused', '{"hero_image":"/images/z.jpg","site_extras":{"related_blog_slugs":["x"]}}', 'field_not_editable:site_extras');
end $$;

-- ---------------------------------------------------------------------------
-- C5 CHECKs and type errors surface as invalid_value / invalid_null, never as a half-write
-- ---------------------------------------------------------------------------
select pg_temp.a_refused('C5 hero_image http://',            '{"hero_image":"http://img.example.com/a.jpg"}', 'invalid_value:tour_catalog_tours_hero_image_chk', '23514');
select pg_temp.a_refused('C5 hero_image no leading slash',   '{"hero_image":"images/a.jpg"}', 'invalid_value:tour_catalog_tours_hero_image_chk', '23514');
select pg_temp.a_refused('C5 hero_image 501 chars',          jsonb_build_object('hero_image', 'https://' || repeat('x', 493)), 'invalid_value:tour_catalog_tours_hero_image_chk', '23514');
select pg_temp.a_refused('C5 gallery 61 items',              jsonb_build_object('gallery', (select jsonb_agg('/images/' || g || '.jpg') from generate_series(1, 61) g)), 'invalid_value:tour_catalog_tours_gallery_chk', '23514');
select pg_temp.a_refused('C5 gallery not an array',          '{"gallery":{"a":1}}', 'invalid_value:tour_catalog_tours_gallery_chk', '23514');
select pg_temp.a_refused('C5 gallery null',                  '{"gallery":null}', 'invalid_value:gallery', '23514');
select pg_temp.a_refused('C5 tags 61 items',                 jsonb_build_object('tags', (select jsonb_agg('t' || g) from generate_series(1, 61) g)), 'invalid_value:tour_catalog_tours_tags_chk', '23514');
select pg_temp.a_refused('C5 tags a string',                 '{"tags":"x"}', 'invalid_value:tour_catalog_tours_tags_chk', '23514');
select pg_temp.a_refused('C5 tags null',                     '{"tags":null}', 'invalid_value:tags', '23514');
select pg_temp.a_refused('C5 faqs not an array',             '{"faqs":{"question":"q"}}', 'invalid_value:tour_catalog_tours_faqs_chk', '23514');
select pg_temp.a_refused('C5 faqs null',                     '{"faqs":null}', 'invalid_value:faqs', '23514');
select pg_temp.a_refused('C5 faqs over 150000 bytes',        jsonb_build_object('faqs', jsonb_build_array(jsonb_build_object('question', 'q', 'answer', repeat('x', 150000)))), 'invalid_value:tour_catalog_tours_faqs_chk', '23514');
select pg_temp.a_refused('C5 meta_title 301',                jsonb_build_object('meta_title', repeat('x', 301)), 'invalid_value:tour_catalog_tours_meta_title_chk', '23514');
select pg_temp.a_refused('C5 meta_description 1001',         jsonb_build_object('meta_description', repeat('x', 1001)), 'invalid_value:tour_catalog_tours_meta_description_chk', '23514');
select pg_temp.a_refused('C5 quick_answer 3001',             jsonb_build_object('quick_answer', repeat('x', 3001)), 'invalid_value:tour_catalog_tours_quick_answer_chk', '23514');
select pg_temp.a_refused('C5 review_summary 501',            jsonb_build_object('review_summary', repeat('x', 501)), 'invalid_value:tour_catalog_tours_review_summary_chk', '23514');
select pg_temp.a_refused('C5 single_supplement_note 501',    jsonb_build_object('single_supplement_note', repeat('x', 501)), 'invalid_value:tour_catalog_tours_single_supplement_note_chk', '23514');
select pg_temp.a_refused('C5 rating 5.1',                    '{"rating":5.1}', 'invalid_value:tour_catalog_tours_rating_chk', '23514');
select pg_temp.a_refused('C5 rating -0.1',                   '{"rating":-0.1}', 'invalid_value:tour_catalog_tours_rating_chk', '23514');
select pg_temp.a_refused('C5 rating 10 (does not fit numeric(2,1))', '{"rating":10}', 'invalid_value:type');
select pg_temp.a_refused('C5 rating not a number',           '{"rating":"great"}', 'invalid_value:type');
select pg_temp.a_refused('C5 review_count -1',               '{"review_count":-1}', 'invalid_value:tour_catalog_tours_review_count_chk', '23514');
select pg_temp.a_refused('C5 review_count not a number',     '{"review_count":"many"}', 'invalid_value:type');
select pg_temp.a_refused('C5 sold_out null',                 '{"sold_out":null}', 'invalid_null:sold_out');
select pg_temp.a_refused('C5 sold_out not a boolean',        '{"sold_out":"maybe"}', 'invalid_value:type');
-- Behaviour kept from before this migration:
select pg_temp.a_refused('C5 name null (as before)',               '{"name":null}', 'invalid_null:name');
select pg_temp.a_refused('C5 is_active null (as before)',          '{"is_active":null}', 'invalid_null:is_active');
select pg_temp.a_refused('C5 manages_departures null (as before)', '{"manages_departures":null}', 'invalid_null:manages_departures');
select pg_temp.a_refused('C5 highlights null (check_violation, as before)', '{"highlights":null}', 'invalid_value:highlights', '23514');
select pg_temp.a_refused('C5 highlights an object (check_violation, as before)', '{"highlights":{"a":1}}', 'invalid_value:tour_catalog_tours_jsonb_arrays', '23514');
select pg_temp.a_refused('C5 name 201 chars',                jsonb_build_object('name', repeat('x', 201)), 'invalid_value:tour_catalog_tours_text_limits', '23514');
select pg_temp.a_refused('C5 max_group_size 0',              '{"max_group_size":0}', 'invalid_value:%', '23514');
select pg_temp.a_refused('C5 max_group_size not a number',   '{"max_group_size":"lots"}', 'invalid_value:type');

do $$ declare v jsonb; v_err text; r record; begin
  v := tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-000000000001', pg_temp.a_updated(),
    jsonb_build_object(
      'hero_image', 'https://' || repeat('x', 492),
      'gallery', (select jsonb_agg('/images/' || g || '.jpg') from generate_series(1, 60) g),
      'tags', (select jsonb_agg('t' || g) from generate_series(1, 60) g),
      'meta_title', repeat('x', 300), 'meta_description', repeat('x', 1000), 'quick_answer', repeat('x', 3000),
      'review_summary', repeat('x', 500), 'single_supplement_note', repeat('x', 500), 'rating', 5, 'review_count', 0), 'a@x');
  insert into cresults values ('C5b boundary values are accepted',
    length(v->>'hero_image') = 500 and jsonb_array_length(v->'gallery') = 60 and (v->>'rating')::numeric = 5 and (v->>'review_count')::int = 0, '');
  v := tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-000000000001', pg_temp.a_updated(), '{"rating":0}', 'a@x');
  insert into cresults values ('C5c rating 0 is accepted', (v->>'rating')::numeric = 0, v->>'rating');

  for r in select * from (values
    ('site_extras an array',      $q$update tour_catalog_tours set site_extras = '[]' where id = 'cccccccc-0000-0000-0000-000000000001'$q$),
    ('site_extras over 20000 bytes', $q$update tour_catalog_tours set site_extras = jsonb_build_object('x', repeat('x', 20000)) where id = 'cccccccc-0000-0000-0000-000000000001'$q$),
    ('settings image_hosts 11',   $q$insert into tour_catalog_settings(client_id, updated_by, image_hosts) values ('00000000-0000-0000-0000-0000000000b2', 't', (select jsonb_agg('h' || g || '.example.com') from generate_series(1, 11) g)) on conflict (client_id) do update set image_hosts = excluded.image_hosts$q$),
    ('settings image_hosts an object', $q$insert into tour_catalog_settings(client_id, updated_by, image_hosts) values ('00000000-0000-0000-0000-0000000000b2', 't', '{"a":1}') on conflict (client_id) do update set image_hosts = excluded.image_hosts$q$)
  ) as t(label, stmt) loop
    begin execute r.stmt; v_err := 'no error'; exception when check_violation then v_err := 'check_violation'; when others then v_err := sqlerrm; end;
    insert into cresults values ('C5d CHECK refuses ' || r.label, v_err = 'check_violation', v_err);
  end loop;
  begin
    insert into tour_catalog_settings(client_id, updated_by, image_hosts)
      values ('00000000-0000-0000-0000-0000000000b2', 't', (select jsonb_agg('h' || g || '.example.com') from generate_series(1, 10) g))
      on conflict (client_id) do update set image_hosts = excluded.image_hosts;
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  insert into cresults values ('C5e settings image_hosts with 10 entries accepted; default is []', v_err = 'no error'
    and (select column_default from information_schema.columns where table_name = 'tour_catalog_settings' and column_name = 'image_hosts') like '%[]%', v_err);
  update tour_catalog_tours set site_extras = '{"related_blog_slugs":["a-post"]}' where id = 'cccccccc-0000-0000-0000-000000000001';
  insert into cresults select 'C5f site_extras object accepted by a direct (seed-style) write', site_extras->'related_blog_slugs' = '["a-post"]', site_extras::text
    from tour_catalog_tours where id = 'cccccccc-0000-0000-0000-000000000001';
end $$;

-- ---------------------------------------------------------------------------
-- C6 the old guards still hold for the new columns
-- ---------------------------------------------------------------------------
do $$ declare v_err text; v_b text := pg_temp.b_row(); v_a text; begin
  begin
    perform tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1', 'dddddddd-0000-0000-0000-000000000001',
      (select updated_at from tour_catalog_tours where id = 'dddddddd-0000-0000-0000-000000000001'),
      '{"hero_image":"/images/hacked.jpg","sold_out":true,"gallery":["/images/hacked.jpg"],"rating":1}', 'a@x');
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  insert into cresults values ('C6a A client + B tour, new columns: refused and B untouched', v_err = 'tour_not_found' and pg_temp.b_row() = v_b, v_err);

  begin
    perform tour_catalog_update_tour('00000000-0000-0000-0000-0000000000b2', 'cccccccc-0000-0000-0000-000000000001', pg_temp.a_updated(), '{"sold_out":true}', 'b@x');
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  insert into cresults values ('C6b B client + A tour, new column: refused', v_err = 'tour_not_found', v_err);

  select md5(to_jsonb(t)::text) into v_a from tour_catalog_tours t where t.id = 'cccccccc-0000-0000-0000-000000000001';
  begin
    perform tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-000000000001', pg_temp.a_updated() - interval '1 second', '{"sold_out":true}', 'a@x');
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  insert into cresults select 'C6c stale token on a new column: conflict, nothing written', v_err like 'conflict:stale:%' and md5(to_jsonb(t)::text) = v_a, v_err
    from tour_catalog_tours t where t.id = 'cccccccc-0000-0000-0000-000000000001';

  begin
    perform tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-000000000001', pg_temp.a_updated(), '{"sold_out":true}', '  ');
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  insert into cresults values ('C6d blank actor on a new column refused', v_err = 'invalid_actor', v_err);

  begin
    perform tour_catalog_update_tour('00000000-0000-0000-0000-0000000000a1', 'cccccccc-0000-0000-0000-000000000001', pg_temp.a_updated(), null, 'a@x');
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  insert into cresults values ('C6e null patch = empty patch: returns the row, writes nothing', v_err = 'no error', v_err);
end $$;

-- C7 a published snapshot carries the new columns (the publish function snapshots whole rows)
do $$ declare v_draft bigint; v_pub bigint; v jsonb; v_tour jsonb; begin
  select catalog_version, published_version into v_draft, v_pub from tour_catalog_state where client_id = '00000000-0000-0000-0000-0000000000a1';
  v := tour_catalog_publish('00000000-0000-0000-0000-0000000000a1', v_draft, v_pub, 'pm@x', 'content test', '{}');
  select t into v_tour from tour_catalog_published p, jsonb_array_elements(p.snapshot->'tours') t
   where p.client_id = '00000000-0000-0000-0000-0000000000a1' and p.version = (v->>'version')::bigint and t->>'id' = 'cccccccc-0000-0000-0000-000000000001';
  insert into cresults values ('C7 published snapshot has the new columns and the itinerary extras',
    v_tour ? 'hero_image' and v_tour ? 'gallery' and v_tour ? 'faqs' and v_tour ? 'sold_out' and v_tour ? 'site_extras'
    and v_tour->'site_extras'->'related_blog_slugs' = '["a-post"]'
    and v_tour->'itinerary'->0->>'accommodation' = 'Sample Hotel' and v_tour->'itinerary'->0->'operatorLogo'->>'src' = '/images/airline.png',
    left(v_tour::text, 120));
end $$;

-- C8 privileges unchanged by create-or-replace
insert into cresults select 'C8 anon/authenticated cannot execute update_tour; service_role can',
  not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute')
  and not p.prosecdef, ''
  from pg_proc p where p.proname = 'tour_catalog_update_tour';
insert into cresults select 'C8b exactly one update_tour function exists (replaced, not overloaded)', count(*) = 1, count(*)::text from pg_proc where proname = 'tour_catalog_update_tour';
insert into cresults select 'C8c anon/authenticated have no privilege on the tours and settings tables',
  not bool_or(has_table_privilege(r.r, t.t, 'select') or has_table_privilege(r.r, t.t, 'update')), ''
  from (values ('anon'), ('authenticated')) r(r) cross join (values ('public.tour_catalog_tours'), ('public.tour_catalog_settings')) t(t);

select name, case when ok then 'PASS' else 'FAIL' end as r, left(detail, 200) as detail from cresults order by name;
do $$ begin if exists (select 1 from cresults where ok is not true) then raise exception 'tour catalog content checks FAILED'; end if; end $$;
