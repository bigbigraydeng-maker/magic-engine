-- =============================================================================
-- Content Reel publish — data layer (PR-A of spec
-- docs/specs/2026-09-15-creatomate-reel-publish-spec-v2.md, v2.1 §3 / §14 / §15)
--
-- ⚠️ Apply as ONE transaction (Supabase MCP apply_migration, or `psql -1 -f`).
--    Never paste statements one by one: the guards below only make sense together.
--
-- What this adds (no application code calls any of it yet):
--   1. clients.content_reel_live_enabled  per-client live switch (RPC-only writes)
--   2. content_posts.import_source_url    idempotency key for "import existing video"
--   3. content_reel_video_copies          immutable, hash-bound copy of the authorised video
--   4. content_reel_publish_attempts      one row per publish authorisation; the row IS the
--                                         receipt. The DB video_id is the only trusted
--                                         identity (Facebook strips zero-width tags, spec §1.3 X1)
--   5. content_reel_live_switch_events    audit rows for the per-client live switch
--   6. Guard triggers + SECURITY DEFINER RPCs that own every state transition
--
-- Why guards live in triggers as well as RPCs: service_role bypasses RLS, so a direct
-- UPDATE from app code would otherwise skip every rule. The row trigger is the single
-- source of truth for legal transitions and their evidence; the RPCs add row locking,
-- side effects on content_posts, and translate expected refusals to codes.
--
-- Evidence timestamps (last_step_started_at, video_deleted_at, absence_first_confirmed_at,
-- publish_verified_at, first_comment_verified_at, finished_at, created_at) may only carry
-- the database clock: NULL on insert, and on update either unchanged or exactly now().
-- A caller can therefore never backdate its way past a time floor.
-- now() is the transaction start time: a long-running transaction would stamp evidence
-- earlier than wall clock. Calls through PostgREST RPC are one short transaction each, so
-- this does not arise on the intended path; do not wrap these RPCs in long transactions.
--
-- Timing floors (spec v2.1 §3.2): Graph writes in strict mode are bounded by start 60s +
-- rupload 15min + finish 60s = 17min. A video-bearing attempt may only be declared
-- "not on Facebook" / "removed externally" when the last DB-recorded activity is >= 30
-- minutes old (17min + 13min margin) and the first absence evidence is >= 10 minutes old.
-- A claimed attempt without a video_id needs 5 minutes (start timeout 60s + margin).
--
-- Security template (scripts/db-invariants.sql): RLS FOR ALL TO service_role; table
-- privileges revoked from PUBLIC/anon/authenticated/service_role and re-granted to
-- service_role without DELETE/TRUNCATE; SECURITY DEFINER functions pin
-- search_path = pg_catalog, pg_temp and are executable by service_role only.
--
-- Apply requires explicit PM go. Rollback: scripts/content-reel-publish-rollback.sql
-- =============================================================================

SET LOCAL lock_timeout = '5s';

-- ── 0. Columns on existing tables first (short locks, fail fast) ─────────────

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS content_reel_live_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS import_source_url text NULL;
CREATE UNIQUE INDEX IF NOT EXISTS content_posts_import_source_url
  ON public.content_posts (client_id, import_source_url)
  WHERE import_source_url IS NOT NULL;

-- ── 1. Tables ────────────────────────────────────────────────────────────────

CREATE TABLE public.content_reel_video_copies (
  id                   uuid PRIMARY KEY,
  client_id            uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  content_post_id      uuid NOT NULL REFERENCES public.content_posts(id) ON DELETE RESTRICT,
  source_video_url     text NOT NULL CHECK (length(source_video_url) > 0),
  copy_path            text NOT NULL UNIQUE CHECK (length(copy_path) > 0),
  sha256               text NULL CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  content_length       bigint NULL CHECK (content_length IS NULL OR content_length > 0),
  status               text NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing','ready','failed')),
  error_code           text NULL,
  requested_by_user_id uuid NOT NULL,
  prepared_by          text NOT NULL CHECK (prepared_by IN ('human','agent')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_reel_video_copies_ready_has_hash
    CHECK (status <> 'ready' OR (sha256 IS NOT NULL AND content_length IS NOT NULL))
);
CREATE INDEX content_reel_video_copies_post ON public.content_reel_video_copies (content_post_id, created_at DESC);

CREATE TABLE public.content_reel_publish_attempts (
  id                               uuid PRIMARY KEY,   -- = authorization_id
  client_id                        uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  content_post_id                  uuid NOT NULL REFERENCES public.content_posts(id) ON DELETE RESTRICT,
  video_copy_id                    uuid NOT NULL REFERENCES public.content_reel_video_copies(id) ON DELETE RESTRICT,
  render_job_id                    uuid NULL,
  mode_requested                   text NOT NULL CHECK (mode_requested IN ('draft','live')),
  state                            text NOT NULL CHECK (state IN (
                                     'authorized','claimed','uploading','in_doubt',
                                     'cancelled','preflight_failed','not_on_facebook',
                                     'draft_published','draft_deleted',
                                     'published','removed_externally')),
  form_sha256                      text NOT NULL CHECK (form_sha256 ~ '^[0-9a-f]{64}$'),
  authorized_via                   text NOT NULL CHECK (authorized_via IN ('ui_click','chat_go')),
  authorized_by_user_id            uuid NOT NULL,
  authorized_by_email              text NOT NULL CHECK (length(authorized_by_email) > 0),
  prepared_by                      text NOT NULL CHECK (prepared_by IN ('human','agent')),
  authorization_record             jsonb NOT NULL CHECK (jsonb_typeof(authorization_record) = 'object'),
  video_sha256                     text NOT NULL CHECK (video_sha256 ~ '^[0-9a-f]{64}$'),
  page_id                          text NOT NULL CHECK (page_id ~ '^[0-9]{5,25}$'),
  video_id                         text NULL CHECK (video_id IS NULL OR video_id ~ '^[0-9]{5,25}$'),
  video_state                      text NULL CHECK (video_state IN ('DRAFT','PUBLISHED')),
  permalink                        text NULL,
  published_at                     timestamptz NULL,
  publish_confirmation             text NULL CHECK (publish_confirmation IN ('graph_get','human_confirmed')),
  publish_confirmed_by_user_id     uuid NULL,
  publish_verified_at              timestamptz NULL,
  env_live_at_publish              boolean NULL,
  rules_live_at_publish            boolean NULL,
  error_code                       text NULL,
  error_detail                     text NULL,
  alert_code                       text NULL,
  last_step_started_at             timestamptz NULL,
  video_deleted_at                 timestamptz NULL,
  absence_first_confirmed_at       timestamptz NULL,
  trigger_event_ids                text[] NOT NULL DEFAULT '{}',
  restart_seq                      integer NOT NULL DEFAULT 0 CHECK (restart_seq >= 0),
  first_comment_state              text NOT NULL DEFAULT 'pending'
                                     CHECK (first_comment_state IN ('pending','verified','not_applicable')),
  first_comment_verified_at        timestamptz NULL,
  first_comment_verification_basis text NULL CHECK (first_comment_verification_basis IN ('from_and_url','url_only')),
  followup                         jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(followup) = 'object'),
  provider_impact                  jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(provider_impact) = 'object'),
  created_at                       timestamptz NOT NULL DEFAULT now(),
  updated_at                       timestamptz NOT NULL DEFAULT now(),
  finished_at                      timestamptz NULL
);

