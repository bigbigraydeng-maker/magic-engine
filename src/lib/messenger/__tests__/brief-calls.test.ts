/**
 * Phone calls as a brief input (`brief-calls.ts`): which calls count, when a stored brief is out of date, and that a
 * failed read is never turned into "this customer had no calls".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Result {
  data: unknown[] | null
  error: { message: string } | null
}
const results: Record<string, Result> = {}
const calls: { table: string; filters: Record<string, unknown> }[] = []

function builder(table: string) {
  const filters: Record<string, unknown> = {}
  const b: Record<string, unknown> = {}
  const chain = (name: string) => (...args: unknown[]) => {
    filters[name] = args
    return b
  }
  for (const m of ['select', 'in', 'eq', 'gte']) b[m] = chain(m)
  b.then = (resolve: (r: Result) => unknown) => {
    calls.push({ table, filters })
    return Promise.resolve(results[table] ?? { data: [], error: null }).then(resolve)
  }
  return b
}

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (table: string) => builder(table) } }))

import {
  CALL_LOOKBACK_DAYS,
  MAX_CALLS_IN_BRIEF,
  hasCallSinceBrief,
  loadCallActivity,
  loadCallActivityOrEmpty,
  recentCallLines,
  type CallNote,
} from '../brief-calls'

const NOW = new Date('2026-11-11T00:00:00.000Z')
const note = (over: Partial<CallNote> = {}): CallNote => ({
  occurredAt: '2026-11-10T05:58:34+00:00',
  analysisCreatedAt: '2026-11-10T06:18:00+00:00',
  summary: 'wants March, asks about the cruise',
  ...over,
})

beforeEach(() => {
  for (const k of Object.keys(results)) delete results[k]
  calls.length = 0
})

describe('hasCallSinceBrief', () => {
  it('a call note written after the brief → true', () => {
    expect(hasCallSinceBrief([note()], '2026-11-10T05:00:00+00:00')).toBe(true)
  })
  it('the brief is newer than every call note → false (otherwise it would be rewritten every hour)', () => {
    expect(hasCallSinceBrief([note()], '2026-11-10T07:12:19+00:00')).toBe(false)
  })
  it('no brief yet, no calls, or an unreadable date → false (no new rule for those)', () => {
    expect(hasCallSinceBrief([note()], null)).toBe(false)
    expect(hasCallSinceBrief([], '2026-11-10T05:00:00+00:00')).toBe(false)
    expect(hasCallSinceBrief(undefined, '2026-11-10T05:00:00+00:00')).toBe(false)
    expect(hasCallSinceBrief([note()], 'not a date')).toBe(false)
  })
})

describe('recentCallLines', () => {
  it('keeps the newest few, oldest first, with the call day', () => {
    const notes = [1, 2, 3, 4].map((d) => note({ occurredAt: `2026-11-0${d}T01:00:00+00:00`, summary: `call ${d}` }))
    const lines = recentCallLines(notes)
    expect(lines).toHaveLength(MAX_CALLS_IN_BRIEF)
    expect(lines[0]).toBe('2026-11-02 call: call 2')
    expect(lines[lines.length - 1]).toBe('2026-11-04 call: call 4')
  })
  it('cuts a very long note', () => {
    const line = recentCallLines([note({ summary: 'x'.repeat(2000) })])[0] ?? ''
    expect(line.length).toBeLessThan(560)
    expect(line.endsWith('…')).toBe(true)
  })
  it('nothing in, nothing out', () => {
    expect(recentCallLines(undefined)).toEqual([])
    expect(recentCallLines([])).toEqual([])
  })
})

describe('loadCallActivity', () => {
  it('joins phone touchpoints to their AI call notes per contact, oldest first, and only reads phone rows of the lookback window', async () => {
    results.contact_touchpoints = {
      error: null,
      data: [
        { contact_id: 'k1', occurred_at: '2026-11-10T05:58:34+00:00', metadata: { call_analysis_id: 'a2' } },
        { contact_id: 'k1', occurred_at: '2026-11-10T03:42:38+00:00', metadata: { call_analysis_id: 'a1' } },
        { contact_id: 'k1', occurred_at: '2026-11-10T03:43:53+00:00', metadata: null }, // a staff note: no call analysis
        { contact_id: 'k2', occurred_at: '2026-11-09T01:00:00+00:00', metadata: { call_analysis_id: 'gone' } }, // analysis missing
      ],
    }
    results.telephony_call_analyses = {
      error: null,
      data: [
        { id: 'a1', summary: 'customer shopping, call back at seven', created_at: '2026-11-10T03:45:00+00:00' },
        { id: 'a2', summary: '  wants March  ', created_at: '2026-11-10T06:18:00+00:00' },
      ],
    }
    const activity = await loadCallActivity(['k1', 'k2', 'k1'], NOW)
    expect(activity.get('k1')?.map((n) => n.summary)).toEqual(['customer shopping, call back at seven', 'wants March'])
    expect(activity.has('k2')).toBe(false)
    const touchRead = calls.find((c) => c.table === 'contact_touchpoints')
    expect(touchRead?.filters.eq).toEqual(['channel', 'phone'])
    const since = (touchRead?.filters.gte as string[])[1] ?? ''
    expect(Date.parse(since)).toBe(NOW.getTime() - CALL_LOOKBACK_DAYS * 86_400_000)
  })

  it('no contacts → no query at all', async () => {
    expect((await loadCallActivity([], NOW)).size).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('a failed read throws (never "no calls")', async () => {
    results.contact_touchpoints = { data: null, error: { message: 'boom' } }
    await expect(loadCallActivity(['k1'], NOW)).rejects.toThrow('call touchpoints read: boom')
  })

  it('the cycle variant logs and carries on as before this feature existed', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    results.contact_touchpoints = { data: null, error: { message: 'boom' } }
    const activity = await loadCallActivityOrEmpty(['k1'], NOW)
    expect(activity.size).toBe(0)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('rows of an unexpected shape are skipped, not trusted', async () => {
    results.contact_touchpoints = { error: null, data: [{ id: 'x' }, null, 5] as unknown[] }
    expect((await loadCallActivity(['k1'], NOW)).size).toBe(0)
  })
})
