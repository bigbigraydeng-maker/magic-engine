/**
 * Regression tests for the 2026-10-29 code review (子牙 + 魏征): backfill depth, live writes only complete
 * reads, untrusted reconciliation is never "ok", hidden / unbound accounts, null-preserving merges, and the
 * upsert conflict key matching the migration's UNIQUE constraint. Each was shown to be breakable without a
 * failing test before these were added.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runBreakdownCapture, firstSpendDate, type CaptureDeps } from '../run'
import { mapBreakdownRows } from '../map'
import { specFor } from '../specs'
import { CONFLICT_KEY } from '../store'
import type { BreakdownSpec, BreakdownStatRow, GraphBreakdownRow } from '../types'
import type { GraphAccountDailySpendRow, GraphReadResult } from '@/lib/meta/entity-settings'

const NOW = new Date('2026-10-21T12:00:00Z') // UTC account → yesterday 2026-10-20

function ok<T>(rows: T[]): GraphReadResult<T> {
  return { rows, complete: true, error: null }
}
function incomplete<T>(rows: T[]): GraphReadResult<T> {
  return { rows, complete: false, error: { status: 0, code: null, message: 'hit 25-page cap' } }
}

const HOUR = specFor('hour_account_tz')
const REGION = specFor('region')

function hourRow(date: string, spend = '10'): GraphBreakdownRow {
  return { ad_id: 'ad_1', date_start: date, spend, impressions: '100', clicks: '1',
    hourly_stats_aggregated_by_advertiser_time_zone: '09:00:00 - 09:59:59' }
}

interface Harness { deps: CaptureDeps; written: BreakdownStatRow[][]; breakdownCalls: string[] }

/** Account whose daily spend is `dailySpend` per day from `firstSpend` to yesterday; every breakdown read sums to it. */
function harness(opts: {
  firstSpend: string
  earliest: string | null
  dailySpend?: number
  breakdownSpendFactor?: number
  incompleteKeys?: string[]
  dailyComplete?: boolean
  hidden?: boolean
  accounts?: number
}): Harness {
  const written: BreakdownStatRow[][] = []
  const breakdownCalls: string[] = []
  const daily = opts.dailySpend ?? 10
  const factor = opts.breakdownSpendFactor ?? 1
  const days = (since: string, until: string): string[] => {
    const out: string[] = []
    for (let d = new Date(`${since}T00:00:00Z`); d.toISOString().slice(0, 10) <= until; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10)
      if (key >= opts.firstSpend) out.push(key)
    }
    return out
  }
  const deps: CaptureDeps = {
    store: {
      listAccounts: async () =>
        Array.from({ length: opts.accounts ?? 1 }, () => ({ adAccountId: 'act_1', hidden: opts.hidden === true })),
      earliestStatDate: async () => opts.earliest,
      upsertRows: async (rows) => { written.push([...rows]) },
    },
    getToken: async () => 'token',
    resolveTimezone: async () => 'UTC',
    fetchBreakdown: async (_a, _t, graphBreakdowns, since, until) => {
      breakdownCalls.push(`${graphBreakdowns}:${since}..${until}`)
      const key = graphBreakdowns === HOUR.graphBreakdowns ? 'hour_account_tz' : 'region'
      const rows = days(since, until).map((d) =>
        key === 'region'
          ? { ad_id: 'ad_1', date_start: d, spend: String(daily * factor), impressions: '1', clicks: '0', region: 'Auckland' }
          : hourRow(d, String(daily * factor)))
      return opts.incompleteKeys?.includes(key) ? incomplete(rows) : ok(rows)
    },
    fetchAccountDaily: async (_a, _t, since, until) => {
      const rows: GraphAccountDailySpendRow[] = days(since, until).map((d) => ({ date_start: d, spend: String(daily) }))
      return opts.dailyComplete === false ? incomplete(rows) : ok(rows)
    },
    now: () => NOW,
    newRequestId: () => 'req',
  }
  return { deps, written, breakdownCalls }
}

const SPECS: readonly BreakdownSpec[] = [HOUR, REGION]

describe('backfill depth (live)', () => {
  it('backfills when nothing is stored yet', async () => {
    const h = harness({ firstSpend: '2026-09-01', earliest: null })
    const r = await runBreakdownCapture(h.deps, { mode: 'live', clientIds: ['c1'], specs: SPECS })
    expect(r.accounts[0].backfill).toBe(true)
    expect(r.accounts[0].since).toBe('2026-06-23') // 120 days ending 2026-10-20
  })

  it('a young account whose history already reaches its first spend day does NOT re-pull 120 days', async () => {
    const h = harness({ firstSpend: '2026-09-11', earliest: '2026-09-11' })
    const r = await runBreakdownCapture(h.deps, { mode: 'live', clientIds: ['c1'], specs: SPECS })
    expect(r.accounts[0].backfill).toBe(false)
    expect(r.accounts[0].since).toBe('2026-10-13') // 8 days
  })

  it('history that stops short of first spend (beyond slack) triggers backfill', async () => {
    const h = harness({ firstSpend: '2026-09-01', earliest: '2026-09-20' })
    const r = await runBreakdownCapture(h.deps, { mode: 'live', clientIds: ['c1'], specs: SPECS })
    expect(r.accounts[0].backfill).toBe(true)
  })

  it('firstSpendDate ignores zero-spend days', () => {
    expect(firstSpendDate([{ date: '2026-09-01', spend: 0 }, { date: '2026-09-03', spend: 2 }, { date: '2026-09-02', spend: 1 }]))
      .toBe('2026-09-02')
    expect(firstSpendDate([{ date: '2026-09-01', spend: 0 }])).toBeNull()
  })
})