-- One in-flight publish per content post (spec D1 / 魏征 M1).
CREATE UNIQUE INDEX content_reel_publish_attempts_one_active
  ON public.content_reel_publish_attempts (content_post_id)
  WHERE state IN ('authorized','claimed','uploading','in_doubt');
CREATE UNIQUE INDEX content_reel_publish_attempts_video
  ON public.content_reel_publish_attempts (video_id) WHERE video_id IS NOT NULL;
CREATE INDEX content_reel_publish_attempts_hash
  ON public.content_reel_publish_attempts (client_id, video_sha256, created_at DESC);
CREATE INDEX content_reel_publish_attempts_state
  ON public.content_reel_publish_attempts (state, updated_at);
CREATE INDEX content_reel_publish_attempts_post
  ON public.content_reel_publish_attempts (content_post_id, created_at DESC);

CREATE TABLE public.content_reel_live_switch_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  old_value          boolean NOT NULL,
  new_value          boolean NOT NULL,
  changed_by_user_id uuid NOT NULL,
  changed_by_email   text NOT NULL CHECK (length(changed_by_email) > 0),
  reason             text NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX content_reel_live_switch_events_client
  ON public.content_reel_live_switch_events (client_id, created_at DESC);

-- ── 2. RLS + privileges ──────────────────────────────────────────────────────

ALTER TABLE public.content_reel_video_copies       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_reel_publish_attempts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_reel_live_switch_events ENABLE ROW LEVEL SECURITY;

-- 🔴 必须写 TO service_role。漏掉 = 对匿名访客敞开读写（2026-08-03 实测泄露 118 条策略）。
CREATE POLICY "service_role_full" ON public.content_reel_video_copies
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full" ON public.content_reel_publish_attempts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full" ON public.content_reel_live_switch_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Supabase default privileges hand ALL (incl. DELETE/TRUNCATE) to service_role too.
-- Revoke everything, then grant back only what the pipeline needs: rows are never deleted.
REVOKE ALL ON TABLE public.content_reel_video_copies       FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.content_reel_publish_attempts   FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.content_reel_live_switch_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.content_reel_video_copies       TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.content_reel_publish_attempts   TO service_role;
GRANT SELECT, INSERT         ON TABLE public.content_reel_live_switch_events TO service_role;

CREATE TRIGGER content_reel_video_copies_updated_at
  BEFORE UPDATE ON public.content_reel_video_copies
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER content_reel_publish_attempts_updated_at
  BEFORE UPDATE ON public.content_reel_publish_attempts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── 3. Transition table (single source of truth, used by trigger and contract) ──

