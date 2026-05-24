-- P14.A.1: Extend cms_connections for WordPress provider
--
-- WordPress connections use Application Passwords (WP 5.6+ native, no plugin required).
-- Reuses the existing AES-256-GCM crypto (CMS_TOKEN_ENCRYPTION_KEY) and the
-- (client_id, provider) UNIQUE constraint that already supports multi-provider rows.
--
-- Shape per provider:
--   github     → repo_owner, repo_name, default_branch, content_paths required
--   wordpress  → site_url, username required (encrypted_token = Application Password)

ALTER TABLE cms_connections
  ADD COLUMN IF NOT EXISTS site_url  text,
  ADD COLUMN IF NOT EXISTS username  text;

-- Relax GitHub-only NOT NULL constraints so wordpress rows can coexist.
ALTER TABLE cms_connections ALTER COLUMN repo_owner     DROP NOT NULL;
ALTER TABLE cms_connections ALTER COLUMN repo_name      DROP NOT NULL;
ALTER TABLE cms_connections ALTER COLUMN default_branch DROP NOT NULL;

-- Per-provider shape enforcement.
ALTER TABLE cms_connections DROP CONSTRAINT IF EXISTS cms_connections_provider_shape;
ALTER TABLE cms_connections ADD CONSTRAINT cms_connections_provider_shape CHECK (
  (provider = 'github'
    AND repo_owner IS NOT NULL
    AND repo_name  IS NOT NULL)
  OR
  (provider = 'wordpress'
    AND site_url IS NOT NULL
    AND username IS NOT NULL)
);

COMMENT ON COLUMN cms_connections.site_url IS
  'WordPress site origin, e.g. https://example.com (no trailing slash). '
  'Used to build REST API URL: {site_url}/wp-json/wp/v2/...';
COMMENT ON COLUMN cms_connections.username IS
  'WordPress username paired with the Application Password stored in encrypted_token. '
  'Use a dedicated low-privilege user (Author or custom role with publish_posts only).';

-- Update table comment to reflect multi-provider scope.
COMMENT ON TABLE cms_connections IS
  'Per-client website connector credentials. Supports github (PAT) and wordpress '
  '(Application Password). Secrets stored as AES-256-GCM ciphertext in encrypted_token. '
  'Key = CMS_TOKEN_ENCRYPTION_KEY env var. UNIQUE (client_id, provider) allows one '
  'connection per provider per client.';
COMMENT ON COLUMN cms_connections.encrypted_token IS
  'AES-256-GCM ciphertext: base64(iv).base64(authTag).base64(ciphertext). '
  'For provider=github this is a GitHub PAT; for provider=wordpress this is an '
  'Application Password. Key = CMS_TOKEN_ENCRYPTION_KEY env var. NEVER store plain text.';
