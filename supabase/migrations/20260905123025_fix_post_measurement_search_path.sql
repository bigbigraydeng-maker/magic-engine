-- Gate A follow-up for #1399: pin the SECURITY DEFINER lookup path.
--
-- Every application relation in the function body is already schema-qualified
-- as public.*. Keeping public in search_path would only widen the object lookup
-- surface. Explicitly placing pg_temp last prevents temporary objects from
-- taking implicit precedence during name resolution.
ALTER FUNCTION public.record_post_measurement_snapshot(
  uuid, uuid, text, text, text, integer,
  timestamptz, timestamptz, text, jsonb, jsonb,
  text, text, integer, integer
) SET search_path = pg_catalog, pg_temp;
