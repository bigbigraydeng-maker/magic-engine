/**
 * flywheel_outcomes writer-coexistence and idempotency — Issue #859.
 *
 * Both attribution writers share one table. These tests pin the invariants that
 * were previously unenforced:
 *
 *   1. one action legitimately has many metric rows;
 *   2. the same metric legitimately has rows at more than one window;
 *   3. the two writers coexist;
 *   4. neither writer removes the other's rows — even on re-run or failure;
 *   5. re-running is idempotent AND keeps flywheel_outcomes.id stable;
 *   6. a failed write does not leave the action with nothing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FakeOutcomesDb } from './fake-outcomes-db'
import { OUTCOME_EVALUATOR } from '../outcome-identity'
import { DUAL_WINDOW_FLAG } from '../dual-window-gate'

// ── Module-level fake, swapped per test ──────────────────────────────────────

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

function seedSeoAction(overrides: Record<string, unknown> = {}): void {
  db.seed('flywheel_actions', [
    {
      id: ACTION_ID,
      client_id: CLIENT_ID,
      flywheel: 'seo',
      action_type: 'seo.publish_blog',
      expected_metric: GSC_CLICKS,
      expected_delta: 1,
      executed_at: EXECUTED_AT,
      payload: null,
      ...overrides,
    },
  ])
}

/** flywheel_metrics rows the job.ts evaluator needs: one before, one inside the window. */
function seedFlywheelMetrics(metricKey = GSC_CLICKS): void {
  db.seed('flywheel_metrics', [
    { client_id: CLIENT_ID, metric_key: metricKey, metric_value: 100, measured_at: '2026-05-30T00:00:00.000Z' },
    { client_id: CLIENT_ID, metric_key: metricKey, metric_value: 140, measured_at: '2026-06-05T00:00:00.000Z' },
  ])
}

/** gsc_performance_snapshots rows the gsc-bridge evaluator needs. */
function seedGscSnapshots(topPages: unknown = null): void {
  db.seed('gsc_performance_snapshots', [
    {
      client_id: CLIENT_ID,
      period_end: '2026-05-31',
      total_clicks: 100,
      total_impressions: 1000,
      avg_position: 20,
      top_pages: topPages,
    },
    {
      client_id: CLIENT_ID,
      period_end: '2026-07-15',
      total_clicks: 150,
      total_impressions: 1600,
      avg_position: 12,
      top_pages: topPages,
    },
  ])
}

async function runJob(windowDays?: number) {
  const { runAttributionJob } = await import('../job')
  return runAttributionJob({ clientId: CLIENT_ID, windowDays })
}

async function runBridge(windowDays = 28) {
  const { runGscAttributionForClient } = await import('../gsc-bridge')
  return runGscAttributionForClient(CLIENT_ID, windowDays)
}

beforeEach(() => {
  db = new FakeOutcomesDb()
  vi.clearAllMocks()
  delete process.env[DUAL_WINDOW_FLAG]
})

// ── 1. One action, many metrics ──────────────────────────────────────────────

describe('one action carries many metric rows', () => {
  it('the GSC evaluator writes three domain rows for a single action', async () => {
    seedSeoAction()
    seedGscSnapshots()

    const result = await runBridge()

    expect(result.outcomes_written).toBe(3)
    const rows = db.outcomes()
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map(r => r.metric_key))).toEqual(
      new Set(['seo.gsc.clicks', 'seo.gsc.impressions', 'seo.gsc.avg_position']),
    )
    // All three belong to the same action — action_id alone cannot be the key.
    expect(new Set(rows.map(r => r.action_id))).toEqual(new Set([ACTION_ID]))
  })
})

// ── 2. Same metric, different windows ────────────────────────────────────────

