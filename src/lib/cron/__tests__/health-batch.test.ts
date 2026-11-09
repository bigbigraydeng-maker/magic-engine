/**
 * checkCronHealth used to fire ~230 single-job queries per call (two per job + one per registry
 * entry for stuck rows). It now asks cron_run_logs once for the recent window and once for stuck
 * rows, and only falls back to a per-job query for jobs that have no run in the window.
 * These tests pin both the answer (same as the per-job queries) and the query count.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { checkCronHealth } from '../health'
import { CRON_REGISTRY } from '../registry'

type Row = Record<string, unknown>

interface Recorded {
  table: string
  eq: Array<[string, unknown]>
  hasIn: boolean
  hasGte: boolean
}

/**
 * Minimal in-memory stand-in for the few PostgREST calls health.ts makes.
 * It implements select/in/eq/is/gte/order/limit/range over arrays; anything else is a test bug.
 */
function fakeDb(tables: Record<string, Row[]>, opts: { failWindow?: boolean } = {}) {
  const log: Recorded[] = []
  class Query implements PromiseLike<{ data: Row[] | null; error: { message: string } | null }> {
    private eqs: Array<[string, unknown]> = []
    private ins: Array<[string, unknown[]]> = []
    private gtes: Array<[string, string]> = []
    private nulls: string[] = []
    private orderBy: { col: string; asc: boolean } | null = null
    private lim: number | null = null
    private rng: [number, number] | null = null
    constructor(private table: string) {}
    select(): this { return this }
    eq(c: string, v: unknown): this { this.eqs.push([c, v]); return this }
    in(c: string, v: unknown[]): this { this.ins.push([c, v]); return this }
    gte(c: string, v: string): this { this.gtes.push([c, v]); return this }
    is(c: string, v: null): this { if (v === null) this.nulls.push(c); return this }
    order(c: string, o?: { ascending?: boolean }): this { this.orderBy = { col: c, asc: o?.ascending !== false }; return this }
    limit(n: number): this { this.lim = n; return this }
    range(a: number, b: number): this { this.rng = [a, b]; return this }
    then<R1, R2>(
      ok?: ((v: { data: Row[] | null; error: { message: string } | null }) => R1 | PromiseLike<R1>) | null,
      bad?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
    ): PromiseLike<R1 | R2> {
      log.push({ table: this.table, eq: this.eqs, hasIn: this.ins.length > 0, hasGte: this.gtes.length > 0 })
      if (opts.failWindow && this.table === 'cron_run_logs' && this.ins.length > 0 && this.gtes.length > 0 && this.nulls.length === 0) {
        return Promise.resolve({ data: null, error: { message: 'boom' } }).then(ok, bad)
      }
      let rows = [...(tables[this.table] ?? [])]
      for (const [c, v] of this.eqs) rows = rows.filter((r) => r[c] === v)
      for (const [c, v] of this.ins) rows = rows.filter((r) => v.includes(r[c]))
      for (const [c, v] of this.gtes) rows = rows.filter((r) => String(r[c]) >= v)
      for (const c of this.nulls) rows = rows.filter((r) => r[c] === null)
      if (this.orderBy) {
        const { col, asc } = this.orderBy
        rows.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1))
      }
      if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1)
      if (this.lim !== null) rows = rows.slice(0, this.lim)
      return Promise.resolve({ data: rows, error: null }).then(ok, bad)
    }
  }
  const client = { from: (t: string) => new Query(t) } as unknown as SupabaseClient // narrow fake of the calls above
  return { client, log }
}

const NOW = new Date('2026-10-19T00:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const runRow = (job: string, startedAt: string, extra: Row = {}): Row => ({
  job_name: job, status: 'completed', error_message: null, started_at: startedAt, finished_at: startedAt, ...extra,
})

const logging = CRON_REGISTRY.filter((e) => e.logsRuns)
const [jobA, jobB, jobC] = [logging[0], logging[1], logging[2]]
if (!jobA || !jobB || !jobC) throw new Error('registry needs at least three logging jobs')
const names = Array.from(new Set(CRON_REGISTRY.map((e) => e.jobName)))

const cronQueries = (log: Recorded[]) => log.filter((q) => q.table === 'cron_run_logs')

describe('checkCronHealth query batching', () => {
  it('uses one window query + one stuck query, and a per-job query only for jobs missing from the window', async () => {
    const { client, log } = fakeDb({
      cron_run_logs: [
        runRow(jobA.jobName, hoursAgo(2)),
        runRow(jobB.jobName, hoursAgo(1), { status: 'failed', error_message: 'kaput', finished_at: hoursAgo(1) }),
        runRow(jobB.jobName, hoursAgo(30)), // older success must not hide the latest failure
        runRow(jobC.jobName, hoursAgo(24 * 10)), // outside the 3-day window -> per-job fallback
      ],
    })
    const report = await checkCronHealth(client, NOW)

    expect(report.failing.map((f) => f.service)).toContain(jobB.service)
    expect(report.failing.find((f) => f.service === jobB.service)?.lastError).toBe('kaput')
    expect(report.neverRan.map((j) => j.service)).not.toContain(jobC.service) // fallback found its old run

    const q = cronQueries(log)
    const windowQueries = q.filter((x) => x.hasIn && x.hasGte && !x.eq.some(([c]) => c === 'status'))
    const stuckQueries = q.filter((x) => x.hasIn && x.eq.some(([c]) => c === 'status'))
    const perJob = q.filter((x) => x.eq.some(([c]) => c === 'job_name'))
    expect(windowQueries).toHaveLength(1)
    expect(stuckQueries).toHaveLength(1)
    // only jobs with NO run in the window are asked for individually (other callers of the table excluded)
    const askedJobs = new Set(perJob.map((x) => String(x.eq.find(([c]) => c === 'job_name')?.[1])))
    expect(askedJobs.has(jobA.jobName)).toBe(false)
    expect(askedJobs.has(jobB.jobName)).toBe(false)
    expect(askedJobs.has(jobC.jobName)).toBe(true)
    expect(q.length).toBeLessThan(names.length + 5) // was 2 * names + registry size (~230)
  })

  it('reports a job stuck in "running" for hours, once per service', async () => {
    const { client } = fakeDb({
      cron_run_logs: [
        runRow(jobA.jobName, hoursAgo(5), { status: 'running', finished_at: null }),
        runRow(jobA.jobName, hoursAgo(1)),
      ],
    })
    const report = await checkCronHealth(client, NOW)
    const stuck = report.stuck.find((s) => s.service === jobA.service)
    expect(stuck?.rounds).toBe(1)
    expect(stuck?.minutesRunning).toBe(300)
  })

  it('falls back to per-job queries for every job when the window query fails (never a partial map)', async () => {
    const { client, log } = fakeDb(
      { cron_run_logs: [runRow(jobA.jobName, hoursAgo(2)), runRow(jobB.jobName, hoursAgo(1), { status: 'failed', error_message: 'x' })] },
      { failWindow: true },
    )
    const report = await checkCronHealth(client, NOW)
    expect(report.failing.map((f) => f.service)).toContain(jobB.service)
    const perJob = cronQueries(log).filter((x) => x.eq.some(([c]) => c === 'job_name'))
    expect(new Set(perJob.map((x) => String(x.eq.find(([c]) => c === 'job_name')?.[1]))).size).toBeGreaterThanOrEqual(names.length)
  })
})
