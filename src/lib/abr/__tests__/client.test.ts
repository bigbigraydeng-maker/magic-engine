/**
 * Unit tests for src/lib/abr/client.ts — ABR (AU) + NZBN (NZ) connector.
 *
 * Reference: ROADMAP.md P8.12.S1.1
 *
 * Mock strategy: global fetch is stubbed; credential env vars are set/unset
 * per test; the module is re-imported each test so credential accessors
 * re-read process.env.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ─── Response helpers ────────────────────────────────────────────────────────

function jsonpResponse(payload: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: async () => `callback(${JSON.stringify(payload)})`,
  } as Response)
}

function jsonResponse(payload: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response)
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ABN_DETAILS_ACTIVE = {
  Abn: '51824753556',
  AbnStatus: 'Active',
  AbnStatusEffectiveFrom: '2000-03-01',
  EntityName: 'EXAMPLE PTY LTD',
  EntityTypeName: 'Australian Private Company',
  EntityTypeCode: 'PRV',
  Gst: '2000-07-01',
  AddressState: 'QLD',
  AddressPostcode: '4000',
  Message: '',
}

const ABN_NAME_MATCHES = {
  Names: [
    { Abn: '11111111111', AbnStatus: 'Cancelled', Name: 'Example Old', Score: 80, State: 'QLD' },
    { Abn: '51824753556', AbnStatus: 'Active', Name: 'Example Pty Ltd', Score: 95, State: 'QLD' },
  ],
  Message: '',
}

const NZBN_ENTITY = {
  nzbn: '9429000000000',
  entityName: 'EXAMPLE LIMITED',
  entityTypeCode: 'LTD',
  entityTypeDescription: 'NZ Limited Company',
  entityStatusCode: '50',
  entityStatusDescription: 'Registered',
  registrationDate: '2010-05-01',
}

// ─── Env restore ─────────────────────────────────────────────────────────────

let savedGuid: string | undefined
let savedNzbnKey: string | undefined

beforeEach(() => {
  savedGuid = process.env.ABR_GUID
  savedNzbnKey = process.env.NZBN_API_KEY
  mockFetch.mockReset()
})

afterEach(() => {
  if (savedGuid !== undefined) process.env.ABR_GUID = savedGuid
  else delete process.env.ABR_GUID
  if (savedNzbnKey !== undefined) process.env.NZBN_API_KEY = savedNzbnKey
  else delete process.env.NZBN_API_KEY
  vi.resetModules()
})

// ─── getAbnDetails ───────────────────────────────────────────────────────────

describe('getAbnDetails', () => {
  it('throws when ABR_GUID is missing', async () => {
    delete process.env.ABR_GUID
    const { getAbnDetails } = await import('../client')
    await expect(getAbnDetails('51 824 753 556')).rejects.toThrow(/ABR_GUID/)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('throws when the ABN does not have 11 digits', async () => {
    process.env.ABR_GUID = 'test-guid'
    const { getAbnDetails } = await import('../client')
    await expect(getAbnDetails('12345')).rejects.toThrow(/Invalid ABN/)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('parses a JSONP response into a normalised registration record', async () => {
    process.env.ABR_GUID = 'test-guid'
    mockFetch.mockImplementation(() => jsonpResponse(ABN_DETAILS_ACTIVE))
    const { getAbnDetails } = await import('../client')

    const result = await getAbnDetails('51 824 753 556')

    expect(result).not.toBeNull()
    expect(result!.country).toBe('AU')
    expect(result!.identifier).toBe('51824753556')
    expect(result!.identifier_type).toBe('ABN')
    expect(result!.entity_name).toBe('EXAMPLE PTY LTD')
    expect(result!.entity_type).toBe('Australian Private Company')
    expect(result!.status).toBe('active')
    expect(result!.registered_since).toBe('2000-03-01')
    expect(result!.gst_registered).toBe(true)
  })

  it('reports gst_registered=false when the Gst field is empty', async () => {
    process.env.ABR_GUID = 'test-guid'
    mockFetch.mockImplementation(() =>
      jsonpResponse({ ...ABN_DETAILS_ACTIVE, Gst: null }),
    )
    const { getAbnDetails } = await import('../client')

    const result = await getAbnDetails('51824753556')
    expect(result!.gst_registered).toBe(false)
  })

  it('returns null when ABR responds with a Message error', async () => {
    process.env.ABR_GUID = 'test-guid'
    mockFetch.mockImplementation(() =>
      jsonpResponse({ Message: 'Search text is not a valid ABN or ACN' }),
    )
    const { getAbnDetails } = await import('../client')

    expect(await getAbnDetails('00000000000')).toBeNull()
  })

  it('throws on a non-ok HTTP status', async () => {
    process.env.ABR_GUID = 'test-guid'
    mockFetch.mockImplementation(() => jsonpResponse({}, 500))
    const { getAbnDetails } = await import('../client')

    await expect(getAbnDetails('51824753556')).rejects.toThrow(/ABR API error: 500/)
  })

  it('passes the GUID in the request URL', async () => {
    process.env.ABR_GUID = 'secret-guid-123'
    mockFetch.mockImplementation(() => jsonpResponse(ABN_DETAILS_ACTIVE))
    const { getAbnDetails } = await import('../client')

    await getAbnDetails('51824753556')
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('secret-guid-123')
    expect(url).toContain('abn=51824753556')
  })
})

// ─── searchAbnByName ─────────────────────────────────────────────────────────

describe('searchAbnByName', () => {
  it('maps the Names array into ranked matches', async () => {
    process.env.ABR_GUID = 'test-guid'
    mockFetch.mockImplementation(() => jsonpResponse(ABN_NAME_MATCHES))
    const { searchAbnByName } = await import('../client')

    const matches = await searchAbnByName('Example')
    expect(matches).toHaveLength(2)
    expect(matches[1].identifier).toBe('51824753556')
    expect(matches[1].status).toBe('active')
    expect(matches[1].score).toBe(95)
  })

  it('returns an empty array when ABR reports a Message error', async () => {
    process.env.ABR_GUID = 'test-guid'
    mockFetch.mockImplementation(() => jsonpResponse({ Message: 'No matches' }))
    const { searchAbnByName } = await import('../client')

    expect(await searchAbnByName('Nobody')).toEqual([])
  })
})

// ─── getNzbnEntity ───────────────────────────────────────────────────────────

describe('getNzbnEntity', () => {
  it('throws when NZBN_API_KEY is missing', async () => {
    delete process.env.NZBN_API_KEY
    const { getNzbnEntity } = await import('../client')
    await expect(getNzbnEntity('9429000000000')).rejects.toThrow(/NZBN_API_KEY/)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('throws when the NZBN does not have 13 digits', async () => {
    process.env.NZBN_API_KEY = 'test-key'
    const { getNzbnEntity } = await import('../client')
    await expect(getNzbnEntity('123')).rejects.toThrow(/Invalid NZBN/)
  })

  it('maps an NZBN entity into a normalised registration record', async () => {
    process.env.NZBN_API_KEY = 'test-key'
    mockFetch.mockImplementation(() => jsonResponse(NZBN_ENTITY))
    const { getNzbnEntity } = await import('../client')

    const result = await getNzbnEntity('9429 000 000 000')
    expect(result).not.toBeNull()
    expect(result!.country).toBe('NZ')
    expect(result!.identifier).toBe('9429000000000')
    expect(result!.identifier_type).toBe('NZBN')
    expect(result!.entity_type).toBe('NZ Limited Company')
    expect(result!.status).toBe('active')
    expect(result!.registered_since).toBe('2010-05-01')
    expect(result!.gst_registered).toBeNull()
  })

  it('returns null on a 404 (unknown NZBN)', async () => {
    process.env.NZBN_API_KEY = 'test-key'
    mockFetch.mockImplementation(() => jsonResponse({}, 404))
    const { getNzbnEntity } = await import('../client')

    expect(await getNzbnEntity('9429000000000')).toBeNull()
  })

  it('throws on a non-404 error status', async () => {
    process.env.NZBN_API_KEY = 'test-key'
    mockFetch.mockImplementation(() => jsonResponse({}, 401))
    const { getNzbnEntity } = await import('../client')

    await expect(getNzbnEntity('9429000000000')).rejects.toThrow(/NZBN API error: 401/)
  })

  it('sends the subscription key as a header', async () => {
    process.env.NZBN_API_KEY = 'secret-nzbn-key'
    mockFetch.mockImplementation(() => jsonResponse(NZBN_ENTITY))
    const { getNzbnEntity } = await import('../client')

    await getNzbnEntity('9429000000000')
    const init = mockFetch.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['Ocp-Apim-Subscription-Key']).toBe('secret-nzbn-key')
  })
})

// ─── verifyBusinessRegistration (non-fatal wrapper) ──────────────────────────

describe('verifyBusinessRegistration', () => {
  it('returns null instead of throwing when credentials are missing', async () => {
    delete process.env.ABR_GUID
    const { verifyBusinessRegistration } = await import('../client')

    const result = await verifyBusinessRegistration({ query: 'Example Pty Ltd', market: 'AU' })
    expect(result).toBeNull()
  })

  it('resolves an 11-digit query directly via getAbnDetails', async () => {
    process.env.ABR_GUID = 'test-guid'
    mockFetch.mockImplementation(() => jsonpResponse(ABN_DETAILS_ACTIVE))
    const { verifyBusinessRegistration } = await import('../client')

    const result = await verifyBusinessRegistration({ query: '51 824 753 556', market: 'AU' })
    expect(result!.identifier).toBe('51824753556')
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('resolves a name query by picking the best match then fetching detail', async () => {
    process.env.ABR_GUID = 'test-guid'
    mockFetch
      .mockImplementationOnce(() => jsonpResponse(ABN_NAME_MATCHES))
      .mockImplementationOnce(() => jsonpResponse(ABN_DETAILS_ACTIVE))
    const { verifyBusinessRegistration } = await import('../client')

    const result = await verifyBusinessRegistration({ query: 'Example', market: 'AU' })
    expect(result!.identifier).toBe('51824753556')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    // Second call must resolve the highest-scoring active match.
    expect(mockFetch.mock.calls[1][0] as string).toContain('abn=51824753556')
  })

  it('returns null when a name query has no matches', async () => {
    process.env.NZBN_API_KEY = 'test-key'
    mockFetch.mockImplementation(() => jsonResponse({ items: [] }))
    const { verifyBusinessRegistration } = await import('../client')

    const result = await verifyBusinessRegistration({ query: 'No Such Co', market: 'NZ' })
    expect(result).toBeNull()
  })
})
