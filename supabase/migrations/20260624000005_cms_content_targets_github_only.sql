-- B2-8 (GEO-B+ Stage 1, 魏征 B2 carryover): content_targets is a GitHub-only
-- concept.
--
-- Why this constraint exists:
--   content_targets drives the publish-geo-to-github injection path. Only the
--   GitHub connector reads it; WordPress and Shopify rows write their snippets
--   via REST and never look at content_targets. Today updateContentTargets()
--   already hard-scopes its write to provider='github', so a non-github row can
--   only get a non-empty content_targets through a future code bug or a manual
--   SQL edit. This partial CHECK is the defensive backstop: a wordpress/shopify
--   row physically cannot carry injection targets, so a stray write fails loud
--   at the DB instead of silently configuring an injection target that nothing
--   will ever honour.
--
-- Shape (existing cms_content_targets_shape_check from 20260624000002) is
-- orthogonal and stays: it validates element structure for ALL rows. This new
-- check only restricts WHERE a non-empty array may live.

-- Defensive: empty/clear any non-github rows that somehow already hold targets,
-- so the constraint can be added without a validation failure on legacy data.
-- (No production non-github row should have targets today; this is belt-and-braces.)
UPDATE cms_connections
  SET content_targets = '[]'::jsonb
  WHERE provider <> 'github'
    AND content_targets <> '[]'::jsonb;

ALTER TABLE cms_connections
  DROP CONSTRAINT IF EXISTS cms_content_targets_github_only_check;

ALTER TABLE cms_connections
  ADD CONSTRAINT cms_content_targets_github_only_check
  CHECK (
    provider = 'github'
    OR content_targets = '[]'::jsonb
  );

COMMENT ON CONSTRAINT cms_content_targets_github_only_check ON cms_connections IS
  'B2-8 (GEO-B+ Stage 1): only github rows may carry content_targets. '
  'WordPress/Shopify connectors publish via REST and never read content_targets, '
  'so a non-empty array on a non-github row is always a bug — reject it at write time.';
