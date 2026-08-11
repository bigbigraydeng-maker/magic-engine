/**
 * Deferral must only go to an evaluator that can actually load the action —
 * Issue #859, Codex P2 round 3.
 *
 * Owning a metric and being able to reach the action that promised it are two
 * different things. `gsc-bridge` queries `flywheel = 'seo'`, so a GEO or Social
 * action carrying a `seo.gsc.*` expected_metric is owned by an evaluator that
 * will never see it. Deferring it manufactures a permanent hole: pass 1 stops
 * attributing, pass 2 never loads it, and no outcome is ever produced.
 *
 * Writing it in pass 1 is not an option either — the
 * `flywheel_outcomes_evaluator_owns_metric` CHECK forbids the flywheel_metrics
 * evaluator writing `seo.gsc.*` rows. So the only honest handling is to report
 * it, in the same spirit as `metric-registry.ts`, which refuses at write time
 * an expected_metric nothing will ever measure.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FakeOutcomesDb } from './fake-outcomes-db'
import {
  OUTCOME_EVALUATOR,
  evaluatorCanLoad,
  evaluatorLoadableFlywheels,
  gscProducedMetricKeys,
  resolveAttributionRouting,
} from '../outcome-identity'

let db: FakeOutcomesDb

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => db.from(table),
  },
}))

const CLIENT_ID = 'client-1'
const EXECUTED_AT = '2026-06-01T00:00:00.000Z'
const GSC_CLICKS = 'seo.gsc.clicks'

function seedAction(id: string, flywheel: string, expectedMetric: string): void {
  db.seed('flywheel_actions', [
    {
      id,
      client_id: CLIENT_ID,
      flywheel,
      action_type: `${flywheel}.some_action`,
      expected_metric: expectedMetric,
      expected_delta: 1,
      executed_at: EXECUTED_AT,
      payload: null,
    },
  ])
}

function seedSnapshots(): void {
  db.seed('gsc_performance_snapshots', [
    { client_id: CLIENT_ID, period_end: '2026-05-31', total_clicks: 100, total_impressions: 1000, avg_position: 20, top_pages: null },
    { client_id: CLIENT_ID, period_end: '2026-07-15', total_clicks: 150, total_impressions: 1600, avg_position: 12, top_pages: null },
  ])
}

async function runJob(windowDays = 14) {
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
})

// ── The routing rule itself ─────────────────────────────────────────────────

/**
 * Every value the `flywheel_name` enum admits, verified against production on
 * 2026-08-08 (`seo, geo, ads, social`; the column is NOT NULL with zero null
 * rows). Routing is exhaustive over these — a value added to the enum later
 * without a routing decision lands in `unattributable`, which is the safe
 * direction: reported, not silently deferred into a hole.
 */
const FLYWHEEL_VALUES = ['seo', 'geo', 'ads', 'social'] as const

describe('resolveAttributionRouting', () => {
  it('keeps a metric the flywheel_metrics evaluator owns, whatever the flywheel', () => {
    for (const flywheel of FLYWHEEL_VALUES) {
      expect(resolveAttributionRouting({ flywheel, expected_metric: 'geo.query.mention_rate' }))
        .toBe('own')
    }
  })

  it('defers a GSC metric only when the bridge can load that flywheel', () => {
    expect(resolveAttributionRouting({ flywheel: 'seo', expected_metric: GSC_CLICKS }))
      .toBe('defer')
  })

  it.each(FLYWHEEL_VALUES.filter(f => f !== 'seo'))(
    'marks a %s action promising a GSC metric unattributable, not deferred',
    (flywheel) => {
      expect(resolveAttributionRouting({ flywheel, expected_metric: GSC_CLICKS }))
        .toBe('unattributable')
    },
  )

  it('routes every flywheel value to exactly one of the three states', () => {
    for (const flywheel of FLYWHEEL_VALUES) {
      for (const metric of [GSC_CLICKS, 'geo.query.mention_rate', 'ads.account.roas']) {
        expect(['own', 'defer', 'unattributable'])
          .toContain(resolveAttributionRouting({ flywheel, expected_metric: metric }))
      }
    }
  })

  it('treats an unknown or absent flywheel as unreachable rather than assuming seo', () => {
    // The column is NOT NULL in the database, so this is belt-and-braces — but
    // guessing "seo" for an unknown value would defer into a hole.
    expect(resolveAttributionRouting({ flywheel: null, expected_metric: GSC_CLICKS }))
      .toBe('unattributable')
    expect(resolveAttributionRouting({ flywheel: 'future_flywheel', expected_metric: GSC_CLICKS }))
      .toBe('unattributable')
  })
})

