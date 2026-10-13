import { describe, expect, it } from 'vitest'
import { DEFAULT_SEO_LOOP_CONFIG, resolveSeoLoopConfig } from '../config'
import {
  aggregatePageRows,
  buildCtrGapCandidates,
  buildNearMissCandidates,
  isExcludedUrl,
  matchOwnPages,
  tokenKey,
  type SnapshotKeywordRow,
} from '../candidates'

const cfg = DEFAULT_SEO_LOOP_CONFIG
const opts = { config: cfg, brandRoot: 'acme', brandAliases: ['acme tours'], competitorDomains: ['rivaltravel.com'] }
const kw = (keyword: string, position: number | null, volume: number | null, kd: number | null, intent: string | null = 'informational'): SnapshotKeywordRow =>
  ({ keyword, position, search_volume: volume, keyword_difficulty: kd, intent })

describe('config', () => {
  it('uses defaults, accepts positive numeric overrides, ignores junk', () => {
    expect(resolveSeoLoopConfig(null)).toEqual(DEFAULT_SEO_LOOP_CONFIG)
    const c = resolveSeoLoopConfig({ loop: { nearMissMinVolume: 30, weeklyMaxItems: -1, wipCap: 'x' } })
    expect(c.nearMissMinVolume).toBe(30)
    expect(c.weeklyMaxItems).toBe(5)
    expect(c.wipCap).toBe(8)
  })
})

describe('tokenKey', () => {
  it('treats reordered / stopword-padded phrasings as one intent', () => {
    expect(tokenKey('nz china visa')).toBe(tokenKey('nz visa china'))
    expect(tokenKey('visa for china nz')).toBe(tokenKey('nz china visa'))
    expect(tokenKey('forbidden city')).toBe(tokenKey('the forbidden city'))
    expect(tokenKey('imperial palace')).not.toBe(tokenKey('forbidden city'))
    expect(tokenKey("xi'an")).toBe(tokenKey('xian'))
  })
})

describe('buildNearMissCandidates — review fixes', () => {
  it('keeps direction: "A to B" and "B to A" are different searches and are not merged', () => {
    expect(tokenKey('flights from auckland to sydney')).not.toBe(tokenKey('flights from sydney to auckland'))
  })

  it('a topic already ranking top-3 under another phrasing is not a gap; positions 4-5 can still gain (to top-3)', () => {
    const { candidates } = buildNearMissCandidates(
      [kw('china visa guide', 2, 900, 3), kw('guide china visa', 15, 800, 3), kw('forbidden city', 4, 1600, 2)],
      opts,
    )
    expect(candidates.map(c => c.primary.keyword)).toEqual(['forbidden city'])
    expect(candidates[0].potentialClicks).toBeGreaterThan(0)
  })

  it('a keyword with no Latin letters is skipped WITH a reason, not silently', () => {
    const { candidates, skipped } = buildNearMissCandidates([kw('中国签证', 15, 500, 2)], opts)
    expect(candidates).toHaveLength(0)
    expect(skipped[0].reason).toMatch(/拉丁字符/)
  })

  it('a competitor whose domain root is only generic words does not blanket-skip ordinary keywords; the reason names the root when it does match', () => {
    const generic = { ...opts, competitorDomains: ['newzealand.com', 'worldjourneys.co.nz', 'wendywutours.co.nz'] }
    const { candidates, skipped } = buildNearMissCandidates(
      [kw('new zealand china tours', 15, 500, 2), kw('wendywutours china', 15, 500, 2)],
      generic,
    )
    expect(candidates.map(c => c.primary.keyword)).toEqual(['new zealand china tours'])
    expect(skipped[0].reason).toContain('wendywutours')
  })
})

describe('buildNearMissCandidates', () => {
  it('merges same-intent phrasings into ONE candidate led by the highest volume', () => {
    const { candidates } = buildNearMissCandidates(
      [kw('nz china visa', 18, 390, 0), kw('nz visa china', 18, 400, 0), kw('visa for china nz', 16, 390, 2)],
      opts,
    )
    expect(candidates).toHaveLength(1)
    expect(candidates[0].primary.keyword).toBe('nz visa china')
    expect(candidates[0].members).toHaveLength(3)
  })

  it('skips branded, competitor-brand, navigational, out-of-band and low-volume words', () => {
    const { candidates, skipped } = buildNearMissCandidates(
      [
        kw('acme tours nz', 9, 500, 1),
        kw('rivaltravel china tour', 12, 500, 1),
        kw('rivaltravel', 12, 500, 1, 'navigational'),
        kw('great wall', 3, 900, 1),
        kw('terracotta', 40, 900, 1),
        kw('tiny phrase', 15, 20, 1),
        kw('good phrase', 15, 300, 1),
      ],
      opts,
    )
    expect(candidates.map(c => c.primary.keyword)).toEqual(['good phrase'])
    expect(skipped.map(s => s.reason)).toEqual(expect.arrayContaining(['品牌词', expect.stringContaining('竞品品牌词')]))
  })

  it('never treats a missing volume or difficulty as zero — it is skipped with a reason', () => {
    const { candidates, skipped } = buildNearMissCandidates([kw('mystery', 15, null, 5), kw('mystery2', 15, 500, null)], opts)
    expect(candidates).toHaveLength(0)
    expect(skipped).toHaveLength(2)
    expect(skipped[0].reason).toMatch(/缺失/)
  })

  it('ranks by estimated gain: big volume far from the next tier beats small volume', () => {
    const { candidates } = buildNearMissCandidates([kw('small one', 12, 150, 1), kw('big one', 17, 1600, 1)], opts)
    expect(candidates[0].primary.keyword).toBe('big one')
    expect(candidates[0].potentialClicks).toBeGreaterThan(candidates[1].potentialClicks)
  })
})

