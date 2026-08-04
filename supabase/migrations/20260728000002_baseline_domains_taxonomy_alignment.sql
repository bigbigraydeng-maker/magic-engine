-- baseline_domains taxonomy alignment — make the producer speak the consumer's language
--
-- ⚠️ NOT APPLIED. PM applies this (repo hard constraint: workers never run apply_migration).
--
-- ── Why ────────────────────────────────────────────────────────────────────────
-- `industry_benchmarks.industry_category` is the hub key that every benchmark
-- reader looks up by. There is exactly one producer of the SEO rows in that
-- table — the baseline cron — and it uses `baseline_domains.industry` verbatim
-- as the key (see src/app/api/cron/baseline-domains-monthly/route.ts, step 4).
--
-- The readers all derive their key from INDUSTRY_DICTIONARY in
-- src/lib/huatuo/industry-mapper.ts:
--   - src/lib/huatuo/agent.ts (华佗 diagnose + re-diagnose)
--   - src/app/api/clients/[id]/diagnostic/baseline/route.ts (诊断页 P50/P75/P90 卡)
--   - src/app/api/clients/[id]/prescription/generate/route.ts
--
-- Three of the four `baseline_domains.industry` values never existed in that
-- dictionary, so the cron writes benchmark rows under keys nobody queries:
--
--   baseline_domains.industry   INDUSTRY_DICTIONARY category   domains
--   -------------------------   ----------------------------   -------
--   tourism_operator            tourism_operator  ✅ match          22
--   flooring_tiles              building_supplies ❌ drift          13
--   real_estate                 real_estate_agency ❌ drift          8
--   logistics_3pl               (absent) ❌ no category            18
--
-- 39 of 61 scored domains therefore produce write-only benchmarks. This was
-- invisible until PR #664 fixed the upsert itself (it referenced a non-existent
-- `snapshot_date` column and omitted NOT NULL `business_size`, so every write
-- had been failing silently since 2026-05-13 and the error was swallowed by
-- `if (!upsertError)`). Now that writes land, the wrong keys become real rows.
--
-- ── Canonical taxonomy decision ────────────────────────────────────────────────
-- INDUSTRY_DICTIONARY wins; `baseline_domains.industry` conforms to it.
-- Rationale: the dictionary is the only side with a reverse label map
-- (`categoryToChineseName`, used in the 华佗 prompt) and it is what every
-- consumer derives from live client data. `baseline_domains.industry` is a
-- producer-side label with exactly one consumer. The producer must conform.
-- The original schema comment already asserted this intent —
-- "-- Industry classification (matches industry_benchmarks.industry_category)"
-- in 20260618000001 — the seed data in 20260618000002 simply never honoured it.
--
-- ── Paired code changes (must ship together) ───────────────────────────────────
--   1. src/lib/huatuo/industry-mapper.ts — adds the `logistics_3pl` category.
--      Without it, the 18 logistics domains keep aggregating into a row that
--      mapIndustryToCategory can never produce.
--   2. src/app/dashboard/industry-baselines/page.tsx — labelSubIndustry keys
--      follow the sub_industry renames in section 2 below, else the admin UI
--      falls through to raw slugs.
--   3. src/app/api/baselines/domains/route.ts — rejects industry values outside
--      INDUSTRY_DICTIONARY, so this drift cannot silently recur.
--
-- Deliberately NOT adding a CHECK constraint on baseline_domains.industry: the
-- allowed set lives in TypeScript, and a SQL CHECK would become a second source
-- of truth that drifts on the next dictionary addition (the exact failure mode
-- CLAUDE.md warns about under "加 enum / status 新值必同步前端 type + UI fallback").
-- Validation belongs at the API boundary instead.

BEGIN;

-- ── 1. industry → INDUSTRY_DICTIONARY categories ──────────────────────────────
-- `tourism_operator` already matches. `logistics_3pl` becomes valid via the
-- paired dictionary addition, so its rows stay as-is.

UPDATE baseline_domains SET industry = 'building_supplies'  WHERE industry = 'flooring_tiles';
UPDATE baseline_domains SET industry = 'real_estate_agency' WHERE industry = 'real_estate';

