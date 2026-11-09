import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushPaidSignalReviewItems, type ManualItem } from '../manual-items'

const now = new Date('2026-09-08T10:00:00Z')
const candidate = (clientId: string, email = 'same@example.com') => ({ clientId, email })

function database(candidates: ReturnType<typeof candidate>[], tag = 'paid_customer') {
  return {
    from(table: string) {
      const chain = {
        select: () => chain, eq: () => chain, gte: () => chain, order: () => chain,
        limit: async () => ({ data: [{ summary: { needsReview: candidates } }], error: null }),
        in: async (_key: string, ids: string[]) => {
          expect(table).toBe('clients')
          return { data: ids.map(id => ({ id, mailchimp_audience_id: id,
            leads_config: { paid_tagging: { paid_tag: tag } } })), error: null }
        },
      }
      return chain
    },
  } as unknown as SupabaseClient
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('paid review history to actionable items', () => {
  it('keeps the unpaid client when another client shares its email and is already paid', async () => {
    vi.stubEnv('MAILCHIMP_API_KEY', 'test-us19')
    const fetch = vi.fn(async (url: string) => new Response(JSON.stringify({
      tags: url.includes('/lists/client-a/') ? [{ name: 'paid_customer' }] : [],
    })))
    vi.stubGlobal('fetch', fetch)
    const items: ManualItem[] = []
    await pushPaidSignalReviewItems(database([
      candidate('client-a'), candidate('client-b'), candidate('client-b', 'SAME@example.com'),
    ]), items, now)
    expect(items.map(item => item.client_id)).toEqual(['client-b'])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('uses the configured tag in the instruction and removes the item after that tag is applied', async () => {
    vi.stubEnv('MAILCHIMP_API_KEY', 'test-us19')
    let paid = false
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ tags: paid ? [{ name: 'vip' }] : [] }))))
    const db = database([candidate('client-a')], ' vip ')
    const items: ManualItem[] = []
    await pushPaidSignalReviewItems(db, items, now)
    expect(items[0].how).toContain('vip')
    expect(items[0].how).not.toContain('paid_customer')
    paid = true
    const after: ManualItem[] = []
    await pushPaidSignalReviewItems(db, after, now)
    expect(after).toEqual([])
  })

  it('filters paid historical candidates before taking twenty pending items', async () => {
    vi.stubEnv('MAILCHIMP_API_KEY', 'test-us19')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({
      tags: url.includes('/lists/paid/') ? [{ name: 'paid_customer' }] : [],
    }))))
    const items: ManualItem[] = []
    await pushPaidSignalReviewItems(database([
      ...Array.from({ length: 20 }, (_, i) => candidate('paid', `paid${i}@example.com`)),
      ...Array.from({ length: 21 }, (_, i) => candidate('pending', `pending${i}@example.com`)),
    ]), items, now)
    expect(items).toHaveLength(20)
    expect(items.every(item => item.client_id === 'pending')).toBe(true)
  })
})
