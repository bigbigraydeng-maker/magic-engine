import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getValidToken: vi.fn(),
  getValidAccessToken: vi.fn(),
}))

vi.mock('@/lib/platform-oauth/token-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platform-oauth/token-manager')>()
  return { ...actual, getValidToken: mocks.getValidToken }
})

vi.mock('@/lib/google-oauth/client', () => ({
  getValidAccessToken: mocks.getValidAccessToken,
}))

import {
  createGscPageQueryEvidenceReceipt,
  fetchGscPageQueryReport,
  fetchGscSnapshot,
  GscApiError,
  isGscPageQueryEvidenceReceipt,
} from '../client'

const SITE = 'sc-domain:ctstours.co.nz'
const params = {
  accessToken: 'test-token',
  siteUrl: SITE,
  startDate: '2026-07-23',
  endDate: '2026-08-20',
  country: 'nzl',
}

function okRows(rows: unknown[] = []) {
  return new Response(JSON.stringify({ rows }), { status: 200 })
}

function firstRequestBody(spy: {
  mock: { calls: Array<[input: string | URL | Request, init?: RequestInit]> }
}) {
  const [, init] = spy.mock.calls[0]
  return JSON.parse((init as RequestInit).body as string) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('fetchGscPageQueryReport request', () => {
  it('requests a real page × query grouping with the NZ filter', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okRows())

    await fetchGscPageQueryReport(params)

    expect(firstRequestBody(fetchSpy)).toEqual({
      startDate: '2026-07-23',
      endDate: '2026-08-20',
      dimensions: ['page', 'query'],
      type: 'web',
      dimensionFilterGroups: [{
        groupType: 'and',
        filters: [{ dimension: 'country', operator: 'equals', expression: 'nzl' }],
      }],
      rowLimit: 250,
    })
  })

  it('encodes the exact GSC property and sends the supplied token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okRows())

    await fetchGscPageQueryReport(params)

    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toContain(encodeURIComponent(SITE))
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-token' })
  })

  it('caps a larger row limit at the evidence-window maximum', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okRows())
    await fetchGscPageQueryReport({ ...params, rowLimit: 25_000 })
    expect(firstRequestBody(fetchSpy).rowLimit).toBe(250)
  })

  it('normalises an uppercase country code', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okRows())
    await fetchGscPageQueryReport({ ...params, country: 'NZL' })
    const groups = firstRequestBody(fetchSpy).dimensionFilterGroups
    expect(groups).toEqual([{ groupType: 'and', filters: [
      { dimension: 'country', operator: 'equals', expression: 'nzl' },
    ] }])
  })
})

describe('fetchGscPageQueryReport response', () => {
  it('maps a returned row without joining separate reports', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okRows([{
      keys: ['https://ctstours.co.nz/tours/rotorua', 'rotorua day tour from auckland'],
      clicks: 4,
      impressions: 210,
      ctr: 0.019,
      position: 8.2,
    }]))

    await expect(fetchGscPageQueryReport(params)).resolves.toEqual([{
      page: 'https://ctstours.co.nz/tours/rotorua',
      query: 'rotorua day tour from auckland',
      clicks: 4,
      impressions: 210,
      ctr: 0.019,
      position: 8.2,
    }])
  })

  it('preserves the exact provider page and query strings', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okRows([{
      keys: [' https://ctstours.co.nz/ ', ' exact query '],
      clicks: 1,
      impressions: 2,
      ctr: 0.5,
      position: 3,
    }]))
    const [row] = await fetchGscPageQueryReport(params)
    expect(row).toMatchObject({ page: ' https://ctstours.co.nz/ ', query: ' exact query ' })
  })

  it('accepts a successful response with no rows', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    await expect(fetchGscPageQueryReport(params)).resolves.toEqual([])
  })

  it.each([null, [], { rows: null }, { rows: {} }])(
    'rejects a malformed successful response instead of reporting zero rows',
    async body => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(body), { status: 200 }),
      )
      await expect(fetchGscPageQueryReport(params)).rejects.toMatchObject({
        googleStatus: 'INVALID_RESPONSE',
      })
    },
  )

  it.each([
    null,
    'not-a-row',
    { keys: ['only-page'], clicks: 1, impressions: 2, ctr: 0.5, position: 3 },
    { keys: ['', 'query'], clicks: 1, impressions: 2, ctr: 0.5, position: 3 },
    { keys: ['page', '   '], clicks: 1, impressions: 2, ctr: 0.5, position: 3 },
    { keys: ['page', 'query'], clicks: 1, impressions: '2', ctr: 0.5, position: 3 },
    { keys: ['page', 'query'], clicks: -1, impressions: 2, ctr: 0.5, position: 3 },
    { keys: ['page', 'query'], clicks: 1, impressions: 2, ctr: 1.1, position: 3 },
  ])('fails closed on a malformed evidence row', async row => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okRows([row]))
    await expect(fetchGscPageQueryReport(params)).rejects.toMatchObject({
      googleStatus: 'INVALID_RESPONSE',
    })
  })
})