describe('evaluatorCanLoad', () => {
  it('lets the flywheel_metrics evaluator load every flywheel (it filters on none)', () => {
    for (const flywheel of ['seo', 'geo', 'social', 'ads', 'anything']) {
      expect(evaluatorCanLoad(OUTCOME_EVALUATOR.FLYWHEEL_METRICS, flywheel)).toBe(true)
    }
  })

  it('limits the GSC evaluator to the flywheels it queries', () => {
    expect(evaluatorCanLoad(OUTCOME_EVALUATOR.GSC_SNAPSHOTS, 'seo')).toBe(true)
    expect(evaluatorCanLoad(OUTCOME_EVALUATOR.GSC_SNAPSHOTS, 'geo')).toBe(false)
    expect(evaluatorCanLoad(OUTCOME_EVALUATOR.GSC_SNAPSHOTS, 'social')).toBe(false)
  })
})

// ── End to end through the real writers ─────────────────────────────────────

describe('an SEO action with a GSC metric', () => {
  it('is deferred by pass 1 and produced by the bridge', async () => {
    seedAction('seo-1', 'seo', GSC_CLICKS)
    seedSnapshots()

    const jobResult = await runJob()
    expect(jobResult.deferred).toBe(1)
    expect(jobResult.unattributable).toBe(0)
    expect(jobResult.pass2ClientIds).toEqual([CLIENT_ID])

    await runBridge()
    expect(db.outcomes().filter(r => r.action_id === 'seo-1')).toHaveLength(3)
  })
})

describe.each(['geo', 'social', 'ads'])('a %s action with a GSC metric', (flywheel) => {
  it('is reported unattributable rather than deferred into a hole', async () => {
    seedAction(`${flywheel}-1`, flywheel, GSC_CLICKS)
    seedSnapshots()

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const jobResult = await runJob()
    consoleSpy.mockRestore()

    expect(jobResult.unattributable).toBe(1)
    expect(jobResult.unattributableSamples).toEqual([`${flywheel}-1`])
    // Crucially NOT deferred — a deferral would promise an answer nobody gives.
    expect(jobResult.deferred).toBe(0)
    // The client is still worth a pass-2 visit: the bridge cannot load THIS
    // action, but the client's other SEO actions are still its to attribute.
    expect(jobResult.pass2ClientIds).toEqual([CLIENT_ID])
  })

  it('is not picked up by the bridge either, confirming the hole is real', async () => {
    seedAction(`${flywheel}-1`, flywheel, GSC_CLICKS)
    seedSnapshots()

    const result = await runBridge()

    expect(result.actions_found).toBe(0)
    expect(db.outcomes()).toHaveLength(0)
  })

  it('never produces an outcome row via pass 1 (the ownership CHECK forbids it)', async () => {
    seedAction(`${flywheel}-1`, flywheel, GSC_CLICKS)
    db.seed('flywheel_metrics', [
      { client_id: CLIENT_ID, metric_key: GSC_CLICKS, metric_value: 100, measured_at: '2026-05-30T00:00:00.000Z' },
      { client_id: CLIENT_ID, metric_key: GSC_CLICKS, metric_value: 140, measured_at: '2026-06-05T00:00:00.000Z' },
    ])

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runJob()
    consoleSpy.mockRestore()

    // Even with perfectly good flywheel_metrics data on both sides of the
    // action, pass 1 must not write it — that is what ownership means.
    expect(db.outcomes()).toHaveLength(0)
  })
})

describe('pass2ClientIds', () => {
  it('names only clients whose actions the bridge will actually take', async () => {
    seedAction('seo-1', 'seo', GSC_CLICKS) // deferrable
    seedAction('geo-1', 'geo', GSC_CLICKS) // unattributable
    seedSnapshots()

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const jobResult = await runJob()
    consoleSpy.mockRestore()

    expect(jobResult.deferred).toBe(1)
    expect(jobResult.unattributable).toBe(1)
    expect(jobResult.pass2ClientIds).toEqual([CLIENT_ID])
  })

  it('still lists the client when every GSC-keyed action is unreachable', async () => {
    // Dropping the client here would also drop their OTHER seo actions from
    // pass 2 — the bridge loads every seo action for a client it visits, so
    // removing the client removes attribution it would otherwise have done.
    seedAction('geo-1', 'geo', GSC_CLICKS)
    seedAction('social-1', 'social', GSC_CLICKS)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const jobResult = await runJob()
    consoleSpy.mockRestore()

    expect(jobResult.unattributable).toBe(2)
    expect(jobResult.deferred).toBe(0)
    expect(jobResult.pass2ClientIds).toEqual([CLIENT_ID])
  })
})

// ── Loading the action is not the same as producing its metric ──────────────
//
// The bridge's scope decides which half of its vocabulary it emits: domain keys
// for a domain-scope action, page keys for a page-scope one, nothing for a
// skipped one. Deferring an action whose promised key is outside that set is
// the same silent hole as deferring across flywheels — and the adapters accept
// the combination today (`/api/flywheel/execute` passes `expectedMetric`
// through unvalidated).

