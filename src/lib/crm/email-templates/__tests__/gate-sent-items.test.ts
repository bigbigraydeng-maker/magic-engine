import { describe, expect, it, vi } from 'vitest'
import {
  buildSentItemsPath,
  collectSentItems,
  parseSentItemsPage,
  toOutboundItems,
  type GraphSentMessage,
  type PageFetcher,
} from '@/lib/crm/email-templates/gates/sent-items'

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

function msg(overrides: Partial<GraphSentMessage> = {}): GraphSentMessage {
  return {
    id: 'm1',
    sentDateTime: isoMinutesAgo(5),
    subject: 'Hello',
    to: ['guest@example.com'],
    cc: [],
    bcc: [],
    ...overrides,
  }
}

function rawMsg(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm1',
    sentDateTime: isoMinutesAgo(5),
    subject: 'Hello',
    toRecipients: [{ emailAddress: { address: 'Guest@Example.com' } }],
    ccRecipients: [],
    bccRecipients: [],
    ...overrides,
  }
}

describe('buildSentItemsPath', () => {
  it('contains literal $ params and encoded filter', () => {
    const since = '2024-01-02T03:04:05.000Z'
    const path = buildSentItemsPath(since)
    expect(path).toContain('$filter=')
    expect(path).toContain('$orderby=sentDateTime%20desc')
    expect(path).toContain('$top=100')
    expect(path).toContain(encodeURIComponent(`sentDateTime ge ${since}`))
    expect(path).toContain('%3A')
  })

  it('clamps pageSize 0 -> 1 and 500 -> 100', () => {
    expect(buildSentItemsPath('2024-01-01T00:00:00.000Z', 0)).toContain('$top=1')
    expect(buildSentItemsPath('2024-01-01T00:00:00.000Z', 500)).toContain('$top=100')
  })
})

describe('parseSentItemsPage', () => {
  it('parses a good page', () => {
    const parsed = parseSentItemsPage({ value: [rawMsg()] })
    expect(parsed).not.toBeNull()
    expect(parsed!.messages).toHaveLength(1)
    expect(parsed!.messages[0].id).toBe('m1')
    expect(parsed!.nextLink).toBeNull()
  })

  it('accepts null subject', () => {
    const parsed = parseSentItemsPage({ value: [rawMsg({ subject: null })] })
    expect(parsed!.messages[0].subject).toBeNull()
  })

  it('lower-cases addresses', () => {
    const parsed = parseSentItemsPage({ value: [rawMsg()] })
    expect(parsed!.messages[0].to).toEqual(['guest@example.com'])
  })

  it('skips entries without an address', () => {
    const parsed = parseSentItemsPage({
      value: [
        rawMsg({
          toRecipients: [
            { emailAddress: {} },
            { emailAddress: { address: 'a@example.com' } },
            {},
          ],
        }),
      ],
    })
    expect(parsed!.messages[0].to).toEqual(['a@example.com'])
  })

  it('returns null when id is missing', () => {
    expect(parseSentItemsPage({ value: [rawMsg({ id: undefined })] })).toBeNull()
  })

  it('returns null when value is not an array', () => {
    expect(parseSentItemsPage({ value: 'nope' })).toBeNull()
  })

  it('returns null when sentDateTime is not a string', () => {
    expect(parseSentItemsPage({ value: [rawMsg({ sentDateTime: 123 })] })).toBeNull()
  })

  it('reads nextLink when present', () => {
    const parsed = parseSentItemsPage({
      value: [],
      '@odata.nextLink': 'https://graph.example/next',
    })
    expect(parsed!.nextLink).toBe('https://graph.example/next')
  })

  it('nextLink absent -> null', () => {
    const parsed = parseSentItemsPage({ value: [] })
    expect(parsed!.nextLink).toBeNull()
  })
})

describe('collectSentItems', () => {
  it('follows two pages and passes nextLink URL to second fetch', async () => {
    const next = 'https://graph.example/next-page'
    const fetchPage = vi
      .fn<PageFetcher>()
      .mockResolvedValueOnce({
        ok: true,
        json: { value: [rawMsg({ id: 'a' })], '@odata.nextLink': next },
      })
      .mockResolvedValueOnce({ ok: true, json: { value: [rawMsg({ id: 'b' })] } })
    const res = await collectSentItems(fetchPage, isoMinutesAgo(60))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.messages.map((m) => m.id)).toEqual(['a', 'b'])
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage.mock.calls[1][0]).toBe(next)
  })

  it('returns ok:false when page 2 fetch fails', async () => {
    const fetchPage = vi
      .fn<PageFetcher>()
      .mockResolvedValueOnce({
        ok: true,
        json: { value: [], '@odata.nextLink': 'https://graph.example/next' },
      })
      .mockResolvedValueOnce({ ok: false, error: 'boom' })
    const res = await collectSentItems(fetchPage, isoMinutesAgo(60))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('boom')
  })

  it('returns ok:false on unreadable page', async () => {
    const fetchPage = vi
      .fn<PageFetcher>()
      .mockResolvedValueOnce({ ok: true, json: { value: 'nope' } })
    const res = await collectSentItems(fetchPage, isoMinutesAgo(60))
    expect(res.ok).toBe(false)
  })

  it('returns too many pages after 31 pages', async () => {
    const fetchPage = vi.fn<PageFetcher>().mockResolvedValue({
      ok: true,
      json: { value: [], '@odata.nextLink': 'https://graph.example/next' },
    })
    const res = await collectSentItems(fetchPage, isoMinutesAgo(60))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('too many pages')
    expect(fetchPage).toHaveBeenCalledTimes(30)
  })

  it('respects maxPages option', async () => {
    const fetchPage = vi.fn<PageFetcher>().mockResolvedValue({
      ok: true,
      json: { value: [], '@odata.nextLink': 'https://graph.example/next' },
    })
    const res = await collectSentItems(fetchPage, isoMinutesAgo(60), { maxPages: 2 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('too many pages')
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })
})

describe('toOutboundItems', () => {
  it('matches to/cc/bcc case-insensitively', () => {
    const items = toOutboundItems(
      [
        msg({ id: 'a', to: ['guest@example.com'], cc: [], bcc: [] }),
        msg({ id: 'b', to: [], cc: ['guest@example.com'], bcc: [] }),
        msg({ id: 'c', to: [], cc: [], bcc: ['guest@example.com'] }),
      ],
      ['Guest@Example.com'],
    )
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(items.every((i) => i.address === 'guest@example.com')).toBe(true)
    expect(items.every((i) => i.source === 'sent_items')).toBe(true)
  })

  it('emits one item per matching address', () => {
    const items = toOutboundItems(
      [msg({ to: ['a@example.com', 'b@example.com'] })],
      ['a@example.com', 'b@example.com'],
    )
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.address).sort()).toEqual(['a@example.com', 'b@example.com'])
  })

  it('skips auto-reply subjects', () => {
    const items = toOutboundItems(
      [msg({ subject: 'Automatic reply: hello' })],
      ['guest@example.com'],
    )
    expect(items).toHaveLength(0)
  })

  it('ignores non-matching addresses', () => {
    const items = toOutboundItems([msg({ to: ['other@example.com'] })], ['guest@example.com'])
    expect(items).toHaveLength(0)
  })
})
