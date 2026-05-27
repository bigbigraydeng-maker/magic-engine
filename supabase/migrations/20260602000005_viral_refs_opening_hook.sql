-- Add opening_hook JSONB column to viral_reference_library
-- Stores what happens in the first 1.5 seconds of a viral video.
-- Shape: { type: string, script: string, feel: string }
ALTER TABLE public.viral_reference_library
  ADD COLUMN IF NOT EXISTS opening_hook JSONB;