describe('GSC page × query evidence receipt', () => {
  it('mints and freezes a receipt only from a returned provider row', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okRows([{
      keys: ['https://ctstours.co.nz/', 'china tours'],
      clicks: 2,
      impressions: 195,
      ctr: 2 / 195,
      position: 14.8,
    }]))
    const [row] = await fetchGscPageQueryReport(params)
    const receipt = createGscPageQueryEvidenceReceipt(params, row)

    expect(receipt).toMatchObject({
      provider: 'gsc',
      property: SITE,
      country: 'nzl',
      page: 'https://ctstours.co.nz/',
      query: 'china tours',
      clicks: 2,
      impressions: 195,
    })
    expect(receipt.evidence_source_id).toMatch(/^gsc-page-query:[0-9a-f]{64}$/)
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(isGscPageQueryEvidenceReceipt(receipt)).toBe(true)
    expect(isGscPageQueryEvidenceReceipt({ ...receipt })).toBe(false)
  })

  it('rejects a caller-fabricated row', () => {
    expect(() => createGscPageQueryEvidenceReceipt(params, {
      page: 'https://ctstours.co.nz/',
      query: 'made up',
      clicks: 1,
      impressions: 1,
      ctr: 1,
      position: 1,
    })).toThrow(GscApiError)
  })

  it.each([
    { siteUrl: 'sc-domain:other.example.nz' },
    { startDate: '2026-07-24' },
    { endDate: '2026-08-19' },
    { country: 'aus' },
  ])('rejects re-labelling a trusted row with a different provider scope', async override => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okRows([{
      keys: ['https://ctstours.co.nz/', 'china tours'],
      clicks: 2,
      impressions: 195,
      ctr: 2 / 195,
      position: 14.8,
    }]))
    const [row] = await fetchGscPageQueryReport(params)

    expect(() => createGscPageQueryEvidenceReceipt({ ...params, ...override }, row))
      .toThrow(GscApiError)
  })
})

describe('fetchGscPageQueryReport validation', () => {
  it.each([
    ['accessToken', ''],
    ['siteUrl', ''],
    ['startDate', ''],
    ['endDate', ''],
    ['country', ''],
  ] as const)('rejects missing %s before making a request', async (field, value) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(fetchGscPageQueryReport({ ...params, [field]: value })).rejects.toThrow(GscApiError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([
    { startDate: '20-07-23' },
    { startDate: '2026-02-30' },
    { endDate: '2026-99-99' },
    { startDate: '2026-08-21', endDate: '2026-08-20' },
    { country: 'nz' },
    { rowLimit: 0 },
    { rowLimit: 1.5 },
  ])('rejects malformed scope before making a request', async override => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(fetchGscPageQueryReport({ ...params, ...override })).rejects.toThrow(GscApiError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('fetchGscPageQueryReport side effects and failures', () => {
  it('does not resolve, refresh, or persist a token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okRows())
    await fetchGscPageQueryReport(params)
    expect(mocks.getValidToken).not.toHaveBeenCalled()
    expect(mocks.getValidAccessToken).not.toHaveBeenCalled()
  })

  it('does not retry provider errors', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'nope' } }),
      { status: 403 },
    ))
    await expect(fetchGscPageQueryReport(params)).rejects.toMatchObject({ httpStatus: 403 })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not retry network errors', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'))
    await expect(fetchGscPageQueryReport(params)).rejects.toMatchObject({
      googleStatus: 'NETWORK_ERROR',
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('fetchGscSnapshot regression', () => {
  it('still uses its three independent aggregate/query/page requests', async () => {
    mocks.getValidToken.mockResolvedValue('token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okRows([{ clicks: 10, impressions: 100, ctr: 0.1, position: 5 }]))
      .mockResolvedValueOnce(okRows([{ keys: ['best tour'], clicks: 4, impressions: 40, ctr: 0.1, position: 3 }]))
      .mockResolvedValueOnce(okRows([{ keys: ['https://ctstours.co.nz/'], clicks: 6, impressions: 60, ctr: 0.1, position: 4 }]))

    const snapshot = await fetchGscSnapshot(SITE, 'client-1', 28)

    expect(snapshot?.total_clicks).toBe(10)
    expect(snapshot?.top_queries[0]?.query).toBe('best tour')
    expect(snapshot?.top_pages[0]?.page).toBe('https://ctstours.co.nz/')
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })
})
