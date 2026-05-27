-- Add AI-detected industry column to viral_reference_library
-- Allows the system to flag when the assigned industry differs from what the AI sees.
ALTER TABLE public.viral_reference_library
  ADD COLUMN IF NOT EXISTS detected_industry TEXT;
