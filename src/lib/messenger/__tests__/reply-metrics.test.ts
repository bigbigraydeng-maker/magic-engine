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
import { AUTOACK_SENT_BY_EMAIL, AUTOACK_TEMPLATE, LEGACY_AUTOACK_TEMPLATE } from '../autoack-identity'

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

describe('rowToThreadMessage — sender detection', () => {
  const base: ReplyMetricRow = {
    conversationId: 'c1',
    direction: 'outbound',
    body: 'Here are the details',
    senderName: null,
    sentAt: '2026-09-10T11:00:00Z',
  }

  it('a Page display name containing an @ is not an ME sender', () => {
    expect(rowToThreadMessage({ ...base, senderName: 'Tours @ Auckland' }).sentByHumanViaMe).toBe(false)
  })

  it('a whole-string email is an ME sender', () => {
    expect(rowToThreadMessage({ ...base, senderName: 'agent@example.com' }).sentByHumanViaMe).toBe(true)
  })
})

describe('computeReplyMetrics — boundaries', () => {
  it('a reply exactly 24h after the first customer message counts as within 24h; one second later does not', () => {
    const exact = computeReplyMetrics(
      [thread([msg('inbound', '2026-09-10T10:00:00Z', 'Hello'), msg('outbound', '2026-09-11T10:00:00Z', 'Hi, here are the details')])],
      opts,
    )
    expect(exact.humanRepliedWithin24h).toBe(1)
    const late = computeReplyMetrics(
      [thread([msg('inbound', '2026-09-10T10:00:00Z', 'Hello'), msg('outbound', '2026-09-11T10:00:01Z', 'Hi, here are the details')])],
      opts,
    )
    expect(late.humanReplied).toBe(1)
    expect(late.humanRepliedWithin24h).toBe(0)
  })

  it('a thread whose first message is exactly 24h old is mature; one second younger is not', () => {
    const exact = computeReplyMetrics([thread([msg('inbound', '2026-10-04T00:00:00Z', 'Hello')])], opts)
    expect(exact.mature).toBe(1)
    const young = computeReplyMetrics([thread([msg('inbound', '2026-10-04T00:00:01Z', 'Hello')])], opts)
    expect(young.mature).toBe(0)
  })
})

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

  it('still recognises the OLD bilingual auto-acknowledgement already stored in history (not a human reply)', () => {
    const rows: ReplyMetricRow[] = [
      { conversationId: 'c1', direction: 'inbound', body: 'Hello', senderName: null, sentAt: '2026-09-10T10:00:00Z' },
      { conversationId: 'c1', direction: 'outbound', body: LEGACY_AUTOACK_TEMPLATE, senderName: AUTOACK_SENT_BY_EMAIL, sentAt: '2026-09-10T10:02:00Z' },
    ]
    const result = computeReplyMetrics([{ conversationId: 'c1', messages: rows.map(rowToThreadMessage) }], opts)
    expect(result.meAutoAck).toBe(1)
    expect(result.humanReplied).toBe(0)
  })

  it('the auto-acknowledgement that is sent now contains no Chinese characters', () => {
    expect(/[\u3400-\u9fff]/.test(AUTOACK_TEMPLATE)).toBe(false)
    expect(AUTOACK_TEMPLATE.length).toBeGreaterThan(20)
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

interface FakeCall {
  table: string
  method: string
  args: unknown[]
}

interface FakeChain {
  select: (...args: unknown[]) => FakeChain
  eq: (...args: unknown[]) => FakeChain
  gte: (...args: unknown[]) => FakeChain
  in: (...args: unknown[]) => FakeChain
  order: (...args: unknown[]) => FakeChain
  range: (a: number, b: number) => Promise<{ data: object[] | null; error: { message: string } | null }>
}

function asClient(fake: object): SupabaseClient {
  return fake as SupabaseClient
}

/** Records every chained call so tests can pin the filters, not just the result. */
function makeFakeClient(
  tables: Record<string, object[]>,
  errorTable?: string,
): { db: SupabaseClient; calls: FakeCall[] } {
  const calls: FakeCall[] = []
  const db = asClient({
    from(table: string) {
      const record = (method: string) => (...args: unknown[]) => {
        calls.push({ table, method, args })
        return chain
      }
      const chain: FakeChain = {
        select: record('select'),
        eq: record('eq'),
        gte: record('gte'),
        in: record('in'),
        order: record('order'),
        range: (a: number, b: number) => {
          calls.push({ table, method: 'range', args: [a, b] })
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
  return { db, calls }
}

describe('fetchReplyMetrics', () => {
  it('reads conversations and messages and computes metrics', async () => {
    const { db, calls } = makeFakeClient({
      conversations: [{ id: 'c1' }],
      conversation_messages: [
        { conversation_id: 'c1', direction: 'inbound', body: 'Hello', sender_name: null, sent_at: '2026-09-10T10:00:00Z' },
        { conversation_id: 'c1', direction: 'outbound', body: 'Hi, here are the details', sender_name: 'agent@example.com', sent_at: '2026-09-10T11:00:00Z' },
      ],
    })
    const result = await fetchReplyMetrics(db, 'client-1', opts)
    expect(result.humanReplied).toBe(1)
    // Pin the filters: a dropped client or channel filter would still return the
    // same rows from this fake, so assert the calls themselves.
    expect(calls).toContainEqual({ table: 'conversations', method: 'eq', args: ['client_id', 'client-1'] })
    expect(calls).toContainEqual({ table: 'conversations', method: 'eq', args: ['channel', 'messenger'] })
    expect(calls).toContainEqual({
      table: 'conversations',
      method: 'gte',
      args: ['last_message_at', opts.from.toISOString()],
    })
  })

  it('pages past the 1000-row response cap and chunks conversation ids by 100', async () => {
    const conversations = Array.from({ length: 1001 }, (_, i) => ({ id: `c${i}` }))
    const { db, calls } = makeFakeClient({ conversations, conversation_messages: [] })
    await fetchReplyMetrics(db, 'client-1', opts)
    expect(calls.filter((c) => c.table === 'conversations' && c.method === 'range')).toHaveLength(2)
    const idChunks = calls.filter((c) => c.table === 'conversation_messages' && c.method === 'in')
    expect(idChunks).toHaveLength(11)
    expect((idChunks[0].args[1] as string[]).length).toBe(100)
    expect((idChunks[10].args[1] as string[]).length).toBe(1)
  })

  it('throws when the conversations query returns an error', async () => {
    const { db } = makeFakeClient({ conversations: [{ id: 'c1' }] }, 'conversations')
    await expect(fetchReplyMetrics(db, 'client-1', opts)).rejects.toThrow('boom')
  })
})
