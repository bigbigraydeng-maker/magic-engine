import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import {
  assertSafeIdentifier,
  decideNotification,
  describeBreakage,
  describeWindow,
  evaluateAll,
  evaluateClientStream,
  evaluateFreshness,
  isSafeIdentifier,
  renderFreshnessEmail,
  selectActiveExpectations,
  streamKey,
  summarize,
  toClientPillars,
  toPillarFreshness,
  SIX_PILLARS,
  type FreshnessExpectation,
  type FreshnessResult,
} from './data-freshness'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = new Date('2026-08-02T06:00:00Z')

function expectation(overrides: Partial<FreshnessExpectation> = {}): FreshnessExpectation {
  return {
    id: 'exp-1',
    table_name: 'gsc_performance_snapshots',
    timestamp_column: 'created_at',
    filter_column: null,
    filter_prefix: null,
    client_column: 'client_id',
    label: 'Google 搜索表现（每日）',
    pillar: 'seo',
    max_age_hours: 120,
    monitor_from: null,
    enabled: true,
    severity: 'critical',
    ...overrides,
  }
}

/** A timestamp `days` before NOW. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY).toISOString()
}

describe('identifier safety', () => {
  it('accepts plain lowercase identifiers', () => {
    expect(isSafeIdentifier('gsc_performance_snapshots')).toBe(true)
    expect(isSafeIdentifier('created_at')).toBe(true)
  })

  it('rejects anything that could break out of a query', () => {
    for (const bad of [
      'users; drop table clients',
      'created_at)',
      'Created_At',
      '1_table',
      '',
      'a'.repeat(64),
      'created_at--',
    ]) {
      expect(isSafeIdentifier(bad)).toBe(false)
      expect(() => assertSafeIdentifier(bad, 'table_name')).toThrow()
    }
  })
})

describe('streamKey', () => {
  it('is the bare table for a whole-table stream', () => {
    expect(streamKey(expectation())).toBe('gsc_performance_snapshots')
  })

  it('distinguishes sub-streams of one physical table', () => {
    const seo = streamKey(expectation({ table_name: 'flywheel_metrics', filter_column: 'metric_key', filter_prefix: 'seo.' }))
    const social = streamKey(expectation({ table_name: 'flywheel_metrics', filter_column: 'metric_key', filter_prefix: 'social.' }))
    expect(seo).not.toBe(social)
    expect(social).toBe('flywheel_metrics:metric_key=social.')
  })

  it('does not change when the human label is edited', () => {
    const before = streamKey(expectation({ label: '旧名字' }))
    const after = streamKey(expectation({ label: '新名字' }))
    expect(before).toBe(after)
  })
})

describe('selectActiveExpectations', () => {
  it('skips disabled rows', () => {
    const rows = [expectation({ id: 'a' }), expectation({ id: 'b', enabled: false })]
    expect(selectActiveExpectations(rows, NOW).map((r) => r.id)).toEqual(['a'])
  })

  it('skips rows whose monitor_from is still in the future', () => {
    const rows = [
      expectation({ id: 'shipped', monitor_from: '2026-07-01' }),
      expectation({ id: 'not-yet', monitor_from: '2026-09-01' }),
    ]
    expect(selectActiveExpectations(rows, NOW).map((r) => r.id)).toEqual(['shipped'])
  })

  it('ignores an unparseable monitor_from rather than dropping the stream', () => {
    const rows = [expectation({ id: 'weird', monitor_from: 'not-a-date' })]
    expect(selectActiveExpectations(rows, NOW)).toHaveLength(1)
  })
})

describe('evaluateFreshness', () => {
  it('is fresh inside the window', () => {
    const r = evaluateFreshness(expectation(), { lastWrittenAt: daysAgo(4), rowCount: 98 }, NOW)
    expect(r.status).toBe('fresh')
    expect(r.overdueHours).toBeNull()
    expect(r.rowCount).toBe(98)
  })

  it('is stale past the window, and reports how far past', () => {
    const r = evaluateFreshness(expectation(), { lastWrittenAt: daysAgo(8), rowCount: 98 }, NOW)
    expect(r.status).toBe('stale')
    expect(r.ageHours).toBeCloseTo(192, 1)
    expect(r.overdueHours).toBeCloseTo(72, 1)
  })

  it('treats an empty table as never, not as fresh', () => {
    const r = evaluateFreshness(expectation(), { lastWrittenAt: null, rowCount: 0 }, NOW)
    expect(r.status).toBe('never')
  })

  // The whole point of the system: a check that cannot run must not look healthy.
  it('treats a failed probe as broken, never as fresh', () => {
    const r = evaluateFreshness(
      expectation(),
      { lastWrittenAt: null, rowCount: null, error: 'relation does not exist' },
      NOW,
    )
    expect(r.status).toBe('never')
    expect(r.probeError).toBe('relation does not exist')
  })

  it('treats an unparseable timestamp as broken', () => {
    const r = evaluateFreshness(expectation(), { lastWrittenAt: 'yesterday-ish', rowCount: 1 }, NOW)
    expect(r.status).toBe('never')
    expect(r.probeError).toContain('Unparseable')
  })

  it('never reports a negative age when a row is written in the future', () => {
    const future = new Date(NOW.getTime() + DAY).toISOString()
    const r = evaluateFreshness(expectation(), { lastWrittenAt: future, rowCount: 1 }, NOW)
    expect(r.ageHours).toBe(0)
    expect(r.status).toBe('fresh')
  })
})

describe('summarize', () => {
  const results = evaluateAll(
    [
      { expectation: expectation({ id: '1' }), observation: { lastWrittenAt: daysAgo(1), rowCount: 1 } },
      { expectation: expectation({ id: '2' }), observation: { lastWrittenAt: daysAgo(9), rowCount: 1 } },
      { expectation: expectation({ id: '3', severity: 'warn' }), observation: { lastWrittenAt: daysAgo(30), rowCount: 1 } },
      { expectation: expectation({ id: '4' }), observation: { lastWrittenAt: null, rowCount: 0 } },
    ],
    NOW,
  )

  it('counts each bucket', () => {
    const s = summarize(results)
    expect(s.total).toBe(4)
    expect(s.fresh).toBe(1)
    expect(s.stale).toBe(2)
    expect(s.never).toBe(1)
    expect(s.broken).toBe(3)
    expect(s.criticalBroken).toBe(2)
  })

  it('ranks "never" above any finite overdue window as the worst offender', () => {
    expect(summarize(results).worst?.status).toBe('never')
    expect(summarize(results).worst?.expectationId).toBe('4')
  })

  it('reports no worst offender when everything is fresh', () => {
    const fresh = evaluateAll(
      [{ expectation: expectation(), observation: { lastWrittenAt: daysAgo(1), rowCount: 1 } }],
      NOW,
    )
    expect(summarize(fresh).worst).toBeNull()
  })
})

describe('plain-language rendering', () => {
  it('describes a window in days once it exceeds two days', () => {
    expect(describeWindow(24)).toBe('24 小时内')
    expect(describeWindow(120)).toBe('5 天内')
    expect(describeWindow(1080)).toBe('45 天内')
  })

  it('says how many days a stream has been dead', () => {
    const r = evaluateFreshness(expectation(), { lastWrittenAt: daysAgo(53), rowCount: 1 }, NOW)
    expect(describeBreakage(r)).toContain('53 天')
    expect(describeBreakage(r)).toContain('5 天内')
  })

  it('distinguishes never-written from stale', () => {
    const r = evaluateFreshness(expectation(), { lastWrittenAt: null, rowCount: 0 }, NOW)
    expect(describeBreakage(r)).toContain('从来没有写入过')
  })

  it('contains no engineering jargon a non-technical PM would trip over', () => {
    const r = evaluateFreshness(expectation(), { lastWrittenAt: daysAgo(53), rowCount: 1 }, NOW)
    const decision = decideNotification([r], null, NOW)
    const { subject, text } = renderFreshnessEmail([r], decision, NOW)
    for (const jargon of ['migration', 'cron', 'schema', 'RLS', 'enum', 'payload', 'PostgREST', 'max_age_hours']) {
      expect(subject).not.toContain(jargon)
      expect(text).not.toContain(jargon)
    }
  })

  it('escapes HTML coming from registry labels', () => {
    const r = evaluateFreshness(
      expectation({ label: '<script>alert(1)</script>' }),
      { lastWrittenAt: daysAgo(20), rowCount: 1 },
      NOW,
    )
    const decision = decideNotification([r], null, NOW)
    const { html } = renderFreshnessEmail([r], decision, NOW)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('decideNotification — the alert must stay worth reading', () => {
  const broken = (id: string) =>
    evaluateFreshness(expectation({ id, label: id }), { lastWrittenAt: daysAgo(30), rowCount: 1 }, NOW)
  const fresh = (id: string) =>
    evaluateFreshness(expectation({ id, label: id }), { lastWrittenAt: daysAgo(1), rowCount: 1 }, NOW)

  it('sends on the very first run when something is broken', () => {
    const d = decideNotification([broken('a')], null, NOW)
    expect(d.send).toBe(true)
    expect(d.reason).toBe('first-run')
  })

  it('stays silent on the first run when everything is fine', () => {
    const d = decideNotification([fresh('a')], null, NOW)
    expect(d.send).toBe(false)
    expect(d.reason).toBe('all-fresh')
  })

  it('sends when a stream newly breaks', () => {
    const previous = [{ streamKey: 'gsc_performance_snapshots', status: 'fresh' as const }]
    const d = decideNotification([broken('a')], previous, NOW)
    expect(d.send).toBe(true)
    expect(d.reason).toBe('newly-broken')
    expect(d.newlyBroken).toHaveLength(1)
  })

  it('sends when a stream recovers', () => {
    const previous = [{ streamKey: 'gsc_performance_snapshots', status: 'stale' as const }]
    const d = decideNotification([fresh('a')], previous, NOW)
    expect(d.send).toBe(true)
    expect(d.reason).toBe('recovered')
    expect(d.recovered).toEqual(['gsc_performance_snapshots'])
  })

  // Without this, the replay's 6 permanently-broken streams would mail an
  // identical list every morning until the PM filters the sender away.
  it('stays silent when the same things are broken as yesterday', () => {
    const previous = [{ streamKey: 'gsc_performance_snapshots', status: 'stale' as const }]
    const d = decideNotification([broken('a')], previous, NOW)
    expect(d.send).toBe(false)
    expect(d.reason).toBe('unchanged')
    expect(d.ongoing).toHaveLength(1)
  })

  it('still re-reminds every Monday so long-running breakage cannot fade away', () => {
    const monday = new Date('2026-08-03T06:00:00Z')
    expect(monday.getUTCDay()).toBe(1)
    const previous = [{ streamKey: 'gsc_performance_snapshots', status: 'stale' as const }]
    const d = decideNotification([broken('a')], previous, monday)
    expect(d.send).toBe(true)
    expect(d.reason).toBe('weekly-reminder')
  })

  it('does not treat a brand-new registry row as breaking news', () => {
    const previous = [{ streamKey: 'some_other_table', status: 'fresh' as const }]
    const d = decideNotification([broken('a')], previous, NOW)
    expect(d.newlyBroken).toHaveLength(0)
    expect(d.send).toBe(false)
  })

  it('separates what just broke from what was already broken in the email', () => {
    const results = [
      evaluateFreshness(expectation({ id: 'n', table_name: 'ga4_traffic_snapshots', label: '刚坏的' }), { lastWrittenAt: daysAgo(30), rowCount: 1 }, NOW),
      evaluateFreshness(expectation({ id: 'o', table_name: 'keyword_snapshots', label: '早就坏的' }), { lastWrittenAt: daysAgo(60), rowCount: 1 }, NOW),
    ]
    const previous = [
      { streamKey: 'ga4_traffic_snapshots', status: 'fresh' as const },
      { streamKey: 'keyword_snapshots', status: 'stale' as const },
    ]
    const decision = decideNotification(results, previous, NOW)
    const { subject, text } = renderFreshnessEmail(results, decision, NOW)
    expect(subject).toContain('新增 1 条')
    expect(text).toContain('这次新发现停摆的')
    expect(text.indexOf('刚坏的')).toBeLessThan(text.indexOf('早就坏的'))
  })
})

describe('pillar rollup (ops view)', () => {
  it('marks a pillar broken when any of its streams is broken', () => {
    const results = evaluateAll(
      [
        { expectation: expectation({ id: '1', pillar: 'seo' }), observation: { lastWrittenAt: daysAgo(1), rowCount: 1 } },
        { expectation: expectation({ id: '2', pillar: 'seo' }), observation: { lastWrittenAt: daysAgo(40), rowCount: 1 } },
        { expectation: expectation({ id: '3', pillar: 'ads' }), observation: { lastWrittenAt: daysAgo(1), rowCount: 1 } },
      ],
      NOW,
    )
    const pillars = toPillarFreshness(results)
    expect(pillars.find((p) => p.pillar === 'seo')?.status).toBe('stale')
    expect(pillars.find((p) => p.pillar === 'ads')?.status).toBe('fresh')
  })
})

describe('per-client view — Type B clients must never false-alarm', () => {
  const seoDaily = expectation({ id: 'gsc', table_name: 'gsc_performance_snapshots', pillar: 'seo', max_age_hours: 120 })
  const adsDaily = expectation({ id: 'ads', table_name: 'ad_daily_insights', pillar: 'ads', max_age_hours: 72 })
  const social = expectation({ id: 'soc', table_name: 'flywheel_metrics', filter_column: 'metric_key', filter_prefix: 'social.', pillar: 'social', max_age_hours: 240 })

  it('reports a stream this client has never had as not_connected, not stale', () => {
    const s = evaluateClientStream(seoDaily, { lastWrittenAt: null, rowCount: 0 }, NOW)
    expect(s.status).toBe('not_connected')
    expect(s.daysSinceLastWrite).toBeNull()
    expect(s.daysOverdue).toBeNull()
  })

  it('reports a stream that had data and then stopped as stale, with days', () => {
    const s = evaluateClientStream(seoDaily, { lastWrittenAt: daysAgo(12), rowCount: 40 }, NOW)
    expect(s.status).toBe('stale')
    expect(s.daysSinceLastWrite).toBe(12)
    expect(s.daysOverdue).toBe(7)
    expect(s.expectedEveryDays).toBe(5)
  })

  it('reports current data as fresh', () => {
    const s = evaluateClientStream(seoDaily, { lastWrittenAt: daysAgo(1), rowCount: 40 }, NOW)
    expect(s.status).toBe('fresh')
    expect(s.daysOverdue).toBeNull()
  })

  // 30 Kiteroa Rothesay Bay: a property-listing (Type B) client that runs ads
  // only. It has rows in flywheel_metrics and nothing else. Nothing about it may
  // raise a staleness alarm on SEO / social.
  it('a listings client with ads only shows ads fresh and the rest 未接入', () => {
    const streams = [
      evaluateClientStream(adsDaily, { lastWrittenAt: daysAgo(1), rowCount: 10 }, NOW),
      evaluateClientStream(seoDaily, { lastWrittenAt: null, rowCount: 0 }, NOW),
      evaluateClientStream(social, { lastWrittenAt: null, rowCount: 0 }, NOW),
    ]
    const pillars = toClientPillars(streams)

    expect(pillars.find((p) => p.pillar === 'ads')?.status).toBe('fresh')
    expect(pillars.find((p) => p.pillar === 'seo')?.status).toBe('not_connected')
    expect(pillars.find((p) => p.pillar === 'social')?.status).toBe('not_connected')
    expect(pillars.filter((p) => p.status === 'stale')).toHaveLength(0)
  })

  it('always returns all six pillars so the strip has a stable shape', () => {
    const pillars = toClientPillars([])
    expect(pillars.map((p) => p.pillar).sort()).toEqual([...SIX_PILLARS].sort())
    expect(pillars.every((p) => p.status === 'not_connected')).toBe(true)
  })

  it('reports the worst stale stream in a pillar', () => {
    const streams = [
      evaluateClientStream(seoDaily, { lastWrittenAt: daysAgo(12), rowCount: 1 }, NOW),
      evaluateClientStream(
        expectation({ id: 'kw', table_name: 'keyword_snapshots', pillar: 'seo', max_age_hours: 240 }),
        { lastWrittenAt: daysAgo(53), rowCount: 1 },
        NOW,
      ),
    ]
    const seo = toClientPillars(streams).find((p) => p.pillar === 'seo')
    expect(seo?.status).toBe('stale')
    expect(seo?.staleDays).toBe(53)
    expect(seo?.staleStreams).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Calibration guard.
//
// The thresholds seeded in the migration were derived from this database's real
// write history (queried 2026-08-02). This block pins them from both sides:
// the largest gap ever observed while a stream was HEALTHY must stay 'fresh',
// and a plainly-dead gap must stay 'stale'.
//
// Mutation check: widen any max_age_hours in the migration (e.g. keyword
// snapshots 240 -> 2400) and the "…must still be caught" case for that stream
// goes red, because a 53-day outage would no longer be reported.
// ---------------------------------------------------------------------------
interface Calibration {
  stream: string
  table: string
  prefix?: string
  maxAgeHours: number
  /** Largest gap seen in production while the stream was working normally. */
  healthyGapDays: number
  /** A gap that really did mean the stream was dead. */
  deadGapDays: number
}

