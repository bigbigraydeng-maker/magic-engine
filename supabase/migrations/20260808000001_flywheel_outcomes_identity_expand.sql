-- ─────────────────────────────────────────────────────────────────────────────
-- flywheel_outcomes: stable business identity — STEP 1 of 2, EXPAND
-- Issue #859 · Attribution Correctness Work Package
--
-- ROLLOUT ORDER — this file is deliberately backward compatible:
--
--     [1] apply THIS migration        ← old main writers keep working
--     [2] deploy the new writers      ← they start filling evaluator_key
--     [3] a SEPARATE follow-up PR ships the contract migration
--         (tightens evaluator_key to NOT NULL + narrows both CHECKs to exclude
--         NULL + NOTIFY pgrst), applied only after [2] is verified:
--           SELECT count(*) FROM flywheel_outcomes WHERE evaluator_key IS NULL;
--         must be 0, and the contract must re-check that count itself and
--         RAISE EXCEPTION if it is not.
--
--   Expect that count to be non-zero for a short while AFTER [2], and do not
--   read it as a failure. The backfill below runs once, at apply time, while
--   the gap between [1] and [2] leaves the OLD writers running against the
--   expanded table — every row they write in that gap arrives with a NULL
--   evaluator the finished backfill will never revisit. Nothing would ever
--   reclaim a row written at a non-cadence window (the gate refuses custom
--   windows and each writer only recomputes its own cadence), so
--   pass 1 now adopts its own unsigned rows on the next pass it makes over the
--   action — matched on action + NULL + everything outside every FOREIGN metric
--   namespace, by UPDATE, never DELETE. The GSC evaluator deliberately does not
--   (see below). While ATTRIBUTION_DUAL_WINDOW_ENABLED is off, both writers
--   also retire their OWN rows at any non-authoritative window, because a
--   signed-but-extra window still double-counts that action for the consumers
--   that read outcome rows. Re-run the count after one full attribution cycle
--   (6h) before treating a non-zero result as a real problem.
--   (Codex P2, round 15 on PR #862.)
--
--   IF THE COUNT STILL WILL NOT REACH ZERO, the rows left are `seo.gsc.*` ones,
--   and they need a human answer rather than a guess:
--
--     SELECT o.action_id, o.metric_key, o.window_days, o.computed_at,
--            a.flywheel, a.expected_metric
--       FROM flywheel_outcomes o
--       JOIN flywheel_actions a ON a.id = o.action_id
--      WHERE o.evaluator_key IS NULL
--        AND o.metric_key LIKE 'seo.gsc.%'
--      ORDER BY o.computed_at;
--
--   The GSC evaluator deliberately signs ONLY what it writes, so it never
--   claims these. Old pass 1 attributed every action straight from
--   flywheel_metrics, which already carries seo.gsc.clicks / impressions /
--   avg_position — so a row at one of those keys could have come from either
--   writer, and nothing in the row records which metric the action promised
--   when it was written. Signing it would make this gate pass while the answer
--   is wrong, and downstream would read flywheel_metrics-derived data as an
--   authoritative GSC measurement.
--
--   Resolve per row: delete it (the bridge recomputes its cadence window on the
--   next run, so nothing is permanently lost), or label it by hand from the run
--   logs. Non-GSC unsigned rows do not appear here — pass 1 claims those by
--   excluding every foreign namespace, which IS provable, because this
--   evaluator has never written outside seo.gsc.*.
--
--   Zero actions carry a seo.gsc.* expected_metric in production as of
--   2026-08-08, so this query is expected to return nothing.
--   (Codex P2, rounds 17 and 24 on PR #862.)
--
--   The contract migration is deliberately NOT in this branch. It was, and
--   review caught the trap (PR #862, Codex P1): its NULL-count guard measures
--   DATA state, not DEPLOY state — the backfill below zeroes that count, so
--   applying both files in one batch (supabase db push, or any run-all-pending
--   flow) passes the guard and tightens the column while the old writers are
--   still live, breaking every subsequent attribution write. A guard that a
--   sibling file makes vacuously true is not a guard; the only reliable gate is
--   that the contract cannot be applied before the deploy because it does not
--   exist yet. A test pins its absence from this branch:
--   src/lib/flywheel/attribution/__tests__/rollout-order.test.ts.
--
--   Nothing here may break the writers currently running on main. Those two
--   writers INSERT without an `evaluator_key`, so this migration adds the column
--   NULLABLE and never tightens it.
--
--   The UNIQUE constraint is added here rather than in the contract because the new
--   writers' `upsert(... onConflict: 'action_id,metric_key,window_days')` cannot
--   run without it — and the old writers (DELETE-then-INSERT, which can never
--   leave two rows on one key) are unaffected by it.
--
-- WHY (all figures measured against production glbdnayojixmexgofbsd on 2026-08-08,
--      not assumed):
--
--   flywheel_outcomes has TWO independent writers:
--
--     src/lib/flywheel/attribution/job.ts
--       → 1 row per action, metric_key = flywheel_actions.expected_metric,
--         window_days default 14 (overridable via the cron route's ?window_days=)
--       → reconciled with  DELETE WHERE action_id = ?   ← no metric_key scope
--
--     src/lib/flywheel/attribution/gsc-bridge.ts
--       → 3 rows per action (seo.gsc.clicks / impressions / avg_position, or the
--         three page-scoped equivalents), window_days default 28 (overridable
--         1..90 via POST /api/clients/[id]/flywheel/gsc-attribution)
--       → reconciled with  DELETE WHERE action_id = ? AND metric_key IN (...)
--
--   Both ran DELETE-then-INSERT, so:
--     1. flywheel_outcomes.id changed on every 6-hourly cron tick — no downstream
--        consumer could hold a stable reference to "the same business outcome";
--     2. job.ts's unscoped DELETE could destroy gsc-bridge's rows (latent today
--        only because no live SEO action's expected_metric has matching
--        flywheel_metrics data — flywheel_metrics DOES already carry
--        seo.gsc.clicks / impressions / avg_position, 99 rows each, so the fuse
--        is armed);
--     3. gsc-bridge DELETEd before INSERTing, so a failed insert left the action
--        with no outcomes at all until the next successful run.
--
-- NATURAL KEY — proven, not assumed:
--
--   candidate                            duplicate groups in production
--   ──────────────────────────────────── ──────────────────────────────
--   action_id                            62   ❌ rejected outright
--   action_id, metric_key                 0   ⚠️  passes today only because the
--                                             two writers happen to use disjoint
--                                             metric_key namespaces AND run at
--                                             different windows; both are
--                                             coincidences, not invariants
--   action_id, metric_key, window_days    0   ✅ adopted
--
--   window_days belongs in the key because the same metric legitimately carries
--   two live windows (14 and 28 both present in production) and both writers
--   accept a caller-supplied window. action_id, metric_key and window_days are
--   all already NOT NULL, so the UNIQUE has no NULL-bypass semantics.
--
--   evaluator_key is deliberately NOT in the key: two evaluators answering the
--   same (action, metric, window) question are competing answers to ONE fact,
--   not two facts. It is recorded as an attribute so that each writer can
--   reconcile its own rows and never the other writer's.
--
-- THIS MIGRATION DELETES NOTHING. It contains no DELETE statement at all: if the
-- data is not in a state the constraint accepts, it aborts and leaves the table
-- untouched for a human to decide. Removing rows is a separate, PM-authorised act.
--
-- Reference: https://github.com/bigbigraydeng-maker/magic-engine/issues/859
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. evaluator_key: which pipeline produced this row ───────────────────────
--
-- NULLABLE and no DEFAULT, both on purpose:
--   * nullable  → the writers running on main today INSERT without this column
--                 and must keep working between step [1] and step [2];
--   * no DEFAULT → a writer must declare which evaluator it is rather than
--                 silently inheriting someone else's label. A DEFAULT would
--                 also make the contract PR's guard meaningless, because old rows
--                 would look filled in without any writer having said so.

ALTER TABLE flywheel_outcomes
  ADD COLUMN IF NOT EXISTS evaluator_key TEXT;

-- Backfill: BEST-EFFORT HISTORICAL INFERENCE, not proven provenance.
--
-- The seo.gsc.* namespace has in practice only ever been written by the GSC
-- bridge, so this is the best label available for rows written before the column
-- existed. It is NOT proof of which writer produced them, and it will stop being
-- a safe inference the moment a flywheel_action carries a seo.gsc.* key as its
-- expected_metric — at which point job.ts writes that namespace too. Rows written
-- from step [2] onward carry the label the writer itself declared; do not read
-- these backfilled values as if they had the same authority.
UPDATE flywheel_outcomes
   SET evaluator_key = CASE
         WHEN metric_key LIKE 'seo.gsc.%' THEN 'gsc_snapshots'
         ELSE 'flywheel_metrics'
       END
 WHERE evaluator_key IS NULL;

-- CHECK admits NULL on purpose: a SQL CHECK passes on NULL, so this constrains
-- the vocabulary without blocking the old writers' NULL inserts. The follow-up
-- contract PR narrows it once the column is tightened.
ALTER TABLE flywheel_outcomes
  DROP CONSTRAINT IF EXISTS flywheel_outcomes_evaluator_key_check;

ALTER TABLE flywheel_outcomes
  ADD CONSTRAINT flywheel_outcomes_evaluator_key_check
  CHECK (evaluator_key IS NULL OR evaluator_key IN ('flywheel_metrics', 'gsc_snapshots'));

-- ── 1b. Evaluator ownership: one authoritative writer per metric family ──────
--
-- The natural key deliberately excludes evaluator_key, which only holds up if a
-- key can never be produced by two evaluators. Otherwise "which answer is true"
-- collapses into "which writer ran last" — and that is reachable: the cron route
-- takes ?window_days= for pass 1 while pass 2 uses 28, so ?window_days=28 plus an
-- SEO action whose expected_metric is a GSC metric lands both writers on one key.
--
-- So ownership is assigned per metric family and enforced here, not just agreed
-- in code: seo.gsc.* belongs to the GSC bridge (it reads Search Console's own
-- snapshots), everything else to the flywheel_metrics evaluator. A non-owner's
-- row is rejected by the database.
--
-- Verified against production before writing this: 0 of 194 rows violate it.
--
-- ⚠️ This expression is mirrored in src/lib/flywheel/attribution/outcome-identity.ts
-- (METRIC_FAMILY_OWNERS). A test asserts the two agree — change them together.

ALTER TABLE flywheel_outcomes
  DROP CONSTRAINT IF EXISTS flywheel_outcomes_evaluator_owns_metric;

ALTER TABLE flywheel_outcomes
  ADD CONSTRAINT flywheel_outcomes_evaluator_owns_metric
  CHECK (
    evaluator_key IS NULL
    OR evaluator_key = CASE
         WHEN metric_key LIKE 'seo.gsc.%' THEN 'gsc_snapshots'
         ELSE 'flywheel_metrics'
       END
  );

COMMENT ON CONSTRAINT flywheel_outcomes_evaluator_owns_metric ON flywheel_outcomes IS
  'Exactly one evaluator is authoritative per metric family, so a natural key is never '
  'contested and execution order cannot decide the verdict. See Issue #859.';

COMMENT ON COLUMN flywheel_outcomes.evaluator_key IS
  'Which attribution pipeline computed this row: flywheel_metrics (attribution/job.ts) '
  'or gsc_snapshots (attribution/gsc-bridge.ts). Not part of the natural key — it exists '
  'so each writer reconciles only its own rows. NULL only for rows written by pre-#859 '
  'code during the expand→deploy window; historical values are inferred, not declared.';

-- ── 2. Duplicate preflight — fail closed, never delete ───────────────────────
--
-- Production preflight before writing this migration returned 0 duplicate groups
-- on (action_id, metric_key, window_days), so this block is expected to pass
-- silently. If the data has moved since, the migration ABORTS: collapsing rows
-- would be an unauthorised, irreversible deletion of client-derived data, and
-- "which row survives" is a reconciliation policy decision, not a schema one.

DO $$
DECLARE
  dup_groups INT;
  dup_rows   INT;
BEGIN
  SELECT count(*), COALESCE(sum(n), 0)
    INTO dup_groups, dup_rows
    FROM (
      SELECT count(*) AS n
        FROM flywheel_outcomes
       GROUP BY action_id, metric_key, window_days
      HAVING count(*) > 1
    ) d;

  IF dup_groups > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'raise_exception',
      MESSAGE = format(
        'flywheel_outcomes: %s duplicate (action_id, metric_key, window_days) group(s) covering %s row(s)',
        dup_groups, dup_rows),
      DETAIL  = 'The UNIQUE constraint cannot be added while duplicates exist, and this '
                'migration will not delete rows to make room for it.',
      HINT    = 'Run the preflight query, decide which row survives, and get that cleanup '
                'authorised separately: SELECT action_id, metric_key, window_days, count(*) '
                'FROM flywheel_outcomes GROUP BY 1,2,3 HAVING count(*) > 1;';
  END IF;

  RAISE NOTICE 'flywheel_outcomes: 0 duplicate (action_id, metric_key, window_days) groups — safe to add UNIQUE';
END $$;

ALTER TABLE flywheel_outcomes
  DROP CONSTRAINT IF EXISTS flywheel_outcomes_natural_key;

ALTER TABLE flywheel_outcomes
  ADD CONSTRAINT flywheel_outcomes_natural_key
  UNIQUE (action_id, metric_key, window_days);

COMMENT ON CONSTRAINT flywheel_outcomes_natural_key ON flywheel_outcomes IS
  'Stable business identity of an outcome: the measured effect of one action on one metric '
  'over one window. Upsert target for both attribution writers — see '
  'src/lib/flywheel/attribution/outcome-identity.ts.';

-- ── 3. outcome_key: the natural key as one readable handle ───────────────────
--
-- Generated + STORED so downstream consumers (memory extraction, reporting)
-- reference one canonical string instead of each re-deriving the concatenation
-- and drifting from one another. All three inputs are NOT NULL, so this is
-- always defined.

ALTER TABLE flywheel_outcomes
  ADD COLUMN IF NOT EXISTS outcome_key TEXT
  GENERATED ALWAYS AS (
    action_id::text || ':' || metric_key || ':' || window_days::text
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_flywheel_outcomes_outcome_key
  ON flywheel_outcomes(outcome_key);

COMMENT ON COLUMN flywheel_outcomes.outcome_key IS
  'Canonical handle for the natural key (action_id:metric_key:window_days). Derived — never written directly.';

-- ── 4. Let PostgREST see the new columns ─────────────────────────────────────
-- Without this the API layer can keep serving a cached schema, and the newly
-- deployed writers get "column evaluator_key does not exist" on their first run.

NOTIFY pgrst, 'reload schema';
