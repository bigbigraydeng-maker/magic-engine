import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getSerpPage, getOrganicRanks, resolveOrganicTarget } from '../serp'
import aiOverviewFixture from './fixtures/serp-ai-overview-nz.json'

vi.mock('@/lib/validation-utils', () => ({
  validateEnvVar: () => 'test',
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function makeMockResponse(items: unknown[]) {
  return Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        tasks: [{ status_code: 20000, result: [{ items }] }],
      }),
  } as Response)
}

describe('getSerpPage', () => {
  beforeEach(() => mockFetch.mockReset())

  it('sends the ISO 639-1 Chinese language code', async () => {
    mockFetch.mockReturnValue(makeMockResponse([]))

    await getSerpPage('奥克兰旅行社', 'nz', { language: 'zh' })

    const request = mockFetch.mock.calls[0]?.[1] as RequestInit
    const payload = JSON.parse(String(request.body)) as Array<{ language_code?: string }>
    expect(payload[0]?.language_code).toBe('zh')
  })

  it('throws when DataForSEO returns an HTTP-200 task error', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        tasks: [{ status_code: 40501, status_message: 'Invalid Field.' }],
      }),
    } as Response)

    await expect(getSerpPage('奥克兰旅行社', 'nz', { language: 'zh' }))
      .rejects.toThrow('DataForSEO SERP task 40501: Invalid Field.')
  })

  it('extracts local_pack listings (max 3)', async () => {
    mockFetch.mockReturnValue(
      makeMockResponse([
        { type: 'local_pack', title: 'Shop A', rating: 4.8, reviews_count: 120, address: '1 Main St' },
        { type: 'local_pack', title: 'Shop B', rating: 4.2, reviews_count: 55,  address: null },
        { type: 'local_pack', title: 'Shop C', rating: null, reviews_count: null, address: '3 Other Rd' },
        { type: 'local_pack', title: 'Shop D — should be dropped (4th)', rating: 3.9, reviews_count: 10, address: '4 Extra Ln' },
      ]),
    )

    const result = await getSerpPage('flooring brisbane')

    expect(result.local_pack).toEqual([
      { name: 'Shop A', rating: 4.8, review_count: 120, address: '1 Main St', domain: null },
      { name: 'Shop B', rating: 4.2, review_count: 55,  address: null, domain: null },
      { name: 'Shop C', rating: null, review_count: null, address: '3 Other Rd', domain: null },
    ])
  })

  it('extracts people_also_ask questions (max 4)', async () => {
    mockFetch.mockReturnValue(
      makeMockResponse([
        { type: 'people_also_ask', title: 'What is the best flooring?' },
        { type: 'people_also_ask', title: 'How much does flooring cost?' },
        { type: 'people_also_ask', title: 'Is vinyl flooring waterproof?' },
        { type: 'people_also_ask', title: 'How long does flooring last?' },
        { type: 'people_also_ask', title: 'Fifth question — should be dropped' },
      ]),
    )

    const result = await getSerpPage('flooring brisbane')

    expect(result.people_also_ask).toEqual([
      'What is the best flooring?',
      'How much does flooring cost?',
      'Is vinyl flooring waterproof?',
      'How long does flooring last?',
    ])
  })

  it('returns undefined local_pack and people_also_ask when SERP has neither', async () => {
    mockFetch.mockReturnValue(
      makeMockResponse([
        { type: 'organic', rank_absolute: 1, title: 'Top result', url: 'https://example.com', description: 'A great page', domain: 'example.com' },
      ]),
    )

    const result = await getSerpPage('flooring brisbane')

    expect(result.local_pack).toBeUndefined()
    expect(result.people_also_ask).toBeUndefined()
  })

  it('coexists correctly with organic, paid, and ai_overview items', async () => {
    mockFetch.mockReturnValue(
      makeMockResponse([
        { type: 'organic', rank_absolute: 1, title: 'Organic 1', url: 'https://a.com', description: 'desc', domain: 'a.com' },
        { type: 'paid', domain: 'ads.com' },
        { type: 'local_pack', title: 'Local Biz', rating: 4.5, reviews_count: 80, address: '10 King St' },
        { type: 'people_also_ask', title: 'How to choose flooring?' },
        { type: 'ai_overview', items: [{ text: 'AI answer here' }], references: [{ url: 'https://ref.com' }] },
      ]),
    )

    const result = await getSerpPage('flooring brisbane')

    expect(result.organic_results).toHaveLength(1)
    expect(result.paid_advertiser_domains).toEqual(['ads.com'])
    expect(result.ai_overview_text).toBe('AI answer here')
    expect(result.local_pack).toEqual([
      { name: 'Local Biz', rating: 4.5, review_count: 80, address: '10 King St', domain: null },
    ])
    expect(result.people_also_ask).toEqual(['How to choose flooring?'])
  })

  it('parses the real AI Overview shape recorded from a live NZ response', async () => {
    mockFetch.mockReturnValue(makeMockResponse(aiOverviewFixture.items))

    const result = await getSerpPage('best time to visit new zealand', 'nz')

    expect(result.ai_overview_text).toContain('December to February')
    expect(result.ai_overview_sources.length).toBeGreaterThanOrEqual(5)
    expect(result.ai_overview_sources).toContain('https://www.nz-tourism.com/when-is-the-best-time-to-visit-new-zealand/')
  })

  it('reports no AI Overview when the SERP has none', async () => {
    mockFetch.mockReturnValue(makeMockResponse([{ type: 'organic', rank_absolute: 1, url: 'https://a.com' }]))

    const result = await getSerpPage('x', 'nz')

    expect(result.ai_overview_text).toBeNull()
    expect(result.ai_overview_sources).toEqual([])
  })

  it('resolves a Google redirect organic item to the breadcrumb host', async () => {
    mockFetch.mockReturnValue(
      makeMockResponse([
        {
          type:          'organic',
          rank_group:    1,
          rank_absolute: 6,
          domain:        'google.com',
          url:           'https://google.com/goto?url=CAESXgHEIkXX',
          title:         'https://brisbanesfinestfloors.au/',
          breadcrumb:    'https://brisbanesfinestfloors.au',
          website_name:  'brisbanesfinestfloors.au',
        },
      ]),
    )

    const result = await getSerpPage('flooring brisbane')

    expect(result.organic_results[0]?.url).toBe('https://brisbanesfinestfloors.au/')
  })

  it('sends a city location_code and no location_name', async () => {
    mockFetch.mockReturnValue(makeMockResponse([]))

    await getSerpPage('flooring', 'au', { city: 'brisbane' })

    const request = mockFetch.mock.calls[0]?.[1] as RequestInit
    const payload = JSON.parse(String(request.body)) as Array<{ location_code?: number; location_name?: string }>
    expect(payload[0]?.location_code).toBe(1000339)
    expect(payload[0]?.location_name).toBeUndefined()
  })
})

