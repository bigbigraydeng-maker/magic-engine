import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getBusinessReviews } from '../client'

function mockFetchOnce(body: unknown, status = 200): void {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response)
}

const MOCK_SEARCH_RESPONSE = {
  status: 'OK',
  results: [
    {
      place_id: 'ChIJabc123',
      name: 'Oztop Building Supplies',
      rating: 4.3,
      user_ratings_total: 87,
    },
  ],
}

beforeEach(() => {
  vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-api-key-123')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('getBusinessReviews', () => {
  it('maps the first text search result to business review data', async () => {
    mockFetchOnce(MOCK_SEARCH_RESPONSE)

    const result = await getBusinessReviews('Oztop Building Supplies Slacks Creek QLD')

    expect(result).toEqual({
      placeId: 'ChIJabc123',
      name: 'Oztop Building Supplies',
      rating: 4.3,
      totalReviews: 87,
    })
  })

  it('defaults missing rating fields to zero', async () => {
    mockFetchOnce({
      status: 'OK',
      results: [
        {
          place_id: 'ChIJnew',
          name: 'Brand New Business',
        },
      ],
    })

    const result = await getBusinessReviews('Brand New Business Brisbane')

    expect(result).toEqual({
      placeId: 'ChIJnew',
      name: 'Brand New Business',
      rating: 0,
      totalReviews: 0,
    })
  })

  it('returns null when the API status is not OK', async () => {
    mockFetchOnce({ status: 'ZERO_RESULTS', results: [] })

    await expect(getBusinessReviews('Unknown Business')).resolves.toBeNull()
  })

  it('returns null when the API returns no results', async () => {
    mockFetchOnce({ status: 'OK', results: [] })

    await expect(getBusinessReviews('Unknown Business')).resolves.toBeNull()
  })

  it('throws when GOOGLE_PLACES_API_KEY is missing', async () => {
    vi.unstubAllEnvs()
    delete process.env.GOOGLE_PLACES_API_KEY

    await expect(getBusinessReviews('Any Query')).rejects.toThrow(
      'GOOGLE_PLACES_API_KEY not configured'
    )
  })

  it('throws when the text search request fails', async () => {
    mockFetchOnce({ error: 'API key invalid' }, 403)

    await expect(getBusinessReviews('Any Query')).rejects.toThrow(
      'Places text search error: 403'
    )
  })

  it('calls the legacy text search endpoint with the encoded query and API key', async () => {
    mockFetchOnce(MOCK_SEARCH_RESPONSE)

    await getBusinessReviews('Oztop Building Supplies Slacks Creek QLD')

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(url).toContain('https://maps.googleapis.com/maps/api/place/textsearch/json')
    expect(url).toContain('query=Oztop%20Building%20Supplies%20Slacks%20Creek%20QLD')
    expect(url).toContain('key=test-api-key-123')
  })
})
