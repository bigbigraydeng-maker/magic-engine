-- Extend the existing video-factory clip pool with reviewable catalog data.
-- New intake remains unavailable to the factory until an admin review activates it.

ALTER TABLE public.video_clips
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_author text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS license_name text,
  ADD COLUMN IF NOT EXISTS license_url text,
  ADD COLUMN IF NOT EXISTS license_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS license_reviewed_by text,
  ADD COLUMN IF NOT EXISTS license_reviewed_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS license_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS license_review_note text,
  ADD COLUMN IF NOT EXISTS sha256 text,
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_note text;

UPDATE public.video_clips
   SET media_type = CASE
     WHEN source_meta ->> 'is_still_image' = 'true' THEN 'image'
     ELSE 'video'
   END
 WHERE media_type IS NULL;

ALTER TABLE public.video_clips
  ALTER COLUMN media_type SET DEFAULT 'video',
  ALTER COLUMN media_type SET NOT NULL;

ALTER TABLE public.video_clips
  DROP CONSTRAINT IF EXISTS video_clips_status_check;
ALTER TABLE public.video_clips
  ADD CONSTRAINT video_clips_status_check
  CHECK (status IN ('active', 'archived', 'quarantined', 'pending_review'));

ALTER TABLE public.video_clips
  DROP CONSTRAINT IF EXISTS video_clips_media_type_check;
ALTER TABLE public.video_clips
  ADD CONSTRAINT video_clips_media_type_check
  CHECK (media_type IN ('video', 'image'));

ALTER TABLE public.video_clips
  DROP CONSTRAINT IF EXISTS video_clips_license_status_check;
ALTER TABLE public.video_clips
  ADD CONSTRAINT video_clips_license_status_check
  CHECK (license_status IN ('unknown', 'verified', 'not_required', 'rejected'));

ALTER TABLE public.video_clips
  DROP CONSTRAINT IF EXISTS video_clips_sha256_check;
ALTER TABLE public.video_clips
  ADD CONSTRAINT video_clips_sha256_check
  CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$');

CREATE INDEX IF NOT EXISTS idx_video_clips_client_review
  ON public.video_clips (client_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_clips_tags
  ON public.video_clips USING GIN (tags);
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_clips_client_sha256
  ON public.video_clips (client_id, sha256)
  WHERE sha256 IS NOT NULL;

COMMENT ON COLUMN public.video_clips.tags IS
  'Client-scoped editorial tags. Factory selection may use these alongside scene_tag.';
COMMENT ON COLUMN public.video_clips.license_status IS
  'unknown until an ME admin reviews license evidence; only verified/not_required clips may be activated.';
COMMENT ON COLUMN public.video_clips.status IS
  'pending_review clips are excluded by the factory; activate only after a human source, tag and rights review.';
COMMENT ON COLUMN public.video_clips.review_note IS
  'ME admin decision note for material activation or quarantine.';
