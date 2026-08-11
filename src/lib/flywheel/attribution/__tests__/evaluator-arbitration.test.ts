/**
 * Evaluator arbitration — Issue #859.
 *
 * The natural key excludes `evaluator_key`, which only holds up if a key can
 * never be produced by two evaluators. Otherwise "which answer is true" decays
 * into "which writer ran last", and a stable row id whose verdict flips with the
 * cron schedule is worse than an unstable one — downstream memory would read
 * scheduling noise as a business reversal.
 *
 * The rule: exactly one evaluator is authoritative per metric family, and a
 * non-owner declines to write. These tests drive both writers at the same
 * (action, metric, window) in both orders and require byte-identical results.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { FakeOutcomesDb } from './fake-outcomes-db'
import { DUAL_WINDOW_FLAG } from '../dual-window-gate'
import {
  OUTCOME_EVALUATOR,
  assertEvaluatorOwnsAll,
  ownsMetric,
  resolveAuthoritativeEvaluator,
} from '../outcome-identity'

let db: FakeOutcomesDb

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => db.from(table),
  },
}))

const ACTION_ID = 'action-collision'
const CLIENT_ID = 'client-1'
const EXECUTED_AT = '2026-06-01T00:00:00.000Z'

/**
 * The contested key. `flywheel_metrics` really does carry seo.gsc.clicks in
 * production (99 rows), and the cron route accepts ?window_days=28, so this is
 * the reachable collision — not a contrived one.
 */
const CONTESTED_METRIC = 'seo.gsc.clicks'
const CONTESTED_WINDOW = 28

function seedCollisionFixture(): void {
  db.seed('flywheel_actions', [
    {
      id: ACTION_ID,
      client_id: CLIENT_ID,
      flywheel: 'seo',
      action_type: 'seo.publish_blog',
      expected_metric: CONTESTED_METRIC,
      expected_delta: 1,
      executed_at: EXECUTED_AT,
      payload: null,
    },
  ])
  db.seed('flywheel_metrics', [
    { client_id: CLIENT_ID, metric_key: CONTESTED_METRIC, metric_value: 100, measured_at: '2026-05-30T00:00:00.000Z' },
    { client_id: CLIENT_ID, metric_key: CONTESTED_METRIC, metric_value: 140, measured_at: '2026-06-05T00:00:00.000Z' },
  ])
  db.seed('gsc_performance_snapshots', [
    { client_id: CLIENT_ID, period_end: '2026-05-31', total_clicks: 100, total_impressions: 1000, avg_position: 20, top_pages: null },
    { client_id: CLIENT_ID, period_end: '2026-07-15', total_clicks: 150, total_impressions: 1600, avg_position: 12, top_pages: null },
  ])
}

async function runJob(windowDays: number) {
  const { runAttributionJob } = await import('../job')
  return runAttributionJob({ clientId: CLIENT_ID, windowDays })
}

async function runBridge(windowDays: number) {
  const { runGscAttributionForClient } = await import('../gsc-bridge')
  return runGscAttributionForClient(CLIENT_ID, windowDays)
}

/** Everything the review requires to be order-independent, in one comparable shape. */
function snapshot(): unknown[] {
  return db
    .outcomes()
    .map(r => ({
      id: r.id,
      action_id: r.action_id,
      metric_key: r.metric_key,
      window_days: r.window_days,
      evaluator_key: r.evaluator_key,
      baseline: r.baseline,
      after_value: r.after_value,
      delta: r.delta,
      delta_pct: r.delta_pct,
      verdict: r.verdict,
      confidence: r.confidence,
      computed_at: r.computed_at,
      outcome_key: r.outcome_key,
    }))
    .sort((a, b) => String(a.metric_key).localeCompare(String(b.metric_key)))
}

beforeEach(() => {
  // Freeze the clock so even computed_at is comparable — the claim is that the
  // two orders agree on everything, not on everything except the timestamp.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-08T00:00:00.000Z'))
  db = new FakeOutcomesDb()
  vi.clearAllMocks()
  delete process.env[DUAL_WINDOW_FLAG]
})

afterEach(() => {
  vi.useRealTimers()
})

// ── The rule itself ──────────────────────────────────────────────────────────