CREATE OR REPLACE FUNCTION public.content_reel_transition_allowed(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT (p_from, p_to) IN (
    ('authorized','claimed'), ('authorized','cancelled'), ('authorized','preflight_failed'),
    ('claimed','claimed'), ('claimed','uploading'), ('claimed','preflight_failed'), ('claimed','not_on_facebook'),
    ('uploading','uploading'), ('uploading','published'), ('uploading','draft_published'), ('uploading','in_doubt'),
    ('in_doubt','in_doubt'), ('in_doubt','published'), ('in_doubt','draft_published'), ('in_doubt','not_on_facebook'),
    ('published','published'), ('published','removed_externally'), ('published','in_doubt'),
    ('draft_published','draft_published'), ('draft_published','draft_deleted'),
    ('not_on_facebook','published')
  );
$fn$;
REVOKE ALL ON FUNCTION public.content_reel_transition_allowed(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_reel_transition_allowed(text, text) TO service_role;

-- ── 4. Guard triggers ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.content_reel_attempts_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_bookkeeping constant text[] := ARRAY['followup','trigger_event_ids','restart_seq','updated_at'];
  v_published_mark timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'content_reel_guard:attempts_are_append_only';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'authorized' OR NEW.video_id IS NOT NULL OR NEW.video_state IS NOT NULL
       OR NEW.published_at IS NOT NULL OR NEW.publish_confirmation IS NOT NULL
       OR NEW.last_step_started_at IS NOT NULL OR NEW.video_deleted_at IS NOT NULL
       OR NEW.absence_first_confirmed_at IS NOT NULL OR NEW.publish_verified_at IS NOT NULL
       OR NEW.first_comment_verified_at IS NOT NULL OR NEW.finished_at IS NOT NULL THEN
      RAISE EXCEPTION 'content_reel_guard:insert_must_be_clean_authorized';
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Bookkeeping is monotonic: the restart counter never goes down and recorded event ids
  -- are never removed (a lost id would let a stale event be mistaken for a fresh one).
  IF NEW.restart_seq < OLD.restart_seq THEN
    RAISE EXCEPTION 'content_reel_guard:bookkeeping_not_monotonic';
  END IF;
  IF NOT (OLD.trigger_event_ids <@ NEW.trigger_event_ids) THEN
    RAISE EXCEPTION 'content_reel_guard:bookkeeping_not_monotonic';
  END IF;

  -- Pure bookkeeping (followup / event ids / restart counter) is legal in every state.
  IF OLD.state = NEW.state
     AND (to_jsonb(NEW) - v_bookkeeping) = (to_jsonb(OLD) - v_bookkeeping) THEN
    RETURN NEW;
  END IF;

  -- Identity columns never change.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.content_post_id IS DISTINCT FROM OLD.content_post_id
     OR NEW.video_copy_id IS DISTINCT FROM OLD.video_copy_id
     OR NEW.render_job_id IS DISTINCT FROM OLD.render_job_id
     OR NEW.mode_requested IS DISTINCT FROM OLD.mode_requested
     OR NEW.form_sha256 IS DISTINCT FROM OLD.form_sha256
     OR NEW.authorized_via IS DISTINCT FROM OLD.authorized_via
     OR NEW.authorized_by_user_id IS DISTINCT FROM OLD.authorized_by_user_id
     OR NEW.authorized_by_email IS DISTINCT FROM OLD.authorized_by_email
     OR NEW.prepared_by IS DISTINCT FROM OLD.prepared_by
     OR NEW.authorization_record IS DISTINCT FROM OLD.authorization_record
     OR NEW.video_sha256 IS DISTINCT FROM OLD.video_sha256
     OR NEW.page_id IS DISTINCT FROM OLD.page_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'content_reel_guard:immutable_column';
  END IF;

  -- Evidence timestamps: database clock only. A changed value must be exactly now();
  -- only the absence marker may be cleared back to NULL.
  IF (NEW.last_step_started_at IS DISTINCT FROM OLD.last_step_started_at
        AND (NEW.last_step_started_at IS NULL OR NEW.last_step_started_at <> now()))
     OR (NEW.video_deleted_at IS DISTINCT FROM OLD.video_deleted_at
        AND (NEW.video_deleted_at IS NULL OR NEW.video_deleted_at <> now()))
     OR (NEW.absence_first_confirmed_at IS DISTINCT FROM OLD.absence_first_confirmed_at
        AND NEW.absence_first_confirmed_at IS NOT NULL AND NEW.absence_first_confirmed_at <> now())
     OR (NEW.publish_verified_at IS DISTINCT FROM OLD.publish_verified_at
        AND (NEW.publish_verified_at IS NULL OR NEW.publish_verified_at <> now()))
     OR (NEW.first_comment_verified_at IS DISTINCT FROM OLD.first_comment_verified_at
        AND (NEW.first_comment_verified_at IS NULL OR NEW.first_comment_verified_at <> now()))
     OR (NEW.finished_at IS DISTINCT FROM OLD.finished_at
        AND (NEW.finished_at IS NULL OR NEW.finished_at <> now())) THEN
    RAISE EXCEPTION 'content_reel_guard:evidence_timestamp_db_clock_only';
  END IF;

  -- video_id: written once, only when a claimed attempt starts uploading.
  IF OLD.video_id IS NOT NULL AND NEW.video_id IS DISTINCT FROM OLD.video_id THEN
    RAISE EXCEPTION 'content_reel_guard:video_id_immutable';
  END IF;
  IF OLD.video_id IS NULL AND NEW.video_id IS NOT NULL
     AND NOT (OLD.state = 'claimed' AND NEW.state = 'uploading') THEN
    RAISE EXCEPTION 'content_reel_guard:video_id_only_on_upload_start';
  END IF;

  IF NOT public.content_reel_transition_allowed(OLD.state, NEW.state) THEN
    RAISE EXCEPTION 'content_reel_guard:illegal_transition:%->%', OLD.state, NEW.state;
  END IF;

  IF NEW.state = 'uploading' AND NEW.video_id IS NULL THEN
    RAISE EXCEPTION 'content_reel_guard:uploading_requires_video_id';
  END IF;

  -- A published row carries a complete receipt on EVERY write, not only on entry.
  IF NEW.state = 'published' THEN
    IF NEW.mode_requested <> 'live' THEN
      RAISE EXCEPTION 'content_reel_guard:mode_state_mismatch';
    END IF;
    IF NEW.video_id IS NULL OR NEW.video_state IS DISTINCT FROM 'PUBLISHED'
       OR NEW.published_at IS NULL OR NEW.publish_confirmation IS NULL THEN
      RAISE EXCEPTION 'content_reel_guard:published_requires_receipt';
    END IF;
    IF NEW.publish_confirmation = 'graph_get' AND NEW.publish_verified_at IS NULL THEN
      RAISE EXCEPTION 'content_reel_guard:graph_get_requires_verified_at';
    END IF;
    IF NEW.publish_confirmation = 'human_confirmed' AND NEW.publish_confirmed_by_user_id IS NULL THEN
      RAISE EXCEPTION 'content_reel_guard:human_confirmed_requires_confirmer';
    END IF;
    IF OLD.state = 'published' THEN
      IF NEW.video_state IS DISTINCT FROM OLD.video_state
         OR NEW.published_at IS DISTINCT FROM OLD.published_at
         OR NEW.publish_confirmed_by_user_id IS DISTINCT FROM OLD.publish_confirmed_by_user_id
         OR (OLD.permalink IS NOT NULL AND NEW.permalink IS DISTINCT FROM OLD.permalink) THEN
        RAISE EXCEPTION 'content_reel_guard:published_receipt_immutable';
      END IF;
      IF NEW.publish_confirmation IS DISTINCT FROM OLD.publish_confirmation
         AND NOT (OLD.publish_confirmation = 'human_confirmed' AND NEW.publish_confirmation = 'graph_get'
                  AND NEW.publish_verified_at IS NOT NULL) THEN
        RAISE EXCEPTION 'content_reel_guard:published_receipt_immutable';
      END IF;
    ELSE
      IF NEW.absence_first_confirmed_at IS NOT NULL THEN
        RAISE EXCEPTION 'content_reel_guard:stale_absence_on_publish';
      END IF;
      -- Reading a video back as public after we recorded it gone or deleted it is an
      -- anomaly someone must look at.
      IF (OLD.state = 'not_on_facebook' OR OLD.video_deleted_at IS NOT NULL)
         AND COALESCE(NEW.alert_code, '') = '' THEN
        RAISE EXCEPTION 'content_reel_guard:alert_required';
      END IF;
    END IF;
  END IF;

  IF NEW.state = 'draft_published' THEN
    IF NEW.mode_requested <> 'draft' THEN
      RAISE EXCEPTION 'content_reel_guard:mode_state_mismatch';
    END IF;
    IF NEW.video_id IS NULL OR NEW.video_state IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'content_reel_guard:draft_requires_video';
    END IF;
    IF OLD.state <> 'draft_published' AND NEW.absence_first_confirmed_at IS NOT NULL THEN
      RAISE EXCEPTION 'content_reel_guard:stale_absence_on_publish';
    END IF;
  END IF;

  IF OLD.state = 'published' AND NEW.state = 'in_doubt'
     AND NOT (OLD.publish_confirmation = 'human_confirmed' AND OLD.publish_verified_at IS NULL) THEN
    RAISE EXCEPTION 'content_reel_guard:only_unverified_human_confirmation_can_reopen';
  END IF;

  -- Absence-based terminal states: evidence is read from OLD so one call can never both
  -- record the evidence and consume it. Evidence recorded at the same instant as (or
  -- before) the deletion does not count.
  IF NEW.state = 'not_on_facebook' AND OLD.state <> 'not_on_facebook' THEN
    IF OLD.video_id IS NULL THEN
      IF OLD.state <> 'claimed' THEN
        RAISE EXCEPTION 'content_reel_guard:not_on_facebook_without_video_requires_claimed';
      END IF;
      IF OLD.last_step_started_at IS NULL OR OLD.last_step_started_at > now() - interval '5 minutes' THEN
        RAISE EXCEPTION 'content_reel_guard:claimed_too_recent';
      END IF;
    ELSE
      IF OLD.video_deleted_at IS NULL THEN
        RAISE EXCEPTION 'content_reel_guard:not_on_facebook_requires_deletion';
      END IF;
      IF OLD.absence_first_confirmed_at IS NULL
         OR OLD.absence_first_confirmed_at <= OLD.video_deleted_at
         OR OLD.absence_first_confirmed_at > now() - interval '10 minutes' THEN
        RAISE EXCEPTION 'content_reel_guard:absence_not_confirmed_twice';
      END IF;
      IF OLD.last_step_started_at IS NULL OR OLD.last_step_started_at > now() - interval '30 minutes' THEN
        RAISE EXCEPTION 'content_reel_guard:last_write_too_recent';
      END IF;
    END IF;
  END IF;

  IF NEW.state = 'removed_externally' AND OLD.state <> 'removed_externally' THEN
    -- The latest DB-clock moment we know the Reel was live: entering published
    -- (finished_at) or the latest verification. Absence must come after it.
    v_published_mark := GREATEST(OLD.publish_verified_at, OLD.finished_at, OLD.created_at);
    IF OLD.absence_first_confirmed_at IS NULL
       OR OLD.absence_first_confirmed_at <= v_published_mark
       OR OLD.absence_first_confirmed_at > now() - interval '10 minutes' THEN
      RAISE EXCEPTION 'content_reel_guard:absence_not_confirmed_twice';
    END IF;
    -- Floor: the latest DB-recorded activity (last Graph write, verification, entry into
    -- published) must be 30+ minutes old. GREATEST, not COALESCE: the most recent of the
    -- clock-stamped columns is the conservative anchor; published_at is caller-supplied
    -- and deliberately not used.
    IF GREATEST(OLD.last_step_started_at, v_published_mark) > now() - interval '30 minutes' THEN
      RAISE EXCEPTION 'content_reel_guard:last_write_too_recent';
    END IF;
  END IF;

  IF NEW.state = 'draft_deleted' AND OLD.state <> 'draft_deleted' THEN
    -- The deletion must happen after the draft was recorded (finished_at is stamped on
    -- entering draft_published); a deletion from an earlier in_doubt episode does not count.
    IF OLD.video_deleted_at IS NULL OR OLD.finished_at IS NULL
       OR OLD.video_deleted_at <= OLD.finished_at THEN
      RAISE EXCEPTION 'content_reel_guard:draft_deleted_requires_deletion';
    END IF;
    IF OLD.absence_first_confirmed_at IS NULL
       OR OLD.absence_first_confirmed_at <= OLD.video_deleted_at
       OR OLD.absence_first_confirmed_at > now() - interval '10 minutes' THEN
      RAISE EXCEPTION 'content_reel_guard:absence_not_confirmed_twice';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.content_reel_attempts_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER content_reel_publish_attempts_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.content_reel_publish_attempts
  FOR EACH ROW EXECUTE FUNCTION public.content_reel_attempts_guard();

CREATE OR REPLACE FUNCTION public.content_reel_video_copies_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'content_reel_guard:video_copies_are_append_only';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'preparing' OR NEW.sha256 IS NOT NULL THEN
      RAISE EXCEPTION 'content_reel_guard:copy_insert_must_be_preparing';
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF OLD.status <> 'preparing' THEN
    RAISE EXCEPTION 'content_reel_guard:copy_already_finalized';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.content_post_id IS DISTINCT FROM OLD.content_post_id
     OR NEW.source_video_url IS DISTINCT FROM OLD.source_video_url
     OR NEW.copy_path IS DISTINCT FROM OLD.copy_path
     OR NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id
     OR NEW.prepared_by IS DISTINCT FROM OLD.prepared_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'content_reel_guard:immutable_column';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.content_reel_video_copies_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER content_reel_video_copies_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.content_reel_video_copies
  FOR EACH ROW EXECUTE FUNCTION public.content_reel_video_copies_guard();

CREATE OR REPLACE FUNCTION public.content_reel_live_switch_events_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'content_reel_guard:live_switch_events_are_append_only';
END;
$fn$;
REVOKE ALL ON FUNCTION public.content_reel_live_switch_events_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER content_reel_live_switch_events_guard
  BEFORE UPDATE OR DELETE ON public.content_reel_live_switch_events
  FOR EACH ROW EXECUTE FUNCTION public.content_reel_live_switch_events_guard();

-- TRUNCATE bypasses row triggers; block it at statement level on all three tables.
CREATE OR REPLACE FUNCTION public.content_reel_block_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'content_reel_guard:truncate_forbidden:%', TG_TABLE_NAME;
END;
$fn$;
REVOKE ALL ON FUNCTION public.content_reel_block_truncate() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER content_reel_publish_attempts_no_truncate
  BEFORE TRUNCATE ON public.content_reel_publish_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION public.content_reel_block_truncate();
CREATE TRIGGER content_reel_video_copies_no_truncate
  BEFORE TRUNCATE ON public.content_reel_video_copies
  FOR EACH STATEMENT EXECUTE FUNCTION public.content_reel_block_truncate();
CREATE TRIGGER content_reel_live_switch_events_no_truncate
  BEFORE TRUNCATE ON public.content_reel_live_switch_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.content_reel_block_truncate();

-- The per-client live switch may only change inside set_content_reel_live_enabled
-- (expected-old-value CAS + audit row), and a client can never be created switched on.
-- The GUC marker plus "current_user is the RPC owner" stops accidental direct writes
-- from app code (service_role). It is a guard against mistakes, NOT a security
-- boundary: the owner / a superuser can still set the marker by hand.
CREATE OR REPLACE FUNCTION public.clients_content_reel_live_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE v_owner name;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.content_reel_live_enabled THEN
      RAISE EXCEPTION 'content_reel_guard:live_switch_insert_must_be_false';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.content_reel_live_enabled IS DISTINCT FROM OLD.content_reel_live_enabled THEN
    SELECT pg_get_userbyid(p.proowner) INTO v_owner
      FROM pg_proc p
     WHERE p.oid = to_regprocedure('public.set_content_reel_live_enabled(uuid,boolean,boolean,uuid,text,text)');
    IF COALESCE(current_setting('content_reel.live_switch_rpc', true), '') <> 'on'
       OR v_owner IS NULL OR current_user IS DISTINCT FROM v_owner THEN
      RAISE EXCEPTION 'content_reel_guard:live_switch_rpc_only';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.clients_content_reel_live_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER clients_content_reel_live_guard
  BEFORE INSERT OR UPDATE OF content_reel_live_enabled ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_content_reel_live_guard();

-- ── 5. RPCs ──────────────────────────────────────────────────────────────────

-- 5.1 Prepare stage: register a copy (idempotent on id).
CREATE OR REPLACE FUNCTION public.content_reel_video_copy_start(
  p_id uuid, p_client_id uuid, p_content_post_id uuid, p_source_video_url text,
  p_copy_path text, p_requested_by_user_id uuid, p_prepared_by text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE v_existing public.content_reel_video_copies%ROWTYPE;
BEGIN
  SELECT * INTO v_existing FROM public.content_reel_video_copies WHERE id = p_id;
  IF FOUND THEN
    IF v_existing.client_id = p_client_id AND v_existing.content_post_id = p_content_post_id
       AND v_existing.source_video_url = p_source_video_url AND v_existing.copy_path = p_copy_path THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true, 'status', v_existing.status);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'copy_id_reused');
  END IF;

  PERFORM 1 FROM public.content_posts WHERE id = p_content_post_id AND client_id = p_client_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'post_not_found');
  END IF;

  INSERT INTO public.content_reel_video_copies
    (id, client_id, content_post_id, source_video_url, copy_path, requested_by_user_id, prepared_by)
  VALUES
    (p_id, p_client_id, p_content_post_id, p_source_video_url, p_copy_path, p_requested_by_user_id, p_prepared_by);
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'status', 'preparing');
END;
$fn$;

