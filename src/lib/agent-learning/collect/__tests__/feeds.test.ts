import { describe, it, expect, vi } from 'vitest'
import {
  createFetchText,
  contentHash,
  fetchFeedItems,
  htmlToText,
  parseFeedXml,
  LEARNING_USER_AGENT,
  type FetchText,
} from '@/lib/agent-learning/collect/feeds'

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example Feed</title>
    <link>https://example.com/</link>
    <description>Example feed description</description>
    <item>
      <title>Item One</title>
      <link>https://example.com/one</link>
      <guid>https://example.com/one</guid>
      <pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate>
      <content:encoded><![CDATA[<p>Hello <b>world</b></p><script>bad()</script>]]></content:encoded>
    </item>
    <item>
      <title>Item Two</title>
      <link>https://example.com/two</link>
      <guid>https://example.com/two</guid>
      <pubDate>Mon, 19 Oct 2026 10:00:00 GMT</pubDate>
      <description>Second item summary</description>
    </item>
    <item>
      <title>Item Three</title>
      <link>https://example.com/three</link>
      <guid>https://example.com/three</guid>
      <pubDate>Sun, 18 Oct 2026 10:00:00 GMT</pubDate>
      <description>Third item summary</description>
    </item>
  </channel>
</rss>`

const ATOM_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom</title>
  <id>urn:uuid:example-feed</id>
  <updated>2026-10-20T10:00:00Z</updated>
  <entry>
    <title>Atom One</title>
    <link href="https://example.com/atom-one"/>
    <id>urn:uuid:atom-one</id>
    <updated>2026-10-20T10:00:00Z</updated>
    <content type="html">&lt;p&gt;Atom body one&lt;/p&gt;</content>
  </entry>
  <entry>
    <title>Atom Two</title>
    <link href="https://example.com/atom-two"/>
    <id>urn:uuid:atom-two</id>
    <updated>2026-10-19T10:00:00Z</updated>
    <content type="html">&lt;p&gt;Atom body two&lt;/p&gt;</content>
  </entry>
</feed>`

describe('parseFeedXml', () => {
  it('parses RSS 2.0 items, strips script blocks, and honours the limit', async () => {
    const res = await parseFeedXml(RSS_FIXTURE, { limit: 3 })
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`)
    expect(res.value).toHaveLength(3)

    const first = res.value[0]
    expect(first?.externalRef).toBe('https://example.com/one')
    expect(first?.title).toBe('Item One')
    expect(first?.text).toBe('Hello world')
    expect(first?.text).not.toContain('bad()')
    expect(first?.publishedAt).toBeTruthy()

    const limited = await parseFeedXml(RSS_FIXTURE, { limit: 2 })
    if (!limited.ok) throw new Error(`expected ok, got ${limited.error}`)
    expect(limited.value).toHaveLength(2)
  })

  it('parses Atom entries into items with refs and titles', async () => {
    const res = await parseFeedXml(ATOM_FIXTURE, { limit: 10 })
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`)
    expect(res.value).toHaveLength(2)
    for (const item of res.value) {
      expect(item.externalRef.length).toBeGreaterThan(0)
      expect(item.title.length).toBeGreaterThan(0)
    }
    expect(res.value[0]?.externalRef).toBe('https://example.com/atom-one')
  })

  it('returns feed_parse_error for invalid XML', async () => {
    const res = await parseFeedXml('not xml <<', { limit: 5 })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected failure')
    expect(res.error).toBe('feed_parse_error')
  })
})

describe('fetchFeedItems', () => {
  it('maps a failed fetch into a feed_fetch_failed result and calls fetch once', async () => {
    const fetchTextImpl: FetchText = async () => ({ ok: false, error: 'http_404' })
    const fetchText = vi.fn(fetchTextImpl)

    const res = await fetchFeedItems(
      { fetchText },
      { sourceKey: 'rss:example', feedUrl: 'https://example.com/feed' },
      { limit: 5 },
    )

    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected failure')
    expect(res.error).toBe('feed_fetch_failed:http_404')
    expect(fetchText).toHaveBeenCalledTimes(1)
    expect(fetchText).toHaveBeenCalledWith('https://example.com/feed')
  })

  it('parses items when the fetch succeeds', async () => {
    const fetchText: FetchText = async () => ({ ok: true, text: RSS_FIXTURE })
    const res = await fetchFeedItems(
      { fetchText },
      { sourceKey: 'rss:example', feedUrl: 'https://example.com/feed' },
      { limit: 1 },
    )
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`)
    expect(res.value).toHaveLength(1)
  })
})

describe('htmlToText', () => {
  it('decodes named and numeric entities', () => {
    expect(htmlToText('&amp;&lt;&#39;&#x41;')).toBe("&<'A")
  })

  it('turns block tags into newlines and collapses blank lines', () => {
    expect(htmlToText('<p>One</p><p>Two</p>')).toBe('One\nTwo')
  })
})

describe('contentHash', () => {
  it('is a stable 64-char hex digest', () => {
    const hash = contentHash('stable text')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(contentHash('stable text')).toBe(hash)
    expect(contentHash('other text')).not.toBe(hash)
  })
})

describe('createFetchText', () => {
  it('sends the learning User-Agent and Accept header', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const fetchImpl = async (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => {
      calls.push({ url, headers: init.headers })
      return { ok: true, status: 200, text: async () => '<rss></rss>' }
    }

    const fetchText = createFetchText(fetchImpl)
    const res = await fetchText('https://example.com/feed')

    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`)
    expect(res.text).toBe('<rss></rss>')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://example.com/feed')
    expect(calls[0]?.headers['User-Agent']).toBe(LEARNING_USER_AGENT)
    expect(calls[0]?.headers['Accept']).toBeTruthy()
  })

  it('sends a standard feed Accept and no Content-Type on GET', async () => {
    const calls: Array<Record<string, string>> = []
    const fetchImpl = async (_url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => {
      calls.push(init.headers)
      return { ok: true, status: 200, text: async () => '<rss></rss>' }
    }

    await createFetchText(fetchImpl)('https://example.com/feed')

    expect(calls[0]?.['Accept']).toBe(
      'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    )
    expect(calls[0]?.['User-Agent']).toMatch(/^Mozilla\/5\.0 \(compatible; MagicEngineLearningBot\//)
    expect(Object.keys(calls[0] ?? {}).map((k) => k.toLowerCase())).not.toContain('content-type')
  })

  it('maps non-2xx status into http_<status>', async () => {
    const fetchImpl = async (_url: string, _init: { headers: Record<string, string>; signal: AbortSignal }) => ({
      ok: false,
      status: 500,
      text: async () => '',
    })

    const fetchText = createFetchText(fetchImpl)
    await expect(fetchText('https://example.com/feed')).resolves.toEqual({
      ok: false,
      error: 'http_500',
    })
  })

  it('never throws when the injected fetch rejects', async () => {
    const fetchImpl = async (
      _url: string,
      _init: { headers: Record<string, string>; signal: AbortSignal },
    ): Promise<{ ok: boolean; status: number; text(): Promise<string> }> => {
      throw new Error('boom')
    }

    const fetchText = createFetchText(fetchImpl)
    const res = await fetchText('https://example.com/feed')

    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected failure')
    expect(res.error).toBe('network_error')
  })
})
