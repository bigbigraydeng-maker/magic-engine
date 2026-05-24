-- P14.A.2: website_publish_jobs
--
-- One row per push attempt from Magic Engine to a connected client website
-- (Shopify / WordPress via cms_connections). Provides:
--   - idempotency: UNIQUE (connection_id, idempotency_key) blocks duplicate pushes
--     when the caller retries the same payload.
--   - audit trail: full content_snapshot + payload_hash (SHA-256) per attempt.
--   - state machine: draft → published | failed; published → rolled_back.
--
-- The connector layer (P14.A.4 Shopify, P14.A.5 WordPress) is responsible for:
--   1. inserting a row with status='draft' after the remote draft is created,
--   2. updating to 'published' once FDE confirms preview and publishes,
--   3. flipping to 'failed' on connector error (with error_message),
--   4. flipping to 'rolled_back' when an explicit unpublish is performed.

CREATE TABLE IF NOT EXISTS website_publish_jobs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid        NOT NULL REFERENCES clients (id)         ON DELETE CASCADE,
  connection_id      uuid        NOT NULL REFERENCES cms_connections (id) ON DELETE CASCADE,
  source_type        text        NOT NULL,
  source_id          uuid        NOT NULL,
  platform_post_id   text,
  target_url         text,
  content_snapshot   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  payload_hash       text        NOT NULL,
  status             text        NOT NULL DEFAULT 'draft',
  idempotency_key    text        NOT NULL,
  retry_count        int         NOT NULL DEFAULT 0,
  error_message      text,
  published_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_publish_jobs_source_type_check
    CHECK (source_type IN ('blog_post','campaign_lp')),
  CONSTRAINT website_publish_jobs_status_check
    CHECK (status IN ('draft','published','failed','rolled_back')),
  CONSTRAINT website_publish_jobs_idempotency_unique
    UNIQUE (connection_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_website_publish_jobs_client_id
  ON website_publish_jobs (client_id);
CREATE INDEX IF NOT EXISTS idx_website_publish_jobs_connection_id
  ON website_publish_jobs (connection_id);
CREATE INDEX IF NOT EXISTS idx_website_publish_jobs_source
  ON website_publish_jobs (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_website_publish_jobs_status
  ON website_publish_jobs (status);

ALTER TABLE website_publish_jobs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON website_publish_jobs FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Auto-update updated_at on row change.
CREATE OR REPLACE FUNCTION update_website_publish_jobs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_website_publish_jobs_updated_at ON website_publish_jobs;
CREATE TRIGGER trg_website_publish_jobs_updated_at
  BEFORE UPDATE ON website_publish_jobs
  FOR EACH ROW EXECUTE FUNCTION update_website_publish_jobs_updated_at();

COMMENT ON TABLE website_publish_jobs IS
  'P14.A.2: Audit log for every push from Magic Engine to a connected client '
  'website (Shopify / WordPress). FK to cms_connections; idempotent on '
  '(connection_id, idempotency_key); state machine: draft → published | failed; '
  'published → rolled_back.';
COMMENT ON COLUMN website_publish_jobs.source_type IS
  'Where the content originated inside Magic Engine: blog_post (blog_posts.id) '
  'or campaign_lp (future campaign landing-page table).';
COMMENT ON COLUMN website_publish_jobs.platform_post_id IS
  'External platform identifier returned after the remote draft is created '
  '(Shopify article/page id, WordPress post id). Null until the connector '
  'receives a response.';
COMMENT ON COLUMN website_publish_jobs.content_snapshot IS
  'Full JSON snapshot of the content as it was pushed. Used for diffing on '
  'rollback and for audit replay.';
COMMENT ON COLUMN website_publish_jobs.payload_hash IS
  'SHA-256 of the canonicalised content payload. Lets us detect drift between '
  'the snapshot we hold and what the remote platform currently serves.';
COMMENT ON COLUMN website_publish_jobs.idempotency_key IS
  'Caller-provided key (typically source_type:source_id:payload_hash). '
  'UNIQUE per connection so retrying the same push returns the existing row '
  'instead of creating a duplicate remote draft.';
