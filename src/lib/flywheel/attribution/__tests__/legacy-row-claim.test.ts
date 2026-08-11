/**
 * Rows the deploy window leaves unsigned — Issue #859, Codex P2 round 15.
 *
 * The expand migration backfills `evaluator_key` ONCE, at apply time. The
 * rollout then deliberately keeps the OLD code running against the expanded
 * table until #862 deploys, and that old code accepted any window from 1 to 90.
 * A row written inside that gap therefore gets a NULL evaluator that the
 * finished backfill will never revisit.
 *
 * What makes it permanent rather than transient: after the deploy the gate
 * refuses custom windows and each writer only recomputes its own cadence, so
 * the new writers never land on that natural key — nothing ever signs the row.
 * The contract migration's `NULL count = 0` precondition would then be
 * unsatisfiable forever, and the rollout could not finish.
 *
 * So each writer adopts the rows it can prove are its own: same action, NULL
 * evaluator, metric key inside its own vocabulary. An UPDATE, never a DELETE —
 * the row is a real measurement, and the point of this Work Package is that no
 * writer destroys another's evidence.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FakeOutcomesDb } from './fake-outcomes-db'
import { OUTCOME_EVALUATOR } from '../outcome-identity'
import { DUAL_WINDOW_FLAG } from '../dual-window-gate'

let db: FakeOutcomesDb

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => db.from(table),
  },
}))

const ACTION_ID = 'action-seo-1'
const CLIENT_ID = 'client-1'
const EXECUTED_AT = '2026-06-01T00:00:00.000Z'
const GSC_CLICKS = 'seo.gsc.clicks'
const SOCIAL_METRIC = 'social.followers'

/**
 * The representative SEO action: its own `expected_metric` is NOT in the GSC
 * namespace, which is what all 205 actions in production look like today. The
 * ambiguous shape — expected_metric IS a GSC key, so old pass 1 could have
 * written that row too — is exercised separately below, deliberately.
 */
function seedSeoAction(): void {
  db.seed('flywheel_actions', [
    {
      id: ACTION_ID,
      client_id: CLIENT_ID,
      flywheel: 'seo',
      action_type: 'seo.publish_blog',
      expected_metric: 'seo.domain.organic_traffic',
      expected_delta: 1,
      executed_at: EXECUTED_AT,
      payload: null,
    },
  ])
}

function seedGscSnapshots(): void {
  db.seed('gsc_performance_snapshots', [
    { client_id: CLIENT_ID, period_end: '2026-05-31', total_clicks: 100, total_impressions: 1000, avg_position: 20, top_pages: null },
    { client_id: CLIENT_ID, period_end: '2026-07-15', total_clicks: 150, total_impressions: 1600, avg_position: 12, top_pages: null },
  ])
}

/**
 * A row exactly as the OLD code left it: no `evaluator_key` column value at
 * all. Written at 7 days — a window neither writer will ever recompute once the
 * gate is off, which is what makes it unreachable by the ordinary upsert path.
 */
function seedUnsignedRow(over: Record<string, unknown> = {}): void {
  db.seed('flywheel_outcomes', [
    {
      id: 'legacy-1',
      action_id: ACTION_ID,
      client_id: CLIENT_ID,
      metric_key: GSC_CLICKS,
      window_days: 7,
      baseline: 100,
      after_value: 120,
      delta: 20,
      delta_pct: 20,
      confidence: 0.9,
      verdict: 'confirmed',
      evaluator_key: null,
      computed_at: '2026-06-10T00:00:00.000Z',
      ...over,
    },
  ])
}

/**
 * The same row, already carrying this evaluator's key — what the expand
 * migration's backfill leaves for a row the bridge itself wrote, and what any
 * row written after the deploy carries. The window retire is scoped to our own
 * key, so this is the shape it acts on; an unsigned row is deliberately outside
 * its reach (see "the GSC evaluator never signs a row it did not write").
 */
