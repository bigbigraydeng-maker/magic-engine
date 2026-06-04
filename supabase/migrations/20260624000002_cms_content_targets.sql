-- B1 (GEO-B+ Stage 1): content_targets schema for cms_connections
--
-- Adds a typed list of injection targets so publish-geo-to-github can read the
-- right template file, recognise its syntax, and inject the GEO snippet inside
-- a marked block instead of dumping a standalone file the FDE has to copy.
--
-- Structure per element:
--   {
--     "path":   "header.php" | "layouts/main.html" | ...,   // relative repo path
--     "syntax": "html" | "php",                              // MVP whitelist
--     "role":   "global_head",                               // currently only global_head
--     "label":  "Site header (optional friendly name)"       // optional
--   }
--
-- The old `content_paths text[]` column is kept untouched for backward compat;
-- it is no longer read by the GEO deploy path but still used by other CMS code
-- (e.g. blog meta patcher). We never migrate data automatically — FDEs will
-- configure content_targets via Settings UI and Magic Engine validates at write
-- time, so old rows simply expose an empty content_targets array.

ALTER TABLE cms_connections
  ADD COLUMN IF NOT EXISTS content_targets jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Validation helper: every element must be an object with path/syntax/role,
-- syntax must be in the MVP whitelist (html|php), role currently must be
-- global_head. label is optional.
CREATE OR REPLACE FUNCTION validate_cms_content_targets(targets jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  elem jsonb;
BEGIN
  IF targets IS NULL OR jsonb_typeof(targets) <> 'array' THEN
    RETURN false;
  END IF;

  FOR elem IN SELECT jsonb_array_elements(targets)
  LOOP
    IF jsonb_typeof(elem) <> 'object' THEN
      RETURN false;
    END IF;
    IF NOT (elem ? 'path' AND elem ? 'syntax' AND elem ? 'role') THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(elem -> 'path')   <> 'string' THEN RETURN false; END IF;
    IF jsonb_typeof(elem -> 'syntax') <> 'string' THEN RETURN false; END IF;
    IF jsonb_typeof(elem -> 'role')   <> 'string' THEN RETURN false; END IF;
    IF (elem ->> 'path')   = '' THEN RETURN false; END IF;
    IF (elem ->> 'syntax') NOT IN ('html', 'php') THEN RETURN false; END IF;
    IF (elem ->> 'role')   NOT IN ('global_head') THEN RETURN false; END IF;
    IF elem ? 'label' AND jsonb_typeof(elem -> 'label') <> 'string' THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

ALTER TABLE cms_connections
  DROP CONSTRAINT IF EXISTS cms_content_targets_shape_check;

ALTER TABLE cms_connections
  ADD CONSTRAINT cms_content_targets_shape_check
  CHECK (validate_cms_content_targets(content_targets));

COMMENT ON COLUMN cms_connections.content_targets IS
  'B1 (GEO-B+ Stage 1): JSON array of GEO snippet injection targets. '
  'Each element: {path, syntax (html|php), role (global_head), label?}. '
  'Replaces content_paths for the GEO deploy path; content_paths kept for '
  'backward compat with other CMS consumers.';

COMMENT ON FUNCTION validate_cms_content_targets IS
  'CHECK helper for cms_connections.content_targets shape. '
  'MVP whitelist: syntax in (html, php), role in (global_head).';