-- 5.2 Prepare stage: finalise a copy.
CREATE OR REPLACE FUNCTION public.content_reel_video_copy_finish(
  p_id uuid, p_status text, p_sha256 text, p_content_length bigint, p_error_code text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE v_row public.content_reel_video_copies%ROWTYPE;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('ready','failed') THEN
    RAISE EXCEPTION 'content_reel_rpc:invalid_copy_status:%', p_status;
  END IF;
  SELECT * INTO v_row FROM public.content_reel_video_copies WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'copy_not_found');
  END IF;
  IF v_row.status <> 'preparing' THEN
    IF v_row.status = p_status AND v_row.sha256 IS NOT DISTINCT FROM p_sha256 THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true, 'status', v_row.status);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'copy_already_finalized', 'status', v_row.status);
  END IF;
  UPDATE public.content_reel_video_copies
     SET status = p_status,
         sha256 = CASE WHEN p_status = 'ready' THEN p_sha256 ELSE NULL END,
         content_length = CASE WHEN p_status = 'ready' THEN p_content_length ELSE NULL END,
         error_code = CASE WHEN p_status = 'failed' THEN p_error_code ELSE NULL END
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'status', p_status);
END;
$fn$;

-- 5.3 Authorise a publish (spec v2.1 §3.2 ①).
CREATE OR REPLACE FUNCTION public.content_reel_authorize(
  p_authorization_id uuid, p_client_id uuid, p_content_post_id uuid, p_video_copy_id uuid,
  p_render_job_id uuid, p_mode_requested text, p_form_sha256 text, p_authorized_via text,
  p_authorized_by_user_id uuid, p_authorized_by_email text, p_prepared_by text,
  p_authorization jsonb, p_video_sha256 text, p_page_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_post     record;
  v_copy     public.content_reel_video_copies%ROWTYPE;
  v_existing public.content_reel_publish_attempts%ROWTYPE;
BEGIN
  SELECT id, client_id, status, source_video_url INTO v_post
    FROM public.content_posts
   WHERE id = p_content_post_id AND client_id = p_client_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'post_not_found');
  END IF;

  SELECT * INTO v_existing FROM public.content_reel_publish_attempts WHERE id = p_authorization_id;
  IF FOUND THEN
    IF v_existing.form_sha256 = p_form_sha256 AND v_existing.content_post_id = p_content_post_id THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true, 'state', v_existing.state);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'authorization_id_reused');
  END IF;

  IF v_post.status <> 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'post_state_changed', 'post_status', v_post.status);
  END IF;

  SELECT * INTO v_copy FROM public.content_reel_video_copies WHERE id = p_video_copy_id;
  IF NOT FOUND OR v_copy.content_post_id <> p_content_post_id OR v_copy.client_id <> p_client_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'video_copy_mismatch');
  END IF;
  IF v_copy.status <> 'ready' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'video_copy_not_ready');
  END IF;
  IF v_copy.sha256 IS DISTINCT FROM p_video_sha256 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'video_copy_mismatch');
  END IF;
  IF v_post.source_video_url IS DISTINCT FROM v_copy.source_video_url THEN
    RETURN jsonb_build_object('ok', false, 'code', 'video_changed_since_prepare');
  END IF;

  -- Allow-list: only jobs known to be finished let the post through; any other or
  -- future status counts as still rendering.
  PERFORM 1 FROM public.content_factory_render_jobs
   WHERE content_post_id = p_content_post_id
     AND status NOT IN ('ready_for_review','failed');
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'render_in_progress');
  END IF;

  PERFORM 1 FROM public.content_reel_publish_attempts
   WHERE content_post_id = p_content_post_id
     AND state IN ('authorized','claimed','uploading','in_doubt');
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'active_attempt_exists');
  END IF;

  PERFORM 1 FROM public.content_reel_publish_attempts
   WHERE content_post_id = p_content_post_id
     AND state IN ('published','removed_externally');
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'post_already_published');
  END IF;

  -- Serialise same-content authorisations for one client across different posts, so two
  -- concurrent calls cannot both miss each other's uncommitted attempt.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('content_reel_hash:' || p_client_id::text || ':' || COALESCE(p_video_sha256, ''), 0));

  -- Same video content for the same client inside 30 days (PM business window, spec §9).
  -- Unverified human confirmations do not count.
  PERFORM 1 FROM public.content_reel_publish_attempts
   WHERE client_id = p_client_id
     AND video_sha256 = p_video_sha256
     AND created_at > now() - interval '30 days'
     AND (state IN ('authorized','claimed','uploading','in_doubt')
          OR (state = 'published'
              AND (publish_confirmation = 'graph_get' OR publish_verified_at IS NOT NULL)));
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'duplicate_content_hash');
  END IF;

  BEGIN
    INSERT INTO public.content_reel_publish_attempts
      (id, client_id, content_post_id, video_copy_id, render_job_id, mode_requested, state,
       form_sha256, authorized_via, authorized_by_user_id, authorized_by_email, prepared_by,
       authorization_record, video_sha256, page_id)
    VALUES
      (p_authorization_id, p_client_id, p_content_post_id, p_video_copy_id, p_render_job_id,
       p_mode_requested, 'authorized', p_form_sha256, p_authorized_via, p_authorized_by_user_id,
       p_authorized_by_email, p_prepared_by, p_authorization, p_video_sha256, p_page_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'active_attempt_exists');
  END;

  UPDATE public.content_posts SET status = 'scheduled'
   WHERE id = p_content_post_id AND status = 'approved';

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'state', 'authorized');
END;
$fn$;

