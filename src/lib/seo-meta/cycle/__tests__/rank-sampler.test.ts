import { describe, expect, it, vi } from 'vitest'
import { MAX_ROWS_PER_RUN, isDue, isoDay, loadDueRows, sampleOneRow, type RankLogRow } from '../rank-sampler'
import type { RankReading } from '../rank-check'
import type { StoredRankSample } from '../rank-verdict'

// ── A tiny in-memory stand-in for the two tables the sampler may touch ───────────────────────
// Any OTHER table throws: that is how the "shadow period writes nowhere else" rule is enforced.

type Row = Record<string, unknown>
type Filter = (row: Row) => boolean
interface Db { rows: Row[]; updates: Row[]; failUpdate?: string; matchNothing?: boolean }

function fakeSupabase(db: Db) {
  return {
    from(table: string) {
      if (table !== 'seo_meta_log' && table !== 'clients') throw new Error(`shadow period: sampler must not touch "${table}"`)
      const filters: Filter[] = []
      let patch: Row | null = null
      let limitN = Infinity
      const source = (): Row[] => (table === 'clients' ? [{ id: 'client-1', domain: 'example.co.nz', semrush_db: 'nz' }] : db.rows)
      const run = () => {
        const matched = source().filter((r) => filters.every((f) => f(r))).slice(0, limitN)
        if (patch) {
          if (db.failUpdate) return { data: null, error: { message: db.failUpdate } }
          if (db.matchNothing) return { data: [], error: null }
          db.updates.push(patch)
          matched.forEach((r) => Object.assign(r, patch))
          return { data: matched.map((r) => ({ id: r.id })), error: null }
        }
        return { data: matched, error: null }
      }
      const q = {
        select: () => q,
        update: (p: Row) => { patch = p; return q },
        eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return q },
        is: (col: string, val: null) => { filters.push((r) => (r[col] ?? null) === val); return q },
        not: (col: string, _op: string, val: null) => { filters.push((r) => (r[col] ?? null) !== val); return q },
        gt: (col: string, val: string) => { filters.push((r) => String(r[col]) > val); return q },
        order: () => q,
        limit: (n: number) => { limitN = n; return q },
        maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error } },
        then: (resolve: (v: unknown) => void) => resolve(run()),
      }
      return q
    },
  }
}

const OPTIMISED = '2026-10-05T05:31:00.000Z'
const T_PLUS_18 = new Date('2026-10-23T20:20:00.000Z')
const DAY2 = new Date('2026-10-25T20:20:00.000Z')
const DAY3 = new Date('2026-10-27T20:20:00.000Z')

function row(overrides: Partial<RankLogRow> = {}): RankLogRow {
  return {
    id: 'row-1', client_id: 'client-1', page_slug: 'beijing-to-xian', page_url: 'https://example.co.nz/blog/beijing-to-xian',
    keyword: 'beijing to xian', new_title: 'Beijing to Xian High Speed Train Guide', optimised_at: OPTIMISED, reverted_at: null,
    baseline_rank_group: 10, baseline_rank_status: 'ranked', baseline_serp_depth: 30, rank_samples: [], rank_verdict: null, verdict_detail: null,
    ...overrides,
  }
}

function reading(rank: number | null, overrides: Partial<RankReading> = {}): RankReading {
  return {
    status: rank === null ? 'not_in_top_n' : 'ranked', rankGroup: rank, url: rank === null ? null : 'https://example.co.nz/blog/beijing-to-xian',
    depth: 30, fetchedAt: '2026-10-23T20:20:05.000Z', duplicateUrl: false, cost: 0.012, ...overrides,
  }
}

function setup(r: RankLogRow, extra: Partial<Db> = {}) {
  const db: Db = { rows: [{ ...r }], updates: [], ...extra }
  const fetchRank = vi.fn(async (_input: unknown) => reading(7))
  const fetchLiveTitle = vi.fn(async (_url: string, _title: string): Promise<boolean | null> => true)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = fakeSupabase(db) as any
  return { db, supabase, fetchRank, fetchLiveTitle }
}

const samplesOf = (db: Db): StoredRankSample[] => (db.rows[0].rank_samples ?? []) as StoredRankSample[]

