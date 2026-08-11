-- Industry benchmarks: ME-observed growth provenance
--
-- Why separate columns instead of reusing source/confidence/sample_size?
--   industry_benchmarks currently holds TWO different kinds of fact:
--     (a) LEVEL   — score_p50/p75/p90 (0-100 dimension health), sourced from
--                   external research reports (Sprout Social / BrightLocal /
--                   Conductor) and from the baseline_domains SEO cron.
--     (b) GROWTH  — realistic_3mo_growth_pct / realistic_6mo_growth_pct, i.e.
--                   "how much does this metric actually move in N days".
--   Only ME's own client outcomes (flywheel_outcomes) can answer (b).
--
--   Giving GROWTH its own provenance columns means the benchmark accumulator
--   never has to touch `source` / `confidence` / `sample_size`, which belong to
--   the LEVEL data. External research rows therefore cannot be silently
--   overwritten by a 3-sample single-client aggregate.
--
-- Applied by PM only (repo hard constraint: workers must not run apply_migration).

ALTER TABLE industry_benchmarks
  ADD COLUMN IF NOT EXISTS growth_source       text,
  ADD COLUMN IF NOT EXISTS growth_sample_size  integer,
  ADD COLUMN IF NOT EXISTS growth_client_count integer,
  ADD COLUMN IF NOT EXISTS growth_confidence   numeric,
  ADD COLUMN IF NOT EXISTS growth_window_days  integer,
  ADD COLUMN IF NOT EXISTS growth_updated_at   timestamptz;

DO $$ BEGIN
  ALTER TABLE industry_benchmarks
    ADD CONSTRAINT industry_benchmarks_growth_confidence_check
    CHECK (growth_confidence IS NULL OR (growth_confidence >= 0 AND growth_confidence <= 1));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN industry_benchmarks.growth_source IS
  'Provenance of realistic_*_growth_pct only. "ME client outcomes" = derived from flywheel_outcomes.';
COMMENT ON COLUMN industry_benchmarks.growth_sample_size IS
  'Number of flywheel_outcomes rows behind the growth figure.';
COMMENT ON COLUMN industry_benchmarks.growth_client_count IS
  'Distinct ME clients behind the growth figure. 1 = this is one clients history, NOT an industry benchmark.';
COMMENT ON COLUMN industry_benchmarks.growth_confidence IS
  '0-1. Independent of `confidence`, which describes the LEVEL scores (score_p50/p75/p90).';
COMMENT ON COLUMN industry_benchmarks.growth_window_days IS
  'Median attribution window (days) of the underlying outcomes. Growth pct is NOT extrapolated beyond this.';
