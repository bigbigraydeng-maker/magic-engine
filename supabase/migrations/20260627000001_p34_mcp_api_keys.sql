-- P34.1 — MCP per-client API keys + access log
--
-- Background:
--   Phase 34 (Client MCP Server, PR #369) lets clients call read-only MCP
--   tools from their own Claude. Existing /api/clients/[id]/* routes
--   authenticate via Supabase session cookie (browser-only). MCP is
--   machine-to-machine and can't carry cookies, so we introduce a parallel
--   Bearer-token auth path: per-client API keys, hash-only at rest.
--
-- Tables:
--   client_api_keys — one row per issued key; key_hash is sha256(plaintext).
--     - key_prefix stores first 12 chars of plaintext for UI display
--       ("me_live_a1b2…") so FDE / clients can identify keys without
--       revealing them.
--     - revoked_at: soft delete (preserve audit trail).
--     - scopes: reserved for future write:* scopes (Phase 34 V2 path,
--       design doc §12 — clients triggering Fix actions via Claude).
--     - metadata: jsonb fallback for future billing/plan linkage (子牙 B3),
--       zero migration cost vs adding columns later.
--
--   mcp_access_log — append-only per-call log. Triple duty:
--     1. Audit (who hit what tool when),
--     2. Rate-limit counter source (count rows in last 60s by key_id) —
--        chosen over single-instance memory LRU (子牙 B3) so it stays
--        correct when Render scales out,
--     3. Future billing aggregation source (no schema change needed).
--
-- Auth model:
--   Both tables follow the service-role-only RLS template (CLAUDE.md
--   strong rule). ME never uses end-user RLS — all DB access goes through
--   supabaseAdmin in API routes. We deliberately do NOT reference
--   workspace_id, client_team, auth.uid, or auth.jwt (none exist in this
--   project's auth model).
--
-- Reference: docs/specs/me-mcp-server-design.md §3.1, §6
-- ROADMAP: P34.1

CREATE TABLE IF NOT EXISTS public.client_api_keys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  key_hash         text NOT NULL UNIQUE,
  key_prefix       text NOT NULL,
  name             text NOT NULL,
  scopes           text[] NOT NULL DEFAULT ARRAY['read:all']::text[],
  created_by_email text,
  last_used_at     timestamptz,
  revoked_at       timestamptz,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.client_api_keys IS
  'P34 MCP per-client API keys. Hash-only at rest. Plaintext returned exactly once at creation. Revoked keys are kept (soft delete) for audit. Issued by FDE in Dashboard settings drawer (P34.2 UI); client self-serve issuance deferred to V2.';
COMMENT ON COLUMN public.client_api_keys.key_hash IS 'sha256 of plaintext key. NEVER store plaintext.';
COMMENT ON COLUMN public.client_api_keys.key_prefix IS 'First 12 chars of plaintext (e.g. "me_live_a1b2") for UI identification; cannot reconstruct the key.';
COMMENT ON COLUMN public.client_api_keys.scopes IS 'MVP all rows are ["read:all"]. Reserved for future write:* scopes when V2 adds executable Fix-triggering tools (design doc §12).';
COMMENT ON COLUMN public.client_api_keys.metadata IS 'Free-form jsonb for future plan/billing linkage; avoids schema migration when Phase 20 metering lands.';

CREATE INDEX IF NOT EXISTS idx_client_api_keys_client ON public.client_api_keys(client_id);
CREATE INDEX IF NOT EXISTS idx_client_api_keys_hash   ON public.client_api_keys(key_hash);

ALTER TABLE public.client_api_keys ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.client_api_keys FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Access log: append-only, drives audit + rate-limit + billing aggregation.
CREATE TABLE IF NOT EXISTS public.mcp_access_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id     uuid NOT NULL REFERENCES public.client_api_keys(id) ON DELETE CASCADE,
  client_id  uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  tool       text NOT NULL,
  ok         boolean NOT NULL DEFAULT true,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mcp_access_log IS
  'P34 MCP append-only access log. Triple-duty: audit / rate-limit counter / future billing aggregation. Rate-limit query: count(*) WHERE key_id=$1 AND created_at > now() - interval ''60 seconds''.';

CREATE INDEX IF NOT EXISTS idx_mcp_access_log_key_ts    ON public.mcp_access_log(key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_access_log_client_ts ON public.mcp_access_log(client_id, created_at DESC);

ALTER TABLE public.mcp_access_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.mcp_access_log FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