-- ── 2. sub_industry → what resolveSubIndustry() actually builds ────────────────
-- fetchBenchmarks prefers a LIVE percentile computed straight off
-- baseline_domains, keyed on `sub_industry` (src/lib/huatuo/benchmarks.ts,
-- computeLiveSeoBenchmark). The key it builds is `<category>` or
-- `<category>_<city>`. Fixing `industry` alone repairs only the cached
-- fallback path; these two renames are what let the preferred live path hit.
--
--   resolveSubIndustry('building_supplies',  'brisbane') = building_supplies_brisbane
--   resolveSubIndustry('real_estate_agency', 'auckland') = real_estate_agency_auckland
--
-- Safe: the (sub_industry, domain) unique constraint cannot collide because the
-- old and new slugs are disjoint sets. The `city` column is unchanged.

UPDATE baseline_domains SET sub_industry = 'building_supplies_brisbane'
  WHERE sub_industry = 'flooring_tiles_brisbane';
UPDATE baseline_domains SET sub_industry = 'real_estate_agency_auckland'
  WHERE sub_industry = 'real_estate_auckland';

-- NOT renamed, on purpose:
--   inbound_tour_operator / outbound_tour_operator — two genuinely distinct
--     watchlists (different keyword sets; CTS is outbound) that both map to the
--     single `tourism_operator` category. Collapsing them to `tourism_operator`
--     would merge 22 domains into one meaningless percentile and destroy the
--     inbound/outbound split the seed migration deliberately created.
--   logistics_3pl_nz — `_nz` is a national geo_scope, not a city, so no
--     `<category>_<city>` form exists for it.
--   These two groups still miss the live path. See the report accompanying this
--   migration: the remaining fix is in computeLiveSeoBenchmark, not in data.

-- ── 3. score history — keep the sparklines continuous ─────────────────────────
-- /api/baselines/score-history filters on sub_industry. Without this the admin
-- UI trend sparkline for the two renamed groups goes blank (it would query the
-- new slug against rows still stamped with the old one).

UPDATE baseline_domain_score_history SET industry = 'building_supplies'  WHERE industry = 'flooring_tiles';
UPDATE baseline_domain_score_history SET industry = 'real_estate_agency' WHERE industry = 'real_estate';

UPDATE baseline_domain_score_history SET sub_industry = 'building_supplies_brisbane'
  WHERE sub_industry = 'flooring_tiles_brisbane';
UPDATE baseline_domain_score_history SET sub_industry = 'real_estate_agency_auckland'
  WHERE sub_industry = 'real_estate_auckland';

-- ── 4. any benchmark rows already written under the drifted keys ──────────────
-- Expected to affect 0 rows: the only writer of these keys was the cron whose
-- upsert had been failing since 2026-05-13. Included so the migration is still
-- correct if a manual/backfilled row exists. Drop a stale row only when a
-- correctly-keyed row already occupies its slot (unique key is
-- industry_category, business_size, market, dimension); otherwise rename it.

DELETE FROM industry_benchmarks stale
WHERE stale.industry_category IN ('flooring_tiles', 'real_estate')
  AND EXISTS (
    SELECT 1 FROM industry_benchmarks fresh
    WHERE fresh.industry_category = CASE stale.industry_category
            WHEN 'flooring_tiles' THEN 'building_supplies'
            WHEN 'real_estate'    THEN 'real_estate_agency'
          END
      AND fresh.business_size IS NOT DISTINCT FROM stale.business_size
      AND fresh.market        IS NOT DISTINCT FROM stale.market
      AND fresh.dimension     IS NOT DISTINCT FROM stale.dimension
  );

UPDATE industry_benchmarks SET industry_category = 'building_supplies'  WHERE industry_category = 'flooring_tiles';
UPDATE industry_benchmarks SET industry_category = 'real_estate_agency' WHERE industry_category = 'real_estate';

COMMIT;

-- ── Verification (run after applying) ─────────────────────────────────────────
-- Expect exactly: building_supplies 13 / logistics_3pl 18 / real_estate_agency 8
--                 / tourism_operator 22, and no other value.
--
--   SELECT industry, sub_industry, count(*)
--   FROM baseline_domains
--   GROUP BY 1, 2 ORDER BY 1, 2;
--
-- Then trigger one cron run ("▶ Run SEO baselines" on /dashboard/industry-baselines)
-- and confirm four SEO rows land under the aligned keys:
--
--   SELECT industry_category, business_size, market, dimension,
--          score_p50, score_p75, score_p90, sample_size, source, updated_at
--   FROM industry_benchmarks
--   WHERE dimension = 'seo' AND source = 'P30.0 baseline cron'
--   ORDER BY industry_category;