function seedSignedRow(over: Record<string, unknown> = {}): void {
  seedUnsignedRow({ evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS, ...over })
}

async function runBridge(windowDays = 28) {
  const { runGscAttributionForClient } = await import('../gsc-bridge')
  return runGscAttributionForClient(CLIENT_ID, windowDays)
}

async function runJob(windowDays?: number) {
  const { runAttributionJob } = await import('../job')
  return runAttributionJob({ clientId: CLIENT_ID, windowDays })
}

beforeEach(() => {
  db = new FakeOutcomesDb()
  vi.clearAllMocks()
  delete process.env[DUAL_WINDOW_FLAG] // shipped default: dual window OFF
})

// ── The GSC evaluator signs only what it writes ──────────────────────────────

describe('the GSC evaluator never signs a row it did not write this run', () => {
  /**
   * Round 15 had it claim unsigned `seo.gsc.*` rows so the contract gate could
   * be satisfied. Round 17 showed old pass 1 could have written that exact key
   * (it attributed straight from flywheel_metrics, which carries all three GSC
   * keys), so the claim was narrowed to exclude the action's own
   * expected_metric. Round 24 showed the narrowing reads the CURRENT metric
   * while the ambiguity was created by whatever it was at the time — and once
   * the todo has a human correct A → B, the A row becomes claimable again.
   *
   * The missing fact is history, and no query recovers it. So the claim is
   * gone: this evaluator signs only what it writes, and an unsigned GSC row is
   * a human's call at rollout step [2].
   */
  it('leaves an unsigned 7-day row exactly as it is', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true'
    seedSeoAction()
    seedGscSnapshots()
    seedUnsignedRow()

    const result = await runBridge(28)

    const legacy = db.outcomes().find(r => r.window_days === 7)
    expect(legacy).toBeDefined()                 // not deleted
    expect(legacy?.evaluator_key).toBeNull()     // and not guessed at
    expect(result.reconcile_errors).toBe(0)      // nothing was even attempted
  })

  it('still leaves it alone after the metric has been corrected', async () => {
    // The round-24 case specifically: the row sits at metric A, which is no
    // longer what the action promises, so an exclusion keyed on the CURRENT
    // expected_metric would have let it through.
    process.env[DUAL_WINDOW_FLAG] = 'true'
    db.seed('flywheel_actions', [
      {
        id: ACTION_ID, client_id: CLIENT_ID, flywheel: 'seo',
        action_type: 'seo.publish_blog',
        expected_metric: 'seo.gsc.impressions',   // corrected to B…
        expected_delta: 1, executed_at: EXECUTED_AT, payload: null,
      },
    ])
    seedGscSnapshots()
    seedUnsignedRow()                             // …row still sits at A

    await runBridge(28)

    expect(db.outcomes().find(r => r.window_days === 7)?.evaluator_key).toBeNull()
  })

  it('signs the rows it does write, through the upsert', async () => {
    // Removing the claim must not weaken the ordinary path: everything this
    // evaluator computes still carries its key.
    seedSeoAction()
    seedGscSnapshots()

    await runBridge(28)

    const written = db.outcomes().filter(r => r.window_days === 28)
    expect(written).toHaveLength(3)
    expect(new Set(written.map(r => r.evaluator_key)))
      .toEqual(new Set([OUTCOME_EVALUATOR.GSC_SNAPSHOTS]))
  })

  it('does not retire an unsigned row either — the retire is scoped to our key', async () => {
    // Not-claiming must not turn into deleting-by-default: the row is a real
    // measurement of unknown provenance, and this PR exists because writers
    // used to destroy rows that were not theirs.
    seedSeoAction()
    seedGscSnapshots()
    seedUnsignedRow()

    await runBridge(28)   // gate OFF: the window retire runs

    expect(db.outcomes().find(r => r.window_days === 7)).toBeDefined()
  })
})

// ── The flywheel_metrics evaluator ───────────────────────────────────────────

