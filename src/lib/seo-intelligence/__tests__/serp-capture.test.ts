/**
 * Tests for the weekly SERP capture pure helpers — DataForSEO 计划 阶段 1.
 */

import { describe, expect, it } from 'vitest'
import {
  domainRoot,
  resolveLocalPackRank,
  buildSerpSnapshotRow,
  groupKeywordsByPackRank,
  type SerpCaptureClient,
} from '../serp-capture'
import type { DfseSerpResult } from '@/lib/dataforseo/serp'

const CTS: SerpCaptureClient = {
  id: 'client-cts',
  domain: 'ctstours.co.nz',
  semrush_db: 'nz',
  name: 'CTS Tours NZ',
  brand_aliases: ['cts tours', 'china travel service'],
}

function makeSerp(overrides: Partial<DfseSerpResult> = {}): DfseSerpResult {
  return {
    query: 'china tours auckland',
    organic_results: [],
    paid_advertiser_domains: [],
    ai_overview_text: null,
    ai_overview_sources: [],
    ...overrides,
  }
}

describe('domainRoot', () => {
  it('strips protocol, www and path', () => {
    expect(domainRoot('https://www.ctstours.co.nz/tours/china')).toBe('ctstours.co.nz')
    expect(domainRoot('WWW.Example.COM')).toBe('example.com')
    expect(domainRoot(null)).toBe('')
  })
})

describe('resolveLocalPackRank', () => {
  const entry = (name: string, domain: string | null) => ({
    name, domain, rating: null, review_count: null, address: null,
  })

  it('matches by listing domain first', () => {
    const pack = [
      entry('Some Other Agency', 'other.co.nz'),
      entry('Unrelated Name', 'www.ctstours.co.nz'),
    ]
    expect(resolveLocalPackRank(pack, CTS)).toBe(2)
  })

  it('falls back to brand alias substring on listing name', () => {
    const pack = [
      entry('CTS Tours — China Travel Service', null),
      entry('Another Agency', null),
    ]
    expect(resolveLocalPackRank(pack, CTS)).toBe(1)
  })

  it('returns null when the client is not in the pack', () => {
    const pack = [entry('Agency A', 'a.co.nz'), entry('Agency B', 'b.co.nz')]
    expect(resolveLocalPackRank(pack, CTS)).toBeNull()
    expect(resolveLocalPackRank(undefined, CTS)).toBeNull()
    expect(resolveLocalPackRank([], CTS)).toBeNull()
  })

  it('does not match on empty needles (blank name, no aliases)', () => {
    const anon = { ...CTS, name: '', brand_aliases: null, domain: '' }
    const pack = [entry('Anything', 'x.co.nz')]
    expect(resolveLocalPackRank(pack, anon)).toBeNull()
  })

  it('short aliases (<4 chars) only match on exact name equality', () => {
    const shortAlias = { ...CTS, domain: 'cts.co.nz', brand_aliases: ['cts'] }
    // "products" contains "cts" as substring — must NOT match
    expect(resolveLocalPackRank([entry('Best Products Ltd', null)], shortAlias)).toBeNull()
    // exact equality still matches
    expect(resolveLocalPackRank([entry('CTS', null)], shortAlias)).toBe(1)
  })
})

describe('buildSerpSnapshotRow', () => {
  const measuredAt = new Date('2026-08-03T02:00:00Z')

  it('marks AI overview presence and client citation', () => {
    const serp = makeSerp({
      ai_overview_text: 'China tours are ...',
      ai_overview_sources: [
        'https://www.ctstours.co.nz/blog/china-guide',
        'https://competitor.co.nz/page',
      ],
    })
    const row = buildSerpSnapshotRow(CTS, 'china tours auckland', serp, '2026-08-03', measuredAt)

    expect(row.has_ai_overview).toBe(true)
    expect(row.client_cited).toBe(true)
    expect(row.cited_sources).toHaveLength(2)
    expect(row.snapshot_date).toBe('2026-08-03')
    expect(row.location_code).toBe(2554) // nz
  })

  it('no AI overview → both flags false', () => {
    const row = buildSerpSnapshotRow(CTS, 'china tours', makeSerp(), '2026-08-03', measuredAt)
    expect(row.has_ai_overview).toBe(false)
    expect(row.client_cited).toBe(false)
    expect(row.cited_sources).toEqual([])
  })

  it('AI overview cites others but not the client → cited false', () => {
    const serp = makeSerp({
      ai_overview_text: 'answer',
      ai_overview_sources: ['https://competitor.co.nz/page'],
    })
    const row = buildSerpSnapshotRow(CTS, 'china tours', serp, '2026-08-03', measuredAt)
    expect(row.has_ai_overview).toBe(true)
    expect(row.client_cited).toBe(false)
  })

  it('client subdomain counts as cited; lookalike host does not', () => {
    const sub = makeSerp({
      ai_overview_text: 'answer',
      ai_overview_sources: ['https://blog.ctstours.co.nz/guide'],
    })
    expect(buildSerpSnapshotRow(CTS, 'kw', sub, '2026-08-03', measuredAt).client_cited).toBe(true)

    const evil = makeSerp({
      ai_overview_text: 'answer',
      ai_overview_sources: [
        'https://myctstours.co.nz.evil.com/page',
        'https://third-party.co.nz/why-ctstours.co.nz-is-great',
      ],
    })
    expect(buildSerpSnapshotRow(CTS, 'kw', evil, '2026-08-03', measuredAt).client_cited).toBe(false)
  })

  it('dedupes organic domains and keeps at most 10', () => {
    const serp = makeSerp({
      organic_results: [
        { position: 1, title: '', url: 'https://www.a.co.nz/x', description: '' },
        { position: 2, title: '', url: 'https://a.co.nz/y', description: '' },
        ...Array.from({ length: 12 }, (_, i) => ({
          position: i + 3, title: '', url: `https://site${i}.co.nz/p`, description: '',
        })),
      ],
    })
    const row = buildSerpSnapshotRow(CTS, 'china tours', serp, '2026-08-03', measuredAt)
    expect(row.top_organic_domains[0]).toBe('a.co.nz')
    expect(row.top_organic_domains).toHaveLength(10)
    expect(new Set(row.top_organic_domains).size).toBe(10)
  })
})

describe('groupKeywordsByPackRank', () => {
  it('groups by rank and drops nulls', () => {
    const groups = groupKeywordsByPackRank([
      { keyword: 'kw1', rank: 1 },
      { keyword: 'kw2', rank: null },
      { keyword: 'kw3', rank: 1 },
      { keyword: 'kw4', rank: 3 },
    ])
    expect(groups.get(1)).toEqual(['kw1', 'kw3'])
    expect(groups.get(3)).toEqual(['kw4'])
    expect(groups.has(2)).toBe(false)
    expect(groups.size).toBe(2)
  })
})