describe('the same metric coexists at different windows', () => {
  it('a 14-day and a 28-day answer for one metric are two separate rows', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true' // two windows only coexist when dual-window is ON
    // Reachable through the manual route, which takes any window in 1..90 while
    // the cron uses 28. Both answers come from the metric's owning evaluator —
    // ownership decides *who* answers, the window decides *which question*.
    seedSeoAction()
    seedGscSnapshots()

    await runBridge(14)
    await runBridge(28)

    const clicksRows = db.outcomes().filter(r => r.metric_key === GSC_CLICKS)
    expect(clicksRows.map(r => r.window_days).sort()).toEqual([14, 28])
    expect(clicksRows.map(r => r.evaluator_key)).toEqual([
      OUTCOME_EVALUATOR.GSC_SNAPSHOTS,
      OUTCOME_EVALUATOR.GSC_SNAPSHOTS,
    ])
    expect(clicksRows.map(r => r.id)).toHaveLength(2)
  })
})

// ── 3 + 4. Two writers coexist; neither deletes the other's rows ─────────────

describe('writer coexistence', () => {
  it('both writers land rows for the same action', async () => {
    seedSeoAction({ expected_metric: 'seo.domain.organic_traffic' })
    seedFlywheelMetrics('seo.domain.organic_traffic')
    seedGscSnapshots()

    await runJob(14)
    await runBridge(28)

    expect(db.outcomes()).toHaveLength(4)
  })

  it('re-running the flywheel_metrics writer does not touch the GSC writer rows', async () => {
    seedSeoAction({ expected_metric: 'seo.domain.organic_traffic' })
    seedFlywheelMetrics('seo.domain.organic_traffic')
    seedGscSnapshots()

    await runBridge(28)
    const gscIdsBefore = db
      .outcomes()
      .filter(r => r.evaluator_key === OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
      .map(r => r.id)
      .sort()
    expect(gscIdsBefore).toHaveLength(3)

    await runJob(14)
    await runJob(14) // and again — re-runs must stay harmless

    const gscIdsAfter = db
      .outcomes()
      .filter(r => r.evaluator_key === OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
      .map(r => r.id)
      .sort()

    expect(gscIdsAfter).toEqual(gscIdsBefore)
  })

  it('the flywheel_metrics writer never issues a DELETE that can reach another evaluator', async () => {
    // This assertion used to be "no DELETE at all", which stopped being true
    // once pass 1 had to retire the metrics an action no longer promises —
    // the one legitimate job main's action-wide DELETE was doing. What must
    // hold is the property that mattered, not the absence of the statement:
    // every delete pass 1 issues is scoped to its own evaluator_key, so it
    // cannot destroy the GSC writer's rows the way the old one did.
    process.env[DUAL_WINDOW_FLAG] = 'true'
    seedSeoAction({ expected_metric: 'seo.domain.organic_traffic' })
    seedFlywheelMetrics('seo.domain.organic_traffic')

    await runJob(14)

    const deletes = db.ops.filter(o => o.table === 'flywheel_outcomes' && o.op === 'delete')
    expect(deletes.length).toBeGreaterThan(0)
    for (const del of deletes) {
      const cols = del.filters.map(f => f.column)
      expect(cols).toContain('action_id')
      expect(cols).toContain('evaluator_key')
      const evaluator = del.filters.find(f => f.column === 'evaluator_key')
      expect(evaluator?.value).toBe(OUTCOME_EVALUATOR.FLYWHEEL_METRICS)
    }
  })

  it('leaves the GSC writer\'s rows for the same action untouched when it retires', async () => {
    // The behavioural half of the assertion above: the bridge legitimately
    // writes three seo.gsc.* rows for an action whose expected_metric is
    // something else entirely (135 such rows in production). Pass 1 must not
    // read those as "a metric this action no longer promises".
    process.env[DUAL_WINDOW_FLAG] = 'true'
    seedSeoAction({ expected_metric: 'seo.domain.organic_traffic' })
    seedFlywheelMetrics('seo.domain.organic_traffic')
    seedGscSnapshots()

    await runBridge(28)          // 3 GSC rows land
    await runJob(14)             // pass 1 writes its own and retires its own

    const gscRows = db.outcomes().filter(r => String(r.metric_key).startsWith('seo.gsc.'))
    expect(gscRows).toHaveLength(3)
  })

  it('the GSC writer retires the domain rows it no longer produces', async () => {
    // The action becomes page-scoped, so the bridge stops producing domain keys
    // and must clear the ones it previously owned at that window.
    seedSeoAction()
    seedGscSnapshots([{ page: 'https://example.com/guide', clicks: 40, impressions: 400, position: 18 }])

    await runBridge(28) // domain scope → 3 domain rows @ 28
    expect(db.outcomes().map(r => r.metric_key).sort()).toEqual([
      'seo.gsc.avg_position',
      'seo.gsc.clicks',
      'seo.gsc.impressions',
    ])

    // The page-upgrade PR merges: same action, now page-scoped.
    const action = db.rowsOf('flywheel_actions')[0]
    action.action_type = 'cms_update_existing'
    action.payload = { status: 'live', page_url: 'https://example.com/guide' }

    await runBridge(28)

    expect(db.outcomes().map(r => r.metric_key).sort()).toEqual([
      'seo.gsc.page_avg_position',
      'seo.gsc.page_clicks',
      'seo.gsc.page_impressions',
    ])
  })

  it('the retire clears the superseded scope at EVERY window, not just this run\'s', async () => {
    // The manual endpoint accepts any window from 1 to 90 while the cron only
    // revisits its cadence and pass 1's window. A window-scoped delete would
    // strand domain rows written at, say, 14 days forever — still shown on the
    // execution board and still counted by the benchmarks — even though the
    // action is now about one specific page. Scope invalidates a key at every
    // window, so the retire has to reach across them.
    seedSeoAction()
    seedGscSnapshots([{ page: 'https://example.com/guide', clicks: 40, impressions: 400, position: 18 }])

    await runBridge(14) // 3 domain rows @ 14

    const action = db.rowsOf('flywheel_actions')[0]
    action.action_type = 'cms_update_existing'
    action.payload = { status: 'live', page_url: 'https://example.com/guide' }

    await runBridge(28) // 3 page rows @ 28; every domain row is now superseded

    expect(db.outcomes().map(r => r.metric_key).sort()).toEqual([
      'seo.gsc.page_avg_position',
      'seo.gsc.page_clicks',
      'seo.gsc.page_impressions',
    ])
    expect(db.outcomes().every(r => r.window_days === 28)).toBe(true)
  })

  it('the retire still never reaches another evaluator or another action', async () => {
    // Dropping the window filter widened the delete; the action and evaluator
    // scoping are what keep it from becoming a blunt instrument.
    seedSeoAction()
    seedGscSnapshots([{ page: 'https://example.com/guide', clicks: 40, impressions: 400, position: 18 }])
    db.seed('flywheel_outcomes', [
      { id: 'other-action', action_id: 'other', client_id: CLIENT_ID, metric_key: 'seo.gsc.clicks', window_days: 28, verdict: 'confirmed', evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS },
      { id: 'other-eval', action_id: ACTION_ID, client_id: CLIENT_ID, metric_key: 'seo.domain.organic_traffic', window_days: 28, verdict: 'confirmed', evaluator_key: OUTCOME_EVALUATOR.FLYWHEEL_METRICS },
    ])

    const action = db.rowsOf('flywheel_actions')[0]
    action.action_type = 'cms_update_existing'
    action.payload = { status: 'live', page_url: 'https://example.com/guide' }

    await runBridge(28)

    expect(db.outcomes().find(r => r.id === 'other-action')).toBeDefined()
    expect(db.outcomes().find(r => r.id === 'other-eval')).toBeDefined()
  })

  it('retires domain rows for a page-scoped action even when the page is missing from the snapshot', async () => {
    // Page scope is decided by the action, not by this run's data: once the
    // action is about one specific page, its domain-level outcomes are wrong
    // whether or not the page shows up in top_pages today. Letting a temporarily
    // absent page keep them alive leaves rows the old ungated bridge wrote on
    // the execution board — and feeding memory and benchmarks — indefinitely.
    seedSeoAction()
    seedGscSnapshots() // top_pages: null → no page rows can be built

    await runBridge(28) // domain scope first: 3 domain rows land
    expect(db.outcomes()).toHaveLength(3)

    const action = db.rowsOf('flywheel_actions')[0]
    action.action_type = 'cms_update_existing'
    action.payload = { status: 'live', page_url: 'https://example.com/guide' }

    const result = await runBridge(28)

    expect(result.outcomes_written).toBe(0) // nothing could be produced…
    expect(db.outcomes()).toHaveLength(0) // …and the stale domain rows are gone
    expect(result.cleanup_errors).toBe(0)
  })

  it('a barren page-scoped run keeps the page rows it produced earlier', async () => {
    // Only the DOMAIN keys are wrong by scope. The page rows are the last known
    // good answer at the right scope, and today's snapshot merely not listing
    // the page is no reason to throw them away — retiring everything the
    // evaluator owns would do exactly that.
    seedSeoAction({
      action_type: 'cms_update_existing',
      payload: { status: 'live', page_url: 'https://example.com/guide' },
    })
    seedGscSnapshots([{ page: 'https://example.com/guide', clicks: 40, impressions: 400, position: 18 }])

    await runBridge(28) // page rows land
    const pageRowIds = db.outcomes().map(r => r.id).sort()
    expect(pageRowIds).toHaveLength(3)

    // The page drops out of top_pages next time round.
    for (const snap of db.rowsOf('gsc_performance_snapshots')) snap.top_pages = []

    const result = await runBridge(28)

    expect(result.outcomes_written).toBe(0)
    expect(db.outcomes().map(r => r.id).sort()).toEqual(pageRowIds)
    expect(db.outcomes().map(r => r.metric_key).sort()).toEqual([
      'seo.gsc.page_avg_position',
      'seo.gsc.page_clicks',
      'seo.gsc.page_impressions',
    ])
  })

  it('a barren run that is NOT page-scoped still retires nothing', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true' // two windows only coexist when dual-window is ON
    // The general rule is unchanged: producing nothing is not a refutation.
    seedSeoAction()
    // No snapshots at all → the run cannot even reach the scope decision.
    const result = await runBridge(28)

    expect(result.outcomes_written).toBe(0)
    expect(db.didDeleteFrom('flywheel_outcomes')).toBe(false)
  })

  it('the retire query is scoped by action, evaluator and metric — deliberately not window', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true' // two windows only coexist when dual-window is ON
    // The evaluator_key scope is now defence in depth rather than load-bearing:
    // metric-family ownership means no other evaluator can hold a seo.gsc.* row
    // in the first place. It stays so that moving a family to a third evaluator
    // later cannot silently reopen the cross-writer delete. Asserted
    // structurally because the behaviour it guards is no longer reachable.
    seedSeoAction()
    seedGscSnapshots([{ page: 'https://example.com/guide', clicks: 40, impressions: 400, position: 18 }])

    const action = db.rowsOf('flywheel_actions')[0]
    action.action_type = 'cms_update_existing'
    action.payload = { status: 'live', page_url: 'https://example.com/guide' }

    await runBridge(28)

    const retire = db.ops.find(o => o.table === 'flywheel_outcomes' && o.op === 'delete')
    expect(retire).toBeDefined()
    expect(retire?.filters.map(f => f.column).sort()).toEqual([
      'action_id',
      'evaluator_key',
      'metric_key',
    ])
  })
})