describe('resolveOrganicTarget', () => {
  it('passes a normal url through unchanged', () => {
    expect(resolveOrganicTarget({ url: 'https://a.com/page', domain: 'a.com' }))
      .toEqual({ url: 'https://a.com/page', domain: 'a.com' })
  })

  it('resolves a redirect via an http breadcrumb with a › suffix', () => {
    expect(resolveOrganicTarget({
      url:         'https://google.com/goto?url=abc',
      domain:      'google.com',
      breadcrumb:  'https://www.thebestbrisbane.com › Recent articles',
      website_name: 'thebestbrisbane.com',
    })).toEqual({ url: 'https://www.thebestbrisbane.com/', domain: 'www.thebestbrisbane.com' })
  })

  it('resolves a redirect via a platform website_name', () => {
    expect(resolveOrganicTarget({
      url:          'https://google.com/goto?url=abc',
      domain:       'google.com',
      breadcrumb:   '1.8K+ followers',
      website_name: 'Facebook · NS Timber Flooring',
    })).toEqual({ url: 'https://facebook.com', domain: 'facebook.com' })
  })

  it('returns empty for an unresolvable redirect', () => {
    expect(resolveOrganicTarget({
      url:          'https://google.com/goto?url=abc',
      domain:       'google.com',
      breadcrumb:   '1 month ago',
      website_name: 'Instagram · romans_flooring',
    })).toEqual({ url: 'https://instagram.com', domain: 'instagram.com' })

    expect(resolveOrganicTarget({
      url:          'https://google.com/goto?url=abc',
      domain:       'google.com',
      breadcrumb:   '1 month ago',
      website_name: 'Some Unknown Thing',
    })).toEqual({ url: '', domain: null })
  })
})

describe('getOrganicRanks', () => {
  beforeEach(() => mockFetch.mockReset())

  it('resolves redirect items and keeps rankGroup', async () => {
    mockFetch.mockReturnValue(
      makeMockResponse([
        {
          type:          'organic',
          rank_group:    1,
          rank_absolute: 6,
          domain:        'google.com',
          url:           'https://google.com/goto?url=abc',
          breadcrumb:    'https://brisbanesfinestfloors.au',
          website_name:  'brisbanesfinestfloors.au',
        },
      ]),
    )

    const snapshot = await getOrganicRanks('x', 'au', { depth: 10 })

    expect(snapshot.items[0]?.rankGroup).toBe(1)
    expect(snapshot.items[0]?.domain).toBe('brisbanesfinestfloors.au')
    expect(snapshot.items[0]?.url).toBe('https://brisbanesfinestfloors.au/')
  })
})
