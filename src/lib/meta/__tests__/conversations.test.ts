/**
 * Tests for the Page Messenger inbox fetcher.
 *
 * What matters here is what a naive implementation gets wrong:
 *   - direction: a message from the Page id is ours, everything else is the customer's
 *   - the participant is the one who is NOT the Page (Meta includes the Page itself)
 *   - the nested messages field is capped, so a long thread must be re-fetched
 *   - the incremental watermark must stop paging, not just filter the current page
 *   - Graph failures must degrade to [] rather than throw inside a cron
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchPageConversations, fetchConversationMessages } from '../conversations'

const PAGE = '1616575215312482'
const TOKEN = 'page-tok'

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => 'boom',
  } as unknown as Response
}

/** One thread whose nested messages are complete (message_count matches). */
function thread(overrides: Record<string, unknown> = {}) {
  return {
    id: 't_100',
    updated_time: '2026-07-26T10:00:00+0000',
    message_count: 2,
    participants: {
      data: [
        { id: PAGE, name: 'CTS Tours' },
        { id: 'psid_9', name: 'Sarah Mitchell' },
      ],
    },
    messages: {
      data: [
        {
          id: 'mid.2',
          created_time: '2026-07-26T10:00:00+0000',
          message: 'Thanks, that helps.',
          from: { id: 'psid_9', name: 'Sarah Mitchell' },
        },
        {
          id: 'mid.1',
          created_time: '2026-07-26T09:00:00+0000',
          message: 'Best of China departs 3 Nov.',
          from: { id: PAGE, name: 'CTS Tours' },
        },
      ],
    },
    ...overrides,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fetchPageConversations', () => {
  it('labels direction by sender and picks the non-Page participant', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [thread()] }))

    const [convo] = await fetchPageConversations(PAGE, TOKEN)

    expect(convo.participantPsid).toBe('psid_9')
    expect(convo.participantName).toBe('Sarah Mitchell')
    // Oldest first, so the last element is genuinely the latest message.
    expect(convo.messages.map((m) => m.messageId)).toEqual(['mid.1', 'mid.2'])
    expect(convo.messages[0].direction).toBe('outbound')
    expect(convo.messages[1].direction).toBe('inbound')
  })

  it('requests the messenger platform only', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))

    await fetchPageConversations(PAGE, TOKEN)

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain(`/${PAGE}/conversations`)
    expect(url).toContain('platform=messenger')
  })

  it('re-fetches the thread when nested messages were truncated', async () => {
    // Graph says 120 messages but only returned 2 inline.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [thread({ message_count: 120 })] }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'mid.full',
              created_time: '2026-07-20T08:00:00+0000',
              message: 'Original enquiry',
              from: { id: 'psid_9', name: 'Sarah Mitchell' },
            },
          ],
        }),
      )

    const [convo] = await fetchPageConversations(PAGE, TOKEN)

    expect(fetchMock.mock.calls[1][0]).toContain('/t_100/messages')
    expect(convo.messages.map((m) => m.messageId)).toEqual(['mid.full'])
  })

  it('does not re-fetch when the nested messages are already complete', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [thread()] }))

    await fetchPageConversations(PAGE, TOKEN)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops paging once a thread at or before the watermark appears', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          thread({ id: 't_new', updated_time: '2026-07-26T10:00:00+0000' }),
          thread({ id: 't_old', updated_time: '2026-07-01T10:00:00+0000' }),
        ],
        paging: { next: 'https://graph.facebook.com/next-page' },
      }),
    )

    const out = await fetchPageConversations(PAGE, TOKEN, '2026-07-20T00:00:00+0000')

    expect(out.map((c) => c.conversationId)).toEqual(['t_new'])
    // The `next` page must not be walked — that is the whole point of the watermark.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps attachment-only messages so ordering and who-spoke-last stay correct', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          thread({
            message_count: 1,
            messages: {
              data: [
                {
                  id: 'mid.img',
                  created_time: '2026-07-26T11:00:00+0000',
                  from: { id: 'psid_9', name: 'Sarah Mitchell' },
                },
              ],
            },
          }),
        ],
      }),
    )

    const [convo] = await fetchPageConversations(PAGE, TOKEN)

    expect(convo.messages).toHaveLength(1)
    expect(convo.messages[0].direction).toBe('inbound')
    expect(convo.messages[0].body).toBe('[non-text message]')
  })

  it('returns [] instead of throwing when Graph errors', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(400))

    await expect(fetchPageConversations(PAGE, TOKEN)).resolves.toEqual([])
  })

  it('returns [] instead of throwing when the network fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))

    await expect(fetchPageConversations(PAGE, TOKEN)).resolves.toEqual([])
  })
})

describe('fetchConversationMessages', () => {
  it('walks paging and returns oldest first', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'mid.b',
              created_time: '2026-07-26T09:00:00+0000',
              message: 'second',
              from: { id: PAGE },
            },
          ],
          paging: { next: 'https://graph.facebook.com/page2' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'mid.a',
              created_time: '2026-07-26T08:00:00+0000',
              message: 'first',
              from: { id: 'psid_9' },
            },
          ],
        }),
      )

    const out = await fetchConversationMessages('t_100', PAGE, TOKEN)

    expect(out.map((m) => m.messageId)).toEqual(['mid.a', 'mid.b'])
    expect(out[0].direction).toBe('inbound')
    expect(out[1].direction).toBe('outbound')
  })

  it('drops malformed rows that have no id or timestamp', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ message: 'orphan' }, { id: 'mid.x', message: 'no time' }] }),
    )

    await expect(fetchConversationMessages('t_100', PAGE, TOKEN)).resolves.toEqual([])
  })
})