// ── 5. Idempotent retry ──────────────────────────────────────────────────────

describe('retry idempotency', () => {
  it('re-running the GSC writer keeps three rows with the same ids', async () => {
    seedSeoAction()
    seedGscSnapshots()

    await runBridge(28)
    const first = db.outcomes().map(r => ({ id: r.id, key: r.metric_key })).sort(byKey)

    await runBridge(28)
    await runBridge(28)
    const third = db.outcomes().map(r => ({ id: r.id, key: r.metric_key })).sort(byKey)

    expect(third).toHaveLength(3)
    expect(third).toEqual(first)
  })

  it('re-running the flywheel_metrics writer keeps one row with the same id', async () => {
    seedSeoAction({ expected_metric: 'seo.domain.organic_traffic' })
    seedFlywheelMetrics('seo.domain.organic_traffic')

    await runJob(14)
    const firstId = db.outcomes()[0].id

    await runJob(14)

    expect(db.outcomes()).toHaveLength(1)
    expect(db.outcomes()[0].id).toBe(firstId)
  })

  it('an updated recomputation overwrites in place rather than adding a row', async () => {
    seedSeoAction({ expected_metric: 'seo.domain.organic_traffic' })
    seedFlywheelMetrics('seo.domain.organic_traffic')

    await runJob(14)
    const id = db.outcomes()[0].id
    expect(db.outcomes()[0].verdict).toBe('confirmed')

    // The metric reverses: a later measurement drops well below baseline.
    db.rowsOf('flywheel_metrics').push({
      id: 'm-3',
      client_id: CLIENT_ID,
      metric_key: 'seo.domain.organic_traffic',
      metric_value: 50,
      measured_at: '2026-06-10T00:00:00.000Z',
    })

    await runJob(14)

    expect(db.outcomes()).toHaveLength(1)
    expect(db.outcomes()[0].id).toBe(id) // same business outcome, same identity
    expect(db.outcomes()[0].verdict).toBe('reversed') // trackable state change
  })
})