describe('the flywheel_metrics evaluator adopts its own unsigned rows', () => {
  function seedSocialAction(): void {
    db.seed('flywheel_actions', [
      {
        id: 'action-social-1',
        client_id: CLIENT_ID,
        flywheel: 'social',
        action_type: 'social.publish',
        expected_metric: SOCIAL_METRIC,
        expected_delta: 1,
        executed_at: EXECUTED_AT,
        payload: null,
      },
    ])
    db.seed('flywheel_metrics', [
      { client_id: CLIENT_ID, metric_key: SOCIAL_METRIC, metric_value: 100, measured_at: '2026-05-30T00:00:00.000Z' },
      { client_id: CLIENT_ID, metric_key: SOCIAL_METRIC, metric_value: 140, measured_at: '2026-06-05T00:00:00.000Z' },
    ])
  }

  it('signs a 21-day row left by the old ungated pass 1 (dual-window ON)', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true'
    // Reachable on main: the cron accepted ?window_days=. After the deploy the
    // gate refuses it and this job only recomputes DEFAULT_WINDOW_DAYS, so the
    // upsert never lands on window 21 again.
    seedSocialAction()
    db.seed('flywheel_outcomes', [
      {
        id: 'legacy-21',
        action_id: 'action-social-1',
        client_id: CLIENT_ID,
        metric_key: SOCIAL_METRIC,
        window_days: 21,
        baseline: 100,
        after_value: 130,
        delta: 30,
        delta_pct: 30,
        confidence: 0.9,
        verdict: 'confirmed',
        evaluator_key: null,
        computed_at: '2026-06-10T00:00:00.000Z',
      },
    ])

    await runJob(14)

    const legacy = db.outcomes().find(r => r.window_days === 21)
    expect(legacy?.evaluator_key).toBe(OUTCOME_EVALUATOR.FLYWHEEL_METRICS)
    expect(legacy?.id).toBe('legacy-21')
  })

  it('signs an immature action\u2019s row even though there is no baseline yet', async () => {
    // processAction returns false at the missing baseline, long before the
    // upsert. Reconciling only after a successful write would leave this row
    // unsigned for as long as the action has no metrics — and the rollout's
    // NULL-count gate would sit blocked on it. (Codex P2, round 16.)
    process.env[DUAL_WINDOW_FLAG] = 'true'
    db.seed('flywheel_actions', [
      {
        id: 'action-social-1', client_id: CLIENT_ID, flywheel: 'social',
        action_type: 'social.publish', expected_metric: SOCIAL_METRIC,
        expected_delta: 1, executed_at: EXECUTED_AT, payload: null,
      },
    ])
    // Deliberately no flywheel_metrics rows at all.
    db.seed('flywheel_outcomes', [
      {
        id: 'legacy-21', action_id: 'action-social-1', client_id: CLIENT_ID,
        metric_key: SOCIAL_METRIC, window_days: 21,
        baseline: 100, after_value: 130, delta: 30, delta_pct: 30,
        confidence: 0.9, verdict: 'confirmed', evaluator_key: null,
        computed_at: '2026-06-10T00:00:00.000Z',
      },
    ])

    const result = await runJob(14)

    expect(result.written).toBe(0) // nothing to attribute yet
    expect(db.outcomes().find(r => r.id === 'legacy-21')?.evaluator_key)
      .toBe(OUTCOME_EVALUATOR.FLYWHEEL_METRICS)
  })

  it('reports a failed reconciliation instead of logging it', async () => {
    // The failure shows up nowhere else: the action still attributes fine, so
    // `written` goes up and `failed` stays 0 while the unsigned row keeps the
    // contract migration blocked. A finding that only reaches console.error is
    // the shape CLAUDE.md §3 forbids, and the GSC writer already reports its
    // equivalent. (Codex P1, round 18.)
    seedSocialAction()
    db.failNext('flywheel_outcomes', 'update', 'permission denied')

    const result = await runJob(14)

    expect(result.written).toBe(1)   // the attribution itself was fine
    expect(result.failed).toBe(0)    // …so it is not an attribution failure
    expect(result.reconcileErrors).toBe(1)
    expect(result.reconcileErrorSamples.join(' ')).toContain('claim unsigned outcomes')
  })

  it('reports a failed window retire the same way', async () => {
    seedSocialAction()
    // The SECOND delete: [2] retires abandoned metrics, [3] retires extra
    // windows. Targeting the first would test a different statement.
    db.failNext('flywheel_outcomes', 'delete', 'deadlock detected', { afterMatches: 1 })

    const result = await runJob(14)

    expect(result.reconcileErrors).toBe(1)
    expect(result.reconcileErrorSamples.join(' ')).toContain('retire non-authoritative windows')
  })

  it('counts nothing when reconciliation succeeds', async () => {
    seedSocialAction()

    const result = await runJob(14)

    expect(result.reconcileErrors).toBe(0)
    expect(result.reconcileErrorSamples).toEqual([])
  })

  it('does not disown a landed write when the claim fails', async () => {
    seedSocialAction()
    db.failNext('flywheel_outcomes', 'update', 'connection reset')

    const result = await runJob(14)

    // The outcome for window 14 was written; a failed claim is reconciliation
    // debt, not a failed attribution. The contract migration's preflight is
    // what refuses to let it decay into a silent hole — it aborts on NULLs.
    expect(result.written).toBe(1)
    expect(result.failed).toBe(0)
  })
})

