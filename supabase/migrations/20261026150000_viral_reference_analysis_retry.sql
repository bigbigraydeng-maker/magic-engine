-- Viral analyzer retry bookkeeping.
-- Nullable columns so existing rows stay valid. Not applied by the code change
-- that adds this file; apply it before deploying the worker that reads them.
--
-- `terminal` is a permanent analysis failure (blocked content, or a host the
-- downloader cannot fetch). The worker only claims pending and error rows.

ALTER TABLE public.viral_reference_library
  ADD COLUMN IF NOT EXISTS analysis_attempts integer,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE public.viral_reference_library
  DROP CONSTRAINT IF EXISTS viral_reference_library_analysis_attempts_check;
ALTER TABLE public.viral_reference_library
  ADD CONSTRAINT viral_reference_library_analysis_attempts_check
  CHECK (analysis_attempts IS NULL OR analysis_attempts >= 0);

-- Drop every check that mentions analysis_status. The historical name is
-- viral_reference_library_analysis_status_check; a renamed copy would otherwise
-- keep rejecting the new terminal value.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'viral_reference_library'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%analysis_status%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.viral_reference_library DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;
END $$;

ALTER TABLE public.viral_reference_library
  ADD CONSTRAINT viral_reference_library_analysis_status_check
  CHECK (analysis_status = ANY (ARRAY[
    'pending'::text,
    'analyzing'::text,
    'done'::text,
    'error'::text,
    'terminal'::text
  ]));

COMMENT ON COLUMN public.viral_reference_library.analysis_attempts IS
  'Failed analysis attempts. Null means the row has not been counted yet.';
COMMENT ON COLUMN public.viral_reference_library.next_retry_at IS
  'Earliest time an error row may be claimed again. Null means due now. Terminal rows leave this null.';
COMMENT ON COLUMN public.viral_reference_library.updated_at IS
  'Last worker touch. Error retries are ordered by this column, nulls first, so every row gets a turn.';

CREATE INDEX IF NOT EXISTS viral_refs_error_retry_idx
  ON public.viral_reference_library (updated_at NULLS FIRST, created_at)
  WHERE analysis_status = 'error';

-- Existing permanent failures must leave the retry queue as soon as this lands,
-- before the new worker code is required.
UPDATE public.viral_reference_library
SET analysis_status = 'terminal',
    next_retry_at = NULL,
    updated_at = now()
WHERE analysis_status IN ('pending', 'error')
  AND (
    analysis_error ILIKE '%PROHIBITED_CONTENT%'
    OR analysis_error ILIKE '%No video formats found%'
    OR platform = 'xiaohongshu'
    OR source_url ILIKE '%xiaohongshu.com%'
    OR source_url ILIKE '%xiaohongshu.cn%'
    OR source_url ILIKE '%xhslink.com%'
    OR source_url ILIKE '%xhs.cn%'
  );