const PAGE_LIVE = {
  action_type: 'cms_update_existing',
  payload: { status: 'live', page_url: 'https://example.com/guide' },
}

describe('routing checks the metric the owner would actually produce', () => {
  it('defers a domain key from a domain-scope action', () => {
    expect(resolveAttributionRouting({
      flywheel: 'seo',
      action_type: 'seo.publish_blog',
      payload: null,
      expected_metric: 'seo.gsc.clicks',
    })).toBe('defer')
  })

  it('strands a PAGE key promised by a domain-scope action', () => {
    // The case Codex found: the bridge loads it, scopes it to domain, and only
    // ever writes the three domain keys — page_clicks never appears.
    expect(resolveAttributionRouting({
      flywheel: 'seo',
      action_type: 'seo.publish_blog',
      payload: null,
      expected_metric: 'seo.gsc.page_clicks',
    })).toBe('unattributable')
  })

  it('defers a page key from a live page-scope action', () => {
    expect(resolveAttributionRouting({
      flywheel: 'seo',
      ...PAGE_LIVE,
      expected_metric: 'seo.gsc.page_clicks',
    })).toBe('defer')
  })

  it('strands a DOMAIN key promised by a page-scope action', () => {
    // The mirror image, equally silent.
    expect(resolveAttributionRouting({
      flywheel: 'seo',
      ...PAGE_LIVE,
      expected_metric: 'seo.gsc.clicks',
    })).toBe('unattributable')
  })

  it('strands any GSC key when the bridge would skip the action entirely', () => {
    expect(resolveAttributionRouting({
      flywheel: 'seo',
      action_type: 'cms_update_existing',
      payload: { status: 'pr_open' }, // not live → scope 'skip'
      expected_metric: 'seo.gsc.page_clicks',
    })).toBe('unattributable')
  })

  it('leaves non-GSC metrics alone — the scope question is the GSC bridge\'s', () => {
    expect(resolveAttributionRouting({
      flywheel: 'seo',
      ...PAGE_LIVE,
      expected_metric: 'seo.domain.organic_traffic',
    })).toBe('own')
  })
})

describe('gscProducedMetricKeys', () => {
  it('reports the three domain keys for a domain-scope action', () => {
    expect([...gscProducedMetricKeys({
      action_type: 'seo.publish_blog',
      payload: null,
      expected_metric: 'seo.gsc.clicks',
    })].sort()).toEqual(['seo.gsc.avg_position', 'seo.gsc.clicks', 'seo.gsc.impressions'])
  })

  it('reports the three page keys for a live page-scope action', () => {
    expect([...gscProducedMetricKeys({
      ...PAGE_LIVE,
      expected_metric: 'seo.gsc.page_clicks',
    })].sort()).toEqual([
      'seo.gsc.page_avg_position',
      'seo.gsc.page_clicks',
      'seo.gsc.page_impressions',
    ])
  })

  it('reports nothing when the bridge would skip the action', () => {
    expect(gscProducedMetricKeys({
      action_type: 'cms_update_existing',
      payload: { status: 'pr_open' },
      expected_metric: 'seo.gsc.page_clicks',
    })).toEqual([])
  })

  it('never claims a key the two scopes do not cover', () => {
    const all = new Set([
      ...gscProducedMetricKeys({ action_type: 'x', payload: null, expected_metric: 'seo.gsc.clicks' }),
      ...gscProducedMetricKeys({ ...PAGE_LIVE, expected_metric: 'seo.gsc.page_clicks' }),
    ])
    expect(all.size).toBe(6) // exactly the evaluator's vocabulary, no more
  })
})

// ── The routing input must actually be fetched ──────────────────────────────

describe('the flywheel column is load-bearing, not incidental', () => {
  it('throws rather than guessing when the column was not selected', () => {
    // Dropping `flywheel` from job.ts's SELECT would make action.flywheel
    // undefined. Coercing that to "unreachable" would route every GSC-owned
    // action to unattributable and rebuild the permanent hole in silence —
    // with every other test still green, because neither fake models column
    // projection.
    expect(() =>
      resolveAttributionRouting({
        flywheel: undefined,
        expected_metric: GSC_CLICKS,
      }),
    ).toThrow(/must\s+select the flywheel column/)
  })

  it('throws even for a metric this evaluator owns, so the mistake surfaces at once', () => {
    // Checked before the ownership short-circuit: otherwise the error would
    // only appear on the subset of actions that need routing, and a run with
    // no GSC-owned actions would look fine.
    expect(() =>
      resolveAttributionRouting({
        flywheel: undefined,
        expected_metric: 'geo.query.mention_rate',
      }),
    ).toThrow(/flywheel is undefined/)
  })

  it("job.ts's query selects the column routing depends on", async () => {
    // The behavioural test above cannot see the query, and the fake DB ignores
    // projections, so this reads the source. It is the only thing standing
    // between a dropped column and a silent hole.
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const source = readFileSync(
      path.join(process.cwd(), 'src/lib/flywheel/attribution/job.ts'),
      'utf8',
    )
    const select = source.match(/\.select\('([^']*flywheel_actions?[^']*|[^']+)'\)/)
    expect(select).not.toBeNull()
    const columns = select![1].split(',').map(c => c.trim())
    for (const needed of ['flywheel', 'action_type', 'payload']) {
      expect(columns).toContain(needed)
    }
  })
})

