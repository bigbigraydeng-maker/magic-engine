/**
 * Window handoff on deferral — Issue #859, Codex P2 on PR #862.
 *
 * Arbitration makes pass 1 defer any action whose expected_metric the GSC
 * evaluator owns. But pass 1 was asked a question at a specific window
 * (default 14, or ?window_days=N), and the bridge's own cadence is 28 — so a
 * deferral that drops the window silently changes which question gets
 * answered: the 14-day (or N-day) outcome never exists.
 *
 * The fix: the cron route forwards pass 1's effective window, and the bridge
 * additionally computes deferred actions at that window. These tests pin the
 * whole chain: deferral happens AND the deferred window's answer exists —
 * produced by the owning evaluator.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FakeOutcomesDb } from './fake-outcomes-db'
import { OUTCOME_EVALUATOR } from '../outcome-identity'
import { DUAL_WINDOW_FLAG } from '../dual-window-gate'
import { DEFAULT_WINDOW_DAYS } from '../job'

let db: FakeOutcomesDb

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => db.from(table),
  },
}))

const ACTION_ID = 'action-deferred'
const CLIENT_ID = 'client-1'
const EXECUTED_AT = '2026-06-01T00:00:00.000Z'
const GSC_CLICKS = 'seo.gsc.clicks'

function seedDeferredAction(expectedMetric = GSC_CLICKS): void {
  db.seed('flywheel_actions', [
    {
      id: ACTION_ID,
      client_id: CLIENT_ID,
      flywheel: 'seo',
      action_type: 'seo.publish_blog',
      expected_metric: expectedMetric,
      expected_delta: 1,
      executed_at: EXECUTED_AT,
      payload: null,
    },
  ])
}

/** Snapshots far enough out to satisfy any window in these tests (7..28). */
function seedSnapshots(): void {
  db.seed('gsc_performance_snapshots', [
    { client_id: CLIENT_ID, period_end: '2026-05-31', total_clicks: 100, total_impressions: 1000, avg_position: 20, top_pages: null },
    { client_id: CLIENT_ID, period_end: '2026-07-15', total_clicks: 150, total_impressions: 1600, avg_position: 12, top_pages: null },
  ])
}

async function runJob(windowDays: number) {
  const { runAttributionJob } = await import('../job')
  return runAttributionJob({ clientId: CLIENT_ID, windowDays })
}

async function runBridge(deferredWindowDays?: number) {
  const { runGscAttributionForClient } = await import('../gsc-bridge')
  return runGscAttributionForClient(CLIENT_ID, undefined, { deferredWindowDays })
}

function outcomeWindows(metricKey: string): number[] {
  return db
    .outcomes()
    .filter(r => r.metric_key === metricKey)
    .map(r => r.window_days as number)
    .sort((a, b) => a - b)
}

beforeEach(() => {
  db = new FakeOutcomesDb()
  vi.clearAllMocks()
  delete process.env[DUAL_WINDOW_FLAG]
})

// ── Criterion 1: the default cron leaves a 14-day answer ────────────────────

