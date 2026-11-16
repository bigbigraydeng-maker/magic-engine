import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPriorityTouchpoints } from '../priority-touchpoints'

interface Row { id: string; contact_id: string; channel: string; direction: string; occurred_at: string; created_at: string | null; raw: string | null; metadata: Record<string, unknown> | null; source: string | null }

function row(i: number): Row {
  return { id: String(i), contact_id: `c${i}`, channel: 'email', direction: 'inbound', occurred_at: '2026-01-01T00:00:00Z', created_at: '2026-02-01T00:00:00Z', raw: null, metadata: null, source: null }
}

function client(rows: Row[], opts: { failFrom?: number } = {}) {
  const eq = vi.fn()
  const ranges: Array<[number, number, boolean]> = []
  const rpc = vi.fn()
  const from = vi.fn(() => {
    let counted = false
    const b = {
      select: (_cols: string, o?: { count?: string }) => { counted = o?.count === 'exact'; return b },
      eq: (key: string, value: string) => { eq(key, value); return b },
      order: () => b,
      range: async (start: number, end: number) => {
        ranges.push([start, end, counted])
        if (opts.failFrom === start) return { data: null, error: { message: 'read failed' }, count: null }
        return { data: rows.slice(start, end + 1), error: null, count: counted ? rows.length : null }
      },
    }
    return b
  })
  return { sb: { rpc, from } as unknown as SupabaseClient, eq, ranges, rpc }
}

describe('priority touchpoints loader', () => {
  it('returns every row in order, scoped to the tenant, without the database function', async () => {
    const rows = Array.from({ length: 9329 }, (_, i) => row(i))
    const c = client(rows)
    const result = await loadPriorityTouchpoints(c.sb, 'tenant-a')
    expect(result.map((r) => r.id)).toEqual(rows.map((r) => r.id))
    expect(result.every((r) => r.summary === null)).toBe(true)
    expect(c.eq).toHaveBeenCalledWith('client_id', 'tenant-a')
    expect(c.rpc).not.toHaveBeenCalled()
    // One counted first page, then the nine remaining pages; never a counted later page.
    expect(c.ranges).toHaveLength(10)
    expect(c.ranges.filter(([, , counted]) => counted)).toEqual([[0, 999, true]])
  })

  it('keeps notes and metadata on each row', async () => {
    const good = { ...row(1), created_at: null, raw: 'note', metadata: { outcome: 'no_answer' }, source: 'me_manual' }
    await expect(loadPriorityTouchpoints(client([good]).sb, 'tenant-a')).resolves.toEqual([{ ...good, summary: null }])
  })

  it('returns an empty list for a tenant without touchpoints', async () => {
    await expect(loadPriorityTouchpoints(client([]).sb, 'tenant-a')).resolves.toEqual([])
  })

  it('does not return partial data when a later page fails', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => row(i))
    await expect(loadPriorityTouchpoints(client(rows, { failFrom: 2000 }).sb, 'tenant-a')).rejects.toThrow('read failed')
  })
})
