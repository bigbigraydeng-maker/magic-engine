-- Throwaway local Postgres integration check; requires the base video_clips
-- schema and 20261023014627_factory_clip_library_catalog.sql to be applied.
BEGIN;

INSERT INTO public.clients (id) VALUES
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.video_clips
 WHERE id IN (
   'aaaaaaaa-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001'
 );

INSERT INTO public.video_clips (
  id, client_id, scene_tag, duration_seconds, track, storage_url, status,
  license_status, license_reviewed_by_user_id, sha256
) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'street', 5, 'a_real', 'fixture-a', 'pending_review', 'verified', '10000000-0000-0000-0000-000000000002', repeat('a', 64)),
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'street', 5, 'a_real', 'fixture-b', 'pending_review', 'verified', '20000000-0000-0000-0000-000000000002', repeat('b', 64));

DO $$
DECLARE affected integer;
BEGIN
  -- A request scoped to client B cannot mutate client A's clip.
  UPDATE public.video_clips
     SET status = 'active'
   WHERE client_id = '00000000-0000-0000-0000-0000000000b2'
     AND id = 'aaaaaaaa-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'cross-client update changed % rows', affected; END IF;

  -- A license change after the caller read its snapshot defeats the CAS.
  UPDATE public.video_clips SET license_status = 'rejected'
   WHERE client_id = '00000000-0000-0000-0000-0000000000a1'
     AND id = 'aaaaaaaa-0000-0000-0000-000000000001';
  UPDATE public.video_clips
     SET status = 'active', reviewed_by_user_id = '10000000-0000-0000-0000-000000000003'
   WHERE client_id = '00000000-0000-0000-0000-0000000000a1'
     AND id = 'aaaaaaaa-0000-0000-0000-000000000001'
     AND status = 'pending_review'
     AND license_status = 'verified'
     AND license_reviewed_by_user_id = '10000000-0000-0000-0000-000000000002'
     AND sha256 = repeat('a', 64);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'stale approval CAS changed % rows', affected; END IF;

  -- The untouched client B row remains pending review.
  IF NOT EXISTS (
    SELECT 1 FROM public.video_clips
     WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'
       AND client_id = '00000000-0000-0000-0000-0000000000b2'
       AND status = 'pending_review'
  ) THEN RAISE EXCEPTION 'client B fixture row changed'; END IF;
END $$;

ROLLBACK;
