import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/require-admin', () => ({ guardAdmin: vi.fn(async () => null) }))

const workOrderRow = {
  id: 'wo1',
  client_id: 'c1',
  status: 'published',
  heartbeat_at: null,
  published_ref: {
    platform: 'facebook',
    page_id: 'PAGE123',
    video_id: 'VID456',
    post_id: 'VID456',
    video_state: 'DRAFT',
    permalink: '/reel/9/',
    published_at: '2024-01-01T00:00:00Z',
    event_ids: ['EVT789'],
    first_comment_id: 'CMT1',
  },
}

let workOrdersResult: { data: unknown[]; error: { message: string } | null }

vi.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const result =
      table === 'content_work_orders'
        ? workOrdersResult
        : { data: [{ id: 'c1', name: 'Some Client' }], error: null }
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.order = () => chain
    chain.limit = () => chain
    chain.in = () => chain
    chain.then = (resolve: (value: unknown) => unknown) => resolve(result)
    return chain
  }
  return { supabaseAdmin: { from: (table: string) => builder(table) } }
})

import { GET } from './route'

beforeEach(() => {
  workOrdersResult = { data: [workOrderRow], error: null }
})

describe('GET /api/factory/work-orders', () => {
  it('projects published_ref into a whitelisted view and never leaks raw fields', async () => {
    const res = await GET()
    const json = await res.json()

    expect(json.orders[0].published).toEqual({
      video_state: 'DRAFT',
      permalink: 'https://www.facebook.com/reel/9/',
      published_at: '2024-01-01T00:00:00Z',
      provisional: false,
    })
    expect(json.orders[0]).not.toHaveProperty('published_ref')

    const serialized = JSON.stringify(json)
    expect(serialized).not.toContain('PAGE123')
    expect(serialized).not.toContain('VID456')
    expect(serialized).not.toContain('EVT789')
    expect(serialized).not.toContain('CMT1')
  })

  it('no longer returns accepted_flags (the "PM accepted" feature was retired)', async () => {
    const res = await GET()
    const json = await res.json()

    expect(json).not.toHaveProperty('accepted_flags_error')
    expect(json.orders[0]).not.toHaveProperty('accepted_flags')
  })
})