const CALIBRATION: Calibration[] = [
  { stream: 'Google 搜索表现', table: 'gsc_performance_snapshots', maxAgeHours: 120, healthyGapDays: 4, deadGapDays: 7 },
  { stream: '网站访问数据 GA4', table: 'ga4_traffic_snapshots', maxAgeHours: 120, healthyGapDays: 4, deadGapDays: 7 },
  { stream: '广告每日花费', table: 'ad_daily_insights', maxAgeHours: 72, healthyGapDays: 1, deadGapDays: 5 },
  { stream: '关键词排名', table: 'keyword_snapshots', maxAgeHours: 240, healthyGapDays: 7, deadGapDays: 53 },
  { stream: 'AI 可见度快照', table: 'ai_visibility_snapshots', maxAgeHours: 240, healthyGapDays: 7, deadGapDays: 30 },
  { stream: '飞轮 · SEO', table: 'flywheel_metrics', prefix: 'seo.', maxAgeHours: 120, healthyGapDays: 4, deadGapDays: 7 },
  { stream: '飞轮 · 广告', table: 'flywheel_metrics', prefix: 'ads.', maxAgeHours: 120, healthyGapDays: 1, deadGapDays: 7 },
  { stream: '飞轮 · AI 可见度', table: 'flywheel_metrics', prefix: 'geo.', maxAgeHours: 240, healthyGapDays: 7, deadGapDays: 28 },
  { stream: '飞轮 · 社媒', table: 'flywheel_metrics', prefix: 'social.', maxAgeHours: 240, healthyGapDays: 7, deadGapDays: 62 },
]

