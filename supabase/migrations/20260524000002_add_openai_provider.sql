-- Allow 'openai' as a valid provider for gpt-image-1 image generation
-- Route /api/visual/image was switched to gpt-image-1 but the constraint was not updated

ALTER TABLE public.visual_assets
  DROP CONSTRAINT IF EXISTS visual_assets_provider_check;

ALTER TABLE public.visual_assets
  ADD CONSTRAINT visual_assets_provider_check
  CHECK (provider IN ('wavespeed', 'seedance', 'heygen', 'upload', 'openai'));