// ── The gate's real promise: one window per action in production ────────────

describe('with dual-window OFF, an action never ends up holding two windows', () => {
  it('retires the legacy 7-day row instead of merely signing it', async () => {
    // Signing alone was not enough, and this is the finding that showed it: the
    // action would hold BOTH a 7-day and a 28-day answer, and the memory
    // consumers still count outcome ROWS — so its evidence is doubled while the
    // gate is supposedly holding production at one window. On main this could
    // not happen, because every writer DELETEd by action before inserting.
    seedSeoAction()
    seedGscSnapshots()
    seedSignedRow()

    await runBridge(28)

    const windows = db.outcomes().map(r => r.window_days)
    expect(new Set(windows)).toEqual(new Set([28]))
    expect(db.outcomes().filter(r => r.action_id === ACTION_ID)).toHaveLength(3)
  })

  it('does NOT drop the only evidence when the authoritative window cannot be computed', async () => {
    // The regression moving reconciliation before the write introduced: with the
    // gate off, an action holding only a 7-day row from the deploy gap and no
    // mature 28-day snapshot had its one row deleted, and then the recompute
    // declined to run. It went from "some evidence" to none — and the reason it
    // was deleted is precisely that we cannot recompute it.
    // (Codex P1, round 22.)
    seedSeoAction()
    seedSignedRow()          // 7 days
    // Deliberately NO snapshots: attributeAction returns early.

    const result = await runBridge(28)

    expect(result.outcomes_written).toBe(0)
    const legacy = db.outcomes().find(r => r.window_days === 7)
    expect(legacy).toBeDefined()
    // Claimed all the same — claiming is an UPDATE and stays pre-write, which
    // is what round 16 needed. Only the DELETE waits.
    expect(legacy?.evaluator_key).toBe(OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
  })

  it('drops it on the pass that finally writes the authoritative window', async () => {
    // The duplicate is transient, not permanent: the moment the replacement
    // lands, the extra window goes.
    seedSeoAction()
    seedSignedRow()

    await runBridge(28)                       // nothing to compute yet → 7 survives
    expect(db.outcomes().some(r => r.window_days === 7)).toBe(true)

    seedGscSnapshots()                        // the action matures
    await runBridge(28)

    expect(new Set(db.outcomes().map(r => r.window_days))).toEqual(new Set([28]))
  })

  it('pass 1 keeps its only row when there is no baseline to recompute from', async () => {
    db.seed('flywheel_actions', [
      {
        id: 'action-social-1', client_id: CLIENT_ID, flywheel: 'social',
        action_type: 'social.publish', expected_metric: SOCIAL_METRIC,
        expected_delta: 1, executed_at: EXECUTED_AT, payload: null,
      },
    ])
    // No flywheel_metrics rows at all → processAction returns before the upsert.
    db.seed('flywheel_outcomes', [
      {
        id: 'only-row', action_id: 'action-social-1', client_id: CLIENT_ID,
        metric_key: SOCIAL_METRIC, window_days: 21,
        baseline: 100, after_value: 130, delta: 30, delta_pct: 30,
        confidence: 0.9, verdict: 'confirmed',
        evaluator_key: OUTCOME_EVALUATOR.FLYWHEEL_METRICS,
        computed_at: '2026-06-10T00:00:00.000Z',
      },
    ])

    const result = await runJob(14)

    expect(result.written).toBe(0)
    expect(db.outcomes().find(r => r.id === 'only-row')).toBeDefined()
  })

  it('keeps both windows once dual-window is enabled', async () => {
    // Same inputs, flag on: the extra window is legitimate and is preserved.
    // Without this pair, "retire everything else" and "the gate does nothing"
    // would look identical.
    process.env[DUAL_WINDOW_FLAG] = 'true'
    seedSeoAction()
    seedGscSnapshots()
    seedSignedRow()

    await runBridge(28)

    expect(new Set(db.outcomes().map(r => r.window_days))).toEqual(new Set([7, 28]))
  })

  it('does not touch the OTHER evaluator\'s rows when retiring windows', async () => {
    // The retire is scoped to our own evaluator_key. A flywheel_metrics row at
    // a different window is not ours to withdraw, and this PR exists because
    // writers used to delete each other's evidence.
    seedSeoAction()
    seedGscSnapshots()
    db.seed('flywheel_outcomes', [
      {
        id: 'other-14',
        action_id: ACTION_ID,
        client_id: CLIENT_ID,
        metric_key: SOCIAL_METRIC,
        window_days: 14,
        baseline: 1, after_value: 2, delta: 1, delta_pct: 100,
        confidence: 0.5, verdict: 'confirmed',
        evaluator_key: OUTCOME_EVALUATOR.FLYWHEEL_METRICS,
        computed_at: '2026-06-10T00:00:00.000Z',
      },
    ])

    await runBridge(28)

    expect(db.outcomes().find(r => r.id === 'other-14')).toBeDefined()
  })

  it('pass 1 clears the old metric\u2019s rows after expected_metric is corrected', async () => {
    // The correction is something the system actively asks a human to make —
    // the action_unattributable todo says "回我一句改指标". On main the
    // action-wide DELETE cleared the old metric's rows as a side effect;
    // removing that delete was necessary, so this job has to be done on purpose
    // now. Ungated: a key the action no longer promises is wrong at every
    // window, not only the non-authoritative ones. (Codex P2, round 19.)
    process.env[DUAL_WINDOW_FLAG] = 'true' // prove it is NOT the window retire doing this
    db.seed('flywheel_actions', [
      {
        id: 'action-social-1', client_id: CLIENT_ID, flywheel: 'social',
        action_type: 'social.publish', expected_metric: SOCIAL_METRIC,
        expected_delta: 1, executed_at: EXECUTED_AT, payload: null,
      },
    ])
    db.seed('flywheel_metrics', [
      { client_id: CLIENT_ID, metric_key: SOCIAL_METRIC, metric_value: 100, measured_at: '2026-05-30T00:00:00.000Z' },
      { client_id: CLIENT_ID, metric_key: SOCIAL_METRIC, metric_value: 140, measured_at: '2026-06-05T00:00:00.000Z' },
    ])
    // What the action USED to promise, at the very same window it runs at now.
    db.seed('flywheel_outcomes', [
      {
        id: 'old-metric', action_id: 'action-social-1', client_id: CLIENT_ID,
        metric_key: 'social.reach', window_days: 14,
        baseline: 10, after_value: 12, delta: 2, delta_pct: 20,
        confidence: 0.5, verdict: 'confirmed',
        evaluator_key: OUTCOME_EVALUATOR.FLYWHEEL_METRICS,
        computed_at: '2026-06-10T00:00:00.000Z',
      },
    ])

    await runJob(14)

    expect(db.outcomes().find(r => r.id === 'old-metric')).toBeUndefined()
    expect(db.outcomes().map(r => r.metric_key)).toEqual([SOCIAL_METRIC])
  })

  it('claims an unsigned row at the OLD metric after a correction, then retires it', async () => {
    // The hole the todo pipeline itself opens: inside the expand→deploy gap the
    // old writer leaves an unsigned row at metric A, then a human corrects the
    // action to metric B — which is exactly what `action_unattributable` asks
    // for. Claiming only the CURRENT metric leaves A unsigned, and the
    // abandoned-metric retire only matches rows already signed, so A was
    // claimed by nobody and deleted by nobody: still read as evidence, and
    // permanently blocking the contract gate. (Codex P2, round 21.)
    process.env[DUAL_WINDOW_FLAG] = 'true'
    db.seed('flywheel_actions', [
      {
        id: 'action-social-1', client_id: CLIENT_ID, flywheel: 'social',
        action_type: 'social.publish', expected_metric: SOCIAL_METRIC,
        expected_delta: 1, executed_at: EXECUTED_AT, payload: null,
      },
    ])
    db.seed('flywheel_metrics', [
      { client_id: CLIENT_ID, metric_key: SOCIAL_METRIC, metric_value: 100, measured_at: '2026-05-30T00:00:00.000Z' },
      { client_id: CLIENT_ID, metric_key: SOCIAL_METRIC, metric_value: 140, measured_at: '2026-06-05T00:00:00.000Z' },
    ])
    db.seed('flywheel_outcomes', [
      {
        id: 'gap-row', action_id: 'action-social-1', client_id: CLIENT_ID,
        metric_key: 'social.reach',                      // what it promised before
        window_days: 14,
        baseline: 10, after_value: 12, delta: 2, delta_pct: 20,
        confidence: 0.5, verdict: 'confirmed',
        evaluator_key: null,                             // written in the gap
        computed_at: '2026-06-10T00:00:00.000Z',
      },
    ])

    const result = await runJob(14)

    // Claimed (so it is ours to withdraw) and then withdrawn — one pass.
    expect(db.outcomes().find(r => r.id === 'gap-row')).toBeUndefined()
    // Nothing unsigned is left to block the rollout gate.
    expect(db.outcomes().filter(r => r.evaluator_key == null)).toEqual([])
    expect(result.written).toBe(1)
  })

  it('excludes the other evaluator\'s namespace in the QUERY, not by hitting the CHECK', async () => {
    // A seo.gsc.* row could have come from either writer — round 17 settled
    // that guessing is worse than letting the rollout gate hold. But asserting
    // only "the row stayed unsigned" proves nothing: an unscoped claim leaves it
    // unsigned too, because the ownership CHECK rejects the statement — and
    // takes down every row the claim was supposed to sign with it. The real
    // assertion is that the run is clean AND the claimable row got claimed.
    process.env[DUAL_WINDOW_FLAG] = 'true'
    db.seed('flywheel_actions', [
      {
        id: 'action-social-1', client_id: CLIENT_ID, flywheel: 'social',
        action_type: 'social.publish', expected_metric: SOCIAL_METRIC,
        expected_delta: 1, executed_at: EXECUTED_AT, payload: null,
      },
    ])
    db.seed('flywheel_metrics', [
      { client_id: CLIENT_ID, metric_key: SOCIAL_METRIC, metric_value: 100, measured_at: '2026-05-30T00:00:00.000Z' },
      { client_id: CLIENT_ID, metric_key: SOCIAL_METRIC, metric_value: 140, measured_at: '2026-06-05T00:00:00.000Z' },
    ])
    db.seed('flywheel_outcomes', [
      {
        id: 'ambiguous', action_id: 'action-social-1', client_id: CLIENT_ID,
        metric_key: GSC_CLICKS, window_days: 14,
        baseline: 1, after_value: 2, delta: 1, delta_pct: 100,
        confidence: 0.5, verdict: 'confirmed', evaluator_key: null,
        computed_at: '2026-06-10T00:00:00.000Z',
      },
      {
        // Ours beyond doubt, at a window we will not recompute: it must be
        // signed on this same pass.
        id: 'ours', action_id: 'action-social-1', client_id: CLIENT_ID,
        metric_key: SOCIAL_METRIC, window_days: 21,
        baseline: 1, after_value: 2, delta: 1, delta_pct: 100,
        confidence: 0.5, verdict: 'confirmed', evaluator_key: null,
        computed_at: '2026-06-10T00:00:00.000Z',
      },
    ])

    const result = await runJob(14)

    // Not guessed at, not deleted.
    const ambiguous = db.outcomes().find(r => r.id === 'ambiguous')
    expect(ambiguous?.evaluator_key).toBeNull()
    // And the claim still did its job for the row it could prove.
    expect(db.outcomes().find(r => r.id === 'ours')?.evaluator_key)
      .toBe(OUTCOME_EVALUATOR.FLYWHEEL_METRICS)
    expect(result.reconcileErrors).toBe(0)
  })

  it('pass 1 clears its old rows when the metric moves to the OTHER evaluator', async () => {
    // The reverse of the case above, and the one that stayed immortal: an SEO
    // action whose expected_metric moves from a flywheel_metrics key to a GSC
    // key. Pass 1 defers the action, the bridge only retires keys in its own
    // vocabulary, so the old verdict had no owner willing to withdraw it — and
    // the orphan audit missed it too, because it asks "can the owner load this
    // action?" and this evaluator loads every flywheel. (Codex P2, round 20.)
    process.env[DUAL_WINDOW_FLAG] = 'true' // not the window retire doing this
    db.seed('flywheel_actions', [
      {
        id: 'action-seo-moved', client_id: CLIENT_ID, flywheel: 'seo',
        action_type: 'seo.publish_blog',
        expected_metric: GSC_CLICKS,          // corrected to the GSC evaluator's key
        expected_delta: 1, executed_at: EXECUTED_AT, payload: null,
      },
    ])
    db.seed('flywheel_outcomes', [
      {
        id: 'old-owner-row', action_id: 'action-seo-moved', client_id: CLIENT_ID,
        metric_key: 'seo.domain.organic_traffic', window_days: 14,
        baseline: 100, after_value: 120, delta: 20, delta_pct: 20,
        confidence: 0.9, verdict: 'confirmed',
        evaluator_key: OUTCOME_EVALUATOR.FLYWHEEL_METRICS,
        computed_at: '2026-06-10T00:00:00.000Z',
      },
    ])

    const result = await runJob(14)

    expect(result.deferred).toBe(1)                       // pass 1 hands it over…
    expect(db.outcomes()).toEqual([])                     // …and withdraws its own verdict
  })

  it('does not touch the OTHER evaluator\'s rows when it defers', async () => {
    // Deferral must not become a licence to clear the action wholesale — that
    // is the delete this PR removed.
    process.env[DUAL_WINDOW_FLAG] = 'true'
    db.seed('flywheel_actions', [
      {
        id: 'action-seo-moved', client_id: CLIENT_ID, flywheel: 'seo',
        action_type: 'seo.publish_blog', expected_metric: GSC_CLICKS,
        expected_delta: 1, executed_at: EXECUTED_AT, payload: null,
      },
    ])
    db.seed('flywheel_outcomes', [
      {
        id: 'gsc-row', action_id: 'action-seo-moved', client_id: CLIENT_ID,
        metric_key: GSC_CLICKS, window_days: 28,
        baseline: 100, after_value: 150, delta: 50, delta_pct: 50,
        confidence: 0.9, verdict: 'confirmed',
        evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS,
        computed_at: '2026-06-10T00:00:00.000Z',
      },
    ])

    await runJob(14)

    expect(db.outcomes().map(r => r.id)).toEqual(['gsc-row'])
  })

  it('reports a reconciliation failure on the defer path too', async () => {
    // The defer branch used to `continue` before any reconciliation existed, so
    // it is the path most likely to go quiet again.
    process.env[DUAL_WINDOW_FLAG] = 'true'
    db.seed('flywheel_actions', [
      {
        id: 'action-seo-moved', client_id: CLIENT_ID, flywheel: 'seo',
        action_type: 'seo.publish_blog', expected_metric: GSC_CLICKS,
        expected_delta: 1, executed_at: EXECUTED_AT, payload: null,
      },
    ])
    db.failNext('flywheel_outcomes', 'delete', 'permission denied')

    const result = await runJob(14)

    expect(result.reconcileErrors).toBe(1)
    expect(result.reconcileErrorSamples.join(' ')).toContain('retire abandoned metric outcomes')
  })

  it('pass 1 retires its own non-authoritative windows too', async () => {
    db.seed('flywheel_actions', [
      {
        id: 'action-social-1', client_id: CLIENT_ID, flywheel: 'social',
        action_type: 'social.publish', expected_metric: SOCIAL_METRIC,
        expected_delta: 1, executed_at: EXECUTED_AT, payload: null,
      },
    ])
    db.seed('flywheel_metrics', [
      { client_id: CLIENT_ID, metric_key: SOCIAL_METRIC, metric_value: 100, measured_at: '2026-05-30T00:00:00.000Z' },
      { client_id: CLIENT_ID, metric_key: SOCIAL_METRIC, metric_value: 140, measured_at: '2026-06-05T00:00:00.000Z' },
    ])
    db.seed('flywheel_outcomes', [
      {
        id: 'legacy-21', action_id: 'action-social-1', client_id: CLIENT_ID,
        metric_key: SOCIAL_METRIC, window_days: 21,
        baseline: 100, after_value: 130, delta: 30, delta_pct: 30,
        confidence: 0.9, verdict: 'confirmed', evaluator_key: null,
        computed_at: '2026-06-10T00:00:00.000Z',
      },
    ])

    await runJob(14)

    expect(db.outcomes().map(r => r.window_days)).toEqual([14])
  })
})

// ── Why the claim is needed at all ───────────────────────────────────────────

describe('the ordinary write path cannot reach these rows', () => {
  it('a cadence run does not touch a 7-day row on its own', async () => {
    // Without the claim this is the whole bug: the run succeeds, writes its own
    // three rows, and the unsigned one is simply never visited.
    process.env[DUAL_WINDOW_FLAG] = 'true'
    seedSeoAction()
    seedGscSnapshots()
    seedUnsignedRow()

    await runBridge(28)

    const rows = db.outcomes()
    // Four rows total — the legacy one was NOT replaced or deleted by the run.
    expect(rows).toHaveLength(4)
    expect(rows.filter(r => r.window_days === 28)).toHaveLength(3)
    // Which is exactly why signing it has to be an explicit step.
    expect(rows.find(r => r.window_days === 7)?.id).toBe('legacy-1')
  })

  it('leaves an unsigned row for the rollout gate rather than guessing at it', async () => {
    // The inverse of what this test used to assert. Round 15 had the bridge
    // clear the unsigned rows so the contract gate would pass; rounds 17 and 24
    // showed the signature it applied could be wrong. A gate that holds on a
    // row a human can look up beats one that opens on a guess — the expand
    // migration's header carries the query and the two ways to resolve it.
    process.env[DUAL_WINDOW_FLAG] = 'true'
    seedSeoAction()
    seedGscSnapshots()
    seedUnsignedRow()

    await runBridge(28)

    const unsigned = db.outcomes().filter(r => r.evaluator_key == null)
    expect(unsigned).toHaveLength(1)
    expect(unsigned[0].id).toBe('legacy-1')
  })
})