describe('default cron (pass 1 at 14, bridge cadence 28)', () => {
  it('the deferred action ends up with a 14-day outcome for its expected_metric', async () => {
    seedDeferredAction()
    seedSnapshots()

    const jobResult = await runJob(14)
    expect(jobResult.deferred).toBe(1) // the deferral really happened — not vacuous
    expect(jobResult.pass2ClientIds).toEqual([CLIENT_ID]) // and named its client
    expect(db.outcomes()).toHaveLength(0) // and pass 1 wrote nothing

    await runBridge(14)

    expect(outcomeWindows(GSC_CLICKS)).toEqual([14, 28])
    const fourteen = db
      .outcomes()
      .find(r => r.metric_key === GSC_CLICKS && r.window_days === 14)
    expect(fourteen?.evaluator_key).toBe(OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
  })

  it('the handoff fills all three family metrics at the deferred window', async () => {
    // The bridge always answers as a family (one snapshot pair covers all
    // three), so the deferred window gets the full set, not just the one
    // metric pass 1 was asked about.
    seedDeferredAction()
    seedSnapshots()

    await runJob(14)
    await runBridge(14)

    const atFourteen = db.outcomes().filter(r => r.window_days === 14)
    expect(atFourteen.map(r => r.metric_key).sort()).toEqual([
      'seo.gsc.avg_position',
      'seo.gsc.clicks',
      'seo.gsc.impressions',
    ])
  })
})

// ── Criterion 2: an explicit override window is honoured ────────────────────

describe('?window_days=7', () => {
  it('the deferred action ends up with a 7-day outcome', async () => {
    seedDeferredAction()
    seedSnapshots()

    const jobResult = await runJob(7)
    expect(jobResult.deferred).toBe(1)

    await runBridge(7)

    expect(outcomeWindows(GSC_CLICKS)).toEqual([7, 28])
  })
})

// ── Criterion 3: coinciding windows are computed once ───────────────────────

describe('?window_days=28', () => {
  it('one computation answers both — no double work, no duplicate rows', async () => {
    seedDeferredAction()
    seedSnapshots()

    await runJob(28)
    const result = await runBridge(28)

    expect(result.outcomes_written).toBe(3)
    expect(outcomeWindows(GSC_CLICKS)).toEqual([28])
    // One upsert batch, not two: the action was attributed exactly once.
    const upserts = db.ops.filter(o => o.table === 'flywheel_outcomes' && o.op === 'upsert')
    expect(upserts).toHaveLength(1)
  })
})

// ── Criterion 4: no window hole survives the handoff ────────────────────────

describe('no holes', () => {
  it('every deferred action has an outcome at the pass-1 window after both passes', async () => {
    seedDeferredAction()
    seedSnapshots()

    for (const window of [14, 7, 28]) {
      db = new FakeOutcomesDb()
      seedDeferredAction()
      seedSnapshots()

      const jobResult = await runJob(window)
      await runBridge(window)

      const holes = db
        .rowsOf('flywheel_actions')
        .filter(a => a.expected_metric === GSC_CLICKS)
        .filter(a => !db.outcomes().some(
          o => o.action_id === a.id
            && o.metric_key === GSC_CLICKS
            && o.window_days === window,
        ))

      expect(jobResult.deferred).toBe(1)
      expect(holes).toEqual([])
    }
  })
})

// ── The handoff is only for deferred actions ────────────────────────────────

describe('handoff scope', () => {
  it('an action pass 1 kept (non-GSC metric) gets no extra-window rows from the bridge', async () => {
    seedDeferredAction('seo.domain.organic_traffic') // owned by flywheel_metrics
    seedSnapshots()

    await runBridge(14)

    // Only the bridge's own 28-day cadence rows — nothing at 14: that window's
    // answer for this action belongs to pass 1, and producing it here would
    // put the two evaluators back on the same natural key.
    expect(db.outcomes().every(r => r.window_days === 28)).toBe(true)
    expect(db.outcomes()).toHaveLength(3)
  })

  it('a bridge run with no deferred window behaves exactly as before', async () => {
    seedDeferredAction()
    seedSnapshots()

    const result = await runBridge(undefined)

    expect(result.outcomes_written).toBe(3)
    expect(outcomeWindows(GSC_CLICKS)).toEqual([28])
  })
})

// ── The real pass-1 constant is pinned here, unmocked ───────────────────────

describe('pass-1 default window', () => {
  it('the real DEFAULT_WINDOW_DAYS export is 14', () => {
    // route.test.ts replaces the job module wholesale and hardcodes 14 in its
    // mock; that mock and its assertions are self-consistent whatever the real
    // value is. THIS import is the real module — if the export is renamed,
    // removed, or changed, this is the test that goes red.
    expect(DEFAULT_WINDOW_DAYS).toBe(14)
  })
})

// ── Garbage windows must not poison the handoff ─────────────────────────────

describe('malformed deferred windows', () => {
  it.each([NaN, -7, 0, 2.5])('window %p is refused — cadence rows only, no errors', async (bad) => {
    // NaN is the live case: parseInt on ?window_days=abc. It would slip the
    // equality dedupe (NaN === anything is false) and Invalid-Date every
    // deferred action. The route sanitises; the bridge also guards itself.
    seedDeferredAction()
    seedSnapshots()

    const result = await runBridge(bad as number)

    expect(result.errors).toEqual([])
    expect(result.outcomes_written).toBe(3)
    expect(outcomeWindows(GSC_CLICKS)).toEqual([28])
  })
})

// ── Partial failure: the handoff failing must not un-count landed rows ──────

describe('snapshot query failures', () => {
  it('a failing snapshot query is reported, not counted as "no data yet"', async () => {
    // The two used to be indistinguishable: fetchGscSnapshot swallowed the
    // error into null, the action landed in `skipped`, `errors` stayed empty,
    // and the run looked healthy. Pass 1 defers these actions now, so nothing
    // else would have covered for it.
    seedDeferredAction()
    seedSnapshots()

    db.failNext('gsc_performance_snapshots', 'select', 'statement timeout')

    const result = await runBridge()

    expect(result.errors.join(' ')).toContain('statement timeout')
    expect(result.outcomes_written).toBe(0)
  })

  it('a genuinely absent snapshot is still a quiet skip', async () => {
    seedDeferredAction() // no snapshots seeded at all

    const result = await runBridge()

    expect(result.errors).toEqual([])
    expect(result.skipped).toBe(1)
    expect(result.outcomes_written).toBe(0)
  })
})

describe('post-write cleanup failure', () => {
  it('keeps the written count when retiring superseded rows fails', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true' // two windows only coexist when dual-window is ON
    // The upsert lands 3 domain rows; retiring the page-scope keys this run no
    // longer produces then fails. Those 3 rows are in the database — reporting
    // the run as having written nothing (and, via the manual route, 502) is
    // the bug this split fixes.
    seedDeferredAction()
    seedSnapshots()

    db.failNext('flywheel_outcomes', 'delete', 'retire failed: deadlock')

    const result = await runBridge()

    expect(result.outcomes_written).toBe(3)
    expect(result.cleanup_errors).toBe(1)
    expect(result.errors.join(' ')).toContain('retire stale outcomes')
    expect(result.skipped).toBe(0)
    expect(db.outcomes()).toHaveLength(3) // the rows really did land
  })

  it('reports zero cleanup errors on a clean run', async () => {
    seedDeferredAction()
    seedSnapshots()

    const result = await runBridge()

    expect(result.outcomes_written).toBe(3)
    expect(result.cleanup_errors).toBe(0)
    expect(result.errors).toEqual([])
  })

  it('still reports nothing written when the upsert itself fails', async () => {
    seedDeferredAction()
    seedSnapshots()

    db.failNext('flywheel_outcomes', 'upsert', 'primary write failed')

    const result = await runBridge()

    expect(result.outcomes_written).toBe(0)
    expect(result.cleanup_errors).toBe(0)
    expect(result.skipped).toBe(1)
  })
})

