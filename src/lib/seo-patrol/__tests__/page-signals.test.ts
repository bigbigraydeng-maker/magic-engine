/**
 * Unit tests for the pure link-graph logic in page-signals.ts (22.E.S15).
 * (buildPageSignals' DB reads are thin wrappers verified at integration time.)
 */

import { describe, it, expect } from 'vitest'
import { canonicalUrl, buildInboundMap } from '../page-signals'

describe('canonicalUrl', () => {
  it('drops protocol, www, trailing slash, query and fragment', () => {
    expect(canonicalUrl('https://www.ctstours.co.nz/china-tours/')).toBe('ctstours.co.nz/china-tours')
    expect(canonicalUrl('http://ctstours.co.nz/china-tours?utm=x#top')).toBe('ctstours.co.nz/china-tours')
  })

  it('normalises the bare homepage to host + /', () => {
    expect(canonicalUrl('https://www.ctstours.co.nz')).toBe('ctstours.co.nz/')
    expect(canonicalUrl('https://ctstours.co.nz/')).toBe('ctstours.co.nz/')
  })

  it('returns null for malformed input', () => {
    expect(canonicalUrl('not a url')).toBeNull()
  })
})

describe('buildInboundMap', () => {
  const origin = 'https://www.example.com'

  it('counts distinct source pages per target, www/non-www unified', () => {
    const pages = [
      { url: 'https://www.example.com/a', markdown_content: '[x](https://example.com/target)' },
      { url: 'https://www.example.com/b', markdown_content: '[y](https://www.example.com/target/)' },
    ]
    const map = buildInboundMap(pages, origin)
    expect(map.get('example.com/target')).toBe(2)
  })

  it('a page linking to the same target twice counts once', () => {
    const pages = [
      {
        url: 'https://www.example.com/a',
        markdown_content: '[x](https://www.example.com/t) and again [y](https://www.example.com/t)',
      },
    ]
    expect(buildInboundMap(pages, origin).get('example.com/t')).toBe(1)
  })

  it('self-links do not count as inbound', () => {
    const pages = [
      { url: 'https://www.example.com/t', markdown_content: '[self](https://www.example.com/t)' },
    ]
    expect(buildInboundMap(pages, origin).get('example.com/t')).toBeUndefined()
  })

  it('pages with empty markdown contribute nothing', () => {
    const pages = [{ url: 'https://www.example.com/a', markdown_content: null }]
    expect(buildInboundMap(pages, origin).size).toBe(0)
  })

  it("Jina's 'URL Source:' self-URL header does not count as inbound (魏征 B1)", () => {
    const pages = [
      {
        url: 'https://www.example.com/t',
        markdown_content: 'Title: T\nURL Source: https://www.example.com/t\n\nbody',
      },
    ]
    expect(buildInboundMap(pages, origin).get('example.com/t')).toBeUndefined()
  })

  it('bare-URL markdown residue (trailing ** or punctuation) still matches (魏征 m2)', () => {
    const pages = [
      { url: 'https://www.example.com/a', markdown_content: 'see https://www.example.com/target**' },
    ]
    expect(buildInboundMap(pages, origin).get('example.com/target')).toBe(1)
  })
})