-- 5.4 State transition with optional patch (spec v2.1 §3.2 ②).
-- Evidence timestamps are set only through marker keys (touch_last_step / mark_absence /
-- mark_video_deleted …) and always carry now(); the trigger rejects anything else.
CREATE OR REPLACE FUNCTION public.content_reel_transition(
  p_id uuid, p_from text[], p_to text, p_patch jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_row        public.content_reel_publish_attempts%ROWTYPE;
  v_key        text;
  v_msg        text;
  v_constraint text;
  v_soft constant text[] := ARRAY[
    'claimed_too_recent','not_on_facebook_requires_deletion','absence_not_confirmed_twice',
    'last_write_too_recent','draft_deleted_requires_deletion'];
BEGIN
  IF p_id IS NULL OR p_from IS NULL OR cardinality(p_from) = 0
     OR array_position(p_from, NULL) IS NOT NULL OR p_to IS NULL OR length(p_to) = 0 THEN
    RAISE EXCEPTION 'content_reel_rpc:invalid_transition_arguments';
  END IF;

  p_patch := COALESCE(p_patch, '{}'::jsonb);
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('video_id','video_state','permalink','published_at','publish_confirmation',
                     'publish_confirmed_by_user_id','env_live_at_publish','rules_live_at_publish',
                     'error_code','error_detail','alert_code','first_comment_state',
                     'first_comment_verification_basis','provider_impact',
                     'touch_last_step','mark_absence','clear_absence','mark_video_deleted',
                     'mark_publish_verified','mark_first_comment_verified') THEN
      RAISE EXCEPTION 'content_reel_rpc:unknown_patch_key:%', v_key;
    END IF;
  END LOOP;

  SELECT * INTO v_row FROM public.content_reel_publish_attempts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'attempt_not_found');
  END IF;
  IF NOT (v_row.state = ANY (p_from)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'transition_lost', 'current_state', v_row.state);
  END IF;

  BEGIN
    UPDATE public.content_reel_publish_attempts SET
      state = p_to,
      video_id = CASE WHEN p_patch ? 'video_id' THEN p_patch->>'video_id' ELSE video_id END,
      video_state = CASE WHEN p_patch ? 'video_state' THEN p_patch->>'video_state' ELSE video_state END,
      permalink = CASE WHEN p_patch ? 'permalink' THEN p_patch->>'permalink' ELSE permalink END,
      published_at = CASE WHEN p_patch ? 'published_at' THEN (p_patch->>'published_at')::timestamptz ELSE published_at END,
      publish_confirmation = CASE WHEN p_patch ? 'publish_confirmation' THEN p_patch->>'publish_confirmation' ELSE publish_confirmation END,
      publish_confirmed_by_user_id = CASE WHEN p_patch ? 'publish_confirmed_by_user_id' THEN (p_patch->>'publish_confirmed_by_user_id')::uuid ELSE publish_confirmed_by_user_id END,
      env_live_at_publish = CASE WHEN p_patch ? 'env_live_at_publish' THEN (p_patch->>'env_live_at_publish')::boolean ELSE env_live_at_publish END,
      rules_live_at_publish = CASE WHEN p_patch ? 'rules_live_at_publish' THEN (p_patch->>'rules_live_at_publish')::boolean ELSE rules_live_at_publish END,
      error_code = CASE WHEN p_patch ? 'error_code' THEN p_patch->>'error_code' ELSE error_code END,
      error_detail = CASE WHEN p_patch ? 'error_detail' THEN p_patch->>'error_detail' ELSE error_detail END,
      alert_code = CASE WHEN p_patch ? 'alert_code' THEN p_patch->>'alert_code' ELSE alert_code END,
      first_comment_state = CASE WHEN p_patch ? 'first_comment_state' THEN p_patch->>'first_comment_state' ELSE first_comment_state END,
      first_comment_verification_basis = CASE WHEN p_patch ? 'first_comment_verification_basis' THEN p_patch->>'first_comment_verification_basis' ELSE first_comment_verification_basis END,
      provider_impact = CASE WHEN p_patch ? 'provider_impact' THEN p_patch->'provider_impact' ELSE provider_impact END,
      last_step_started_at = CASE WHEN (p_patch->>'touch_last_step')::boolean IS TRUE THEN now() ELSE last_step_started_at END,
      absence_first_confirmed_at = CASE
        -- entering a live/draft state wipes any stale absence evidence
        WHEN p_to <> v_row.state AND p_to IN ('published','draft_published') THEN NULL
        WHEN (p_patch->>'clear_absence')::boolean IS TRUE THEN NULL
        WHEN (p_patch->>'mark_absence')::boolean IS TRUE THEN COALESCE(absence_first_confirmed_at, now())
        ELSE absence_first_confirmed_at END,
      video_deleted_at = CASE WHEN (p_patch->>'mark_video_deleted')::boolean IS TRUE THEN now() ELSE video_deleted_at END,
      publish_verified_at = CASE WHEN (p_patch->>'mark_publish_verified')::boolean IS TRUE THEN now() ELSE publish_verified_at END,
      first_comment_verified_at = CASE WHEN (p_patch->>'mark_first_comment_verified')::boolean IS TRUE THEN now() ELSE first_comment_verified_at END,
      finished_at = CASE
        WHEN p_to <> v_row.state AND p_to IN ('cancelled','preflight_failed','not_on_facebook',
                                              'draft_published','draft_deleted','published','removed_externally')
          THEN now()
        ELSE finished_at END
    WHERE id = p_id;
  EXCEPTION
    WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      IF v_msg LIKE 'content_reel_guard:%' AND split_part(v_msg, ':', 2) = ANY (v_soft) THEN
        RETURN jsonb_build_object('ok', false, 'code', split_part(v_msg, ':', 2), 'current_state', v_row.state);
      END IF;
      RAISE;
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'content_reel_publish_attempts_video' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'video_id_conflict', 'current_state', v_row.state);
      ELSIF v_constraint = 'content_reel_publish_attempts_one_active' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'active_attempt_exists', 'current_state', v_row.state);
      END IF;
      RAISE;
  END;

  -- Card goes back to the "rendered" column so the video can be replaced and re-authorised,
  -- unless some other attempt on the same post is still in flight.
  IF p_to <> v_row.state AND p_to IN ('cancelled','preflight_failed','not_on_facebook','draft_published') THEN
    UPDATE public.content_posts cp SET status = 'approved'
     WHERE cp.id = v_row.content_post_id
       AND cp.status = 'scheduled'
       AND NOT EXISTS (
         SELECT 1 FROM public.content_reel_publish_attempts a
          WHERE a.content_post_id = v_row.content_post_id
            AND a.state IN ('authorized','claimed','uploading','in_doubt'));
  END IF;

  RETURN jsonb_build_object('ok', true, 'previous_state', v_row.state, 'state', p_to);
