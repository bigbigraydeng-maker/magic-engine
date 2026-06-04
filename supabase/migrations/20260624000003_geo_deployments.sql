-- B2 (GEO-B+ Stage 1): geo_deployments tracking table
--
-- Records every GEO snippet injection so publish-geo-to-github can:
--   1. Detect "external drift" — the ME-GEO marker block on disk no longer
--      matches the hash ME last wrote, meaning a human edited the template
--      directly. We refuse to overwrite silently and prompt for force.
--   2. Cancel a stale PR — if a directive's previous publish opened PR #N
--      and the FDE never merged it, the next publish closes #N and opens a
--      fresh one rather than force-pushing (preserves PR review history).
--   3. Reconcile post-merge — the GitHub webhook flips status to 'merged'
--      and the Deploy page can show "✅ live in production".
--
-- One row per (client_id, directive_id, target_path) — each template file
-- gets its own row even when the same directive is injected into multiple
-- targets.

CREATE TABLE IF NOT EXISTS geo_deployments (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid        NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  directive_id        uuid        NOT NULL REFERENCES geo_directives (id) ON DELETE CASCADE,
  target_path         text        NOT NULL,
  branch              text        NOT NULL,
  pr_number           integer     NOT NULL,
  pr_url              text        NOT NULL,
  -- SHA-256 hex of the snippet block ME injected. Used to detect drift on
  -- the next publish (compare against the live file content).
  injected_hash       text        NOT NULL,
  -- Lifecycle:
  --   pending_pr — PR opened, awaiting FDE merge
  --   merged     — PR merged (webhook flips this)
  --   superseded — a newer publish replaced this row (old PR was closed)
  --   closed     — PR closed without merging (FDE rejected)
  status              text        NOT NULL DEFAULT 'pending_pr',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geo_deployments_status_check
    CHECK (status IN ('pending_pr', 'merged', 'superseded', 'closed')),
  CONSTRAINT geo_deployments_pr_number_positive
    CHECK (pr_number > 0)
);

-- Lookup by (client, directive, path) — happens on every publish.
CREATE INDEX IF NOT EXISTS idx_geo_deployments_client_directive_path
  ON geo_deployments (client_id, directive_id, target_path);

-- Webhook reconciliation: GitHub gives us the pr_number, we find the row.
CREATE INDEX IF NOT EXISTS idx_geo_deployments_pr_number
  ON geo_deployments (pr_number);

-- "What's currently live for this client" query (status='merged').
CREATE INDEX IF NOT EXISTS idx_geo_deployments_client_status
  ON geo_deployments (client_id, status);

ALTER TABLE geo_deployments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON geo_deployments FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION update_geo_deployments_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_geo_deployments_updated_at ON geo_deployments;
CREATE TRIGGER trg_geo_deployments_updated_at
  BEFORE UPDATE ON geo_deployments
  FOR EACH ROW EXECUTE FUNCTION update_geo_deployments_updated_at();

COMMENT ON TABLE geo_deployments IS
  'B2 (GEO-B+ Stage 1): one row per (client, directive, template_path) injection. '
  'Tracks PR lifecycle + ME-GEO block hash so the next publish can detect external drift '
  'and cancel-then-reopen instead of force-pushing.';
COMMENT ON COLUMN geo_deployments.injected_hash IS
  'SHA-256 hex of the snippet block ME wrote into the template. Compared against the '
  'live file content on next publish to detect human edits inside ME-GEO markers.';
COMMENT ON COLUMN geo_deployments.status IS
  'pending_pr | merged | superseded | closed. Webhook updates to merged; new publish '
  'flips old rows to superseded.';