// ── 6. Partial failure ───────────────────────────────────────────────────────

describe('partial failure', () => {
  it('a failed GSC write leaves the previous rows in place', async () => {
    seedSeoAction()
    seedGscSnapshots()

    await runBridge(28)
    const before = db.outcomes().map(r => r.id).sort()
    expect(before).toHaveLength(3)

    db.failNext('flywheel_outcomes', 'upsert', 'connection reset')
    const result = await runBridge(28)

    expect(result.errors.join(' ')).toContain('connection reset')
    expect(db.outcomes().map(r => r.id).sort()).toEqual(before)
  })

  it('a failed GSC write does not run the retire step', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true' // two windows only coexist when dual-window is ON
    seedSeoAction({
      action_type: 'cms_update_existing',
      payload: { status: 'live', page_url: 'https://example.com/guide' },
    })
    seedGscSnapshots([{ page: 'https://example.com/guide', clicks: 40, impressions: 400, position: 18 }])

    db.failNext('flywheel_outcomes', 'upsert', 'write timeout')
    await runBridge(28)

    expect(db.didDeleteFrom('flywheel_outcomes')).toBe(false)
  })

  it('one failing action does not abort the rest of the client run', async () => {
    seedSeoAction()
    db.seed('flywheel_actions', [
      {
        id: 'action-seo-2',
        client_id: CLIENT_ID,
        flywheel: 'seo',
        action_type: 'seo.publish_blog',
        expected_metric: GSC_CLICKS,
        expected_delta: 1,
        executed_at: EXECUTED_AT,
        payload: null,
      },
    ])
    seedGscSnapshots()

    db.failNext('flywheel_outcomes', 'upsert', 'transient')
    const result = await runBridge(28)

    expect(result.errors).toHaveLength(1)
    expect(result.outcomes_written).toBe(3) // the second action still landed
  })
})

