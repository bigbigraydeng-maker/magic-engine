-- Add video_error column to reels_drafts (was in 20260505000003 but never applied)
ALTER TABLE public.reels_drafts ADD COLUMN IF NOT EXISTS video_error TEXT;
