import { describe, expect, it } from 'vitest'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  emptyReadbackSuggestion,
  latestClientReadbackReceipt,
  parseReadbackSuggestion,
  readReadbackSuggestionForClient,
  WEEKLY_READBACK_JOB,
} from './readback-suggestion'

const CLIENT = '11111111-1111-4111-8111-111111111111'

const okReceipt = {
  client_id: CLIENT,
  as_of: '2026-11-17',
  error: null,
  suggestion: { status: 'ok', lines: ['模板「hot」互动不错：建议多做。'] },
}

describe('parseReadbackSuggestion', () => {
  it('turns an ok weekly receipt into draft basis lines', () => {
    const read = parseReadbackSuggestion(okReceipt)
    expect(read.read).toBe('ok')
    expect(read.asOf).toBe('2026-11-17')
    expect(read.draftBasis[0]).toContain('Facebook Reel')
    expect(read.draftBasis.some((line) => line.includes('建议多做'))).toBe(true)
  })

  it('stays empty when there is no advice to act on', () => {
    expect(parseReadbackSuggestion(null)).toEqual(emptyReadbackSuggestion())
    expect(parseReadbackSuggestion({ ...okReceipt, suggestion: { status: 'not_enough_data', lines: ['样本太少'] } }))
      .toEqual({ read: 'none', asOf: '2026-11-17', draftBasis: [] })
  })

  it('marks a failed client receipt as unreadable', () => {
    const read = parseReadbackSuggestion({ ...okReceipt, error: 'db down' })
    expect(read.read).toBe('unreadable')
    expect(read.draftBasis).toEqual([])
  })
})

describe('latestClientReadbackReceipt', () => {
  it('picks the newest matching client from cron summaries', () => {
    const rows = [
      { summary: { clients: [{ ...okReceipt, suggestion: { status: 'ok', lines: ['新的'] } }] } },
      { summary: { clients: [{ ...okReceipt, suggestion: { status: 'ok', lines: ['旧的'] } }] } },
    ]
    const receipt = latestClientReadbackReceipt(rows, CLIENT)
    expect(parseReadbackSuggestion(receipt).draftBasis.some((l) => l.includes('新的'))).toBe(true)
  })
})

describe('readReadbackSuggestionForClient', () => {
  const memoryDb = (rows: unknown[], error: unknown = null): SupabaseClient => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'gte', 'order']) q[m] = () => q
    q.limit = () => Promise.resolve({ data: rows, error })
    return { from: (table: string) => {
      if (table !== 'cron_run_logs') throw new Error(table)
      return q
    } } as unknown as SupabaseClient
  }

  it('returns none when the only receipt is outside the fresh window (no rows)', async () => {
    const read = await readReadbackSuggestionForClient(memoryDb([]), CLIENT, new Date('2026-11-20'))
    expect(read).toEqual(emptyReadbackSuggestion())
  })

  it('surfaces unreadable when cron_run_logs cannot be read', async () => {
    const read = await readReadbackSuggestionForClient(memoryDb([], { message: 'down' }), CLIENT, new Date())
    expect(read.read).toBe('unreadable')
  })

  it('loads the latest in-window receipt for the client', async () => {
    const read = await readReadbackSuggestionForClient(
      memoryDb([{ summary: { clients: [okReceipt] }, started_at: '2026-11-17T06:10:00Z' }]),
      CLIENT,
      new Date('2026-11-18'),
    )
    expect(read.read).toBe('ok')
    expect(WEEKLY_READBACK_JOB).toBe('social-readback-weekly')
  })
})