// ── The declaration and the query must not drift ────────────────────────────

describe('the bridge query derives its filter from the shared declaration', () => {
  it('filters on exactly the flywheels declared loadable for this evaluator', async () => {
    seedAction('seo-1', 'seo', GSC_CLICKS)
    seedSnapshots()

    await runBridge()

    const actionQuery = db.ops.find(o => o.table === 'flywheel_actions' && o.op === 'select')
    const flywheelFilter = actionQuery?.filters.find(f => f.column === 'flywheel')

    expect(flywheelFilter?.op).toBe('in')
    expect(flywheelFilter?.value).toEqual(
      evaluatorLoadableFlywheels(OUTCOME_EVALUATOR.GSC_SNAPSHOTS),
    )
  })
})

// ── Pass 1 must read every action, for the same reason the audit does ──────

describe('pass 1 pagination', () => {
  it("job.ts pages its action scan rather than issuing one unbounded read", async () => {
    // PostgREST caps a response at 1000 rows silently. Truncation here does not
    // merely skip work: pass2ClientIds is built from this set, so a dropped
    // seo.gsc.* action belonging to a GSC-disconnected client would take that
    // client out of pass 2's visit list too — pass 1 declines it on ownership,
    // pass 2 never sees it, and the run still reports success.
    const { readFileSync } = await import('node:fs')
    const nodePath = await import('node:path')
    const source = readFileSync(
      nodePath.join(process.cwd(), 'src/lib/flywheel/attribution/job.ts'),
      'utf8',
    )

    expect(source).toMatch(/fetchAll</)
    expect(source).toMatch(/\.range\(from, to\)/)
    // A stable, unique sort — without one, `range` repeats or drops boundary rows.
    expect(source).toMatch(/\.order\('id'/)
  })

  it('reads past the first page in practice', async () => {
    // The fake models .range(), so this exercises the loop rather than the text.
    for (let i = 0; i < 1200; i++) {
      db.seed('flywheel_actions', [{
        id: `bulk-${String(i).padStart(5, '0')}`,
        client_id: CLIENT_ID,
        flywheel: 'geo',
        action_type: 'geo.deploy_directive',
        expected_metric: GSC_CLICKS, // every one is unattributable
        expected_delta: 1,
        executed_at: EXECUTED_AT,
        payload: null,
      }])
    }

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await runJob()
    consoleSpy.mockRestore()

    expect(result.processed).toBe(1200)
    expect(result.unattributable).toBe(1200)
  })
})

// ── The bridge must read every action too ──────────────────────────────────

describe('gsc-bridge pagination', () => {
  it('loads SEO actions past the first page', async () => {
    // pass2ClientIds carries only client ids, so if the bridge truncates its
    // own scan the deferred actions pass 1 promised we would answer are simply
    // never seen — by either writer — and the run still reports success.
    db.seed('gsc_performance_snapshots', [
      { client_id: CLIENT_ID, period_end: '2026-05-31', total_clicks: 100, total_impressions: 1000, avg_position: 20, top_pages: null },
      { client_id: CLIENT_ID, period_end: '2026-07-15', total_clicks: 150, total_impressions: 1600, avg_position: 12, top_pages: null },
    ])
    for (let i = 0; i < 1100; i++) {
      db.seed('flywheel_actions', [{
        id: `seo-${String(i).padStart(5, '0')}`,
        client_id: CLIENT_ID,
        flywheel: 'seo',
        action_type: 'seo.publish_blog',
        expected_metric: GSC_CLICKS,
        expected_delta: 1,
        executed_at: EXECUTED_AT,
        payload: null,
      }])
    }

    const result = await runBridge()

    expect(result.actions_found).toBe(1100)
  })

  it('uses a stable unique sort so page boundaries cannot drop or repeat rows', async () => {
    const { readFileSync } = await import('node:fs')
    const nodePath = await import('node:path')
    const source = readFileSync(
      nodePath.join(process.cwd(), 'src/lib/flywheel/attribution/gsc-bridge.ts'),
      'utf8',
    )

    expect(source).toMatch(/fetchAll</)
    expect(source).toMatch(/\.order\('id'/)
  })
})
