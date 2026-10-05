import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  computeReplyMetrics,
  fetchReplyMetrics,
  rowToThreadMessage,
  type ReplyMetricRow,
  type ReplyMetricsOptions,
} from '../reply-metrics'
import type { ThreadMessage } from '../automation'
import { AUTOACK_SENT_BY_EMAIL, AUTOACK_TEMPLATE } from '../autoack-identity'

const now = new Date('2026-10-05T00:00:00Z')
const opts: ReplyMetricsOptions = {
  from: new Date('2026-09-01T00:00:00Z'),
  to: new Date('2026-10-05T00:00:00Z'),
  now,
}

function msg(direction: 'inbound' | 'outbound', sentAt: string, body: string): ThreadMessage {
  return { direction, body, sentAt, tags: [] }
}

function thread(messages: ThreadMessage[]) {
  return { conversationId: 'c1', messages }
}

describe('computeReplyMetrics', () => {
  it('counts a human reply within 24h', () => {
    const result = computeReplyMetrics(
      [thread([msg('inbound', '2026-09-10T10:00:00Z', 'Hello'), msg('outbound', '2026-09-10T11:30:00Z', 'Hi, here are the details')])],
      opts,
    )
    expect(result.humanReplied).toBe(1)
    expect(result.humanRepliedWithin24h).toBe(1)
    expect(result.humanRepliedRate).toBe(1)
    expect(result.humanRepliedWithin24hRate).toBe(1)
  })

  it('counts a human reply after 24h but not within 24h', () => {
    const result = computeReplyMetrics(
      [thread([msg('inbound', '2026-09-10T10:00:00Z', 'Hello'), msg('outbound', '2026-09-11T16:00:00Z', 'Hi, here are the details')])],
      opts,
    )
    expect(result.humanReplied).toBe(1)
    expect(result.humanRepliedWithin24h).toBe(0)
  })

  it('treats an empty-body card reply as automated only', () => {
    const result = computeReplyMetrics(
      [thread([msg('inbound', '2026-09-10T10:00:00Z', 'Hello'), msg('outbound', '2026-09-10T10:00:05Z', '')])],
      opts,
    )
    expect(result.automatedOnly).toBe(1)
    expect(result.humanReplied).toBe(0)
  })

  it('recognises the ME auto-acknowledgement from a stored row', () => {
    const rows: ReplyMetricRow[] = [
      { conversationId: 'c1', direction: 'inbound', body: 'Hello', senderName: null, sentAt: '2026-09-10T10:00:00Z' },
      { conversationId: 'c1', direction: 'outbound', body: AUTOACK_TEMPLATE, senderName: AUTOACK_SENT_BY_EMAIL, sentAt: '2026-09-10T10:02:00Z' },
    ]
    const result = computeReplyMetrics(
      [{ conversationId: 'c1', messages: rows.map(rowToThreadMessage) }],
      opts,
    )
    expect(result.meAutoAck).toBe(1)
    expect(result.humanReplied).toBe(0)
    expect(result.automatedOnly).toBe(1)
    // The classifier checks the auto-ack flag first, so also pin the flags
    // themselves: a mutation that sets the human flag on the auto-ack row would
    // otherwise hide behind that ordering.
    const ackRow = rowToThreadMessage(rows[1])
    expect(ackRow.viaMeAutoAck).toBe(true)
    expect(ackRow.sentByHumanViaMe).toBe(false)
  })

  it('treats a different body from the auto-ack email as a human reply', () => {
    const row: ReplyMetricRow = {
      conversationId: 'c1',
      direction: 'outbound',
      body: 'Here are the details you asked for',
      senderName: AUTOACK_SENT_BY_EMAIL,
      sentAt: '2026-09-10T10:10:00Z',
    }
    const mapped = rowToThreadMessage(row)
    expect(mapped.sentByHumanViaMe).toBe(true)
    const result = computeReplyMetrics(
      [{ conversationId: 'c1', messages: [msg('inbound', '2026-09-10T10:00:00Z', 'Hello'), mapped] }],
      opts,
    )
    expect(result.humanReplied).toBe(1)
  })

  it('excludes threads where the Page spoke first', () => {
    const result = computeReplyMetrics(
      [thread([msg('outbound', '2026-09-10T09:00:00Z', 'Our Christmas tour is on'), msg('inbound', '2026-09-10T10:00:00Z', 'Hello')])],
      opts,
    )
    expect(result.cohort).toBe(0)
    expect(result.pageSpokeFirst).toBe(1)
  })

  it('does not treat a system notice before the customer as the Page speaking first', () => {
    const result = computeReplyMetrics(
      [
        thread([
          msg('outbound', '2026-09-10T09:59:00Z', 'Jane 回复了一条广告。'),
          msg('inbound', '2026-09-10T10:00:00Z', 'Hello'),
          msg('outbound', '2026-09-10T12:00:00Z', 'Hi, here are the details'),
        ]),
      ],
      opts,
    )
    expect(result.cohort).toBe(1)
    expect(result.humanReplied).toBe(1)
  })

  it('does not count a thread that is not yet mature', () => {
    const result = computeReplyMetrics(
      [thread([msg('inbound', '2026-10-04T22:00:00Z', 'Hello')])],
      opts,
    )
    expect(result.cohort).toBe(1)
    expect(result.mature).toBe(0)
    expect(result.humanReplied).toBe(0)
    expect(result.humanRepliedRate).toBeNull()
    expect(result.humanRepliedWithin24hRate).toBeNull()
  })

  it('skips threads whose first customer message is before the window', () => {
    const result = computeReplyMetrics(
      [thread([msg('inbound', '2026-08-20T10:00:00Z', 'Hello')])],
      opts,
    )
    expect(result.cohort).toBe(0)
  })

  it('treats an instant machine reply as automated only', () => {
    const result = computeReplyMetrics(
      [thread([msg('inbound', '2026-09-10T10:00:00Z', 'Hello'), msg('outbound', '2026-09-10T10:00:10Z', 'Thanks for contacting us')])],
      opts,
    )
    expect(result.automatedOnly).toBe(1)
  })
})

