import { describe, it, expect, vi, beforeEach } from 'vitest'

interface QueryCall {
  method: 'eq' | 'gte'
  column: string
  value: unknown
}

interface QueryResult {
  data: unknown
  error: { message: string } | null
}

const state: {
  table: string | null
  calls: QueryCall[]
  result: QueryResult
} = {
  table: null,
  calls: [],
  result: { data: [], error: null },
}

vi.mock('@/lib/supabase', () => {
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      state.calls.push({ method: 'eq', column, value })
      return builder
    },
    gte: (column: string, value: unknown) => {
      state.calls.push({ method: 'gte', column, value })
      return builder
    },
    limit: () => Promise.resolve(state.result),
  }

  return {
    supabaseAdmin: {
      from: (table: string) => {
        state.table = table
        return builder
      },
    },
  }
})

import { hasRecentOutbound } from '../recent-outbound'

describe('hasRecentOutbound', () => {
  beforeEach(() => {
    state.table = null
    state.calls = []
    state.result = { data: [], error: null }
  })

  it('returns true when a row comes back and queries the right table/columns', async () => {
    state.result = { data: [{ id: 'row-1' }], error: null }

    const result = await hasRecentOutbound('conv-123', '2026-01-01T00:00:00.000Z')

    expect(result).toBe(true)
    expect(state.table).toBe('conversation_outbound_log')
    expect(state.calls).toEqual([
      { method: 'eq', column: 'conversation_id', value: 'conv-123' },
      { method: 'eq', column: 'status', value: 'sent' },
      { method: 'gte', column: 'created_at', value: '2026-01-01T00:00:00.000Z' },
    ])
  })

  it('returns false when data is an empty array', async () => {
    state.result = { data: [], error: null }

    const result = await hasRecentOutbound('conv-123', '2026-01-01T00:00:00.000Z')

    expect(result).toBe(false)
  })

  it('throws (does not return false) when the query returns an error', async () => {
    state.result = { data: null, error: { message: 'boom' } }

    await expect(
      hasRecentOutbound('conv-123', '2026-01-01T00:00:00.000Z'),
    ).rejects.toThrow(/read failed/)
  })
})

describe('hasRecentOutbound — 响应不认识时不放行', () => {
  it('🔴 没报错但 data 不是数组（null）→ 抛错，不当成「最近没回过」', async () => {
    state.result = { data: null, error: null }
    await expect(hasRecentOutbound('conv-9', '2026-01-01T00:00:00.000Z')).rejects.toThrow(/read failed/)
  })
})


describe('hasRecentOutbound — 只认成功发出的行', () => {
  it('🔴 查询带 status=sent 过滤（失败/待发的行不算已回复；把过滤去掉这条会红）', async () => {
    state.result = { data: [], error: null }
    state.calls = []
    await hasRecentOutbound('conv-9', '2026-01-01T00:00:00.000Z')
    expect(state.calls).toContainEqual({ method: 'eq', column: 'status', value: 'sent' })
    expect(state.calls.some((c) => c.column === 'status' && c.value !== 'sent')).toBe(false)
  })
})
