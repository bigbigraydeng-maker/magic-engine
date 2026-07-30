import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getCompetitorDomains, getSerpRankings } from '../client'

vi.mock('@/lib/validation-utils', () => ({ validateEnvVar: () => 'test' }))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function okEmpty() {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ tasks: [{ result: [{ items: [] }] }] }),
  } as Response)
}

/** Read the location_code out of the single request body the SUT sent. */
function sentLocationCode(): number {
  const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
  const body = JSON.parse(init.body as string) as Array<{ location_code: number }>
  return body[0].location_code
}

// Regression guard: `getCompetitorDomains` hardcoded `location_code: 2554` under
// a comment claiming "Australia". 2554 is New Zealand — so every AU client's
// competitor set was silently pulled from the NZ SERP. The market must come from
// the client's semrush_db, matching LOCATION_CODE_BY_DB used across the codebase.
describe('DataForSEO location_code routing (AU=2036, NZ=2554)', () => {
  beforeEach(() => mockFetch.mockReset())

  it('getCompetitorDomains sends 2036 for an AU client', async () => {
    mockFetch.mockReturnValue(okEmpty())
    await getCompetitorDomains('oztopbuildingsupplies.com.au', 5, 'au')
    expect(sentLocationCode()).toBe(2036)
  })

  it('getCompetitorDomains sends 2554 for an NZ client', async () => {
    mockFetch.mockReturnValue(okEmpty())
    await getCompetitorDomains('ctstours.co.nz', 5, 'nz')
    expect(sentLocationCode()).toBe(2554)
  })

  it('getCompetitorDomains defaults to AU (2036), not NZ, when db is omitted', async () => {
    mockFetch.mockReturnValue(okEmpty())
    await getCompetitorDomains('example.com.au')
    expect(sentLocationCode()).toBe(2036)
  })

  it('getCompetitorDomains falls back to AU on an unknown db value', async () => {
    mockFetch.mockReturnValue(okEmpty())
    await getCompetitorDomains('example.com', 5, 'uk')
    expect(sentLocationCode()).toBe(2036)
  })

  it('getSerpRankings resolves the same mapping', async () => {
    mockFetch.mockReturnValue(okEmpty())
    await getSerpRankings('ctstours.co.nz', ['china tours'], 'nz')
    expect(sentLocationCode()).toBe(2554)

    mockFetch.mockReset()
    mockFetch.mockReturnValue(okEmpty())
    await getSerpRankings('oztop.com.au', ['spc flooring'], 'au')
    expect(sentLocationCode()).toBe(2036)
  })
})