describe('metric family ownership', () => {
  it('gives every metric exactly one authoritative evaluator', () => {
    expect(resolveAuthoritativeEvaluator('seo.gsc.clicks')).toBe(OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
    expect(resolveAuthoritativeEvaluator('seo.gsc.page_avg_position')).toBe(OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
    expect(resolveAuthoritativeEvaluator('seo.domain.organic_traffic')).toBe(OUTCOME_EVALUATOR.FLYWHEEL_METRICS)
    expect(resolveAuthoritativeEvaluator('geo.query.mention_rate')).toBe(OUTCOME_EVALUATOR.FLYWHEEL_METRICS)
    expect(resolveAuthoritativeEvaluator('anything.unknown')).toBe(OUTCOME_EVALUATOR.FLYWHEEL_METRICS)
  })

  it('never lets both evaluators own the same metric', () => {
    for (const metric of [
      'seo.gsc.clicks',
      'seo.gsc.impressions',
      'seo.domain.organic_traffic',
      'ads.account.roas',
      'social.posts.published_count',
    ]) {
      const owners = [OUTCOME_EVALUATOR.FLYWHEEL_METRICS, OUTCOME_EVALUATOR.GSC_SNAPSHOTS]
        .filter(e => ownsMetric(e, metric))
      expect(owners).toHaveLength(1)
    }
  })
})

// ── Criterion 1 + 2: exact collision, both orders, identical result ─────────

describe('both writers targeting the same (action, metric, window)', () => {
  it('job → gsc and gsc → job produce byte-identical rows', async () => {
    seedCollisionFixture()
    await runJob(CONTESTED_WINDOW)
    await runBridge(CONTESTED_WINDOW)
    const jobFirst = snapshot()

    db = new FakeOutcomesDb()
    seedCollisionFixture()
    await runBridge(CONTESTED_WINDOW)
    await runJob(CONTESTED_WINDOW)
    const gscFirst = snapshot()

    expect(jobFirst).toEqual(gscFirst)
  })

  it('the contested row is owned by the GSC evaluator in either order', async () => {
    seedCollisionFixture()
    await runJob(CONTESTED_WINDOW)
    await runBridge(CONTESTED_WINDOW)

    const contested = db
      .outcomes()
      .filter(r => r.metric_key === CONTESTED_METRIC && r.window_days === CONTESTED_WINDOW)

    expect(contested).toHaveLength(1)
    expect(contested[0].evaluator_key).toBe(OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
    // baseline 100 → 150 comes from the GSC snapshots, not the 100 → 140 that
    // flywheel_metrics would have produced. The owner's answer is the one kept.
    expect(contested[0].baseline).toBe(100)
    expect(contested[0].after_value).toBe(150)
  })

  it('the non-owning writer reports the deferral instead of swallowing it', async () => {
    seedCollisionFixture()
    const result = await runJob(CONTESTED_WINDOW)

    expect(result).toEqual({
      processed: 1,
      written: 0,
      skipped: 0, failed: 0,
      deferred: 1,
      pass2ClientIds: [CLIENT_ID], // pass 2 uses this to know whom to visit
      unattributable: 0, // the bridge can load this flywheel, so it is reachable
      unattributableSamples: [], reconcileErrors: 0, reconcileErrorSamples: [],
    })
    expect(db.outcomes()).toHaveLength(0)
  })
})

// ── Criterion 3: repeated alternating rounds converge ───────────────────────

describe('repeated execution', () => {
  it('converges to the same row set however many times the writers alternate', async () => {
    seedCollisionFixture()

    await runJob(CONTESTED_WINDOW)
    await runBridge(CONTESTED_WINDOW)
    const afterFirstRound = snapshot()

    for (let i = 0; i < 4; i++) {
      await runBridge(CONTESTED_WINDOW)
      await runJob(CONTESTED_WINDOW)
      await runJob(CONTESTED_WINDOW)
      await runBridge(CONTESTED_WINDOW)
    }

    expect(snapshot()).toEqual(afterFirstRound)
    expect(db.outcomes()).toHaveLength(3)
  })
})

// ── Criterion 4: non-contested work still splits across both writers ───────

describe('non-contested metrics', () => {
  it('both writers still coexist when they own different metric families', async () => {
    db.seed('flywheel_actions', [
      {
        id: ACTION_ID,
        client_id: CLIENT_ID,
        flywheel: 'seo',
        action_type: 'seo.publish_blog',
        expected_metric: 'seo.domain.organic_traffic', // owned by flywheel_metrics
        expected_delta: 1,
        executed_at: EXECUTED_AT,
        payload: null,
      },
    ])
    db.seed('flywheel_metrics', [
      { client_id: CLIENT_ID, metric_key: 'seo.domain.organic_traffic', metric_value: 100, measured_at: '2026-05-30T00:00:00.000Z' },
      { client_id: CLIENT_ID, metric_key: 'seo.domain.organic_traffic', metric_value: 140, measured_at: '2026-06-05T00:00:00.000Z' },
    ])
    db.seed('gsc_performance_snapshots', [
      { client_id: CLIENT_ID, period_end: '2026-05-31', total_clicks: 100, total_impressions: 1000, avg_position: 20, top_pages: null },
      { client_id: CLIENT_ID, period_end: '2026-07-15', total_clicks: 150, total_impressions: 1600, avg_position: 12, top_pages: null },
    ])

    const jobResult = await runJob(14)
    await runBridge(28)

    expect(jobResult.deferred).toBe(0)
    expect(jobResult.written).toBe(1)
    expect(db.outcomes()).toHaveLength(4)
    expect(
      new Set(db.outcomes().map(r => r.evaluator_key)),
    ).toEqual(
      new Set([OUTCOME_EVALUATOR.FLYWHEEL_METRICS, OUTCOME_EVALUATOR.GSC_SNAPSHOTS]),
    )
  })

  it('the same metric at two windows is still two rows when one owner writes both', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true' // two windows only coexist when dual-window is ON
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
    db.seed('flywheel_metrics', [
      { client_id: CLIENT_ID, metric_key: 'seo.domain.organic_traffic', metric_value: 100, measured_at: '2026-05-30T00:00:00.000Z' },
      { client_id: CLIENT_ID, metric_key: 'seo.domain.organic_traffic', metric_value: 140, measured_at: '2026-06-05T00:00:00.000Z' },
    ])

    await runJob(14)
    await runJob(30)

    expect(db.outcomes().map(r => r.window_days).sort()).toEqual([14, 30])
  })
})

// ── The database refuses a trespassing row too ─────────────────────────────

describe('database enforcement', () => {
  it('rejects a row written by the evaluator that does not own the metric', async () => {
    const { error } = await db.from('flywheel_outcomes').insert({
      action_id: ACTION_ID,
      client_id: CLIENT_ID,
      metric_key: CONTESTED_METRIC,
      window_days: CONTESTED_WINDOW,
      verdict: 'confirmed',
      evaluator_key: OUTCOME_EVALUATOR.FLYWHEEL_METRICS, // not the owner
    })

    expect(error?.message).toContain('flywheel_outcomes_evaluator_owns_metric')
  })

  it('accepts the same row from the owning evaluator', async () => {
    const { error } = await db.from('flywheel_outcomes').insert({
      action_id: ACTION_ID,
      client_id: CLIENT_ID,
      metric_key: CONTESTED_METRIC,
      window_days: CONTESTED_WINDOW,
      verdict: 'confirmed',
      evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS,
    })

    expect(error).toBeNull()
  })
})

// ── The SQL CHECK and the TS rule must be the same rule ────────────────────

describe('code ↔ schema agreement on ownership', () => {
  const EXPAND_SQL = readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260808000001_flywheel_outcomes_identity_expand.sql'),
    'utf8',
  )

  it('the metric family in the CHECK resolves to the same owner in TypeScript', () => {
    const match = EXPAND_SQL.match(/WHEN metric_key LIKE '([^']+)' THEN '([^']+)'/)
    expect(match).not.toBeNull()

    const [, likePattern, sqlOwner] = match!
    const prefix = likePattern.replace(/%$/, '')

    expect(resolveAuthoritativeEvaluator(`${prefix}some_measure`)).toBe(sqlOwner)
  })

  it('the CHECK fallback resolves to the same default owner in TypeScript', () => {
    const match = EXPAND_SQL.match(/ELSE '([^']+)'\s*\n\s*END/)
    expect(match).not.toBeNull()

    expect(resolveAuthoritativeEvaluator('some.unclaimed.metric')).toBe(match![1])
  })

  it('the ownership constraint exists under that exact name in the expand migration', () => {
    // Anchored on the CHECK that follows: a renamed or suffixed constraint is a
    // different constraint, and a bare substring match would wave it through.
    // The follow-up contract PR (deliberately not in this branch — see
    // rollout-order.test.ts) must re-add it with the NULL escape removed and
    // bring its own copy of this assertion.
    const declared = /ADD CONSTRAINT flywheel_outcomes_evaluator_owns_metric\s+CHECK \(/
    expect(EXPAND_SQL).toMatch(declared)
  })
})

// ── The trespass guard: logic covered, trigger currently unreachable ────────

describe('assertEvaluatorOwnsAll', () => {
  it('passes when every metric belongs to the writer', () => {
    expect(() =>
      assertEvaluatorOwnsAll(OUTCOME_EVALUATOR.GSC_SNAPSHOTS, [
        'seo.gsc.clicks',
        'seo.gsc.page_impressions',
      ]),
    ).not.toThrow()
  })

  it('throws, naming the metric, when a writer reaches outside its family', () => {
    expect(() =>
      assertEvaluatorOwnsAll(OUTCOME_EVALUATOR.GSC_SNAPSHOTS, [
        'seo.gsc.clicks',
        'seo.domain.organic_traffic',
      ]),
    ).toThrow(/seo\.domain\.organic_traffic/)
  })

  it('throws rather than silently dropping the offending row', () => {
    expect(() =>
      assertEvaluatorOwnsAll(OUTCOME_EVALUATOR.FLYWHEEL_METRICS, ['seo.gsc.clicks']),
    ).toThrow(/not the authoritative evaluator/)
  })

  it('is a no-op on an empty batch', () => {
    expect(() => assertEvaluatorOwnsAll(OUTCOME_EVALUATOR.GSC_SNAPSHOTS, [])).not.toThrow()
  })

  it('is actually called by the GSC bridge before it writes', () => {
    // Asserted on the source, not through behaviour: with today's metric
    // families the guard can never fire, so deleting the call changes no
    // observable outcome. Without this the call site could be dropped silently
    // and only resurface as a Postgres constraint violation in production.
    const source = readFileSync(
      path.join(process.cwd(), 'src/lib/flywheel/attribution/gsc-bridge.ts'),
      'utf8',
    )
    const guardAt = source.indexOf('assertEvaluatorOwnsAll(')
    const writeAt = source.indexOf('.upsert(rows')

    expect(guardAt).toBeGreaterThan(-1)
    expect(writeAt).toBeGreaterThan(guardAt)
  })
})
