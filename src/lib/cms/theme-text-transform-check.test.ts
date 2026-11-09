import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./ssrf-guard', () => ({
  assertPublicHost: vi.fn().mockResolvedValue(undefined),
}))

import {
  scanCssForUppercase,
  extractStylesheetUrls,
  detectThemeUppercase,
} from './theme-text-transform-check'

// ═══════════════════════════════════════════════════════════════════════════════
// scanCssForUppercase — pure function
// ═══════════════════════════════════════════════════════════════════════════════

describe('scanCssForUppercase', () => {
  const SRC = 'https://example.com/wp-content/themes/astra/style.css'

  it('flags Astra-style .entry-content p uppercase rule', () => {
    const css = `.entry-content p { text-transform: uppercase; color: red; }`
    const out = scanCssForUppercase(css, SRC)
    expect(out).toEqual([{ selector: '.entry-content p', source: SRC }])
  })

  it('flags article p and main p selectors', () => {
    const out = scanCssForUppercase(
      `article p { text-transform: uppercase; }
       main p { text-transform: uppercase; }`,
      SRC,
    )
    expect(out.map(m => m.selector).sort()).toEqual(['article p', 'main p'])
  })

  it('handles a comma-joined selector list, flags only the content paragraph selectors', () => {
    // header h1 is innocent; .entry-content p is guilty.
    const css = `header h1, .entry-content p, .sidebar a { text-transform: uppercase; }`
    const out = scanCssForUppercase(css, SRC)
    expect(out).toEqual([{ selector: '.entry-content p', source: SRC }])
  })

  it('does NOT flag .sidebar p or header p (non-content selectors)', () => {
    const css = `.sidebar p { text-transform: uppercase; }
                 header p { text-transform: uppercase; }`
    expect(scanCssForUppercase(css, SRC)).toEqual([])
  })

  it('does NOT flag a content selector when its body uses lowercase or capitalize', () => {
    const css = `.entry-content p { text-transform: lowercase; }
                 article p { text-transform: capitalize; }`
    expect(scanCssForUppercase(css, SRC)).toEqual([])
  })

  it('ignores rules inside CSS comments', () => {
    const css = `/* .entry-content p { text-transform: uppercase; } */
                 .entry-content p { color: red; }`
    expect(scanCssForUppercase(css, SRC)).toEqual([])
  })

  it('survives @media wrappers — rule inside still flagged', () => {
    const css = `@media (min-width: 768px) {
                   .entry-content p { text-transform: uppercase; }
                 }`
    const out = scanCssForUppercase(css, SRC)
    expect(out.map(m => m.selector)).toContain('.entry-content p')
  })

  it('tolerates whitespace / case variations in the declaration', () => {
    const css = `.entry-content p {
                   TEXT-TRANSFORM   :    UPPERCASE  ;
                 }`
    expect(scanCssForUppercase(css, SRC)).toHaveLength(1)
  })

  it('flags Gutenberg .wp-block-paragraph', () => {
    const css = `.wp-block-paragraph { text-transform: uppercase; }`
    expect(scanCssForUppercase(css, SRC)).toEqual([
      { selector: '.wp-block-paragraph', source: SRC },
    ])
  })

  it('flags bare global "p {...}" rule', () => {
    const css = `p { text-transform: uppercase; }`
    expect(scanCssForUppercase(css, SRC)).toHaveLength(1)
  })

  it('returns empty array for non-uppercase CSS', () => {
    expect(scanCssForUppercase('.foo { color: red; }', SRC)).toEqual([])
    expect(scanCssForUppercase('', SRC)).toEqual([])
  })

  it('mutation-canary: deleting any pattern would drop a known match', () => {
    // Each entry MUST be flagged. If we remove a pattern from CONTENT_PARAGRAPH_PATTERNS
    // the corresponding canary fails — proving the test set isn't a no-op.
    const samples: Array<[string, string]> = [
      ['.entry-content p { text-transform: uppercase; }',  '.entry-content p'],
      ['.post-content p { text-transform: uppercase; }',   '.post-content p'],
      ['article p { text-transform: uppercase; }',         'article p'],
      ['main p { text-transform: uppercase; }',            'main p'],
      ['body p { text-transform: uppercase; }',            'body p'],
      ['.wp-block-paragraph { text-transform: uppercase; }', '.wp-block-paragraph'],
    ]
    for (const [css, expected] of samples) {
      const out = scanCssForUppercase(css, SRC)
      expect(out.map(m => m.selector)).toContain(expected)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// extractStylesheetUrls — pure function
// ═══════════════════════════════════════════════════════════════════════════════

describe('extractStylesheetUrls', () => {
  const BASE = 'https://oztop.com.au/'

  it('extracts an absolute https stylesheet href', () => {
    const html = `<link rel="stylesheet" href="https://cdn.example.com/style.css">`
    const out = extractStylesheetUrls(html, BASE)
    expect(out.urls).toEqual(['https://cdn.example.com/style.css'])
    expect(out.inlineCss).toEqual([])
  })

  it('resolves relative hrefs against baseUrl', () => {
    const html = `<link rel="stylesheet" href="/wp-content/themes/astra/style.css">`
    const out = extractStylesheetUrls(html, BASE)
    expect(out.urls).toEqual(['https://oztop.com.au/wp-content/themes/astra/style.css'])
  })

  it('deduplicates repeat URLs', () => {
    const html = `
      <link rel="stylesheet" href="https://a.com/x.css">
      <link rel="stylesheet" href="https://a.com/x.css">
    `
    const out = extractStylesheetUrls(html, BASE)
    expect(out.urls).toEqual(['https://a.com/x.css'])
  })

  it('preserves source order across multiple sheets', () => {
    const html = `
      <link rel="stylesheet" href="/a.css">
      <link rel="stylesheet" href="/b.css">
      <link rel="stylesheet" href="/c.css">
    `
    const out = extractStylesheetUrls(html, BASE)
    expect(out.urls).toEqual([
      'https://oztop.com.au/a.css',
      'https://oztop.com.au/b.css',
      'https://oztop.com.au/c.css',
    ])
  })

  it('ignores non-stylesheet <link> tags', () => {
    const html = `
      <link rel="icon" href="/favicon.ico">
      <link rel="canonical" href="https://x.com/">
      <link rel="preload" as="style" href="/preload.css">
    `
    expect(extractStylesheetUrls(html, BASE).urls).toEqual([])
  })

  it('pulls inline <style>...</style> blocks', () => {
    const html = `<style>.foo { color: red; }</style><link rel="stylesheet" href="/a.css">`
    const out = extractStylesheetUrls(html, BASE)
    expect(out.inlineCss).toEqual(['.foo { color: red; }'])
    expect(out.urls).toEqual(['https://oztop.com.au/a.css'])
  })

  it('skips malformed hrefs without throwing', () => {
    // Both hrefs are rejected by the WHATWG URL parser even with a base URL
    // (unterminated IPv6 literal / space in host). A relative-looking string
    // such as ":::x" is NOT malformed — it resolves against the base.
    const html = `<link rel="stylesheet" href="http://[bad">
                  <link rel="stylesheet" href="https://exa mple.com/x.css">
                  <link rel="stylesheet" href="/ok.css">`
    const out = extractStylesheetUrls(html, BASE)
    expect(out.urls).toEqual(['https://oztop.com.au/ok.css'])
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// detectThemeUppercase — async, integration
// ═══════════════════════════════════════════════════════════════════════════════

describe('detectThemeUppercase', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function ok(body: string): Response {
    return {
      ok: true,
      status: 200,
      text: async () => body,
    } as unknown as Response
  }
  function notFound(): Response {
    return {
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    } as unknown as Response
  }

  it('returns uppercase=true when the Astra rule appears on an external sheet', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(
        `<html><head><link rel="stylesheet" href="/style.css"></head></html>`,
      ))
      .mockResolvedValueOnce(ok(
        `.entry-content p { text-transform: uppercase; }`,
      ))

    const result = await detectThemeUppercase('https://oztop.com.au/', { fetchFn: fetchMock })

    expect(result.uppercase).toBe(true)
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0].selector).toBe('.entry-content p')
    expect(result.matches[0].source).toBe('https://oztop.com.au/style.css')
    expect(result.warnings).toEqual([])
  })

  it('flags inline <style> uppercase rules without needing an external fetch', async () => {
    fetchMock.mockResolvedValueOnce(ok(
      `<html><head><style>.entry-content p { text-transform: uppercase; }</style></head></html>`,
    ))

    const result = await detectThemeUppercase('https://oztop.com.au/', { fetchFn: fetchMock })

    expect(result.uppercase).toBe(true)
    expect(result.matches[0].source).toBe('<inline>')
    expect(fetchMock).toHaveBeenCalledTimes(1)   // homepage only
  })

  it('returns uppercase=false on a clean theme', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(
        `<html><head><link rel="stylesheet" href="/style.css"></head></html>`,
      ))
      .mockResolvedValueOnce(ok(
        `.entry-content p { color: #333; }`,
      ))

    const result = await detectThemeUppercase('https://oztop.com.au/', { fetchFn: fetchMock })
    expect(result.uppercase).toBe(false)
    expect(result.matches).toEqual([])
  })

  it('records a warning but does NOT throw when a stylesheet 404s', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(
        `<html><head>
          <link rel="stylesheet" href="/missing.css">
          <link rel="stylesheet" href="/good.css">
        </head></html>`,
      ))
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(ok(`.entry-content p { text-transform: uppercase; }`))

    const result = await detectThemeUppercase('https://oztop.com.au/', { fetchFn: fetchMock })

    expect(result.uppercase).toBe(true)
    expect(result.warnings.some(w => w.includes('missing.css'))).toBe(true)
    expect(result.warnings.some(w => w.includes('HTTP 404'))).toBe(true)
  })

  it('records a warning and returns uppercase=false when the homepage itself 404s', async () => {
    fetchMock.mockResolvedValueOnce(notFound())

    const result = await detectThemeUppercase('https://oztop.com.au/', { fetchFn: fetchMock })

    expect(result.uppercase).toBe(false)
    expect(result.matches).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatch(/Homepage fetch failed/i)
  })

  it('caps the stylesheet scan to maxStylesheets and records the skip in warnings', async () => {
    const links = Array.from({ length: 5 }, (_, i) => `<link rel="stylesheet" href="/s${i}.css">`).join('')
    fetchMock.mockResolvedValueOnce(ok(`<html><head>${links}</head></html>`))
    // Only the first 2 should be fetched.
    for (let i = 0; i < 2; i++) {
      fetchMock.mockResolvedValueOnce(ok(`.foo { color: red; }`))
    }

    const result = await detectThemeUppercase('https://oztop.com.au/', {
      fetchFn:        fetchMock,
      maxStylesheets: 2,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1 + 2)   // homepage + 2 sheets
    expect(result.warnings.some(w => w.includes('only the first 2'))).toBe(true)
  })

  it('aborts a hanging sheet fetch after the timeout and records the warning', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(`<link rel="stylesheet" href="/stuck.css">`))
      .mockImplementationOnce((_url, init: RequestInit = {}) => new Promise<Response>((_resolve, reject) => {
        // Simulate AbortController firing.
        init.signal?.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      }))

    const result = await detectThemeUppercase('https://oztop.com.au/', {
      fetchFn:   fetchMock,
      timeoutMs: 10,
    })

    expect(result.warnings.some(w => w.includes('stuck.css'))).toBe(true)
    expect(result.warnings.some(w => w.includes('timeout'))).toBe(true)
  })

  it('flags multiple distinct matches across selectors and sheets', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(
        `<html><head>
          <link rel="stylesheet" href="/a.css">
          <link rel="stylesheet" href="/b.css">
         </head></html>`,
      ))
      .mockResolvedValueOnce(ok(
        `.entry-content p { text-transform: uppercase; }`,
      ))
      .mockResolvedValueOnce(ok(
        `article p { text-transform: uppercase; }`,
      ))

    const result = await detectThemeUppercase('https://oztop.com.au/', { fetchFn: fetchMock })
    expect(result.uppercase).toBe(true)
    expect(result.matches).toHaveLength(2)
    const selectors = result.matches.map(m => m.selector).sort()
    expect(selectors).toEqual(['.entry-content p', 'article p'])
  })
})
