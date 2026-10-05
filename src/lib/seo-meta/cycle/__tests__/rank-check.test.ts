import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrganicRankItem, OrganicRankSnapshot } from '@/lib/dataforseo/serp'

const getOrganicRanks = vi.fn()
vi.mock('@/lib/dataforseo/serp', () => ({ getOrganicRanks: (...args: unknown[]) => getOrganicRanks(...args) }))

import { RANK_SERP_DEPTH, extractTargetRank, fetchTargetRank, hostOf, pageKeyOf } from '../rank-check'

const DOMAIN = 'example.co.nz'
const TARGET = 'https://www.example.co.nz/blog/beijing-to-xian'

function item(rankGroup: number, url: string, rankAbsolute: number | null = rankGroup): OrganicRankItem {
  return { rankGroup, rankAbsolute, url, domain: new URL(url).hostname }
}

function snap(items: OrganicRankItem[], depth = RANK_SERP_DEPTH): OrganicRankSnapshot {
  return { query: 'beijing to xian', depth, items, cost: 0.012, fetchedAt: '2026-10-22T00:00:00.000Z' }
}

describe('extractTargetRank', () => {
  it('reads the organic rank_group of the target page', () => {
    const r = extractTargetRank(snap([item(1, 'https://rival.com/a'), item(7, TARGET)]), DOMAIN, TARGET)
    expect(r).toMatchObject({ status: 'ranked', rankGroup: 7, url: TARGET, duplicateUrl: false, depth: RANK_SERP_DEPTH })
  })

  it('uses rank_group, not rank_absolute, when Google inserted extra blocks above the result', () => {
    const r = extractTargetRank(snap([item(5, TARGET, 8)]), DOMAIN, TARGET)
    expect(r.rankGroup).toBe(5)
  })

  it('takes the best rank when the same URL is listed twice and flags it', () => {
    const r = extractTargetRank(snap([item(9, TARGET), item(7, `${TARGET}/`)]), DOMAIN, TARGET)
    expect(r).toMatchObject({ status: 'ranked', rankGroup: 7, duplicateUrl: true })
  })

  it('matches www / trailing slash / query string / scheme as the same page', () => {
    const r = extractTargetRank(snap([item(4, 'http://example.co.nz/blog/beijing-to-xian/?utm=x#top')]), DOMAIN, TARGET)
    expect(r).toMatchObject({ status: 'ranked', rankGroup: 4 })
  })

  it('records other_own_page — never the target rank — when only a different page of the domain ranks', () => {
    const r = extractTargetRank(snap([item(3, 'https://example.co.nz/china-tours'), item(12, 'https://example.co.nz/blog/other')]), DOMAIN, TARGET)
    expect(r).toMatchObject({ status: 'other_own_page', rankGroup: null, url: 'https://example.co.nz/china-tours' })
  })

  it('records not_in_top_n with a NULL rank — never 0 and never depth+1', () => {
    const r = extractTargetRank(snap([item(1, 'https://rival.com/a'), item(2, 'https://other.com/b')]), DOMAIN, TARGET)
    expect(r.status).toBe('not_in_top_n')
    expect(r.rankGroup).toBeNull()
    expect(r.url).toBeNull()
  })

  it('does not mistake a look-alike host for the client domain', () => {
    const r = extractTargetRank(snap([item(2, 'https://notexample.co.nz/blog/beijing-to-xian')]), DOMAIN, TARGET)
    expect(r.status).toBe('not_in_top_n')
  })

  it('passes cost and fetch time through for the receipt', () => {
    const r = extractTargetRank(snap([item(7, TARGET)]), DOMAIN, TARGET)
    expect(r.cost).toBe(0.012)
    expect(r.fetchedAt).toBe('2026-10-22T00:00:00.000Z')
  })
})

describe('hostOf / pageKeyOf', () => {
  it('normalises bare domains and full URLs the same way', () => {
    expect(hostOf('https://www.Example.co.nz/')).toBe('example.co.nz')
    expect(hostOf('example.co.nz')).toBe('example.co.nz')
    expect(pageKeyOf('https://www.example.co.nz')).toBe('example.co.nz/')
  })
})

describe('fetchTargetRank', () => {
  beforeEach(() => {
    getOrganicRanks.mockReset()
  })

  it('asks for the default depth of 30 and returns the extracted reading', async () => {
    getOrganicRanks.mockResolvedValue(snap([item(6, TARGET)]))
    const r = await fetchTargetRank({ keyword: 'beijing to xian', countryCode: 'nz', domain: DOMAIN, targetUrl: TARGET })
    expect(getOrganicRanks).toHaveBeenCalledWith('beijing to xian', 'nz', { depth: 30 })
    expect(r).toMatchObject({ status: 'ranked', rankGroup: 6 })
  })

  it('honours an explicit depth (a sample must reuse its baseline depth)', async () => {
    getOrganicRanks.mockResolvedValue(snap([], 20))
    await fetchTargetRank({ keyword: 'k', countryCode: 'au', domain: DOMAIN, targetUrl: TARGET, depth: 20 })
    expect(getOrganicRanks).toHaveBeenCalledWith('k', 'au', { depth: 20 })
  })

  it('never throws: a provider failure becomes a fetch_failed reading (not a missing one)', async () => {
    getOrganicRanks.mockRejectedValue(new Error('DataForSEO SERP error: 500'))
    const r = await fetchTargetRank({ keyword: 'k', countryCode: 'nz', domain: DOMAIN, targetUrl: TARGET })
    expect(r).toMatchObject({ status: 'fetch_failed', rankGroup: null, depth: 30, error: 'DataForSEO SERP error: 500' })
  })
})
