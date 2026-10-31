import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPriorityTouchpoints } from '../priority-touchpoints'

function row(i: number) {
  return { id: String(i), contact_id: `c${i}`, channel: 'email', direction: 'inbound', occurred_at: '2026-01-01T00:00:00Z', created_at: '2026-02-01T00:00:00Z', raw: null, metadata: null, source: null }
}

function client(rpc: ReturnType<typeof vi.fn>, fallbackRows = [row(99)]) {
  const eq = vi.fn()
  const b = {
    select: () => b,
    eq: (key: string, value: string) => { eq(key, value); return b },
    order: () => b,
    range: async (from: number, to: number) => ({ data: fallbackRows.slice(from, to + 1), error: null }),
  }
  const from = vi.fn(() => b)
  return { sb: { rpc, from } as unknown as SupabaseClient, eq, from }
}

describe('priority touchpoints batch loader', () => {
  it('returns a complete ordered batch with one tenant-scoped request', async () => {
    const rows = Array.from({ length: 7685 }, (_, i) => row(i))
    const rpc = vi.fn(async () => ({ data: rows, error: null }))
    const c = client(rpc)
    const result = await loadPriorityTouchpoints(c.sb, 'tenant-a')
    expect(result.map((r) => r.id)).toEqual(rows.map((r) => r.id))
    expect(result.every((r) => r.summary === null)).toBe(true)
    expect(result[0].created_at).toBe('2026-02-01T00:00:00Z')
    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('crm_priority_touchpoint_batch', { p_client_id: 'tenant-a', p_offset: 0 })
    expect(c.from).not.toHaveBeenCalled()
  })

  it('reads past the ten-thousand boundary without truncation', async () => {
    const rows = Array.from({ length: 10001 }, (_, i) => row(i))
    const rpc = vi.fn(async (_name: string, args: { p_offset: number }) => ({ data: rows.slice(args.p_offset, args.p_offset + 10000), error: null }))
    const result = await loadPriorityTouchpoints(client(rpc).sb, 'tenant-a')
    expect(result).toHaveLength(10001)
    expect(result[10000].id).toBe('10000')
    expect(rpc.mock.calls.map(([, args]) => args.p_offset)).toEqual([0, 10000])
  })

  it.each(['error', 'malformed'])('uses the existing tenant-scoped reader on %s', async (mode) => {
    const rpc = vi.fn(async () => mode === 'error' ? { data: null, error: { message: 'missing' } } : { data: [{ id: 'incomplete' }], error: null })
    const c = client(rpc)
    const result = await loadPriorityTouchpoints(c.sb, 'tenant-a')
    expect(result.map((r) => r.id)).toEqual(['99'])
    expect(c.eq).toHaveBeenCalledWith('client_id', 'tenant-a')
  })

  it.each([
    ['created_at', 42],
    ['metadata', []],
    ['raw', 42],
    ['source', false],
  ] as const)('uses the tenant-scoped reader when %s has a disallowed value', async (field, value) => {
    const rpc = vi.fn(async () => ({ data: [{ ...row(1), [field]: value }], error: null }))
    const c = client(rpc)
    const result = await loadPriorityTouchpoints(c.sb, 'tenant-a')
    expect(result.map((r) => r.id)).toEqual(['99'])
    expect(c.eq).toHaveBeenCalledWith('client_id', 'tenant-a')
    expect(c.from).toHaveBeenCalled()
  })

  it('keeps null notes and object metadata on the batch path', async () => {
    const good = { ...row(1), created_at: null, raw: 'note', metadata: {}, source: 'me_manual' }
    const rpc = vi.fn(async () => ({ data: [good], error: null }))
    const c = client(rpc)
    await expect(loadPriorityTouchpoints(c.sb, 'tenant-a')).resolves.toEqual([{ ...good, summary: null }])
    expect(c.from).not.toHaveBeenCalled()
  })

  it('does not return partial data when a later batch fails', async () => {
    const rpc = vi.fn(async (_name: string, args: { p_offset: number }) => args.p_offset === 0
      ? { data: Array.from({ length: 10000 }, (_, i) => row(i)), error: null }
      : { data: null, error: { message: 'failure' } })
    const result = await loadPriorityTouchpoints(client(rpc).sb, 'tenant-a')
    expect(result.map((r) => r.id)).toEqual(['99'])
  })
})