END;
$fn$;

-- 5.5 Mark the content post published (separate call from the receipt write, spec D10).
-- An unverified human confirmation never marks the post published (spec §4.5).
CREATE OR REPLACE FUNCTION public.content_reel_mark_post_published(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE v_row public.content_reel_publish_attempts%ROWTYPE; v_changed integer;
BEGIN
  SELECT * INTO v_row FROM public.content_reel_publish_attempts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'attempt_not_found');
  END IF;
  IF v_row.state <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'attempt_not_published', 'current_state', v_row.state);
  END IF;
  IF NOT (v_row.publish_confirmation = 'graph_get' OR v_row.publish_verified_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'publication_not_verified');
  END IF;
  UPDATE public.content_posts SET status = 'published', published_at = v_row.published_at
   WHERE id = v_row.content_post_id AND status IN ('scheduled','approved');
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'changed', v_changed > 0);
END;
$fn$;

-- 5.6 Atomic followup bookkeeping (allowed in every state by the guard's bookkeeping path).
CREATE OR REPLACE FUNCTION public.content_reel_followup_patch(p_id uuid, p_key text, p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE v_followup jsonb;
BEGIN
  IF p_key IS NULL OR p_key NOT IN ('books_written','published_event_ids','measurement_registered',
                   'draft_delete_results','last_error') THEN
    RAISE EXCEPTION 'content_reel_rpc:unknown_followup_key:%', p_key;
  END IF;
  UPDATE public.content_reel_publish_attempts
     SET followup = jsonb_set(followup, ARRAY[p_key], COALESCE(p_value, 'null'::jsonb), true)
   WHERE id = p_id
  RETURNING followup INTO v_followup;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'attempt_not_found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'followup', v_followup);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.content_reel_append_event_id(p_id uuid, p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE v_ids text[];
BEGIN
  IF p_event_id IS NULL OR length(p_event_id) = 0 THEN
    RAISE EXCEPTION 'content_reel_rpc:empty_event_id';
  END IF;
  UPDATE public.content_reel_publish_attempts
     SET trigger_event_ids = CASE WHEN p_event_id = ANY (trigger_event_ids)
                                  THEN trigger_event_ids
                                  ELSE array_append(trigger_event_ids, p_event_id) END
   WHERE id = p_id
  RETURNING trigger_event_ids INTO v_ids;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'attempt_not_found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'trigger_event_ids', to_jsonb(v_ids));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.content_reel_next_restart_seq(p_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE v_seq integer;
BEGIN
  UPDATE public.content_reel_publish_attempts SET restart_seq = restart_seq + 1
   WHERE id = p_id RETURNING restart_seq INTO v_seq;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'content_reel_rpc:attempt_not_found';
  END IF;
  RETURN v_seq;
END;
$fn$;

-- 5.7 Abandon a content post (spec v2.1 §3.4 step 12).
CREATE OR REPLACE FUNCTION public.content_reel_abandon_post(p_client_id uuid, p_content_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.content_posts
   WHERE id = p_content_post_id AND client_id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'post_not_found');
  END IF;
  IF EXISTS (SELECT 1 FROM public.content_reel_publish_attempts
              WHERE content_post_id = p_content_post_id
                AND state IN ('authorized','claimed','uploading','in_doubt')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'active_attempt_exists');
  END IF;
  IF EXISTS (SELECT 1 FROM public.content_reel_publish_attempts
              WHERE content_post_id = p_content_post_id AND state = 'published') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'post_already_published');
  END IF;
  IF EXISTS (SELECT 1 FROM public.content_reel_publish_attempts
              WHERE content_post_id = p_content_post_id AND state = 'draft_published') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'drafts_not_deleted');
  END IF;
  IF v_status NOT IN ('draft','approved','scheduled','rejected') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'post_state_changed', 'post_status', v_status);
  END IF;
  UPDATE public.content_posts SET status = 'rejected' WHERE id = p_content_post_id;
  RETURN jsonb_build_object('ok', true, 'previous_status', v_status);
