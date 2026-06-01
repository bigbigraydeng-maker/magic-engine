-- Allow 'client_library' as a valid provider for visual_assets.
-- Used when an FDE picks an existing analysed client-library photo into a
-- content post's gallery (POST /api/clients/[id]/visual-assets/from-library),
-- instead of generating a fresh image. The library file is referenced by URL.
--
-- Without this, the from-library INSERT violates visual_assets_provider_check
-- (error 23514) and the API returns 400.

ALTER TABLE public.visual_assets
  DROP CONSTRAINT IF EXISTS visual_assets_provider_check;

ALTER TABLE public.visual_assets
  ADD CONSTRAINT visual_assets_provider_check
  CHECK (provider IN ('wavespeed', 'seedance', 'heygen', 'upload', 'openai', 'client_library'));