// ── 7. Historical duplicates ─────────────────────────────────────────────────

describe('historical duplicate rows', () => {
  it('a plain INSERT of a duplicate natural key is rejected once the constraint exists', async () => {
    seedSeoAction()
    db.seed('flywheel_outcomes', [
      {
        id: 'legacy-1',
        action_id: ACTION_ID,
        client_id: CLIENT_ID,
        metric_key: GSC_CLICKS,
        window_days: 28,
        verdict: 'inconclusive',
        evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS,
      },
    ])

    const { error } = await db.from('flywheel_outcomes').insert({
      action_id: ACTION_ID,
      client_id: CLIENT_ID,
      metric_key: GSC_CLICKS,
      window_days: 28,
      verdict: 'confirmed',
      evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS,
    })

    expect(error?.message).toContain('flywheel_outcomes_natural_key')
  })

  it('a pre-existing row is adopted by the writer instead of duplicated', async () => {
    seedSeoAction()
    seedGscSnapshots()
    db.seed('flywheel_outcomes', [
      {
        id: 'legacy-1',
        action_id: ACTION_ID,
        client_id: CLIENT_ID,
        metric_key: GSC_CLICKS,
        window_days: 28,
        verdict: 'inconclusive',
        evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS,
      },
    ])

    await runBridge(28)

    const clicks = db.outcomes().filter(r => r.metric_key === GSC_CLICKS)
    expect(clicks).toHaveLength(1)
    expect(clicks[0].id).toBe('legacy-1') // identity survives the recomputation
    expect(clicks[0].verdict).toBe('confirmed')
  })
})