END;
$fn$;

-- 5.8 Per-client live switch: expected-old-value CAS + audit row.
CREATE OR REPLACE FUNCTION public.set_content_reel_live_enabled(
  p_client_id uuid, p_expected_old boolean, p_new boolean,
  p_user_id uuid, p_email text, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE v_current boolean;
BEGIN
  IF p_client_id IS NULL OR p_expected_old IS NULL OR p_new IS NULL OR p_user_id IS NULL
     OR p_email IS NULL OR length(p_email) = 0 THEN
    RAISE EXCEPTION 'content_reel_rpc:live_switch_missing_argument';
  END IF;
  SELECT content_reel_live_enabled INTO v_current FROM public.clients
   WHERE id = p_client_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'client_not_found');
  END IF;
  IF v_current IS DISTINCT FROM p_expected_old THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale', 'current', v_current);
  END IF;
  IF v_current = p_new THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'current', v_current);
  END IF;

  PERFORM set_config('content_reel.live_switch_rpc', 'on', true);
  UPDATE public.clients SET content_reel_live_enabled = p_new WHERE id = p_client_id;
  PERFORM set_config('content_reel.live_switch_rpc', 'off', true);

  INSERT INTO public.content_reel_live_switch_events
    (client_id, old_value, new_value, changed_by_user_id, changed_by_email, reason)
  VALUES (p_client_id, v_current, p_new, p_user_id, p_email, p_reason);

  RETURN jsonb_build_object('ok', true, 'changed', true, 'current', p_new);
