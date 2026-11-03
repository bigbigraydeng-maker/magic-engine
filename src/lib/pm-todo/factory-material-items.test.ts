import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushFactoryMaterialItems } from './factory-material-items'
import type { ManualItem } from './manual-item-types'

const NOW = new Date('2026-10-27T12:00:00.000Z')
const HELD = '90506421-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function client(byStatus: Record<string, { data: unknown; error: { message: string } | null }>) {
  return {
    from() {
      let status = ''
      const query = {
        select: () => query,
        eq: (_column: string, value: string) => {
          status = value
          return query
        },
        limit: async () => byStatus[status] ?? { data: [], error: null },
      }
      return query
    },
  } as unknown as SupabaseClient
}

async function items(byStatus: Record<string, { data: unknown; error: { message: string } | null }>, names = new Map([['client-1', { name: 'Sample Co' }]])) {
  const out: ManualItem[] = []
  await pushFactoryMaterialItems(client(byStatus), out, NOW, names)
  return out
}

describe('pushFactoryMaterialItems', () => {
  it('nudges a review older than 24 hours and skips a fresh one', async () => {
    const old = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString()
    const fresh = new Date(NOW.getTime() - 23 * 60 * 60 * 1000).toISOString()
    const out = await items({
      in_review: { data: [
        { id: 'review-old', client_id: 'client-1', updated_at: old },
        { id: 'review-new', client_id: 'client-1', updated_at: fresh },
      ], error: null },
      dead_letter: { data: [], error: null },
    })
    expect(out.map((item) => item.kind)).toEqual(['factory_review_overdue'])
    expect(out[0]?.what).toContain('超过 24 小时')
    expect(out[0]?.what).toContain('Sample Co')
    expect(out[0]?.how).toContain('不会自动批准')
  })

  it('an unreadable review time still becomes a todo', async () => {
    const out = await items({
      in_review: { data: [{ id: 'review-bad', client_id: 'client-1', updated_at: 'nope' }], error: null },
    })
    expect(out[0]?.what).toContain('读不到')
  })

  it('skips a held review and does not invent a client name', async () => {
    const old = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString()
    const out = await items({
      in_review: { data: [
        { id: HELD, client_id: 'client-1', updated_at: old },
        { id: 'review-old', client_id: 'client-2', updated_at: old },
      ], error: null },
    }, new Map())
    expect(out).toHaveLength(1)
    expect(out[0]?.client_name).toBe('未知客户')
  })

  it('escalations and unreadable dead letters become todos, planned reruns do not', async () => {
    const out = await items({
      in_review: { data: [], error: null },
      dead_letter: { data: [
        { id: 'rerun-me', client_id: 'client-1', reject_reason: 'ENOENT missing local file', review_ref: null, brief: null, reclaim_count: 0 },
        { id: 'stuck-me', client_id: 'client-1', reject_reason: '413 Payload Too Large', review_ref: null, brief: null, reclaim_count: 0 },
        { id: 'blank-me', client_id: 'client-1', reject_reason: '', review_ref: null, brief: null, reclaim_count: 0 },
      ], error: null },
    })
    expect(out.map((item) => item.kind)).toEqual(['factory_dead_letter_stuck', 'factory_dead_letter_stuck'])
    expect(out[0]?.what).toContain('413')
    expect(out[0]?.what).toContain('不是批准')
    expect(out[1]?.what).toContain('读不到')
  })

  it('a query failure is a todo, not an empty success', async () => {
    const out = await items({
      in_review: { data: null, error: { message: '' } },
      dead_letter: { data: null, error: { message: 'db down' } },
    })
    expect(out.map((item) => item.kind)).toEqual(['factory_material_check_failed', 'factory_material_check_failed'])
    expect(out[0]?.what).toContain('读不到')
    expect(out[1]?.what).toContain('db down')
  })
})