interface FakeChain {
  select: () => FakeChain
  eq: () => FakeChain
  gte: () => FakeChain
  in: () => FakeChain
  order: () => FakeChain
  range: (a: number, b: number) => Promise<{ data: object[] | null; error: { message: string } | null }>
}

function asClient(fake: object): SupabaseClient {
  return fake as SupabaseClient
}

function makeFakeClient(tables: Record<string, object[]>, errorTable?: string): SupabaseClient {
  return asClient({
    from(table: string) {
      const chain: FakeChain = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        in: () => chain,
        order: () => chain,
        range: (a: number, b: number) => {
          if (table === errorTable) {
            return Promise.resolve({ data: null, error: { message: 'boom' } })
          }
          const rows = tables[table] ?? []
          return Promise.resolve({ data: rows.slice(a, b + 1), error: null })
        },
      }
      return chain
    },
  })
}

describe('fetchReplyMetrics', () => {
  it('reads conversations and messages and computes metrics', async () => {
    const db = makeFakeClient({
      conversations: [{ id: 'c1' }],
      conversation_messages: [
        { conversation_id: 'c1', direction: 'inbound', body: 'Hello', sender_name: null, sent_at: '2026-09-10T10:00:00Z' },
        { conversation_id: 'c1', direction: 'outbound', body: 'Hi, here are the details', sender_name: 'agent@example.com', sent_at: '2026-09-10T11:00:00Z' },
      ],
    })
    const result = await fetchReplyMetrics(db, 'client-1', opts)
    expect(result.humanReplied).toBe(1)
  })

  it('throws when the conversations query returns an error', async () => {
    const db = makeFakeClient({ conversations: [{ id: 'c1' }] }, 'conversations')
    await expect(fetchReplyMetrics(db, 'client-1', opts)).rejects.toThrow('boom')
  })
})