describe('handoff partial failure', () => {
  it('cadence rows that already landed stay counted when the handoff write fails', async () => {
    seedDeferredAction()
    seedSnapshots()

    // First upsert (cadence @28) succeeds; second (handoff @14) fails.
    db.failNext('flywheel_outcomes', 'upsert', 'handoff write timeout', { afterMatches: 1 })

    const result = await runBridge(14)

    expect(result.errors.join(' ')).toContain('handoff write timeout')
    expect(result.outcomes_written).toBe(3) // the landed rows are reported…
    expect(result.skipped).toBe(0) // …and the action is not misfiled as skipped
    expect(outcomeWindows(GSC_CLICKS)).toEqual([28]) // DB matches the report
  })

  it('a failure before anything landed still counts as skipped', async () => {
    seedDeferredAction()
    seedSnapshots()

    db.failNext('flywheel_outcomes', 'upsert', 'connection reset') // first write fails

    const result = await runBridge(14)

    expect(result.errors.join(' ')).toContain('connection reset')
    expect(result.outcomes_written).toBe(0)
    expect(result.skipped).toBe(1)
    expect(db.outcomes()).toHaveLength(0)
  })
})

// ── Order-independence still holds with the handoff in play ─────────────────

describe('order-independence with handoff', () => {
  it('job → bridge and bridge → job converge on the same rows', async () => {
    seedDeferredAction()
    seedSnapshots()
    await runJob(14)
    await runBridge(14)
    const jobFirst = db.outcomes()
      .map(r => ({ key: r.outcome_key, evaluator: r.evaluator_key }))
      .sort((a, b) => String(a.key).localeCompare(String(b.key)))

    db = new FakeOutcomesDb()
    seedDeferredAction()
    seedSnapshots()
    await runBridge(14)
    await runJob(14)
    const bridgeFirst = db.outcomes()
      .map(r => ({ key: r.outcome_key, evaluator: r.evaluator_key }))
      .sort((a, b) => String(a.key).localeCompare(String(b.key)))

    expect(jobFirst).toEqual(bridgeFirst)
    expect(jobFirst).toHaveLength(6) // 3 @ 14 (handoff) + 3 @ 28 (cadence)
  })
})

// ── Only an action pass 1 actually DEFERRED gets a second window ────────────

describe('the handoff window follows the routing decision, not just ownership', () => {
  it('gives no second window to a scope-mismatched action', async () => {
    // `seo.gsc.page_clicks` on a plain `seo.publish_blog` IS owned by this
    // evaluator, so an ownership-only test says yes — but pass 1 routes it
    // `unattributable` (scope_mismatch) and never hands it over. Computing a
    // handoff window for it would give a misconfigured action two windows'
    // worth of rows, re-amplifying exactly the evidence the dual-window gate
    // holds down. (Codex P2, round 33.)
    // Flag ON, so the window retire is not what removes the extra rows — the
    // assertion is about whether a handoff window is COMPUTED at all.
    process.env[DUAL_WINDOW_FLAG] = 'true'
    seedDeferredAction('seo.gsc.page_clicks')
    seedSnapshots()

    await runBridge(14)

    // Only the cadence window's rows exist — no 14-day set alongside them.
    expect(new Set(db.outcomes().map(r => r.window_days))).toEqual(new Set([28]))
  })

  it('still gives one to an action pass 1 genuinely deferred', async () => {
    // The control: same shape, a metric this evaluator both owns and produces.
    process.env[DUAL_WINDOW_FLAG] = 'true'
    seedDeferredAction(GSC_CLICKS)
    seedSnapshots()

    await runBridge(14)

    expect(new Set(db.outcomes().map(r => r.window_days))).toEqual(new Set([14, 28]))
  })
})