describe('isDue', () => {
  const now = T_PLUS_18
  it('is not due before day 18', () => {
    expect(isDue(row(), new Date('2026-10-22T05:30:00.000Z'))).toBe(false)
  })
  it('is due from day 18', () => {
    expect(isDue(row(), now)).toBe(true)
  })
  it('waits SAMPLE_SPACING_DAYS between samples — adjacent days are not independent', () => {
    const s = (day: string): StoredRankSample => ({ day, status: 'ranked', rank_group: 7, url: 'u', depth: 30, fetched_at: 'x', cost: null })
    expect(isDue(row({ rank_samples: [s('2026-10-23')] }), new Date('2026-10-24T20:20:00.000Z'))).toBe(false)
    expect(isDue(row({ rank_samples: [s('2026-10-23')] }), DAY2)).toBe(true)
  })
  it('never touches a row that already has a verdict, or a pre-feature row with no baseline status', () => {
    expect(isDue(row({ rank_verdict: 'no_detectable_change' }), now)).toBe(false)
    expect(isDue(row({ baseline_rank_status: null }), now)).toBe(false)
  })
  it('a reverted row is finalised promptly — it does not wait out the 18 days', () => {
    expect(isDue(row({ reverted_at: '2026-10-06T00:00:00Z' }), new Date('2026-10-08T00:00:00Z'))).toBe(true)
  })
})