describe('threshold calibration against real production history', () => {
  for (const c of CALIBRATION) {
    const exp = expectation({
      table_name: c.table,
      filter_column: c.prefix ? 'metric_key' : null,
      filter_prefix: c.prefix ?? null,
      max_age_hours: c.maxAgeHours,
      label: c.stream,
    })

    it(`${c.stream}：正常节奏下最大 ${c.healthyGapDays} 天的间隔不许误报`, () => {
      const r = evaluateFreshness(exp, { lastWrittenAt: daysAgo(c.healthyGapDays), rowCount: 1 }, NOW)
      expect(r.status).toBe('fresh')
    })

    it(`${c.stream}：真实停摆 ${c.deadGapDays} 天必须被抓到`, () => {
      const r = evaluateFreshness(exp, { lastWrittenAt: daysAgo(c.deadGapDays), rowCount: 1 }, NOW)
      expect(r.status).toBe('stale')
    })
  }
})

// ---------------------------------------------------------------------------
// The migration is the thing that actually ships. Parse its seeded thresholds
// and check they match the calibration above, so editing the SQL alone (without
// touching any TypeScript) still turns this suite red.
// ---------------------------------------------------------------------------
describe('seeded registry matches the calibration table', () => {
  const sql = readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260802120000_data_freshness_registry.sql'),
    'utf8',
  )

  /** table_name, timestamp_column, filter_column, filter_prefix, client_column, label, pillar, max_age_hours */
  const ROW =
    /\n {2}\('([a-z0-9_]+)',\s*'([a-z0-9_]+)',\s*(NULL|'[^']*'),\s*(NULL|'[^']*'),\s*(NULL|'[^']*'),\s*'[^']*',\s*'([a-z_]+)',\s*(\d+)\s*,/g

  const seeded = new Map<string, number>()
  for (const m of sql.matchAll(ROW)) {
    const [, table, , , filterPrefix, , , maxAge] = m
    const prefix = filterPrefix === 'NULL' ? '' : filterPrefix.slice(1, -1)
    seeded.set(prefix ? `${table}:${prefix}` : table, Number(maxAge))
  }

  it('parses every seeded row', () => {
    // 7 pillar tables + 4 flywheel prefixes + anomaly + benchmarks
    // + 4 cron heartbeats + self heartbeat
    expect(seeded.size).toBeGreaterThanOrEqual(17)
  })

  for (const c of CALIBRATION) {
    it(`${c.stream} 的期望值没有被悄悄改宽或改窄`, () => {
      const key = c.prefix ? `${c.table}:${c.prefix}` : c.table
      expect(seeded.get(key)).toBe(c.maxAgeHours)
    })
  }

  it('registers the self-heartbeat the external check watches', () => {
    expect(seeded.get('data_freshness_alerts')).toBe(48)
  })

  it('registers cron heartbeats for the jobs that have silently disappeared before', () => {
    expect(seeded.get('cron_run_logs:keyword-snapshots-weekly')).toBe(240)
    expect(seeded.get('cron_run_logs:daily-cron-digest')).toBe(48)
    expect(seeded.get('cron_run_logs:data-freshness-check')).toBe(48)
  })

  it('uses only the service-role RLS template', () => {
    expect(sql).toContain('CREATE POLICY "service_role_full"')
    expect(sql).not.toMatch(/workspace_id|client_team|auth\.uid|auth\.jwt/)
  })
})

describe('the external (layer 3) check shares nothing with the system it watches', () => {
  const workflow = readFileSync(
    path.join(process.cwd(), '.github/workflows/data-freshness-external.yml'),
    'utf8',
  )

  // The comments explain at length WHY this file must not touch ME, and they
  // name the very things it must not use. Assert against the executable lines
  // only, or the documentation would fail its own rule.
  const executable = workflow
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')

  it('never calls the Magic Engine app', () => {
    expect(executable).not.toContain('app.magicengine.com.au')
    expect(executable).not.toContain('/api/cron/')
  })

  // The alert text names CRON_SECRET as the usual culprit — that is advice for
  // the reader. What matters is that the check never *reads* it: a secret shared
  // with the monitored system would take the watchdog down with it.
  it('never reads CRON_SECRET', () => {
    expect(executable).not.toContain('secrets.CRON_SECRET')
    expect(executable).not.toMatch(/\$\{?CRON_SECRET/)
    expect(executable).not.toMatch(/^\s*CRON_SECRET\s*:/m)
  })

  it('does not check out the repository or install anything', () => {
    expect(executable).not.toContain('actions/checkout')
    expect(executable).not.toContain('actions/setup-node')
    expect(executable).not.toContain('npm ')
    expect(executable).not.toContain('npx ')
  })

  it('talks straight to the database', () => {
    expect(workflow).toContain('/rest/v1/')
    expect(workflow).toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('watches the layer-2 heartbeat, so a dead daily check is visible from outside', () => {
    expect(workflow).toContain('data_freshness_alerts')
    expect(workflow).toContain('data-freshness-check')
  })

  it('fails the job even when it cannot send mail, so GitHub itself notifies', () => {
    expect(workflow).toContain('exit 1')
  })
})

describe('cron registration', () => {
  const render = readFileSync(path.join(process.cwd(), 'render.yaml'), 'utf8')

  it('registers the daily check', () => {
    expect(render).toContain('name: data-freshness-check')
    expect(render).toContain('/api/cron/data-freshness-check')
  })

  // The whole incident this system exists for: a hand-typed CRON_SECRET that
  // did not match, on a job that then left no trace at all.
  it('takes its secret from the shared env group rather than a hand-typed value', () => {
    const block = render.slice(render.indexOf('name: data-freshness-check'))
    const envVars = block.slice(block.indexOf('envVars:'), block.indexOf('envVars:') + 200)
    expect(envVars).toContain('fromGroup: me-shared-cron-secret')
    expect(envVars).not.toContain('sync: false')
  })
})

describe('probe module keeps identifiers validated', () => {
  it('every identifier taken from the registry is checked before use', async () => {
    const src = readFileSync(path.join(process.cwd(), 'src/lib/monitoring/freshness-probe.ts'), 'utf8')
    for (const field of ['table_name', 'timestamp_column', 'filter_column', 'client_column']) {
      expect(src).toContain(`assertSafeIdentifier(expectation.${field}`)
    }
  })
})

/** Guards the shape the client dashboard endpoint returns. */
describe('client freshness result shape', () => {
  it('exposes days overdue and expected cadence for every stream', () => {
    const s: ReturnType<typeof evaluateClientStream> = evaluateClientStream(
      expectation(),
      { lastWrittenAt: daysAgo(10), rowCount: 5 },
      NOW,
    )
    const expectedKeys = [
      'streamKey', 'label', 'pillar', 'status', 'lastWrittenAt',
      'daysSinceLastWrite', 'daysOverdue', 'expectedEveryDays', 'rowCount',
    ]
    expect(Object.keys(s).sort()).toEqual(expectedKeys.sort())
  })

  it('results carry the fields the persistence layer writes', () => {
    const r: FreshnessResult = evaluateFreshness(expectation(), { lastWrittenAt: daysAgo(2), rowCount: 3 }, NOW)
    expect(r.expectationId).toBe('exp-1')
    expect(r.pillar).toBe('seo')
    expect(r.severity).toBe('critical')
    expect(r.maxAgeHours).toBe(120)
  })
})
