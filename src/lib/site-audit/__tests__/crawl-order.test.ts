import { describe, it, expect } from 'vitest'
import { crawlKey, orderStalestFirst, summarizeCapSkips } from '../crawl-order'

const U = (p: string) => `https://www.example.com${p}`

describe('orderStalestFirst', () => {
  it('puts never-crawled first, then oldest crawled_at, so a cap cuts the freshest', () => {
    const urls = [U('/a'), U('/b'), U('/c'), U('/d')]
    const at = new Map([
      [U('/a'), '2026-10-04T01:00:00Z'],
      [U('/b'), '2026-09-13T01:00:00Z'],
      [U('/c'), '2026-10-01T01:00:00Z'],
    ])
    expect(orderStalestFirst(urls, at)).toEqual([U('/d'), U('/b'), U('/c'), U('/a')])
  })

  it('keeps sitemap order for ties and for never-crawled pages', () => {
    const urls = [U('/x'), U('/y'), U('/z')]
    expect(orderStalestFirst(urls, new Map())).toEqual(urls)
  })

  it('matches a stored url that differs only by trailing slash or host case', () => {
    const urls = [U('/p'), U('/q')]
    const at = new Map([['https://WWW.example.com/p/', '2026-09-01T00:00:00Z']])
    expect(orderStalestFirst(urls, at)).toEqual([U('/q'), U('/p')])
  })

  it('does not mutate the input', () => {
    const urls = [U('/a'), U('/b')]
    orderStalestFirst(urls, new Map([[U('/a'), '2026-10-04T00:00:00Z']]))
    expect(urls).toEqual([U('/a'), U('/b')])
  })
})

describe('crawlKey', () => {
  it('treats root with and without slash alike and keeps query strings', () => {
    expect(crawlKey('https://a.com/')).toBe(crawlKey('https://a.com'))
    expect(crawlKey('https://a.com/x?y=1')).not.toBe(crawlKey('https://a.com/x'))
  })
})

describe('summarizeCapSkips', () => {
  it('is null when everything fits', () => {
    expect(summarizeCapSkips(150, 150)).toBeNull()
  })
  it('names how many pages were not refreshed', () => {
    expect(summarizeCapSkips(179, 150)).toContain('29 页')
  })
})
