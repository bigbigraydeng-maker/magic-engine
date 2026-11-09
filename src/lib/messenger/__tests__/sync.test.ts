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
// Which Page token (and whether the Page is this client's at all) is decided by
// the sync gate — its rules are tested in lib/meta/__tests__/page-sync-authorization.test.ts,
// and the real gate wired into this sync in sync-page-gate.test.ts.
vi.mock('@/lib/meta/page-sync-authorization', () => ({ authorizePageSync: vi.fn() }))
vi.mock('@/lib/meta/conversations', () => ({ fetchPageConversations: vi.fn() }))

import { syncClientMessenger } from '../sync'
import { supabaseAdmin } from '@/lib/supabase'
import { authorizePageSync } from '@/lib/meta/page-sync-authorization'
import { fetchPageConversations } from '@/lib/meta/conversations'

const mockFrom = vi.mocked(supabaseAdmin.from)
const mockAuth = vi.mocked(authorizePageSync)
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
function stubSupabase(opts: {
  watermarkRow?: { meta_updated_time: string } | null
  /**
   * Existing (participant_name, last_message_at) for the conversation being
   * stored — what `loadExistingSummary` (the webhook-vs-cron overwrite guard,
   * issue #1581 H14) reads. `undefined` = no existing row (brand-new thread,
   * matches every pre-existing test in this file).
   */
  existingSummaryRow?: { participant_name: string | null; last_message_at: string | null } | null
}): Captured {
  const captured: Captured = { conversations: [], messages: [] }

  mockFrom.mockImplementation((table: string) => {
    let result: unknown = { data: null, error: null }
    // Distinguishes loadExistingSummary's select (.eq('conversation_id', …)) from
    // getWatermark's (.not('meta_updated_time', …)) — both hit `conversations`.
    let sawConversationIdFilter = false

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string) => {
        if (col === 'conversation_id') sawConversationIdFilter = true
        return chain
      },
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      // in/is/lt/update back the identity-index load + contact linking added to sync.
      in: () => chain,
      is: () => chain,
      lt: () => chain,
      update: () => chain,
      single: async () => result,
      maybeSingle: async () => {
        if (table === 'conversations' && sawConversationIdFilter) {
          return { data: opts.existingSummaryRow ?? null, error: null }
        }
        return result
      },
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

    // The identity-index load (contact_identities) resolves to an empty set here,
    // so linking is a no-op in these sync tests — link behaviour is covered in
    // link-contacts.test.ts. Without this the .in() call would read the shared
    // `result` and mis-handle it; an empty list keeps the index empty.
    if (table === 'contact_identities') {
      result = { data: [], error: null }
    }

    if (table === 'conversations') {
      // The SELECT path (watermark lookup) resolves to the configured row.
      // (loadExistingSummary's select is intercepted separately above.)
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
        tags: [],
      },
      {
        messageId: 'mid.2',
        direction: lastDirection,
        senderId: lastDirection === 'inbound' ? 'psid_9' : 'page',
        senderName: lastDirection === 'inbound' ? 'Sarah Mitchell' : 'CTS Tours',
        body: 'Thanks, that helps.',
        sentAt: '2026-07-26T10:00:00+0000',
        tags: [],
      },
    ],
  }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // Default: the gate lets this Page through with a derived Page token.
  mockAuth.mockResolvedValue({ ok: true, pageToken: 'page-tok', via: 'legacy_client_token' })
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
    expect(mockAuth).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('skips when the client has no Meta token', async () => {
    mockAuth.mockResolvedValue({ ok: false, skipped: 'no_meta_token' })

    const res = await syncClientMessenger(CLIENT)

    expect(res.skipped).toBe('no_meta_token')
    expect(res.error).toBeUndefined()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('skips when the token does not manage that Page', async () => {
    mockAuth.mockResolvedValue({ ok: false, skipped: 'no_page_token' })

    const res = await syncClientMessenger(CLIENT)

    expect(res.skipped).toBe('no_page_token')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('AD-SEC-4: a Page not verified as this client\'s is never read, and the run reports it as an error', async () => {
    mockAuth.mockResolvedValue({ ok: false, skipped: 'page_not_verified', reason: 'unverified_shared_token' })

    const res = await syncClientMessenger(CLIENT)

    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), CLIENT.id, CLIENT.facebook_page_id, expect.anything())
    expect(res.skipped).toBe('page_not_verified')
    // error, not just skipped: the hourly run counts errors as failed, so a paused
    // inbox cannot look like a quiet hour.
    expect(res.error).toBe('page_not_verified: unverified_shared_token')
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

/**
 * issue #1581 (H14): the Messenger webhook now writes participant_name /
 * last_message_at / last_message_from in real time. This cron is a 2-hourly
 * fallback — its Graph API snapshot can be older than what the webhook already
 * wrote, and must not regress it.
 */
describe('syncClientMessenger — cron must not overwrite fresher webhook data', () => {
  it('no existing row (brand-new thread) → writes forward as before', async () => {
    const captured = stubSupabase({ watermarkRow: null, existingSummaryRow: null })
    mockFetch.mockResolvedValue([convo('inbound')])

    await syncClientMessenger(CLIENT)

    expect(captured.conversations[0]).toMatchObject({
      participant_name: 'Sarah Mitchell',
      last_message_at: '2026-07-26T10:00:00+0000',
      last_message_from: 'customer',
    })
  })

  it('existing last_message_at is NEWER than this snapshot (webhook already got a later message) → does not touch it', async () => {
    const captured = stubSupabase({
      watermarkRow: null,
      // Webhook already recorded a message an hour after this Graph snapshot's last message.
      existingSummaryRow: { participant_name: 'Sarah Mitchell', last_message_at: '2026-07-26T11:00:00+0000' },
    })
    mockFetch.mockResolvedValue([convo('inbound')]) // last message at 10:00

    await syncClientMessenger(CLIENT)

    expect(captured.conversations[0]).not.toHaveProperty('last_message_at')
    expect(captured.conversations[0]).not.toHaveProperty('last_message_from')
    expect(captured.conversations[0]).not.toHaveProperty('participant_name')
    // Cron-owned columns still get refreshed every run.
    expect(captured.conversations[0]).toMatchObject({
      client_id: CLIENT.id,
      conversation_id: 't_100',
      participant_psid: 'psid_9',
      message_count: 2,
    })
  })

  it('existing last_message_at is OLDER than this snapshot (cron caught up on something webhook missed) → overwrites forward', async () => {
    const captured = stubSupabase({
      watermarkRow: null,
      existingSummaryRow: { participant_name: 'Sarah M.', last_message_at: '2026-07-26T09:00:00+0000' },
    })
    mockFetch.mockResolvedValue([convo('inbound')]) // last message at 10:00 — newer

    await syncClientMessenger(CLIENT)

    expect(captured.conversations[0]).toMatchObject({
      participant_name: 'Sarah Mitchell',
      last_message_at: '2026-07-26T10:00:00+0000',
      last_message_from: 'customer',
    })
  })

  it('existing last_message_at is EQUAL to this snapshot → does not touch it (no regression either way)', async () => {
    const captured = stubSupabase({
      watermarkRow: null,
      existingSummaryRow: { participant_name: 'Sarah Mitchell', last_message_at: '2026-07-26T10:00:00+0000' },
    })
    mockFetch.mockResolvedValue([convo('inbound')])

    await syncClientMessenger(CLIENT)

    expect(captured.conversations[0]).not.toHaveProperty('last_message_at')
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

describe('syncClientMessenger — uses the Page token the gate hands back', () => {
  it('reads the inbox with exactly that token', async () => {
    stubSupabase({ watermarkRow: null })
    mockAuth.mockResolvedValue({ ok: true, pageToken: 'stored-page-tok', via: 'client_oauth' })

    await syncClientMessenger(CLIENT)

    expect(mockFetch).toHaveBeenCalledWith(CLIENT.facebook_page_id, 'stored-page-tok', undefined)
  })
})