function byKey(a: { key: unknown }, b: { key: unknown }): number {
  return String(a.key).localeCompare(String(b.key))
}

// ── Cleanup forgiveness is per ACTION, not per client ───────────────────────

describe('a zero-write action\'s cleanup failure is not forgiven', () => {
  it('does not count it as reconcilable debt just because another action wrote', async () => {
    // Action A attributes normally. Action B is page-scoped with its page
    // missing from top_pages, so it writes nothing and still has to retire the
    // domain keys it no longer stands behind — and that retire fails. Counting
    // it as cleanup debt let the client-level `outcomes_written > 0` from A
    // forgive it, so B's stale domain rows stayed on the board inside a run
    // reported as successful. (Codex P2, round 32.)
    process.env[DUAL_WINDOW_FLAG] = 'true'
    seedSeoAction()                       // A — plain, writes 3 rows
    db.seed('flywheel_actions', [
      {
        id: 'action-page-b', client_id: CLIENT_ID, flywheel: 'seo',
        action_type: 'cms_update_existing',
        payload: { status: 'live', page_url: 'https://example.com/missing' },
        expected_metric: GSC_CLICKS, expected_delta: 1, executed_at: EXECUTED_AT,
      },
    ])
    // Snapshots exist, but top_pages never mentions B's page → B produces none.
    seedGscSnapshots([{ page: 'https://example.com/other', clicks: 5, impressions: 50, position: 9 }])
    // The SECOND delete: A retires the page keys it does not produce (and it
    // DID write, so that one is legitimate debt); B's is the one under test.
    db.failNext('flywheel_outcomes', 'delete', 'retire failed: deadlock', { afterMatches: 1 })

    const result = await runBridge(28)

    expect(result.outcomes_written).toBeGreaterThan(0)  // A landed
    expect(result.cleanup_errors).toBe(0)               // …but B's is not debt
    expect(result.errors.join(' ')).toContain('retire stale outcomes')
  })

  it('still forgives a cleanup failure on an action that did write', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true'
    seedSeoAction({
      action_type: 'cms_update_existing',
      payload: { status: 'live', page_url: 'https://example.com/guide' },
    })
    seedGscSnapshots([{ page: 'https://example.com/guide', clicks: 40, impressions: 400, position: 18 }])
    db.failNext('flywheel_outcomes', 'delete', 'retire failed: deadlock')

    const result = await runBridge(28)

    expect(result.outcomes_written).toBeGreaterThan(0)
    expect(result.cleanup_errors).toBe(1)               // rows landed → debt
  })
})
