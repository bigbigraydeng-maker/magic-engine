import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandTailRepeated, fetchLiveSnippet, parseSnippet, snippetQuickFixes } from '../live-snippet'

describe('parseSnippet', () => {
  it('reads <title>, description, canonical, robots and decodes entities (hex, decimal, named)', () => {
    const html = `<html><head><title>
      Liziba: China&#x27;s Most Photographed &amp; Famous Station | CTS Tours</title>
      <meta name="description" content="It&#39;s the &quot;world&quot;&#x27;s only one">
      <link rel="canonical" href="https://x.com/liziba" />
      <meta name="robots" content="index, follow"></head><body><h1>Different heading</h1></body></html>`
    const s = parseSnippet(html, 200)
    expect(s.title).toBe("Liziba: China's Most Photographed & Famous Station | CTS Tours")
    expect(s.description).toBe(`It's the "world"'s only one`)
    expect(s.canonical).toBe('https://x.com/liziba')
    expect(s.noindex).toBe(false)
  })
  it('detects noindex; a page with no <title> or description yields nulls (not the H1)', () => {
    const s = parseSnippet('<meta name="robots" content="noindex,nofollow"><h1>Heading only</h1>', 200)
    expect(s.noindex).toBe(true)
    expect(s.title).toBeNull()
    expect(s.description).toBeNull()
  })
  it('accepts content-before-name attribute order and single quotes', () => {
    expect(parseSnippet(`<meta content='Hello there' name='description'>`, 200).description).toBe('Hello there')
  })
})

describe('brandTailRepeated / snippetQuickFixes', () => {
  const aliases = ['cts', 'cts tours', 'china travel service']
  it('flags "… | CTS | CTS Tours" but not a normal single brand tail or a brand word inside the topic', () => {
    expect(brandTailRepeated('Forbidden City Tour Guide | CTS | CTS Tours', aliases)).toBe(true)
    expect(brandTailRepeated('Forbidden City Tour Guide | CTS Tours', aliases)).toBe(false)
    expect(brandTailRepeated('CTS history: how a 1928 agency grew | CTS Tours', aliases)).toBe(false)
    expect(brandTailRepeated('Anything | CTS | CTS Tours', null)).toBe(false)
  })
  it('lists only mechanical defects; description length is labelled as not shown to matter', () => {
    const fixes = snippetQuickFixes({ title: 'x'.repeat(70) + ' | CTS | CTS Tours', description: 'd'.repeat(200), canonical: null, noindex: true, status: 200 }, aliases)
    const joined = fixes.join('；')
    expect(joined).toContain('noindex')
    expect(joined).toContain('品牌后缀重复')
    expect(joined).toContain('超过约 60')
    expect(joined).toContain('本站数据没显示描述长度影响点击率')
    expect(snippetQuickFixes({ title: 'Short | CTS Tours', description: 'ok', canonical: null, noindex: false, status: 200 }, aliases)).toEqual([])
  })
})

describe('fetchLiveSnippet', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('only ever fetches https URLs: an http / non-URL value returns null WITHOUT making a request', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await fetchLiveSnippet('http://x.com/p')).toBeNull()
    expect(await fetchLiveSnippet('file:///etc/passwd')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('parses a successful response; a non-OK response or a network error degrades to null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '<title>A | B</title><meta name="description" content="d">' }))
    expect((await fetchLiveSnippet('https://x.com/p'))?.title).toBe('A | B')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => '' }))
    expect(await fetchLiveSnippet('https://x.com/p')).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')))
    expect(await fetchLiveSnippet('https://x.com/p')).toBeNull()
  })
})

