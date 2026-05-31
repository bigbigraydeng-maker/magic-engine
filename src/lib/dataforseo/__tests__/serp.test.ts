import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getSerpPage } from '../serp'

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
        tasks: [{ result: [{ items }] }],
      }),
  } as Response)
}

describe('getSerpPage', () => {
  beforeEach(() => mockFetch.mockReset())

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
      { name: 'Shop A', rating: 4.8, review_count: 120, address: '1 Main St' },
      { name: 'Shop B', rating: 4.2, review_count: 55,  address: null },
      { name: 'Shop C', rating: null, review_count: null, address: '3 Other Rd' },
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
        { type: 'ai_overview', ai_overview: { text: 'AI answer here', references: [{ url: 'https://ref.com', title: 'Ref' }] } },
      ]),
    )

    const result = await getSerpPage('flooring brisbane')

    expect(result.organic_results).toHaveLength(1)
    expect(result.paid_advertiser_domains).toEqual(['ads.com'])
    expect(result.ai_overview_text).toBe('AI answer here')
    expect(result.local_pack).toEqual([
      { name: 'Local Biz', rating: 4.5, review_count: 80, address: '10 King St' },
    ])
    expect(result.people_also_ask).toEqual(['How to choose flooring?'])
  })
})