describe('loadDueRows', () => {
  it('returns only due rows and never more than MAX_ROWS_PER_RUN (a backlog cannot become a runaway bill)', async () => {
    const rows = Array.from({ length: MAX_ROWS_PER_RUN + 10 }, (_, i) => ({ ...row({ id: `r${i}` }) }))
    rows.push({ ...row({ id: 'too-young', optimised_at: '2026-10-20T00:00:00Z' }) })
    const db: Db = { rows, updates: [] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const due = await loadDueRows(fakeSupabase(db) as any, T_PLUS_18)
    expect(due).toHaveLength(MAX_ROWS_PER_RUN)
    expect(due.find((r) => r.id === 'too-young')).toBeUndefined()
  })
})

describe('sampleOneRow — taking samples', () => {
  it('takes the first sample at the BASELINE depth and keeps the row open until 3 valid samples exist', async () => {
    const { db, supabase, fetchRank, fetchLiveTitle } = setup(row({ baseline_serp_depth: 20 }))
    const out = await sampleOneRow('row-1', { supabase, fetchRank, fetchLiveTitle, now: T_PLUS_18 })
    expect(out).toMatchObject({ kind: 'sampled', providerCalls: 1, costUsd: 0.012, verdict: null })
    expect(fetchRank).toHaveBeenCalledWith({ keyword: 'beijing to xian', countryCode: 'nz', domain: 'example.co.nz', targetUrl: 'https://example.co.nz/blog/beijing-to-xian', depth: 20 })
    expect(samplesOf(db)).toHaveLength(1)
    expect(samplesOf(db)[0]).toMatchObject({ day: isoDay(T_PLUS_18), status: 'ranked', rank_group: 7 })
    expect(db.rows[0].rank_verdict).toBeNull()
  })

  it('is idempotent within a day: a re-run or retry never double-samples or double-spends', async () => {
    const { db, supabase, fetchRank, fetchLiveTitle } = setup(row())
    await sampleOneRow('row-1', { supabase, fetchRank, fetchLiveTitle, now: T_PLUS_18 })
    const again = await sampleOneRow('row-1', { supabase, fetchRank, fetchLiveTitle, now: new Date('2026-10-23T22:00:00.000Z') })
    expect(again).toMatchObject({ kind: 'skipped', reason: 'not_due', providerCalls: 0 })
    expect(fetchRank).toHaveBeenCalledTimes(1)
    expect(samplesOf(db)).toHaveLength(1)
  })

  it('writes the verdict (and checked_at) on the third valid sample — 10 → 7,7,7 is a move up', async () => {
    const { db, supabase, fetchRank, fetchLiveTitle } = setup(row())
    await sampleOneRow('row-1', { supabase, fetchRank, fetchLiveTitle, now: T_PLUS_18 })
    await sampleOneRow('row-1', { supabase, fetchRank, fetchLiveTitle, now: DAY2 })
    const out = await sampleOneRow('row-1', { supabase, fetchRank, fetchLiveTitle, now: DAY3 })
    expect(out).toMatchObject({ kind: 'finalised', verdict: 'rank_moved_up' })
    expect(db.rows[0]).toMatchObject({ rank_verdict: 'rank_moved_up', checked_at: DAY3.toISOString() })
    expect(samplesOf(db)).toHaveLength(3)
    expect(db.rows[0].verdict_detail).toMatchObject({ valid_samples: 3, median_delta: -3, live_title_ok: true })
  })

  it('a failed SERP read is stored as a fetch_failed attempt — it does not count as a valid sample and does not produce a verdict', async () => {
    const { db, supabase, fetchLiveTitle } = setup(row())
    const fetchRank = vi.fn(async () => reading(null, { status: 'fetch_failed', error: 'boom' }))
    const out = await sampleOneRow('row-1', { supabase, fetchRank, fetchLiveTitle, now: T_PLUS_18 })
    expect(out.kind).toBe('sampled')
    expect(samplesOf(db)[0]).toMatchObject({ status: 'fetch_failed', rank_group: null })
    expect(db.rows[0].rank_verdict).toBeNull()
  })
})

describe('sampleOneRow — rows that are finalised WITHOUT spending a SERP call', () => {
  it.each([
    ['a reverted row', { reverted_at: '2026-10-06T00:00:00Z' }, 'reverted'],
    ['a row with no usable baseline', { baseline_rank_status: 'fetch_failed' as const, baseline_rank_group: null }, 'no_baseline'],
  ])('%s → not_measured:%s', async (_label, overrides, reason) => {
    const { db, supabase, fetchRank, fetchLiveTitle } = setup(row(overrides))
    const out = await sampleOneRow('row-1', { supabase, fetchRank, fetchLiveTitle, now: T_PLUS_18 })
    expect(out).toMatchObject({ kind: 'finalised', verdict: 'not_measured', providerCalls: 0 })
    expect(db.rows[0].verdict_detail).toMatchObject({ reason })
    expect(fetchRank).not.toHaveBeenCalled()
  })

  it('a later change to the same page → not_measured:superseded', async () => {
    const { db, supabase, fetchRank, fetchLiveTitle } = setup(row())
    db.rows.push({ ...row({ id: 'row-2', optimised_at: '2026-10-12T00:00:00.000Z' }) })
    const out = await sampleOneRow('row-1', { supabase, fetchRank, fetchLiveTitle, now: T_PLUS_18 })
    expect(out).toMatchObject({ kind: 'finalised', verdict: 'not_measured', providerCalls: 0 })
    expect(db.rows[0].verdict_detail).toMatchObject({ reason: 'superseded' })
    expect(fetchRank).not.toHaveBeenCalled()
  })

  it('the live page not carrying the title we wrote (merged PR ≠ deployed page) → not_measured:live_title_mismatch', async () => {
    const { db, supabase, fetchRank } = setup(row())
    const fetchLiveTitle = vi.fn(async (_url: string, _title: string): Promise<boolean | null> => false)
    const out = await sampleOneRow('row-1', { supabase, fetchRank, fetchLiveTitle, now: T_PLUS_18 })
    expect(out).toMatchObject({ kind: 'finalised', verdict: 'not_measured' })
    expect(db.rows[0].verdict_detail).toMatchObject({ reason: 'live_title_mismatch', live_title_ok: false })
    expect(fetchRank).not.toHaveBeenCalled()
  })

  it('never overwrites an existing verdict', async () => {
    const { supabase, fetchRank, fetchLiveTitle } = setup(row({ rank_verdict: 'no_detectable_change' }))
    const out = await sampleOneRow('row-1', { supabase, fetchRank, fetchLiveTitle, now: T_PLUS_18 })
    expect(out).toMatchObject({ kind: 'skipped', reason: 'already_has_verdict' })
    expect(fetchRank).not.toHaveBeenCalled()
  })
})

describe('sampleOneRow — fail-closed', () => {
  it('throws (so the run is visibly failed) when the database write fails — it never reports a sample it did not store', async () => {
    const { supabase, fetchRank, fetchLiveTitle } = setup(row(), { failUpdate: 'connection reset' })
    await expect(sampleOneRow('row-1', { supabase, fetchRank, fetchLiveTitle, now: T_PLUS_18 })).rejects.toThrow('rank_sampler_write_failed:connection reset')
  })

  it('throws when the write matched no row (a verdict landed underneath us) instead of pretending success', async () => {
    const { supabase, fetchRank, fetchLiveTitle } = setup(row(), { matchNothing: true })
    await expect(sampleOneRow('row-1', { supabase, fetchRank, fetchLiveTitle, now: T_PLUS_18 })).rejects.toThrow('rank_sampler_write_matched_0_rows')
  })

  it('touches only seo_meta_log and clients — nothing is written to flywheel_outcomes / memory during the shadow period', async () => {
    const touched: string[] = []
    const { db } = setup(row())
    const inner = fakeSupabase(db)
    const spy = { from: (t: string) => { touched.push(t); return inner.from(t) } }
    const fetchRank = vi.fn(async (_input: unknown) => reading(7))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sampleOneRow('row-1', { supabase: spy as any, fetchRank, fetchLiveTitle: async () => true, now: T_PLUS_18 })
    expect([...new Set(touched)].sort()).toEqual(['clients', 'seo_meta_log'])
  })
})
