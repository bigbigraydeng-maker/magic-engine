-- ============================================================================
-- content_reel_publish_attempts — behaviour probes on a real Postgres
-- (spec docs/specs/2026-09-15-creatomate-reel-publish-spec-v2.md v2.1 §3, PR-A)
--
-- Reading the SQL is not evidence. Every rule the publish pipeline will rely on
-- (legal transitions, terminal states never roll back, one active attempt per
-- post, the 30-minute / deletion / double-absence evidence for "not on
-- Facebook", the live-switch CAS + audit row, privileges) is exercised here.
--
-- Run through scripts/content-reel-publish-db-check.sh (replays every migration
-- into a throwaway database first). The whole file runs in one transaction and
-- ROLLBACKs; the final DO block raises if any probe failed, so psql exits 3.
-- ============================================================================

\set ON_ERROR_STOP off
\pset pager off

BEGIN;
\o /dev/null

CREATE TEMP TABLE probe_results(seq serial, name text, passed boolean, detail text);

CREATE OR REPLACE FUNCTION pg_temp.record(p_name text, p_passed boolean, p_detail text)
RETURNS void LANGUAGE sql AS $$ INSERT INTO probe_results(name, passed, detail) VALUES (p_name, p_passed, p_detail) $$;

-- statement returns jsonb; expect ok=true
CREATE OR REPLACE FUNCTION pg_temp.expect_ok(p_name text, p_stmt text)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE r jsonb;
BEGIN
  EXECUTE p_stmt INTO r;
  PERFORM pg_temp.record(p_name, (r->>'ok')::boolean IS TRUE, left(r::text, 120));
  RETURN r;
EXCEPTION WHEN others THEN
  PERFORM pg_temp.record(p_name, false, 'raised: ' || left(SQLERRM, 110));
  RETURN NULL;
END;
$fn$;

-- statement returns jsonb; expect ok=false with this code
CREATE OR REPLACE FUNCTION pg_temp.expect_code(p_name text, p_stmt text, p_code text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE r jsonb;
BEGIN
  EXECUTE p_stmt INTO r;
  PERFORM pg_temp.record(p_name, (r->>'ok')::boolean IS FALSE AND r->>'code' = p_code, left(r::text, 120));
EXCEPTION WHEN others THEN
  PERFORM pg_temp.record(p_name, false, 'raised: ' || left(SQLERRM, 110));
END;
$fn$;

-- statement must raise, with this fragment in the message
CREATE OR REPLACE FUNCTION pg_temp.expect_raise(p_name text, p_stmt text, p_fragment text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    EXECUTE p_stmt;
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.record(p_name, position(p_fragment in SQLERRM) > 0, left(SQLERRM, 120));
    RETURN;
  END;
  PERFORM pg_temp.record(p_name, false, 'expected an error containing "' || p_fragment || '", statement succeeded');
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.expect_true(p_name text, p_sql text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v boolean;
BEGIN
  EXECUTE p_sql INTO v;
  PERFORM pg_temp.record(p_name, v IS TRUE, p_sql);
EXCEPTION WHEN others THEN
  PERFORM pg_temp.record(p_name, false, 'raised: ' || left(SQLERRM, 110));
END;
$fn$;

-- run a statement as another role (e.g. service_role); must raise with fragment
CREATE OR REPLACE FUNCTION pg_temp.expect_raise_as(p_role text, p_name text, p_stmt text, p_fragment text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_err text;
BEGIN
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_stmt;
  EXCEPTION WHEN others THEN
    v_err := SQLERRM;
  END;
  RESET ROLE;
  IF v_err IS NULL THEN
    PERFORM pg_temp.record(p_name, false, 'expected an error containing "' || p_fragment || '", statement succeeded as ' || p_role);
  ELSE
    PERFORM pg_temp.record(p_name, position(p_fragment in v_err) > 0, left(v_err, 120));
  END IF;
END;
$fn$;

-- run a jsonb-returning statement as another role; expect ok=true
CREATE OR REPLACE FUNCTION pg_temp.expect_ok_as(p_role text, p_name text, p_stmt text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE r jsonb; v_err text;
BEGIN
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_stmt INTO r;
  EXCEPTION WHEN others THEN
    v_err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp.record(p_name, v_err IS NULL AND (r->>'ok')::boolean IS TRUE, COALESCE('raised: ' || left(v_err, 110), left(r::text, 120)));
END;
$fn$;

-- Backdate evidence timestamps (simulates time passing). Guard trigger is
-- disabled only for this statement; every probe that consumes the evidence
-- runs with the guard enabled.
CREATE OR REPLACE FUNCTION pg_temp.backdate(p_id uuid, p_col text, p_minutes int)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  ALTER TABLE public.content_reel_publish_attempts DISABLE TRIGGER content_reel_publish_attempts_guard;
  EXECUTE format('UPDATE public.content_reel_publish_attempts SET %I = now() - make_interval(mins => %s) WHERE id = %L',
                 p_col, p_minutes, p_id);
  ALTER TABLE public.content_reel_publish_attempts ENABLE TRIGGER content_reel_publish_attempts_guard;
END;
$fn$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- client C1, posts P1..P7, hashes H1 (shared by P1/P3) H2 H4 H5 H6 H7
INSERT INTO public.clients (id, name) VALUES ('c1000000-0000-0000-0000-000000000001', 'Probe Reel Client')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.content_posts (id, client_id, title, route, platforms, status, source_video_url) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'P1', 'route_a', '{}', 'approved', 'https://x/p1.mp4'),
  ('a1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'P2', 'route_a', '{}', 'approved', 'https://x/p2.mp4'),
  ('a1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', 'P3', 'route_a', '{}', 'approved', 'https://x/p3.mp4'),
  ('a1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000001', 'P4', 'route_a', '{}', 'approved', 'https://x/p4.mp4'),
  ('a1000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000001', 'P5', 'route_a', '{}', 'approved', 'https://x/p5.mp4'),
  ('a1000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-000000000001', 'P6', 'route_a', '{}', 'approved', 'https://x/p6.mp4'),
  ('a1000000-0000-0000-0000-000000000007', 'c1000000-0000-0000-0000-000000000001', 'P7', 'route_a', '{}', 'approved', 'https://x/p7.mp4');

\set H1 '''1111111111111111111111111111111111111111111111111111111111111111'''
\set H2 '''2222222222222222222222222222222222222222222222222222222222222222'''
\set H4 '''4444444444444444444444444444444444444444444444444444444444444444'''
\set H5 '''5555555555555555555555555555555555555555555555555555555555555555'''
\set H6 '''6666666666666666666666666666666666666666666666666666666666666666'''
\set H7 '''7777777777777777777777777777777777777777777777777777777777777777'''
\set F1 '''f111111111111111111111111111111111111111111111111111111111111111'''
\set F2 '''f222222222222222222222222222222222222222222222222222222222222222'''
\set U  '''e1000000-0000-0000-0000-000000000001'''

-- helper to authorise: attempt id, post suffix, copy id, hash, form hash
CREATE OR REPLACE FUNCTION pg_temp.auth_stmt(p_attempt text, p_post text, p_copy text, p_hash text, p_form text, p_mode text DEFAULT 'live')
RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT public.content_reel_authorize(%L::uuid,'c1000000-0000-0000-0000-000000000001'::uuid,%L::uuid,%L::uuid,NULL,%L,%L,'ui_click','e1000000-0000-0000-0000-000000000001'::uuid,'staff@example.com','human','{"schema_version":2}'::jsonb,%L,'1616575215312482')$q$,
                p_attempt, p_post, p_copy, p_mode, p_form, p_hash)
$$;

CREATE OR REPLACE FUNCTION pg_temp.copy_ready(p_copy text, p_post text, p_url text, p_hash text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.content_reel_video_copy_start(p_copy::uuid, 'c1000000-0000-0000-0000-000000000001', p_post::uuid, p_url,
          'content-factory/c1/authorized/' || p_copy || '.mp4', 'e1000000-0000-0000-0000-000000000001', 'agent');
  PERFORM public.content_reel_video_copy_finish(p_copy::uuid, 'ready', p_hash, 1000, NULL);
END $$;

-- ── A. Video copies ─────────────────────────────────────────────────────────
SELECT pg_temp.expect_ok('A01 copy start',
  $$SELECT public.content_reel_video_copy_start('b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','https://x/p1.mp4','content-factory/c1/authorized/k1.mp4','e1000000-0000-0000-0000-000000000001','agent')$$);
SELECT pg_temp.expect_true('A02 copy start is idempotent on same inputs',
  $$SELECT (public.content_reel_video_copy_start('b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','https://x/p1.mp4','content-factory/c1/authorized/k1.mp4','e1000000-0000-0000-0000-000000000001','agent')->>'duplicate')::boolean$$);
SELECT pg_temp.expect_code('A03 copy id reused with other inputs refused',
  $$SELECT public.content_reel_video_copy_start('b1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','https://x/OTHER.mp4','content-factory/c1/authorized/k1.mp4','e1000000-0000-0000-0000-000000000001','agent')$$, 'copy_id_reused');
SELECT pg_temp.expect_code('A04 copy start for a post of another client refused',
  $$SELECT public.content_reel_video_copy_start('b1000000-0000-0000-0000-0000000000ff','c0000000-0000-0000-0000-00000000dead','a1000000-0000-0000-0000-000000000001','https://x/p1.mp4','content-factory/c1/authorized/kff.mp4','e1000000-0000-0000-0000-000000000001','agent')$$, 'post_not_found');
SELECT pg_temp.expect_raise('A05 ready copy without valid sha256 refused',
  $$SELECT public.content_reel_video_copy_finish('b1000000-0000-0000-0000-000000000001','ready','not-a-hash',1000,NULL)$$, 'content_reel_video_copies_sha256_check');
SELECT pg_temp.expect_ok('A06 copy finish ready',
  format($$SELECT public.content_reel_video_copy_finish('b1000000-0000-0000-0000-000000000001','ready',%L,1000,NULL)$$, :H1));
SELECT pg_temp.expect_code('A07 finalised copy cannot be re-finalised differently',
  $$SELECT public.content_reel_video_copy_finish('b1000000-0000-0000-0000-000000000001','failed',NULL,NULL,'x')$$, 'copy_already_finalized');
SELECT pg_temp.expect_raise('A08 direct UPDATE of a finalised copy refused',
  $$UPDATE public.content_reel_video_copies SET source_video_url='https://evil' WHERE id='b1000000-0000-0000-0000-000000000001'$$, 'copy_already_finalized');
SELECT pg_temp.expect_raise('A09 copies are append-only',
  $$DELETE FROM public.content_reel_video_copies WHERE id='b1000000-0000-0000-0000-000000000001'$$, 'video_copies_are_append_only');

SELECT pg_temp.copy_ready('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000003', 'https://x/p3.mp4', :H1);
SELECT pg_temp.copy_ready('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000004', 'https://x/p4.mp4', :H4);
SELECT pg_temp.copy_ready('b1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000005', 'https://x/p5.mp4', :H5);
SELECT pg_temp.copy_ready('b1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000006', 'https://x/p6.mp4', :H6);
SELECT pg_temp.copy_ready('b1000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000007', 'https://x/p7.mp4', :H7);
SELECT public.content_reel_video_copy_start('b1000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000002','https://x/p2.mp4','content-factory/c1/authorized/k2.mp4','e1000000-0000-0000-0000-000000000001','agent');

-- ── B. Authorise ────────────────────────────────────────────────────────────
SELECT pg_temp.expect_code('B01 copy not ready refused',
  pg_temp.auth_stmt('d1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000002',:H2,:F1), 'video_copy_not_ready');
SELECT pg_temp.expect_ok('B02 authorise P1',
  pg_temp.auth_stmt('d1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',:H1,:F1));
SELECT pg_temp.expect_true('B03 post moved approved -> scheduled',
  $$SELECT status='scheduled' FROM public.content_posts WHERE id='a1000000-0000-0000-0000-000000000001'$$);
SELECT pg_temp.expect_true('B04 same id + same form hash returns duplicate',
  format($$SELECT ((%s)::jsonb->>'duplicate')::boolean$$, '(' || pg_temp.auth_stmt('d1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',:H1,:F1) || ')'));
SELECT pg_temp.expect_code('B05 same id + different form hash refused',
  pg_temp.auth_stmt('d1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',:H1,:F2), 'authorization_id_reused');
SELECT pg_temp.expect_code('B06 second authorisation while post scheduled refused',
  pg_temp.auth_stmt('d1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',:H1,:F2), 'post_state_changed');
UPDATE public.content_posts SET status='approved' WHERE id='a1000000-0000-0000-0000-000000000001';
SELECT pg_temp.expect_code('B07 active attempt on the same post refused even if post status was reset',
  pg_temp.auth_stmt('d1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',:H1,:F2), 'active_attempt_exists');
UPDATE public.content_posts SET status='scheduled' WHERE id='a1000000-0000-0000-0000-000000000001';
SELECT pg_temp.expect_raise('B08 partial unique index: direct second active insert refused',
  format($$INSERT INTO public.content_reel_publish_attempts (id, client_id, content_post_id, video_copy_id, mode_requested, state, form_sha256, authorized_via, authorized_by_user_id, authorized_by_email, prepared_by, authorization_record, video_sha256, page_id)
           VALUES ('d1000000-0000-0000-0000-0000000000b8','c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','live','authorized',%L,'ui_click',%L,'s@e.com','human','{}',%L,'1616575215312482')$$, :F2, :U, :H1),
  'content_reel_publish_attempts_one_active');
SELECT pg_temp.expect_code('B09 same video hash for same client within 30 days refused',
  pg_temp.auth_stmt('d1000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000003','b1000000-0000-0000-0000-000000000003',:H1,:F1), 'duplicate_content_hash');
UPDATE public.content_posts SET source_video_url='https://x/p4-CHANGED.mp4' WHERE id='a1000000-0000-0000-0000-000000000004';
SELECT pg_temp.expect_code('B10 source video changed since prepare refused',
  pg_temp.auth_stmt('d1000000-0000-0000-0000-000000000004','a1000000-0000-0000-0000-000000000004','b1000000-0000-0000-0000-000000000004',:H4,:F1), 'video_changed_since_prepare');
UPDATE public.content_posts SET source_video_url='https://x/p4.mp4' WHERE id='a1000000-0000-0000-0000-000000000004';
INSERT INTO public.content_factory_render_jobs (client_id, content_post_id, status)
VALUES ('c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000004','rendering');
SELECT pg_temp.expect_code('B11 render in progress refused',
  pg_temp.auth_stmt('d1000000-0000-0000-0000-000000000004','a1000000-0000-0000-0000-000000000004','b1000000-0000-0000-0000-000000000004',:H4,:F1), 'render_in_progress');
UPDATE public.content_factory_render_jobs SET status='ready_for_review' WHERE content_post_id='a1000000-0000-0000-0000-000000000004';
SELECT pg_temp.expect_code('B12 copy of another post refused',
  pg_temp.auth_stmt('d1000000-0000-0000-0000-000000000004','a1000000-0000-0000-0000-000000000004','b1000000-0000-0000-0000-000000000005',:H5,:F1), 'video_copy_mismatch');
SELECT pg_temp.expect_raise('B13 insert of a non-authorized row refused by guard',
  format($$INSERT INTO public.content_reel_publish_attempts (id, client_id, content_post_id, video_copy_id, mode_requested, state, form_sha256, authorized_via, authorized_by_user_id, authorized_by_email, prepared_by, authorization_record, video_sha256, page_id)
           VALUES ('d1000000-0000-0000-0000-0000000000b9','c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000001','live','published',%L,'ui_click',%L,'s@e.com','human','{}',%L,'1616575215312482')$$, :F2, :U, :H2),
  'insert_must_be_clean_authorized');

-- ── C. Transitions on A1 (P1): full video path to not_on_facebook ─────────────
\set A1 '''d1000000-0000-0000-0000-000000000001'''
SELECT pg_temp.expect_code('C01 transition_lost when current state not in expected set',
  format($$SELECT public.content_reel_transition(%L, ARRAY['claimed'], 'uploading', '{}')$$, :A1), 'transition_lost');
SELECT pg_temp.expect_raise('C02 illegal transition authorized -> published raises',
  format($$SELECT public.content_reel_transition(%L, ARRAY['authorized'], 'published', '{}')$$, :A1), 'illegal_transition:authorized->published');
SELECT pg_temp.expect_raise('C03 unknown patch key raises',
  format($$SELECT public.content_reel_transition(%L, ARRAY['authorized'], 'claimed', '{"last_step_started_at":"2000-01-01T00:00:00Z"}')$$, :A1), 'unknown_patch_key');
SELECT pg_temp.expect_ok('C04 authorized -> claimed',
  format($$SELECT public.content_reel_transition(%L, ARRAY['authorized'], 'claimed', '{"touch_last_step":true}')$$, :A1));
SELECT pg_temp.expect_raise('C05 claimed -> uploading without video_id raises',
  format($$SELECT public.content_reel_transition(%L, ARRAY['claimed'], 'uploading', '{"touch_last_step":true}')$$, :A1), 'uploading_requires_video_id');
SELECT pg_temp.expect_raise('C06 video_id cannot be written without starting upload',
  format($$SELECT public.content_reel_transition(%L, ARRAY['claimed'], 'claimed', '{"video_id":"2259550698170001"}')$$, :A1), 'video_id_only_on_upload_start');
SELECT pg_temp.expect_ok('C07 claimed -> uploading with video_id',
  format($$SELECT public.content_reel_transition(%L, ARRAY['claimed'], 'uploading', '{"video_id":"2259550698170001","touch_last_step":true}')$$, :A1));
SELECT pg_temp.expect_raise('C08 video_id is immutable once written',
  format($$SELECT public.content_reel_transition(%L, ARRAY['uploading'], 'uploading', '{"video_id":"2259550698179999"}')$$, :A1), 'video_id_immutable');
SELECT pg_temp.expect_raise('C09 published without receipt raises',
  format($$SELECT public.content_reel_transition(%L, ARRAY['uploading'], 'published', '{}')$$, :A1), 'published_requires_receipt');
SELECT pg_temp.expect_ok('C10 uploading -> in_doubt',
  format($$SELECT public.content_reel_transition(%L, ARRAY['uploading'], 'in_doubt', '{"error_code":"finish_failed_after_start"}')$$, :A1));
SELECT pg_temp.expect_raise('C10b partial unique index also blocks a second attempt while one is in_doubt',
  format($$INSERT INTO public.content_reel_publish_attempts (id, client_id, content_post_id, video_copy_id, mode_requested, state, form_sha256, authorized_via, authorized_by_user_id, authorized_by_email, prepared_by, authorization_record, video_sha256, page_id)
           VALUES ('d1000000-0000-0000-0000-0000000000c0','c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','live','authorized',%L,'ui_click',%L,'s@e.com','human','{}',%L,'1616575215312482')$$, :F2, :U, :H2),
  'content_reel_publish_attempts_one_active');
SELECT pg_temp.expect_code('C11 not_on_facebook without a deletion record refused',
  format($$SELECT public.content_reel_transition(%L, ARRAY['in_doubt'], 'not_on_facebook', '{}')$$, :A1), 'not_on_facebook_requires_deletion');
SELECT pg_temp.backdate(:A1::uuid, 'last_step_started_at', 45);
SELECT pg_temp.expect_ok('C12 record absence evidence BEFORE deletion (must not count)',
  format($$SELECT public.content_reel_transition(%L, ARRAY['in_doubt'], 'in_doubt', '{"mark_absence":true}')$$, :A1));
SELECT pg_temp.backdate(:A1::uuid, 'absence_first_confirmed_at', 20);
SELECT pg_temp.expect_ok('C13 mark video deleted',
  format($$SELECT public.content_reel_transition(%L, ARRAY['in_doubt'], 'in_doubt', '{"mark_video_deleted":true}')$$, :A1));
SELECT pg_temp.expect_code('C14 absence recorded before deletion does not satisfy the rule',
  format($$SELECT public.content_reel_transition(%L, ARRAY['in_doubt'], 'not_on_facebook', '{}')$$, :A1), 'absence_not_confirmed_twice');
SELECT pg_temp.expect_ok('C15 clear + re-mark absence after deletion',
  format($$SELECT public.content_reel_transition(%L, ARRAY['in_doubt'], 'in_doubt', '{"clear_absence":true}')$$, :A1));
SELECT pg_temp.backdate(:A1::uuid, 'video_deleted_at', 12);
SELECT pg_temp.expect_ok('C16 mark absence after deletion',
  format($$SELECT public.content_reel_transition(%L, ARRAY['in_doubt'], 'in_doubt', '{"mark_absence":true}')$$, :A1));
SELECT pg_temp.expect_code('C17 absence younger than 10 minutes refused',
  format($$SELECT public.content_reel_transition(%L, ARRAY['in_doubt'], 'not_on_facebook', '{}')$$, :A1), 'absence_not_confirmed_twice');
SELECT pg_temp.backdate(:A1::uuid, 'absence_first_confirmed_at', 11);
SELECT pg_temp.backdate(:A1::uuid, 'last_step_started_at', 29);
SELECT pg_temp.expect_code('C18 last Graph write 29 minutes ago refused (30-minute floor)',
  format($$SELECT public.content_reel_transition(%L, ARRAY['in_doubt'], 'not_on_facebook', '{}')$$, :A1), 'last_write_too_recent');
SELECT pg_temp.backdate(:A1::uuid, 'last_step_started_at', 31);
SELECT pg_temp.expect_ok('C19 deletion + two absences 10min apart + 31min since last write -> not_on_facebook',
  format($$SELECT public.content_reel_transition(%L, ARRAY['in_doubt'], 'not_on_facebook', '{}')$$, :A1));
SELECT pg_temp.expect_true('C20 post returned to approved in the same transaction',
  $$SELECT status='approved' FROM public.content_posts WHERE id='a1000000-0000-0000-0000-000000000001'$$);
SELECT pg_temp.expect_raise('C21 terminal not_on_facebook cannot roll back to in_doubt',
  format($$SELECT public.content_reel_transition(%L, ARRAY['not_on_facebook'], 'in_doubt', '{}')$$, :A1), 'illegal_transition:not_on_facebook->in_doubt');
SELECT pg_temp.expect_raise('C22 terminal not_on_facebook cannot go back to authorized (direct UPDATE)',
  format($$UPDATE public.content_reel_publish_attempts SET state='authorized' WHERE id=%L$$, :A1), 'illegal_transition:not_on_facebook->authorized');
SELECT pg_temp.expect_raise('C23 authorization record is immutable',
  format($$UPDATE public.content_reel_publish_attempts SET authorization_record='{"forged":true}' WHERE id=%L$$, :A1), 'immutable_column');
SELECT pg_temp.expect_raise('C24 attempts are append-only',
  format($$DELETE FROM public.content_reel_publish_attempts WHERE id=%L$$, :A1), 'attempts_are_append_only');
SELECT pg_temp.expect_raise('C25 content post with attempts cannot be deleted (FK RESTRICT)',
  $$DELETE FROM public.content_posts WHERE id='a1000000-0000-0000-0000-000000000001'$$, 'content_reel');

-- ── D. Claimed without video_id (P4) ─────────────────────────────────────────
\set A4 '''d1000000-0000-0000-0000-000000000004'''
SELECT pg_temp.expect_ok('D01 authorise P4', pg_temp.auth_stmt('d1000000-0000-0000-0000-000000000004','a1000000-0000-0000-0000-000000000004','b1000000-0000-0000-0000-000000000004',:H4,:F1));
SELECT pg_temp.expect_raise('D02 authorized -> not_on_facebook is not a legal shortcut',
  format($$SELECT public.content_reel_transition(%L, ARRAY['authorized'], 'not_on_facebook', '{}')$$, :A4), 'illegal_transition:authorized->not_on_facebook');
SELECT pg_temp.expect_ok('D03 claim P4', format($$SELECT public.content_reel_transition(%L, ARRAY['authorized'], 'claimed', '{"touch_last_step":true}')$$, :A4));
SELECT pg_temp.expect_code('D04 claimed without video 1 minute old refused',
  format($$SELECT public.content_reel_transition(%L, ARRAY['claimed'], 'not_on_facebook', '{}')$$, :A4), 'claimed_too_recent');
SELECT pg_temp.backdate(:A4::uuid, 'last_step_started_at', 6);
SELECT pg_temp.expect_ok('D05 claimed without video 6 minutes old -> not_on_facebook',
  format($$SELECT public.content_reel_transition(%L, ARRAY['claimed'], 'not_on_facebook', '{}')$$, :A4));

-- ── E. Published paths (P5 graph_get, P6 human_confirmed) ────────────────────
\set A5 '''d1000000-0000-0000-0000-000000000005'''
SELECT pg_temp.expect_ok('E01 authorise P5', pg_temp.auth_stmt('d1000000-0000-0000-0000-000000000005','a1000000-0000-0000-0000-000000000005','b1000000-0000-0000-0000-000000000005',:H5,:F1));
SELECT public.content_reel_transition(:A5, ARRAY['authorized'], 'claimed', '{"touch_last_step":true}');
SELECT public.content_reel_transition(:A5, ARRAY['claimed'], 'uploading', '{"video_id":"2259550698170005","touch_last_step":true}');
SELECT pg_temp.expect_raise('E02 graph_get published requires verified timestamp',
  format($$SELECT public.content_reel_transition(%L, ARRAY['uploading'], 'published', '{"video_state":"PUBLISHED","published_at":"2026-09-15T00:00:00Z","publish_confirmation":"graph_get"}')$$, :A5), 'graph_get_requires_verified_at');
SELECT pg_temp.expect_ok('E03 uploading -> published (graph_get)',
  format($$SELECT public.content_reel_transition(%L, ARRAY['uploading'], 'published', '{"video_state":"PUBLISHED","published_at":"2026-09-15T00:00:00Z","publish_confirmation":"graph_get","mark_publish_verified":true,"permalink":"https://www.facebook.com/reel/2259550698170005/"}')$$, :A5));
SELECT pg_temp.expect_ok('E04 mark post published', format($$SELECT public.content_reel_mark_post_published(%L)$$, :A5));
SELECT pg_temp.expect_true('E05 post status published', $$SELECT status='published' FROM public.content_posts WHERE id='a1000000-0000-0000-0000-000000000005'$$);
UPDATE public.content_posts SET status='approved' WHERE id='a1000000-0000-0000-0000-000000000005';
SELECT public.content_reel_video_copy_start('b1000000-0000-0000-0000-000000000055','c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000005','https://x/p5.mp4','content-factory/c1/authorized/k55.mp4','e1000000-0000-0000-0000-000000000001','agent');
SELECT public.content_reel_video_copy_finish('b1000000-0000-0000-0000-000000000055','ready','5555555555555555555555555555555555555555555555555555555555555556',1000,NULL);
SELECT pg_temp.expect_code('E06 post that already has a published attempt refused',
  pg_temp.auth_stmt('d1000000-0000-0000-0000-0000000000e6','a1000000-0000-0000-0000-000000000005','b1000000-0000-0000-0000-000000000055','5555555555555555555555555555555555555555555555555555555555555556',:F2), 'post_already_published');
SELECT pg_temp.expect_raise('E07 verified graph_get publication cannot be reopened',
  format($$SELECT public.content_reel_transition(%L, ARRAY['published'], 'in_doubt', '{}')$$, :A5), 'only_unverified_human_confirmation_can_reopen');
SELECT pg_temp.expect_ok('E08 record absence on published', format($$SELECT public.content_reel_transition(%L, ARRAY['published'], 'published', '{"mark_absence":true}')$$, :A5));
SELECT pg_temp.expect_code('E09 removed_externally with fresh absence refused',
  format($$SELECT public.content_reel_transition(%L, ARRAY['published'], 'removed_externally', '{}')$$, :A5), 'absence_not_confirmed_twice');
SELECT pg_temp.backdate(:A5::uuid, 'absence_first_confirmed_at', 11);
SELECT pg_temp.backdate(:A5::uuid, 'last_step_started_at', 31);
SELECT pg_temp.expect_code('E09a removed_externally: absence recorded before the publication mark does not count',
  format($$SELECT public.content_reel_transition(%L, ARRAY['published'], 'removed_externally', '{}')$$, :A5), 'absence_not_confirmed_twice');
SELECT pg_temp.backdate(:A5::uuid, 'created_at', 60);
SELECT pg_temp.backdate(:A5::uuid, 'finished_at', 20);
SELECT pg_temp.backdate(:A5::uuid, 'publish_verified_at', 20);
SELECT pg_temp.expect_code('E09b removed_externally 30-minute floor counts the latest verification, not only the last Graph write',
  format($$SELECT public.content_reel_transition(%L, ARRAY['published'], 'removed_externally', '{}')$$, :A5), 'last_write_too_recent');
SELECT pg_temp.backdate(:A5::uuid, 'finished_at', 35);
SELECT pg_temp.backdate(:A5::uuid, 'publish_verified_at', 35);
SELECT pg_temp.expect_ok('E10 published -> removed_externally after double absence',
  format($$SELECT public.content_reel_transition(%L, ARRAY['published'], 'removed_externally', '{}')$$, :A5));
UPDATE public.content_posts SET status='approved' WHERE id='a1000000-0000-0000-0000-000000000005';
SELECT public.content_reel_video_copy_start('b1000000-0000-0000-0000-000000000056','c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000005','https://x/p5.mp4','content-factory/c1/authorized/k56.mp4','e1000000-0000-0000-0000-000000000001','agent');
SELECT public.content_reel_video_copy_finish('b1000000-0000-0000-0000-000000000056','ready','5555555555555555555555555555555555555555555555555555555555555557',1000,NULL);
SELECT pg_temp.expect_code('E10b removed_externally still blocks re-authorising the same card',
  pg_temp.auth_stmt('d1000000-0000-0000-0000-0000000000e7','a1000000-0000-0000-0000-000000000005','b1000000-0000-0000-0000-000000000056','5555555555555555555555555555555555555555555555555555555555555557',:F2), 'post_already_published');
SELECT pg_temp.expect_raise('E11 removed_externally is terminal',
  format($$SELECT public.content_reel_transition(%L, ARRAY['removed_externally'], 'published', '{}')$$, :A5), 'illegal_transition:removed_externally->published');

\set A6 '''d1000000-0000-0000-0000-000000000006'''
SELECT pg_temp.expect_ok('E12 authorise P6', pg_temp.auth_stmt('d1000000-0000-0000-0000-000000000006','a1000000-0000-0000-0000-000000000006','b1000000-0000-0000-0000-000000000006',:H6,:F1));
SELECT public.content_reel_transition(:A6, ARRAY['authorized'], 'claimed', '{"touch_last_step":true}');
SELECT public.content_reel_transition(:A6, ARRAY['claimed'], 'uploading', '{"video_id":"2259550698170006","touch_last_step":true}');
SELECT public.content_reel_transition(:A6, ARRAY['uploading'], 'in_doubt', '{}');
SELECT pg_temp.expect_raise('E13 human_confirmed requires the confirmer',
  format($$SELECT public.content_reel_transition(%L, ARRAY['in_doubt'], 'published', '{"video_state":"PUBLISHED","published_at":"2026-09-15T00:00:00Z","publish_confirmation":"human_confirmed"}')$$, :A6), 'human_confirmed_requires_confirmer');
SELECT pg_temp.expect_ok('E14 in_doubt -> published (human_confirmed)',
  format($$SELECT public.content_reel_transition(%L, ARRAY['in_doubt'], 'published', '{"video_state":"PUBLISHED","published_at":"2026-09-15T00:00:00Z","publish_confirmation":"human_confirmed","publish_confirmed_by_user_id":"e1000000-0000-0000-0000-000000000001"}')$$, :A6));
SELECT pg_temp.expect_ok('E15 unverified human confirmation can be reopened to in_doubt',
  format($$SELECT public.content_reel_transition(%L, ARRAY['published'], 'in_doubt', '{"error_code":"t4_not_public"}')$$, :A6));

-- 30-day hash rule ignores unverified human confirmation (P7 re-uses H6 via a new copy)
SELECT pg_temp.copy_ready('b1000000-0000-0000-0000-000000000076', 'a1000000-0000-0000-0000-000000000007', 'https://x/p7.mp4', :H6);
SELECT public.content_reel_transition(:A6, ARRAY['in_doubt'], 'published', '{"publish_confirmation":"human_confirmed","publish_confirmed_by_user_id":"e1000000-0000-0000-0000-000000000001"}');
SELECT pg_temp.expect_ok('E16 same hash allowed when the earlier publication is an unverified human confirmation',
  pg_temp.auth_stmt('d1000000-0000-0000-0000-000000000076','a1000000-0000-0000-0000-000000000007','b1000000-0000-0000-0000-000000000076',:H6,:F1));
SELECT pg_temp.expect_ok('E17 cancel the P7 authorisation',
  $$SELECT public.content_reel_transition('d1000000-0000-0000-0000-000000000076', ARRAY['authorized'], 'cancelled', '{}')$$);
SELECT pg_temp.expect_true('E18 cancelled post returns to approved',
  $$SELECT status='approved' FROM public.content_posts WHERE id='a1000000-0000-0000-0000-000000000007'$$);
SELECT pg_temp.expect_raise('E19 cancelled is terminal',
  $$SELECT public.content_reel_transition('d1000000-0000-0000-0000-000000000076', ARRAY['cancelled'], 'claimed', '{}')$$, 'illegal_transition:cancelled->claimed');

-- ── F. Draft path and abandon (P7 with H7) ───────────────────────────────────
\set A7 '''d1000000-0000-0000-0000-000000000007'''
SELECT pg_temp.expect_ok('F01 authorise P7 draft', pg_temp.auth_stmt('d1000000-0000-0000-0000-000000000007','a1000000-0000-0000-0000-000000000007','b1000000-0000-0000-0000-000000000007',:H7,:F2,'draft'));
SELECT public.content_reel_transition(:A7, ARRAY['authorized'], 'claimed', '{"touch_last_step":true}');
SELECT public.content_reel_transition(:A7, ARRAY['claimed'], 'uploading', '{"video_id":"2259550698170007","touch_last_step":true}');
SELECT pg_temp.expect_raise('F02 draft_published requires DRAFT video_state',
  format($$SELECT public.content_reel_transition(%L, ARRAY['uploading'], 'draft_published', '{}')$$, :A7), 'draft_requires_video');
SELECT pg_temp.expect_ok('F03 uploading -> draft_published',
  format($$SELECT public.content_reel_transition(%L, ARRAY['uploading'], 'draft_published', '{"video_state":"DRAFT"}')$$, :A7));
SELECT pg_temp.backdate(:A7::uuid, 'finished_at', 30);
SELECT pg_temp.expect_true('F04 draft leaves the post approved', $$SELECT status='approved' FROM public.content_posts WHERE id='a1000000-0000-0000-0000-000000000007'$$);
SELECT pg_temp.expect_code('F05 abandon post refused while a draft is not deleted',
  $$SELECT public.content_reel_abandon_post('c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000007')$$, 'drafts_not_deleted');
SELECT pg_temp.expect_code('F06 draft_deleted without deletion refused',
  format($$SELECT public.content_reel_transition(%L, ARRAY['draft_published'], 'draft_deleted', '{}')$$, :A7), 'draft_deleted_requires_deletion');
SELECT public.content_reel_transition(:A7, ARRAY['draft_published'], 'draft_published', '{"mark_absence":true}');
SELECT pg_temp.backdate(:A7::uuid, 'absence_first_confirmed_at', 20);
SELECT public.content_reel_transition(:A7, ARRAY['draft_published'], 'draft_published', '{"mark_video_deleted":true}');
SELECT pg_temp.backdate(:A7::uuid, 'video_deleted_at', 15);
SELECT pg_temp.expect_code('F06b draft_deleted: absence recorded before the deletion does not count',
  format($$SELECT public.content_reel_transition(%L, ARRAY['draft_published'], 'draft_deleted', '{}')$$, :A7), 'absence_not_confirmed_twice');
SELECT public.content_reel_transition(:A7, ARRAY['draft_published'], 'draft_published', '{"clear_absence":true}');
SELECT public.content_reel_transition(:A7, ARRAY['draft_published'], 'draft_published', '{"mark_absence":true}');
SELECT pg_temp.expect_code('F07 draft_deleted with fresh absence refused',
  format($$SELECT public.content_reel_transition(%L, ARRAY['draft_published'], 'draft_deleted', '{}')$$, :A7), 'absence_not_confirmed_twice');
SELECT pg_temp.backdate(:A7::uuid, 'absence_first_confirmed_at', 11);
SELECT pg_temp.expect_ok('F08 draft_published -> draft_deleted',
  format($$SELECT public.content_reel_transition(%L, ARRAY['draft_published'], 'draft_deleted', '{}')$$, :A7));
SELECT pg_temp.expect_ok('F09 abandon post after drafts deleted',
  $$SELECT public.content_reel_abandon_post('c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000007')$$);
SELECT pg_temp.expect_true('F10 abandoned post is rejected', $$SELECT status='rejected' FROM public.content_posts WHERE id='a1000000-0000-0000-0000-000000000007'$$);
SELECT pg_temp.expect_code('F11 abandon refused when the post has a published attempt',
  $$SELECT public.content_reel_abandon_post('c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000006')$$, 'post_already_published');

-- ── G. Followup bookkeeping ─────────────────────────────────────────────────
SELECT pg_temp.expect_raise('G01 unknown followup key raises',
  format($$SELECT public.content_reel_followup_patch(%L, 'anything', '1')$$, :A6), 'unknown_followup_key');
SELECT pg_temp.expect_ok('G02 followup patch', format($$SELECT public.content_reel_followup_patch(%L, 'books_written', 'true')$$, :A6));
SELECT public.content_reel_append_event_id(:A6, 'content-reel-followup:x:1');
SELECT public.content_reel_append_event_id(:A6, 'content-reel-followup:x:1');
SELECT pg_temp.expect_true('G03 append_event_id is idempotent',
  format($$SELECT cardinality(trigger_event_ids)=1 FROM public.content_reel_publish_attempts WHERE id=%L$$, :A6));
SELECT pg_temp.expect_true('G04 next_restart_seq increments atomically',
  format($$SELECT public.content_reel_next_restart_seq(%L) = 1 AND public.content_reel_next_restart_seq(%L) = 2$$, :A6, :A6));

-- ── H. Live switch ──────────────────────────────────────────────────────────
SELECT pg_temp.expect_raise('H01 direct UPDATE of live switch refused',
  $$UPDATE public.clients SET content_reel_live_enabled=true WHERE id='c1000000-0000-0000-0000-000000000001'$$, 'live_switch_rpc_only');
SELECT pg_temp.expect_code('H02 stale expected old value refused',
  $$SELECT public.set_content_reel_live_enabled('c1000000-0000-0000-0000-000000000001', true, false, 'e1000000-0000-0000-0000-000000000001', 'staff@example.com', 'probe')$$, 'stale');
SELECT pg_temp.expect_true('H03 stale call wrote no audit row',
  $$SELECT count(*)=0 FROM public.content_reel_live_switch_events WHERE client_id='c1000000-0000-0000-0000-000000000001'$$);
SELECT pg_temp.expect_ok('H04 CAS false -> true',
  $$SELECT public.set_content_reel_live_enabled('c1000000-0000-0000-0000-000000000001', false, true, 'e1000000-0000-0000-0000-000000000001', 'staff@example.com', 'probe')$$);
SELECT pg_temp.expect_true('H05 value changed and exactly one audit row',
  $$SELECT (SELECT content_reel_live_enabled FROM public.clients WHERE id='c1000000-0000-0000-0000-000000000001')
        AND (SELECT count(*)=1 FROM public.content_reel_live_switch_events WHERE client_id='c1000000-0000-0000-0000-000000000001' AND old_value=false AND new_value=true)$$);
SELECT pg_temp.expect_true('H06 switch guard is re-armed after the RPC',
  $$SELECT COALESCE(current_setting('content_reel.live_switch_rpc', true), '') <> 'on'$$);
SELECT pg_temp.expect_raise('H07 audit rows are append-only',
  $$UPDATE public.content_reel_live_switch_events SET new_value=false$$, 'live_switch_events_are_append_only');

-- ── I. Import idempotency (behavioural: real ON CONFLICT) ────────────────────
INSERT INTO public.content_posts (client_id, title, route, platforms, status, import_source_url)
VALUES ('c1000000-0000-0000-0000-000000000001', 'import-1', 'route_a', '{}', 'approved', 'https://x/import.mp4');
SELECT pg_temp.expect_raise('I01 duplicate import_source_url for same client refused',
  $$INSERT INTO public.content_posts (client_id, title, route, platforms, status, import_source_url) VALUES ('c1000000-0000-0000-0000-000000000001','import-2','route_a','{}','approved','https://x/import.mp4')$$,
  'content_posts_import_source_url');
SELECT pg_temp.expect_true('I02 ON CONFLICT on the partial unique index resolves to one row',
  $$WITH ins AS (INSERT INTO public.content_posts (client_id, title, route, platforms, status, import_source_url)
                 VALUES ('c1000000-0000-0000-0000-000000000001','import-3','route_a','{}','approved','https://x/import.mp4')
                 ON CONFLICT (client_id, import_source_url) WHERE import_source_url IS NOT NULL DO NOTHING RETURNING 1)
    SELECT (SELECT count(*) FROM ins) = 0
       AND (SELECT count(*) FROM public.content_posts WHERE import_source_url='https://x/import.mp4') = 1$$);

-- ── K. Review round 1 fixes (子牙 B1/B2/S2–S8, 魏征 M1–M4 + suggestions) ─────
CREATE OR REPLACE FUNCTION pg_temp.post_copy(p_n int, p_hash_char text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.content_posts (id, client_id, title, route, platforms, status, source_video_url)
  VALUES (('a1000000-0000-0000-0000-000000000' || (100 + p_n))::uuid, 'c1000000-0000-0000-0000-000000000001', 'K' || p_n, 'route_a', '{}', 'approved', 'https://x/k' || p_n || '.mp4');
  PERFORM pg_temp.copy_ready('b1000000-0000-0000-0000-000000000' || (100 + p_n), 'a1000000-0000-0000-0000-000000000' || (100 + p_n), 'https://x/k' || p_n || '.mp4', repeat(p_hash_char, 64));
END $$;
CREATE OR REPLACE FUNCTION pg_temp.k_id(p_n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('d1000000-0000-0000-0000-000000000' || (100 + p_n))::uuid $$;
CREATE OR REPLACE FUNCTION pg_temp.k_auth(p_n int, p_hash_char text, p_mode text DEFAULT 'live')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  EXECUTE pg_temp.auth_stmt('d1000000-0000-0000-0000-000000000' || (100 + p_n), 'a1000000-0000-0000-0000-000000000' || (100 + p_n),
                            'b1000000-0000-0000-0000-000000000' || (100 + p_n), repeat(p_hash_char, 64), repeat('e', 64), p_mode) INTO r;
  RETURN r;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.k_upload(p_n int, p_video text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.content_reel_transition(pg_temp.k_id(p_n), ARRAY['authorized'], 'claimed', '{"touch_last_step":true}');
  PERFORM public.content_reel_transition(pg_temp.k_id(p_n), ARRAY['claimed'], 'uploading', jsonb_build_object('video_id', p_video, 'touch_last_step', true));
END $$;

SELECT pg_temp.post_copy(1, 'a');
SELECT pg_temp.post_copy(2, 'b');
SELECT pg_temp.post_copy(3, 'c');
SELECT pg_temp.post_copy(4, '8');
SELECT pg_temp.post_copy(5, '9');
SELECT pg_temp.post_copy(6, '0');
SELECT pg_temp.post_copy(7, 'd');
SELECT pg_temp.post_copy(8, '3');
SELECT pg_temp.k_auth(1, 'a');

-- M1: bookkeeping is legal in every state
SELECT pg_temp.expect_ok('K01 followup patch on an authorized attempt (M1)',
  format($$SELECT public.content_reel_followup_patch(%L, 'last_error', '"x"')$$, pg_temp.k_id(1)));
SELECT pg_temp.expect_ok('K02 append event id on an authorized attempt (M1)',
  format($$SELECT public.content_reel_append_event_id(%L, 'content-reel-publish:k1:r1')$$, pg_temp.k_id(1)));
SELECT pg_temp.expect_true('K03 restart seq on an authorized attempt (M1)',
  format($$SELECT public.content_reel_next_restart_seq(%L) = 1$$, pg_temp.k_id(1)));
SELECT pg_temp.expect_ok('K04 followup patch on a cancelled (terminal) attempt (M1)',
  $$SELECT public.content_reel_followup_patch('d1000000-0000-0000-0000-000000000076', 'last_error', '"late"')$$);
SELECT pg_temp.expect_code('K05 abandon post refused while an attempt is in flight',
  $$SELECT public.content_reel_abandon_post('c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000101')$$, 'active_attempt_exists');

-- suggestion 1: transition arguments
SELECT pg_temp.expect_raise('K06 p_from NULL raises (would otherwise skip the CAS)',
  format($$SELECT public.content_reel_transition(%L, NULL, 'claimed', '{}')$$, pg_temp.k_id(1)), 'invalid_transition_arguments');
SELECT pg_temp.expect_raise('K07 p_from empty array raises',
  format($$SELECT public.content_reel_transition(%L, ARRAY[]::text[], 'claimed', '{}')$$, pg_temp.k_id(1)), 'invalid_transition_arguments');
SELECT pg_temp.expect_raise('K08 p_to NULL raises',
  format($$SELECT public.content_reel_transition(%L, ARRAY['authorized'], NULL, '{}')$$, pg_temp.k_id(1)), 'invalid_transition_arguments');

-- B1 / M2: evidence timestamps only from the DB clock, even for service_role direct UPDATEs
SELECT pg_temp.k_upload(1, '3000000001');
SELECT public.content_reel_transition(pg_temp.k_id(1), ARRAY['uploading'], 'in_doubt', '{}');
SELECT pg_temp.expect_raise_as('service_role', 'K09 service_role cannot backdate last_step_started_at (B1/M2)',
  format($$UPDATE public.content_reel_publish_attempts SET last_step_started_at='2020-01-01' WHERE id=%L$$, pg_temp.k_id(1)), 'evidence_timestamp_db_clock_only');
SELECT pg_temp.expect_raise_as('service_role', 'K10 service_role cannot forge deletion + absence timestamps (B1/M2)',
  format($$UPDATE public.content_reel_publish_attempts SET video_deleted_at='2020-01-01 00:00', absence_first_confirmed_at='2020-01-01 00:01' WHERE id=%L$$, pg_temp.k_id(1)), 'evidence_timestamp_db_clock_only');
SELECT pg_temp.expect_raise_as('service_role', 'K11 service_role cannot set a future absence timestamp',
  format($$UPDATE public.content_reel_publish_attempts SET absence_first_confirmed_at='2030-01-01' WHERE id=%L$$, pg_temp.k_id(1)), 'evidence_timestamp_db_clock_only');
SELECT public.content_reel_transition(pg_temp.k_id(1), ARRAY['in_doubt'], 'in_doubt', '{"mark_video_deleted":true}');
SELECT pg_temp.expect_raise('K12 deletion record cannot be cleared',
  format($$UPDATE public.content_reel_publish_attempts SET video_deleted_at=NULL WHERE id=%L$$, pg_temp.k_id(1)), 'evidence_timestamp_db_clock_only');
SELECT pg_temp.expect_raise('K13 insert with a pre-set evidence timestamp refused',
  format($$INSERT INTO public.content_reel_publish_attempts (id, client_id, content_post_id, video_copy_id, mode_requested, state, form_sha256, authorized_via, authorized_by_user_id, authorized_by_email, prepared_by, authorization_record, video_sha256, page_id, last_step_started_at)
           VALUES ('d1000000-0000-0000-0000-0000000000f1','c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000102','b1000000-0000-0000-0000-000000000102','live','authorized',%L,'ui_click',%L,'s@e.com','human','{}',%L,'1616575215312482','2020-01-01')$$, :F2, :U, repeat('b',64)),
  'insert_must_be_clean_authorized');
SELECT pg_temp.expect_true('K14 insert stamps created_at with the DB clock even if a caller supplies one',
  $$WITH ins AS (INSERT INTO public.content_reel_publish_attempts (id, client_id, content_post_id, video_copy_id, mode_requested, state, form_sha256, authorized_via, authorized_by_user_id, authorized_by_email, prepared_by, authorization_record, video_sha256, page_id, created_at)
                 VALUES ('d1000000-0000-0000-0000-0000000000f2','c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000102','b1000000-0000-0000-0000-000000000102','live','authorized',repeat('f',64),'ui_click','e1000000-0000-0000-0000-000000000001','s@e.com','human','{}',repeat('b',64),'1616575215312482','2000-01-01')
                 RETURNING created_at)
    SELECT created_at = now() FROM ins$$);
SELECT public.content_reel_transition('d1000000-0000-0000-0000-0000000000f2', ARRAY['authorized'], 'cancelled', '{}');

-- suggestion 5: deletion and absence at the same instant do not count
SELECT public.content_reel_transition(pg_temp.k_id(1), ARRAY['in_doubt'], 'in_doubt', '{"mark_absence":true}');
SELECT pg_temp.backdate(pg_temp.k_id(1), 'video_deleted_at', 15);
SELECT pg_temp.backdate(pg_temp.k_id(1), 'absence_first_confirmed_at', 15);
SELECT pg_temp.backdate(pg_temp.k_id(1), 'last_step_started_at', 31);
SELECT pg_temp.expect_code('K15 deletion and absence stamped at the same instant do not count',
  format($$SELECT public.content_reel_transition(%L, ARRAY['in_doubt'], 'not_on_facebook', '{}')$$, pg_temp.k_id(1)), 'absence_not_confirmed_twice');
SELECT pg_temp.expect_code('K16 mark_post_published requires a published attempt',
  format($$SELECT public.content_reel_mark_post_published(%L)$$, pg_temp.k_id(1)), 'attempt_not_published');

-- B2 / M3: a published row keeps a complete, immutable receipt on every write
SELECT pg_temp.k_auth(2, 'b');
SELECT pg_temp.k_upload(2, '3000000002');
SELECT public.content_reel_transition(pg_temp.k_id(2), ARRAY['uploading'], 'published',
  '{"video_state":"PUBLISHED","published_at":"2026-09-15T00:00:00Z","publish_confirmation":"graph_get","mark_publish_verified":true}');
SELECT pg_temp.expect_raise('K17 published -> published cannot erase the receipt (B2/M3, W4)',
  format($$SELECT public.content_reel_transition(%L, ARRAY['published'], 'published', '{"video_state":"DRAFT","published_at":null,"publish_confirmation":null}')$$, pg_temp.k_id(2)), 'published_requires_receipt');
SELECT pg_temp.expect_raise('K18 published -> published cannot change published_at',
  format($$SELECT public.content_reel_transition(%L, ARRAY['published'], 'published', '{"published_at":"2026-01-01T00:00:00Z"}')$$, pg_temp.k_id(2)), 'published_receipt_immutable');
SELECT pg_temp.expect_raise('K19 graph_get cannot be downgraded to human_confirmed',
  format($$SELECT public.content_reel_transition(%L, ARRAY['published'], 'published', '{"publish_confirmation":"human_confirmed","publish_confirmed_by_user_id":"e1000000-0000-0000-0000-000000000001"}')$$, pg_temp.k_id(2)), 'published_receipt_immutable');

-- human_confirmed path: stale absence, verification upgrade, mark_post_published gate
SELECT pg_temp.k_auth(3, 'c');
SELECT pg_temp.k_upload(3, '3000000003');
SELECT public.content_reel_transition(pg_temp.k_id(3), ARRAY['uploading'], 'in_doubt', '{"mark_absence":true}');
SELECT pg_temp.expect_raise('K20 entering published with stale absence evidence refused (direct UPDATE)',
  format($$UPDATE public.content_reel_publish_attempts SET state='published', video_state='PUBLISHED', published_at=now(), publish_confirmation='human_confirmed', publish_confirmed_by_user_id='e1000000-0000-0000-0000-000000000001', finished_at=now() WHERE id=%L$$, pg_temp.k_id(3)), 'stale_absence_on_publish');
SELECT pg_temp.expect_ok('K21 RPC entering published clears stale absence automatically',
  format($$SELECT public.content_reel_transition(%L, ARRAY['in_doubt'], 'published', '{"video_state":"PUBLISHED","published_at":"2026-09-15T00:00:00Z","publish_confirmation":"human_confirmed","publish_confirmed_by_user_id":"e1000000-0000-0000-0000-000000000001"}')$$, pg_temp.k_id(3)));
SELECT pg_temp.expect_code('K22 mark_post_published refuses an unverified human confirmation (W9)',
  format($$SELECT public.content_reel_mark_post_published(%L)$$, pg_temp.k_id(3)), 'publication_not_verified');
SELECT pg_temp.expect_ok('K23 human_confirmed -> graph_get with verification allowed',
  format($$SELECT public.content_reel_transition(%L, ARRAY['published'], 'published', '{"publish_confirmation":"graph_get","mark_publish_verified":true}')$$, pg_temp.k_id(3)));
SELECT pg_temp.expect_ok('K24 mark_post_published after verification',
  format($$SELECT public.content_reel_mark_post_published(%L)$$, pg_temp.k_id(3)));
SELECT pg_temp.expect_raise('K24b graph_get cannot flip back to human_confirmed even with the same confirmer',
  format($$SELECT public.content_reel_transition(%L, ARRAY['published'], 'published', '{"publish_confirmation":"human_confirmed"}')$$, pg_temp.k_id(3)), 'published_receipt_immutable');

-- S5: not_on_facebook -> published needs an alert code (A1 is not_on_facebook since C19)
SELECT pg_temp.expect_raise('K25 not_on_facebook -> published without alert_code refused (S5)',
  $$SELECT public.content_reel_transition('d1000000-0000-0000-0000-000000000001', ARRAY['not_on_facebook'], 'published', '{"video_state":"PUBLISHED","published_at":"2026-09-15T00:00:00Z","publish_confirmation":"graph_get","mark_publish_verified":true}')$$,
  'alert_required');
SELECT pg_temp.expect_ok('K26 not_on_facebook -> published with alert_code',
  $$SELECT public.content_reel_transition('d1000000-0000-0000-0000-000000000001', ARRAY['not_on_facebook'], 'published', '{"video_state":"PUBLISHED","published_at":"2026-09-15T00:00:00Z","publish_confirmation":"graph_get","mark_publish_verified":true,"alert_code":"not_on_facebook_found_public"}')$$);

-- S6: requested mode must match the terminal state
SELECT pg_temp.k_auth(4, '8', 'draft');
SELECT pg_temp.k_upload(4, '3000000004');
SELECT pg_temp.expect_raise('K27 draft request cannot become published (S6)',
  format($$SELECT public.content_reel_transition(%L, ARRAY['uploading'], 'published', '{"video_state":"PUBLISHED","published_at":"2026-09-15T00:00:00Z","publish_confirmation":"graph_get","mark_publish_verified":true}')$$, pg_temp.k_id(4)), 'mode_state_mismatch');
SELECT pg_temp.k_auth(5, '9');
SELECT pg_temp.k_upload(5, '3000000005');
SELECT pg_temp.expect_raise('K28 live request cannot become draft_published (S6)',
  format($$SELECT public.content_reel_transition(%L, ARRAY['uploading'], 'draft_published', '{"video_state":"DRAFT"}')$$, pg_temp.k_id(5)), 'mode_state_mismatch');

-- suggestion 2: unique violations are translated
SELECT pg_temp.k_auth(6, '0');
SELECT public.content_reel_transition(pg_temp.k_id(6), ARRAY['authorized'], 'claimed', '{}');
SELECT pg_temp.expect_code('K29 re-used video_id returns video_id_conflict (W11)',
  format($$SELECT public.content_reel_transition(%L, ARRAY['claimed'], 'uploading', '{"video_id":"3000000005"}')$$, pg_temp.k_id(6)), 'video_id_conflict');
SELECT pg_temp.k_auth(8, '3');
SELECT pg_temp.k_upload(8, '3000000008');
SELECT public.content_reel_transition(pg_temp.k_id(8), ARRAY['uploading'], 'in_doubt', '{}');
SELECT public.content_reel_transition(pg_temp.k_id(8), ARRAY['in_doubt'], 'published',
  '{"video_state":"PUBLISHED","published_at":"2026-09-15T00:00:00Z","publish_confirmation":"human_confirmed","publish_confirmed_by_user_id":"e1000000-0000-0000-0000-000000000001"}');
INSERT INTO public.content_reel_publish_attempts (id, client_id, content_post_id, video_copy_id, mode_requested, state, form_sha256, authorized_via, authorized_by_user_id, authorized_by_email, prepared_by, authorization_record, video_sha256, page_id)
VALUES ('d1000000-0000-0000-0000-0000000000f8','c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000108','b1000000-0000-0000-0000-000000000108','live','authorized',repeat('f',64),'ui_click','e1000000-0000-0000-0000-000000000001','s@e.com','human','{}',repeat('3',64),'1616575215312482');
SELECT pg_temp.expect_code('K30 reopening a publication while another attempt is in flight returns active_attempt_exists (W16)',
  format($$SELECT public.content_reel_transition(%L, ARRAY['published'], 'in_doubt', '{}')$$, pg_temp.k_id(8)), 'active_attempt_exists');

-- S7: unknown render statuses count as in progress
INSERT INTO public.content_factory_render_jobs (client_id, content_post_id, status)
VALUES ('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000107', 'some_future_status');
SELECT pg_temp.expect_code('K31 unknown render status blocks authorisation (S7 allow-list)',
  pg_temp.auth_stmt('d1000000-0000-0000-0000-000000000107','a1000000-0000-0000-0000-000000000107','b1000000-0000-0000-0000-000000000107',repeat('d',64),repeat('e',64)), 'render_in_progress');

-- S2: service_role cannot delete or truncate
SELECT pg_temp.expect_true('K32 service_role has no DELETE / TRUNCATE on the new tables (S2)',
  $$SELECT bool_and(NOT has_table_privilege('service_role', t, 'DELETE') AND NOT has_table_privilege('service_role', t, 'TRUNCATE'))
      FROM unnest(ARRAY['public.content_reel_video_copies','public.content_reel_publish_attempts','public.content_reel_live_switch_events']) t$$);
SELECT pg_temp.expect_raise_as('service_role', 'K33 service_role DELETE is denied (S2)',
  $$DELETE FROM public.content_reel_publish_attempts WHERE id='d1000000-0000-0000-0000-000000000001'$$, 'permission denied');
SELECT pg_temp.expect_raise('K34 TRUNCATE is blocked even for the owner (S2)',
  $$TRUNCATE public.content_reel_live_switch_events$$, 'truncate_forbidden');
SELECT pg_temp.expect_true('K35 service_role keeps SELECT/INSERT/UPDATE on attempts and can reach clients (sandbox models Supabase defaults)',
  $$SELECT has_table_privilege('service_role','public.content_reel_publish_attempts','SELECT')
       AND has_table_privilege('service_role','public.content_reel_publish_attempts','INSERT')
       AND has_table_privilege('service_role','public.content_reel_publish_attempts','UPDATE')
       AND has_table_privilege('service_role','public.clients','UPDATE')$$);

-- S3 / W5 / W6: live switch cannot be flipped outside the RPC by app roles
SELECT set_config('content_reel.live_switch_rpc', 'on', true);
SELECT pg_temp.expect_raise_as('service_role', 'K36 service_role with the GUC marker set still cannot flip the switch (W5)',
  $$UPDATE public.clients SET content_reel_live_enabled = false WHERE id='c1000000-0000-0000-0000-000000000001'$$, 'live_switch_rpc_only');
SELECT set_config('content_reel.live_switch_rpc', 'off', true);
SELECT pg_temp.expect_raise_as('service_role', 'K37 a client cannot be inserted with the switch on (W6)',
  $$INSERT INTO public.clients (id, name, content_reel_live_enabled) VALUES ('c1000000-0000-0000-0000-0000000000ff', 'Live insert', true)$$, 'live_switch_insert_must_be_false');
SELECT pg_temp.expect_ok_as('service_role', 'K38 service_role can flip the switch through the RPC',
  $$SELECT public.set_content_reel_live_enabled('c1000000-0000-0000-0000-000000000001', true, false, 'e1000000-0000-0000-0000-000000000001', 'staff@example.com', 'probe')$$);
SELECT pg_temp.expect_true('K39 RPC flip wrote a second audit row',
  $$SELECT count(*) = 2 FROM public.content_reel_live_switch_events WHERE client_id='c1000000-0000-0000-0000-000000000001'$$);

-- ── L. Closing round (第二轮两审建议) ─────────────────────────────────────────
-- 魏征 C: owner TRUNCATE refused on the other two tables as well
SELECT pg_temp.expect_raise('L01 owner TRUNCATE of publish attempts refused',
  $$TRUNCATE public.content_reel_publish_attempts$$, 'truncate_forbidden');
SELECT pg_temp.expect_raise('L02 owner TRUNCATE of video copies refused (CASCADE)',
  $$TRUNCATE public.content_reel_video_copies CASCADE$$, 'truncate_forbidden');

-- 子牙建议 4 / 魏征 D: bookkeeping is monotonic
SELECT pg_temp.expect_raise('L03 restart_seq cannot go down',
  format($$UPDATE public.content_reel_publish_attempts SET restart_seq = 0 WHERE id=%L$$, pg_temp.k_id(1)), 'bookkeeping_not_monotonic');
SELECT pg_temp.expect_raise('L04 recorded trigger event ids cannot be removed',
  format($$UPDATE public.content_reel_publish_attempts SET trigger_event_ids = '{}' WHERE id=%L$$, pg_temp.k_id(1)), 'bookkeeping_not_monotonic');
SELECT pg_temp.expect_raise('L05 restart_seq cannot go down on a terminal attempt either',
  $$UPDATE public.content_reel_publish_attempts SET restart_seq = restart_seq - 1 WHERE id='d1000000-0000-0000-0000-000000000006' AND restart_seq > 0$$, 'bookkeeping_not_monotonic');

-- 子牙建议 4 / 魏征 D: permalink is locked once written on a published attempt
SELECT pg_temp.expect_ok('L06 permalink may be filled in once while published',
  format($$SELECT public.content_reel_transition(%L, ARRAY['published'], 'published', '{"permalink":"https://www.facebook.com/reel/3000000002/"}')$$, pg_temp.k_id(2)));
SELECT pg_temp.expect_raise('L07 permalink cannot be rewritten while published',
  format($$SELECT public.content_reel_transition(%L, ARRAY['published'], 'published', '{"permalink":"https://www.facebook.com/reel/9999999999/"}')$$, pg_temp.k_id(2)), 'published_receipt_immutable');

-- 子牙建议 1: reading a deleted video back as public needs an alert code
SELECT pg_temp.post_copy(10, 'e');
SELECT pg_temp.k_auth(10, 'e');
SELECT pg_temp.k_upload(10, '3000000010');
SELECT public.content_reel_transition(pg_temp.k_id(10), ARRAY['uploading'], 'in_doubt', '{"mark_video_deleted":true}');
SELECT pg_temp.expect_raise('L08 in_doubt with a deletion record -> published without alert_code refused',
  format($$SELECT public.content_reel_transition(%L, ARRAY['in_doubt'], 'published', '{"video_state":"PUBLISHED","published_at":"2026-09-15T00:00:00Z","publish_confirmation":"graph_get","mark_publish_verified":true}')$$, pg_temp.k_id(10)), 'alert_required');
SELECT pg_temp.expect_ok('L09 in_doubt with a deletion record -> published with alert_code',
  format($$SELECT public.content_reel_transition(%L, ARRAY['in_doubt'], 'published', '{"video_state":"PUBLISHED","published_at":"2026-09-15T00:00:00Z","publish_confirmation":"graph_get","mark_publish_verified":true,"alert_code":"deleted_video_found_public"}')$$, pg_temp.k_id(10)));

-- 子牙建议 2: a draft deletion must happen after the attempt became a draft
SELECT pg_temp.post_copy(11, 'f');
SELECT pg_temp.k_auth(11, 'f', 'draft');
SELECT pg_temp.k_upload(11, '3000000011');
SELECT public.content_reel_transition(pg_temp.k_id(11), ARRAY['uploading'], 'in_doubt', '{"mark_video_deleted":true}');
SELECT pg_temp.backdate(pg_temp.k_id(11), 'video_deleted_at', 40);
SELECT public.content_reel_transition(pg_temp.k_id(11), ARRAY['in_doubt'], 'draft_published', '{"video_state":"DRAFT"}');
SELECT public.content_reel_transition(pg_temp.k_id(11), ARRAY['draft_published'], 'draft_published', '{"mark_absence":true}');
SELECT pg_temp.backdate(pg_temp.k_id(11), 'finished_at', 30);
SELECT pg_temp.backdate(pg_temp.k_id(11), 'absence_first_confirmed_at', 11);
SELECT pg_temp.expect_code('L10 deletion recorded before the draft existed does not count for draft_deleted',
  format($$SELECT public.content_reel_transition(%L, ARRAY['draft_published'], 'draft_deleted', '{}')$$, pg_temp.k_id(11)), 'draft_deleted_requires_deletion');

-- ── J. Privileges and function config ───────────────────────────────────────
SELECT pg_temp.expect_true('J01 anon cannot execute any content_reel RPC',
  $$SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND (p.proname LIKE 'content_reel_%' OR p.proname='set_content_reel_live_enabled')$$);
SELECT pg_temp.expect_true('J02 authenticated cannot execute any content_reel RPC',
  $$SELECT bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND (p.proname LIKE 'content_reel_%' OR p.proname='set_content_reel_live_enabled')$$);
SELECT pg_temp.expect_true('J03 service_role can execute every SECURITY DEFINER RPC',
  $$SELECT bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prosecdef AND (p.proname LIKE 'content_reel_%' OR p.proname='set_content_reel_live_enabled')$$);
SELECT pg_temp.expect_true('J04 every SECURITY DEFINER RPC pins search_path = pg_catalog, pg_temp',
  $$SELECT bool_and(p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']) AND count(*) = 10
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prosecdef AND (p.proname LIKE 'content_reel_%' OR p.proname='set_content_reel_live_enabled')$$);
SELECT pg_temp.expect_true('J05 anon/authenticated have no table privileges on the new tables',
  $$SELECT bool_and(NOT has_table_privilege(r, t, 'SELECT') AND NOT has_table_privilege(r, t, 'INSERT') AND NOT has_table_privilege(r, t, 'UPDATE'))
      FROM unnest(ARRAY['anon','authenticated']) r,
           unnest(ARRAY['public.content_reel_video_copies','public.content_reel_publish_attempts','public.content_reel_live_switch_events']) t$$);
SELECT pg_temp.expect_true('J06 every policy on the new tables is TO service_role',
  $$SELECT bool_and(roles = '{service_role}') AND count(*) = 3 FROM pg_policies
     WHERE schemaname='public' AND tablename IN ('content_reel_video_copies','content_reel_publish_attempts','content_reel_live_switch_events')$$);
SELECT pg_temp.expect_true('J07 partial unique index covers exactly the four active states',
  $$SELECT pg_get_indexdef('public.content_reel_publish_attempts_one_active'::regclass) LIKE '%authorized%claimed%uploading%in_doubt%'
       AND pg_get_indexdef('public.content_reel_publish_attempts_one_active'::regclass) NOT LIKE '%published%'$$);

-- ── K-end. Card reset must not happen while another attempt is still in flight ──
-- The partial unique index normally makes this state unreachable; it is dropped here
-- (inside the probe transaction, rolled back) to prove the NOT EXISTS guard on its own.
DROP INDEX public.content_reel_publish_attempts_one_active;
SELECT pg_temp.post_copy(9, '2');
SELECT pg_temp.k_auth(9, '2');
INSERT INTO public.content_reel_publish_attempts (id, client_id, content_post_id, video_copy_id, mode_requested, state, form_sha256, authorized_via, authorized_by_user_id, authorized_by_email, prepared_by, authorization_record, video_sha256, page_id)
VALUES ('d1000000-0000-0000-0000-0000000000f9','c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000109','b1000000-0000-0000-0000-000000000109','live','authorized',repeat('f',64),'ui_click','e1000000-0000-0000-0000-000000000001','s@e.com','human','{}',repeat('2',64),'1616575215312482');
SELECT pg_temp.expect_ok('K40 cancel one of two in-flight attempts',
  format($$SELECT public.content_reel_transition(%L, ARRAY['authorized'], 'cancelled', '{}')$$, pg_temp.k_id(9)));
SELECT pg_temp.expect_true('K41 card stays scheduled while another attempt is still in flight',
  $$SELECT status='scheduled' FROM public.content_posts WHERE id='a1000000-0000-0000-0000-000000000109'$$);

-- ── Report ──────────────────────────────────────────────────────────────────
\o
SELECT to_char(seq, 'FM000') AS seq, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result, name, detail
  FROM probe_results ORDER BY seq;
SELECT count(*) FILTER (WHERE passed) AS passed, count(*) FILTER (WHERE NOT passed) AS failed, count(*) AS total
  FROM probe_results;

\set ON_ERROR_STOP on
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM probe_results WHERE NOT passed;
  IF n > 0 THEN
    RAISE EXCEPTION 'content-reel probes: % failed', n;
  END IF;
END $$;

ROLLBACK;
