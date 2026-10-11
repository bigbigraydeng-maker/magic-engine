import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/require-admin', () => ({ guardAdmin: vi.fn(async () => null) }))

const workOrderRow = {
  id: 'wo1',
  client_id: 'c1',
  status: 'published',
  heartbeat_at: null,
  brief_brand_name: 'Acme',
  brief_persona: { name: 'Nora', role: 'narrator' },
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

const inReviewRow = {
  id: 'wo2',
  client_id: 'c1',
  status: 'in_review',
  heartbeat_at: null,
  brief_brand_name: 'Acme',
  brief_persona: { name: 'Nora', role: 'narrator' },
  published_ref: null,
}

const acceptanceRow = {
  client_id: 'c1',
  category: 'narrator_voice_mismatch',
  brief_fingerprint: '',
  accepted_by: 'pm@example.com',
  accepted_at: '2024-02-01T00:00:00Z',
}

// Compute the fingerprint the same way the production code does, so the test
// stays honest about what "matching persona" means.
import { narratorBriefFingerprint } from '@/lib/factory/review-accept-flag'

const matchingAcceptance = {
  ...acceptanceRow,
  brief_fingerprint: narratorBriefFingerprint({
    brand_name: 'Acme',
    brand_voice: { persona: { name: 'Nora', role: 'narrator' } },
  }) as string,
}

let workOrdersResult: { data: unknown[]; error: { message: string } | null }
let acceptancesResult: { data: unknown[]; error: { message: string } | null }

vi.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const result =
      table === 'content_work_orders'
        ? workOrdersResult
        : table === 'factory_review_flag_acceptances'
          ? acceptancesResult
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
  acceptancesResult = { data: [], error: null }
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
    expect(json.orders[0]).not.toHaveProperty('brief_brand_name')
    expect(json.orders[0]).not.toHaveProperty('brief_persona')

    const serialized = JSON.stringify(json)
    expect(serialized).not.toContain('PAGE123')
    expect(serialized).not.toContain('VID456')
    expect(serialized).not.toContain('EVT789')
    expect(serialized).not.toContain('CMT1')
  })

  it('returns accepted_flags with one entry when the persona matches a stored acceptance', async () => {
    workOrdersResult = { data: [inReviewRow], error: null }
    acceptancesResult = { data: [matchingAcceptance], error: null }

    const res = await GET()
    const json = await res.json()

    expect(json.accepted_flags_error).toBeNull()
    expect(json.orders[0].accepted_flags).toEqual([
      {
        category: 'narrator_voice_mismatch',
        accepted_at: '2024-02-01T00:00:00Z',
        accepted_by: 'pm@example.com',
      },
    ])
  })

  it('returns accepted_flags [] when the persona name differs from the stored acceptance', async () => {
    workOrdersResult = {
      data: [{ ...inReviewRow, brief_persona: { name: 'Someone Else', role: 'narrator' } }],
      error: null,
    }
    acceptancesResult = { data: [matchingAcceptance], error: null }

    const res = await GET()
    const json = await res.json()

    expect(json.accepted_flags_error).toBeNull()
    expect(json.orders[0].accepted_flags).toEqual([])
  })

  it('surfaces accepted_flags_error and empties accepted_flags when the acceptances query fails', async () => {
    workOrdersResult = { data: [inReviewRow], error: null }
    acceptancesResult = { data: [], error: { message: 'boom' } }

    const res = await GET()
    const json = await res.json()

    expect(json.accepted_flags_error).toBe('boom')
    expect(json.orders[0].accepted_flags).toEqual([])
  })
})