END;
$fn$;

-- ── 6. Function privileges: service_role only ────────────────────────────────
-- 🔴 db-invariants 不变量 4：REVOKE FROM PUBLIC 在 Supabase 上收不干净 ——
--    anon/authenticated 由 ALTER DEFAULT PRIVILEGES 独立授权，必须显式撤。

REVOKE ALL ON FUNCTION public.content_reel_video_copy_start(uuid, uuid, uuid, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_reel_video_copy_start(uuid, uuid, uuid, text, text, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.content_reel_video_copy_finish(uuid, text, text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_reel_video_copy_finish(uuid, text, text, bigint, text) TO service_role;

REVOKE ALL ON FUNCTION public.content_reel_authorize(uuid, uuid, uuid, uuid, uuid, text, text, text, uuid, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_reel_authorize(uuid, uuid, uuid, uuid, uuid, text, text, text, uuid, text, text, jsonb, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.content_reel_transition(uuid, text[], text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_reel_transition(uuid, text[], text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.content_reel_mark_post_published(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_reel_mark_post_published(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.content_reel_followup_patch(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_reel_followup_patch(uuid, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.content_reel_append_event_id(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_reel_append_event_id(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.content_reel_next_restart_seq(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_reel_next_restart_seq(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.content_reel_abandon_post(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_reel_abandon_post(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.set_content_reel_live_enabled(uuid, boolean, boolean, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_content_reel_live_enabled(uuid, boolean, boolean, uuid, text, text) TO service_role;
