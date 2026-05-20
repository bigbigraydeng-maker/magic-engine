-- P_CMS.1: GitHub CMS Connector
-- Stores one encrypted GitHub PAT per client, plus repo config.
-- The encrypted_token field uses AES-256-GCM:
--   base64(iv) + '.' + base64(authTag) + '.' + base64(ciphertext)
-- The encryption key lives in CMS_TOKEN_ENCRYPTION_KEY (server env only).

CREATE TABLE IF NOT EXISTS cms_connections (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid        NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  provider            text        NOT NULL DEFAULT 'github',
  repo_owner          text        NOT NULL,
  repo_name           text        NOT NULL,
  default_branch      text        NOT NULL DEFAULT 'main',
  content_paths       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  encrypted_token     text        NOT NULL,
  token_last_four     text,
  status              text        NOT NULL DEFAULT 'disconnected',
  last_error          text,
  last_tested_at      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cms_connections_client_provider_unique UNIQUE (client_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_cms_connections_client_id ON cms_connections (client_id);

ALTER TABLE cms_connections ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON cms_connections FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_cms_connections_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cms_connections_updated_at ON cms_connections;
CREATE TRIGGER trg_cms_connections_updated_at
  BEFORE UPDATE ON cms_connections
  FOR EACH ROW EXECUTE FUNCTION update_cms_connections_updated_at();

COMMENT ON TABLE cms_connections IS
  'P_CMS.1: One GitHub CMS connector per client. PAT stored as AES-256-GCM ciphertext. '
  'Magic Engine can open PRs to push meta + content fixes to the client repo.';
COMMENT ON COLUMN cms_connections.encrypted_token IS
  'AES-256-GCM ciphertext: base64(iv).base64(authTag).base64(ciphertext). '
  'Key = CMS_TOKEN_ENCRYPTION_KEY env var. NEVER store plain text here.';
COMMENT ON COLUMN cms_connections.content_paths IS
  'JSON array of relative file paths in the repo that contain SEO metadata, '
  'e.g. ["src/lib/data/guides.ts", "src/lib/data/tours.ts"].';