describe('page-level CTR gap', () => {
  const rows = (url: string, days: number, imp: number, clicks: number, pos: number) =>
    Array.from({ length: days }, () => ({ page_url: url, clicks, impressions: imp, position: pos }))

  it('aggregates impression-weighted and flags only high-impression, page-1, low-CTR pages', () => {
    const agg = aggregatePageRows([
      ...rows('https://x.com/a', 10, 50, 0, 6),
      ...rows('https://x.com/b', 10, 50, 5, 6),
      ...rows('https://x.com/c', 2, 50, 0, 6),
      ...rows('https://x.com/d', 10, 50, 0, 15),
    ])
    const gap = buildCtrGapCandidates(agg, cfg)
    expect(gap.map(g => g.url)).toEqual(['https://x.com/a'])
    expect(gap[0].potentialClicks).toBeGreaterThan(0)
  })
})

describe('exclusions and own-page matching', () => {
  it('excludes protected slugs and pages the meta-cycle changed recently', () => {
    expect(isExcludedUrl('https://x.com/china-tours', ['china-tours'], new Set())).toBe(true)
    expect(isExcludedUrl('https://www.x.com/blog/foo/', [], new Set(['x.com/blog/foo']))).toBe(true)
    expect(isExcludedUrl('https://x.com/blog/bar', ['china-tours'], new Set())).toBe(false)
  })

  it('protected list: slug entries match the last path segment, path entries need the full path, home needs the "/" entry', () => {
    const none = new Set<string>()
    // CTS-style: a bare slug entry still protects the page that lives under /blog/
    expect(isExcludedUrl('https://x.com/blog/china-visa-free-nz-2026', ['china-visa-free-nz-2026'], none)).toBe(true)
    // a slug entry is not a substring match and does not protect sub-pages
    expect(isExcludedUrl('https://x.com/about/team', ['about'], none)).toBe(false)
    expect(isExcludedUrl('https://x.com/tours/china/beijing', ['tours'], none)).toBe(false)
    // path entries need the full path
    expect(isExcludedUrl('https://x.com/tours/china', ['tours/china'], none)).toBe(true)
    expect(isExcludedUrl('https://x.com/other/tours/china', ['tours/china'], none)).toBe(false)
    // the home page can now be protected (it used to be dropped as an empty slug)
    expect(isExcludedUrl('https://x.com/', ['/'], none)).toBe(true)
    expect(isExcludedUrl('https://x.com/anything', ['/'], none)).toBe(false)
    // encoded / mixed case URLs
    expect(isExcludedUrl('https://x.com/China%2DTours/', ['china-tours'], none)).toBe(true)
    // undecodable URL is never offered as an opportunity
    expect(isExcludedUrl('https://x.com/%E0%A4%A', [], none)).toBe(true)
  })

  it('matches own pages only when title/H1/path contain EVERY keyword token (a text match, not a rank fact)', () => {
    const pages = [
      { url: 'https://x.com/visa', path: '/china-visa-guide', title: 'China visa for Kiwis', h1: null, word_count: 900 },
      { url: 'https://x.com/other', path: '/other', title: 'Beijing hotels', h1: null, word_count: 500 },
    ]
    expect(matchOwnPages('nz china visa', pages)).toHaveLength(0)
    expect(matchOwnPages('china visa', pages).map(p => p.url)).toEqual(['https://x.com/visa'])
  })

  it('treats "nz"/"au" as their spelled-out forms in page copy', () => {
    const pages = [{ url: 'https://x.com/v', path: '/china-visa-guide-for-new-zealanders', title: null, h1: null, word_count: null }]
    expect(matchOwnPages('nz china visa', pages)).toHaveLength(1)
    expect(matchOwnPages('au china visa', pages)).toHaveLength(0)
  })

  it('ordinary tokens match whole words too: "tour" does not match "tourist"', () => {
    const pages = [{ url: 'https://x.com/a', path: '/tourist-info', title: 'Tourist info', h1: null, word_count: 1 }]
    expect(matchOwnPages('tour', pages)).toHaveLength(0)
    expect(matchOwnPages('tourist', pages)).toHaveLength(1)
    expect(matchOwnPages('tourists', pages)).toHaveLength(1)
  })

  it('matches WHOLE words only: "au" never matches restaurant/Tauranga, and the host ("co.nz") never makes every page an "nz" page', () => {
    const pages = [
      { url: 'https://x.co.nz/restaurants-in-tauranga', path: '/restaurants-in-tauranga', title: 'Restaurants because', h1: null, word_count: 1 },
      { url: 'https://x.co.nz/something', path: null, title: null, h1: null, word_count: 1 },
    ]
    expect(matchOwnPages('au visa', pages)).toHaveLength(0)
    expect(matchOwnPages('nz something', pages)).toHaveLength(0)
  })
})
