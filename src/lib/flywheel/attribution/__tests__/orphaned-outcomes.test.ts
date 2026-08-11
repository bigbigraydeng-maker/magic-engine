/**
 * Outcome rows nobody can maintain — Issue #859, Codex P2 round 19.
 *
 * Removing main's `DELETE WHERE action_id = ?` was necessary: it is how pass 1
 * destroyed the GSC evaluator's rows. But that delete was doing one legitimate
 * job as a side effect — clearing the outcomes of a metric the action had
 * stopped promising.
 *
 * Half of that job is now done deliberately and safely: pass 1 retires ITS OWN
 * rows for keys the action no longer promises (see legacy-row-claim.test.ts).
 * The other half cannot be: when the abandoned metric belongs to a different
 * evaluator, deleting it would be exactly the cross-writer delete this Work
 * Package removed. Those rows are detected and reported instead — the system
 * itself asks for `expected_metric` to be corrected, so it must own the
 * consequence rather than leave frozen numbers feeding the reports.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { FakeOutcomesDb } from './fake-outcomes-db'
import { auditOrphanedOutcomes } from '../unattributable-audit'
import { OUTCOME_EVALUATOR } from '../outcome-identity'

let db: FakeOutcomesDb

const CLIENT_ID = 'client-1'
const CLIENTS = [CLIENT_ID]

function outcome(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `row-${Math.abs(JSON.stringify(over).length)}-${String(over.metric_key)}-${String(over.window_days ?? 28)}`,
    client_id: CLIENT_ID,
    window_days: 28,
    baseline: 1,
    after_value: 2,
    delta: 1,
    delta_pct: 100,
    confidence: 0.5,
    verdict: 'confirmed',
    computed_at: '2026-06-10T00:00:00.000Z',
    ...over,
  }
}

beforeEach(() => {
  db = new FakeOutcomesDb()
})

describe('auditOrphanedOutcomes', () => {
  it('finds rows abandoned by a corrected expected_metric whose owner cannot load the action', async () => {
    // The exact path the system asks for: a GEO action promised seo.gsc.clicks,
    // the todo told a human to fix it, and the fix stranded the rows the old
    // value had already produced. Pass 1 will not touch them (not its
    // evaluator's) and the GSC bridge cannot load a GEO action.
    db.seed('flywheel_actions', [
      {
        id: 'a1', client_id: CLIENT_ID, flywheel: 'geo',
        action_type: 'geo.deploy_directive',
        expected_metric: 'geo.query.mention_rate',
        executed_at: '2026-06-01T00:00:00.000Z', payload: null,
      },
    ])
    db.seed('flywheel_outcomes', [
      outcome({ action_id: 'a1', metric_key: 'seo.gsc.clicks', evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS }),
      outcome({ action_id: 'a1', metric_key: 'geo.query.mention_rate', evaluator_key: OUTCOME_EVALUATOR.FLYWHEEL_METRICS }),
    ])

    const orphans = await auditOrphanedOutcomes(db as never, CLIENTS)

    expect(orphans).toHaveLength(1)
    expect(orphans[0]).toMatchObject({
      action_id: 'a1',
      metric_key: 'seo.gsc.clicks',
      expected_metric: 'geo.query.mention_rate',
      flywheel: 'geo',
      rows: 1,
    })
  })

  it('does NOT report the three GSC rows a normal SEO action carries', async () => {
    // The false positive that would make this audit useless: the bridge writes
    // seo.gsc.clicks / impressions / avg_position for every SEO action, whatever
    // that action's own expected_metric is — 135 such rows in production. Their
    // owner CAN load an SEO action, so it refreshes and retires them itself.
    db.seed('flywheel_actions', [
      {
        id: 'a2', client_id: CLIENT_ID, flywheel: 'seo',
        action_type: 'seo.publish_blog',
        expected_metric: 'seo.domain.organic_traffic',
        executed_at: '2026-06-01T00:00:00.000Z', payload: null,
      },
    ])
    db.seed('flywheel_outcomes', [
      outcome({ action_id: 'a2', metric_key: 'seo.gsc.clicks', evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS }),
      outcome({ action_id: 'a2', metric_key: 'seo.gsc.impressions', evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS }),
      outcome({ action_id: 'a2', metric_key: 'seo.gsc.avg_position', evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS }),
    ])

    expect(await auditOrphanedOutcomes(db as never, CLIENTS)).toEqual([])
  })

  it('does not report a row the action still promises', async () => {
    db.seed('flywheel_actions', [
      {
        id: 'a3', client_id: CLIENT_ID, flywheel: 'geo',
        action_type: 'geo.deploy_directive',
        expected_metric: 'geo.query.mention_rate',
        executed_at: '2026-06-01T00:00:00.000Z', payload: null,
      },
    ])
    db.seed('flywheel_outcomes', [
      outcome({ action_id: 'a3', metric_key: 'geo.query.mention_rate', evaluator_key: OUTCOME_EVALUATOR.FLYWHEEL_METRICS }),
    ])

    expect(await auditOrphanedOutcomes(db as never, CLIENTS)).toEqual([])
  })

  it('counts every window of the same stranded pair as one finding', async () => {
    db.seed('flywheel_actions', [
      {
        id: 'a4', client_id: CLIENT_ID, flywheel: 'social',
        action_type: 'social.publish',
        expected_metric: 'social.followers',
        executed_at: '2026-06-01T00:00:00.000Z', payload: null,
      },
    ])
    db.seed('flywheel_outcomes', [
      outcome({ action_id: 'a4', metric_key: 'seo.gsc.clicks', window_days: 7, evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS }),
      outcome({ action_id: 'a4', metric_key: 'seo.gsc.clicks', window_days: 28, evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS }),
    ])

    const orphans = await auditOrphanedOutcomes(db as never, CLIENTS)

    expect(orphans).toHaveLength(1)
    expect(orphans[0].rows).toBe(2)
  })

  it('returns nothing when there are no clients to check', async () => {
    expect(await auditOrphanedOutcomes(db as never, [])).toEqual([])
  })

  it('throws rather than reporting "no orphans" when the query fails', async () => {
    // The distinction this whole PR keeps re-establishing: "nothing is wrong"
    // and "we could not check" must never arrive at the caller the same way.
    db.seed('flywheel_actions', [
      {
        id: 'a5', client_id: CLIENT_ID, flywheel: 'geo',
        action_type: 'geo.deploy_directive',
        expected_metric: 'geo.query.mention_rate',
        executed_at: '2026-06-01T00:00:00.000Z', payload: null,
      },
    ])
    db.failNext('flywheel_outcomes', 'select', 'permission denied for table flywheel_outcomes')

    await expect(auditOrphanedOutcomes(db as never, CLIENTS)).rejects.toThrow(/permission denied/)
  })
})
