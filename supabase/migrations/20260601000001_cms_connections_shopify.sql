-- P14.A.4: Extend cms_connections for Shopify provider
--
-- Shopify connections use Private App Admin API access tokens with write_content
-- (write_blogs + write_pages) scope. The shop URL is stored normalised in site_url
-- (same column WordPress uses). No username column is needed for Shopify.
--
-- Shape per provider after this migration:
--   github     → repo_owner, repo_name, default_branch, content_paths required
--   wordpress  → site_url, username required
--   shopify    → site_url required (username NULL)

-- Drop and replace the provider-shape check to include shopify.
ALTER TABLE cms_connections DROP CONSTRAINT IF EXISTS cms_connections_provider_shape;
ALTER TABLE cms_connections ADD CONSTRAINT cms_connections_provider_shape CHECK (
  (provider = 'github'
    AND repo_owner IS NOT NULL
    AND repo_name  IS NOT NULL)
  OR
  (provider = 'wordpress'
    AND site_url IS NOT NULL
    AND username IS NOT NULL)
  OR
  (provider = 'shopify'
    AND site_url IS NOT NULL)
);

-- Update table comment.
COMMENT ON TABLE cms_connections IS
  'Per-client website connector credentials. Supports github (PAT), wordpress '
  '(Application Password), and shopify (Admin API token). Secrets stored as '
  'AES-256-GCM ciphertext in encrypted_token. Key = CMS_TOKEN_ENCRYPTION_KEY '
  'env var. UNIQUE (client_id, provider) allows one connection per provider per client.';

COMMENT ON COLUMN cms_connections.site_url IS
  'Normalised site origin. WordPress: https://example.com. '
  'Shopify: https://my-store.myshopify.com (or custom domain). '
  'Used to build REST API base URL.';
