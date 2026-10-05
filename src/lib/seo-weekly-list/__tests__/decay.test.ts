import { describe, expect, it } from 'vitest'
import { buildDecayCandidates } from '../decay'
import { DEFAULT_SEO_LOOP_CONFIG } from '../config'
import type { PageAggRow } from '../candidates'

const cfg = DEFAULT_SEO_LOOP_CONFIG
const row = (url: string, clicks: number, impressions: number, position: number): PageAggRow => ({ url, clicks, impressions, position })

describe('buildDecayCandidates', () => {
  it('flags a page that fell far more than the site, with the click loss as its sort key', () => {
    const prior = [row('/a', 60, 600, 4), row('/b', 100, 1000, 3)]
    const recent = [row('/a', 20, 250, 8), row('/b', 100, 1000, 3)]
    const { candidates, siteRatio } = buildDecayCandidates(recent, prior, cfg)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ url: '/a', priorClicks: 60, recentClicks: 20, potentialClicks: 40, cause: 'rank_loss' })
    expect(siteRatio).toBeCloseTo(120 / 160, 5)
  })

  it('a page that vanished from the latest window counts as 0 clicks, never as unknown', () => {
    const { candidates } = buildDecayCandidates([row('/b', 100, 1000, 3)], [row('/gone', 30, 300, 5), row('/b', 100, 1000, 3)], cfg)
    expect(candidates.map(c => c.url)).toEqual(['/gone'])
    expect(candidates[0]).toMatchObject({ recentClicks: 0, recentImpressions: 0, recentPosition: null, cause: 'visibility_down' })
  })

  it('a site-wide dip is NOT a page problem: everything halving flags nothing', () => {
    const prior = [row('/a', 60, 600, 4), row('/b', 100, 1000, 3)]
    const recent = [row('/a', 28, 300, 4), row('/b', 48, 500, 3)]
    expect(buildDecayCandidates(recent, prior, cfg).candidates).toEqual([])
  })

  it('small pages and small drops are noise: below the prior-click floor or the absolute-drop floor', () => {
    const prior = [row('/tiny', 6, 60, 5), row('/small-drop', 12, 120, 5), row('/big', 400, 4000, 2)]
    const recent = [row('/tiny', 0, 5, 9), row('/small-drop', 8, 90, 5), row('/big', 400, 4000, 2)]
    expect(buildDecayCandidates(recent, prior, cfg).candidates).toEqual([])
  })

  it('reads the cause from impressions and position: ctr_drop when impressions held, rank_loss when position slid', () => {
    const prior = [row('/ctr', 50, 500, 4), row('/rank', 50, 500, 4), row('/mix', 50, 500, 4), row('/anchor', 400, 4000, 2)]
    const recent = [row('/ctr', 15, 480, 4), row('/rank', 15, 200, 7), row('/mix', 15, 380, 4.5), row('/anchor', 400, 4000, 2)]
    const byUrl = new Map(buildDecayCandidates(recent, prior, cfg).candidates.map(c => [c.url, c.cause]))
    expect(byUrl.get('/ctr')).toBe('ctr_drop')
    expect(byUrl.get('/rank')).toBe('rank_loss')
    expect(byUrl.get('/mix')).toBe('mixed')
  })

  it('no clicks in the previous window means there is nothing to compare: no candidates, ratio null', () => {
    expect(buildDecayCandidates([row('/a', 5, 50, 3)], [], cfg)).toEqual({ candidates: [], siteRatio: null })
  })

  it('largest click loss first', () => {
    const prior = [row('/x', 40, 400, 4), row('/y', 90, 900, 4), row('/z', 400, 4000, 2)]
    const recent = [row('/x', 10, 100, 8), row('/y', 20, 200, 8), row('/z', 400, 4000, 2)]
    expect(buildDecayCandidates(recent, prior, cfg).candidates.map(c => c.url)).toEqual(['/y', '/x'])
  })
  it('ordinary random wobble on a small page is not a decline: 13 → 7 clicks is inside the noise, 9 → 2 is outside', () => {
    const prior = [row('/wobble', 13, 400, 8), row('/real', 9, 400, 8), row('/anchor', 400, 4000, 2)]
    const recent = [row('/wobble', 7, 400, 8), row('/real', 2, 400, 8), row('/anchor', 400, 4000, 2)]
    expect(buildDecayCandidates(recent, prior, cfg).candidates.map(c => c.url)).toEqual(['/real'])
  })
})