describe('live writes only complete reads', () => {
  it('an incomplete breakdown is not written (so it cannot fake history depth) and the account is partial', async () => {
    const h = harness({ firstSpend: '2026-10-01', earliest: '2026-10-01', incompleteKeys: ['region'] })
    const r = await runBreakdownCapture(h.deps, { mode: 'live', clientIds: ['c1'], specs: SPECS })
    expect(h.written).toHaveLength(1)
    expect(h.written[0].every((row) => row.breakdown_key === 'hour_account_tz')).toBe(true)
    expect(r.accounts[0].status).toBe('partial')
  })
})

describe('reconciliation decides trust', () => {
  it('complete reads whose spend does not add up are partial, not ok', async () => {
    const h = harness({ firstSpend: '2026-10-15', earliest: '2026-10-15', breakdownSpendFactor: 0.5 })
    const r = await runBreakdownCapture(h.deps, { mode: 'dry', clientIds: ['c1'], specs: SPECS })
    expect(r.accounts[0].status).toBe('partial')
    expect(r.accounts[0].reconciliation_failures.length).toBeGreaterThan(0)
  })

  it('reconciliation that could not run is partial, not ok', async () => {
    const h = harness({ firstSpend: '2026-10-15', earliest: '2026-10-15', dailyComplete: false })
    const r = await runBreakdownCapture(h.deps, { mode: 'dry', clientIds: ['c1'], specs: SPECS })
    expect(r.accounts[0].status).toBe('partial')
    expect(r.accounts[0].error).toContain('reconciliation skipped')
  })

  it('matching spend stays ok', async () => {
    const h = harness({ firstSpend: '2026-10-15', earliest: '2026-10-15' })
    const r = await runBreakdownCapture(h.deps, { mode: 'dry', clientIds: ['c1'], specs: SPECS })
    expect(r.accounts[0].status).toBe('ok')
  })
})

describe('accounts', () => {
  it('hidden accounts are skipped without reading Meta', async () => {
    const h = harness({ firstSpend: '2026-10-15', earliest: null, hidden: true })
    const r = await runBreakdownCapture(h.deps, { mode: 'live', clientIds: ['c1'], specs: SPECS })
    expect(r.accounts[0].status).toBe('skipped')
    expect(h.breakdownCalls).toHaveLength(0)
  })

  it('a client with no bound accounts is reported as a problem', async () => {
    const h = harness({ firstSpend: '2026-10-15', earliest: null, accounts: 0 })
    const r = await runBreakdownCapture(h.deps, { mode: 'dry', clientIds: ['c1'], specs: SPECS })
    expect(r.accounts).toHaveLength(0)
    expect(r.problems.some((p) => p.includes('no bound Meta ad accounts'))).toBe(true)
  })
})

describe('merge keeps "Meta did not report" as null', () => {
  it('duplicate hourly rows merge to meta_leads null, never 0', () => {
    const rows = [hourRow('2026-10-20'), hourRow('2026-10-20')]
    const out = mapBreakdownRows(rows, HOUR, { clientId: 'c1', adAccountId: 'act_1', fetchedAt: 'x' })
    expect(out.rows).toHaveLength(1)
    expect(out.merged).toBe(1)
    expect(out.rows[0].meta_leads).toBeNull()
    expect(out.rows[0].meta_messaging).toBeNull()
    expect(out.rows[0].spend).toBe(20)
  })
})

describe('upsert conflict key matches the migration', () => {
  it('CONFLICT_KEY lists exactly the columns of ad_breakdown_stats_cell_key', () => {
    const sql = readFileSync(
      path.resolve(__dirname, '../../../../../supabase/migrations/20261029120000_ad_breakdown_stats_and_findings.sql'),
      'utf8',
    )
    const match = sql.match(/CONSTRAINT ad_breakdown_stats_cell_key\s+UNIQUE \(([^)]+)\)/)
    expect(match).not.toBeNull()
    const migrationCols = (match?.[1] ?? '').split(',').map((s) => s.trim())
    expect(CONFLICT_KEY.split(',').map((s) => s.trim())).toEqual(migrationCols)
  })
})
