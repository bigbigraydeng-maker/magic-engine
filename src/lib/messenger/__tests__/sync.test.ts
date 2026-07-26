/**
 * Tests for the Messenger inbox sync.
 *
 * Focus on the decisions that are easy to get silently wrong:
 *   1. opt-in gating — a client with no page id / token must never hit Graph
 *   2. last_message_from — the "customer is waiting on us" flag the sales view keys on
 *   3. the watermark must look BACK from the newest stored thread, not resume exactly
 *      at it (Meta backdates updated_time; resuming exactly would lose those threads)
 *   4. a first run must pull the whole inbox, not an empty window
 *   5. one client blowing up must not throw out of the cron
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: vi.fn() }))
vi.mock('@/lib/meta/page-posts', () => ({ getPageAccessToken: vi.fn() }))
vi.mock('@/lib/meta/conversations', () => ({ fetchPageConversations: vi.fn() }))

import { syncClientMessenger } from '../sync'
import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { getPageAccessToken } from '@/lib/meta/page-posts'
import { fetchPageConversations } from '@/lib/meta/conversations'

const mockFrom = vi.mocked(supabaseAdmin.from)
const mockUserToken = vi.mocked(getMetaTokenForClient)
const mockPageToken = vi.mocked(getPageAccessToken)
const mockFetch = vi.mocked(fetchPageConversations)

const CLIENT = { id: 'c0000000-0000-0000-0000-000000000000', name: 'CTS Tours NZ', facebook_page_id: '1616575215312482' }

/** Captures every payload written, so assertions can inspect the stored row. */
interface Captured {
  conversations: Record<string, unknown>[]
  messages: Record<string, unknown>[][]
}

/**
 * Chainable supabase stub. Every builder method returns the same object; the
 * object is awaitable and also exposes .single()/.maybeSingle().
 */
function stubSupabase(opts: { watermarkRow?: { meta_updated_time: string } | null }): Captured {
  const captured: Captured = { conversations: [], messages: [] }

  mockFrom.mockImplementation((table: string) => {
    let result: unknown = { data: null, error: null }

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      single: async () => result,
      maybeSingle: async () => result,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      upsert: (payload: Record<string, unknown> | Record<string, unknown>[]) => {
        if (table === 'conversations') {
          captured.conversations.push(payload as Record<string, unknown>)
          result = { data: { id: 'row-uuid' }, error: null }
        } else {
          captured.messages.push(payload as Record<string, unknown>[])
          result = { data: (payload as unknown[]).map(() => ({ id: 'm' })), error: null }
        }
        return chain
      },
    }

    if (table === 'conversations') {
      // The SELECT path (watermark lookup) resolves to the configured row.
      result = { data: opts.watermarkRow ?? null, error: null }
    }

    return chain as never
  })

  return captured
}

function convo(lastDirection: 'inbound' | 'outbound') {
  return {
    conversationId: 't_100',
    participantPsid: 'psid_9',
    participantName: 'Sarah Mitchell',
    messageCount: 2,
    updatedTime: '2026-07-26T10:00:00+0000',
    messages: [
      {
        messageId: 'mid.1',
        direction: 'outbound' as const,
        senderId: 'page',
        senderName: 'CTS Tours',
        body: 'Best of China departs 3 Nov.',
        sentAt: '2026-07-26T09:00:00+0000',
      },
      {
        messageId: 'mid.2',
        direction: lastDirection,
        senderId: lastDirection === 'inbound' ? 'psid_9' : 'page',
        senderName: lastDirection === 'inbound' ? 'Sarah Mitchell' : 'CTS Tours',
        body: 'Thanks, that helps.',
        sentAt: '2026-07-26T10:00:00+0000',
      },
    ],
  }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockUserToken.mockResolvedValue('user-tok')
  mockPageToken.mockResolvedValue('page-tok')
  mockFetch.mockResolvedValue([])
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('syncClientMessenger — opt-in gating', () => {
  it('skips a client with no page id and never calls Graph', async () => {
    const res = await syncClientMessenger({ ...CLIENT, facebook_page_id: null })

    expect(res.skipped).toBe('no_page_id')
    expect(mockUserToken).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('skips when the client has no Meta token', async () => {
    mockUserToken.mockResolvedValue(null)

    const res = await syncClientMessenger(CLIENT)

    expect(res.skipped).toBe('no_meta_token')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('skips when the token does not manage that Page', async () => {
    mockPageToken.mockResolvedValue(null)

    const res = await syncClientMessenger(CLIENT)

    expect(res.skipped).toBe('no_page_token')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('syncClientMessenger — storing', () => {
  it('flags the thread as waiting on us when the customer spoke last', async () => {
    const captured = stubSupabase({ watermarkRow: null })
    mockFetch.mockResolvedValue([convo('inbound')])

    const res = await syncClientMessenger(CLIENT)

    expect(res.conversations).toBe(1)
    expect(res.messages).toBe(2)
    expect(captured.conversations[0].last_message_from).toBe('customer')
    expect(captured.conversations[0].last_message_at).toBe('2026-07-26T10:00:00+0000')
  })

  it('flags the thread as ours when the Page spoke last', async () => {
    const captured = stubSupabase({ watermarkRow: null })
    mockFetch.mockResolvedValue([convo('outbound')])

    await syncClientMessenger(CLIENT)

    expect(captured.conversations[0].last_message_from).toBe('page')
  })

  it('stores the Meta watermark separately from the last message time', async () => {
    const captured = stubSupabase({ watermarkRow: null })
    const c = convo('inbound')
    c.updatedTime = '2026-07-26T12:00:00+0000' // bumped by a reaction, not a message
    mockFetch.mockResolvedValue([c])

    await syncClientMessenger(CLIENT)

    expect(captured.conversations[0].meta_updated_time).toBe('2026-07-26T12:00:00+0000')
    expect(captured.conversations[0].last_message_at).toBe('2026-07-26T10:00:00+0000')
  })

  it('writes every message with its direction under the parent thread', async () => {
    const captured = stubSupabase({ watermarkRow: null })
    mockFetch.mockResolvedValue([convo('inbound')])

    await syncClientMessenger(CLIENT)

    const rows = captured.messages[0]
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.conversation_id === 'row-uuid')).toBe(true)
    expect(rows.map((r) => r.direction)).toEqual(['outbound', 'inbound'])
  })
})

describe('syncClientMessenger — watermark', () => {
  it('pulls the whole inbox on a first run', async () => {
    stubSupabase({ watermarkRow: null })

    await syncClientMessenger(CLIENT)

    expect(mockFetch).toHaveBeenCalledWith('1616575215312482', 'page-tok', undefined)
  })

  it('looks back from the newest stored thread rather than resuming exactly at it', async () => {
    stubSupabase({ watermarkRow: { meta_updated_time: '2026-07-26T12:00:00.000Z' } })

    await syncClientMessenger(CLIENT)

    const since = mockFetch.mock.calls[0][2] as string
    expect(new Date(since).getTime()).toBe(new Date('2026-07-26T06:00:00.000Z').getTime())
  })
})

describe('syncClientMessenger — resilience', () => {
  it('returns an error instead of throwing when Graph blows up', async () => {
    stubSupabase({ watermarkRow: null })
    mockFetch.mockRejectedValue(new Error('rate limited'))

    const res = await syncClientMessenger(CLIENT)

    expect(res.error).toBe('rate limited')
    expect(res.conversations).toBe(0)
  })
})
