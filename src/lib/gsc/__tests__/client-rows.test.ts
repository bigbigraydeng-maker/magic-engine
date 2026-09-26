import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class PlatformConnectionNotFoundError extends Error {}
  return {
    getValidToken: vi.fn(),
    getValidAccessToken: vi.fn(),
    loadServiceAccount: vi.fn(() => null),
    PlatformConnectionNotFoundError,
  }
})

vi.mock('@/lib/platform-oauth/token-manager', () => ({
  getValidToken: mocks.getValidToken,
  PlatformConnectionNotFoundError: mocks.PlatformConnectionNotFoundError,
}))
vi.mock('@/lib/google-oauth/client', () => ({ getValidAccessToken: mocks.getValidAccessToken }))
vi.mock('@/lib/google-oauth/service-account', () => ({
  loadServiceAccount: mocks.loadServiceAccount,
  mintServiceAccountToken: vi.fn(),
}))

import {
  GscApiError,
  fetchFinalizedDayRange,
  fetchGscSnapshot,
  parseRetryAfterMs,
  querySearchAnalyticsRows,
  withGscAccess,
} from '../client'

const SITE = 'https://example.com.au/'
const CLIENT = 'c0000000-0000-0000-0000-000000000000'

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit | undefined
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadServiceAccount.mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('querySearchAnalyticsRows', () => {
  it('sends dimensions / rowLimit / startRow and never orderBy or dataState', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json({ rows: [{ keys: ['https://example.com.au/a'], clicks: 3, impressions: 40, ctr: 0.075, position: 4.2 }] }),
    )

    const rows = await querySearchAnalyticsRows('tok', SITE, {
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      dimensions: ['page'],
      rowLimit: 25000,
      startRow: 25000,
    })

    expect(rows).toEqual([
      { keys: ['https://example.com.au/a'], clicks: 3, impressions: 40, ctr: 0.075, position: 4.2 },
    ])

    const call = fetchSpy.mock.calls[0]
    expect(String(call[0])).toContain(encodeURIComponent(SITE))
    expect(bodyOf(call)).toEqual({
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      dimensions: ['page'],
      rowLimit: 25000,
      startRow: 25000,
    })

    const init = call[1] as RequestInit | undefined
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok')
  })

  it('startRow defaults to 0 and a missing rows field means no rows', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({}))

    const rows = await querySearchAnalyticsRows('tok', SITE, {
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      dimensions: ['page'],
      rowLimit: 25000,
    })

    expect(rows).toEqual([])
    expect(bodyOf(fetchSpy.mock.calls[0]).startRow).toBe(0)
  })

  it("429 carries Google's Retry-After in ms", async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }, 429, { 'retry-after': '120' }),
    )

    const err = await querySearchAnalyticsRows('tok', SITE, {
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      dimensions: ['page'],
      rowLimit: 25000,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(GscApiError)
    expect((err as GscApiError).httpStatus).toBe(429)
    expect((err as GscApiError).retryAfterMs).toBe(120000)
  })

  it('429 without Retry-After → retryAfterMs null', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }, 429),
    )

    const err = await querySearchAnalyticsRows('tok', SITE, {
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      dimensions: ['page'],
      rowLimit: 25000,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(GscApiError)
    expect((err as GscApiError).retryAfterMs).toBeNull()
  })

  it("403 is a GscApiError with Google's reason", async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json(
        {
          error: {
            status: 'PERMISSION_DENIED',
            message: 'User does not have sufficient permission for site',
            errors: [{ reason: 'forbidden' }],
          },
        },
        403,
      ),
    )

    const err = await querySearchAnalyticsRows('tok', SITE, {
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      dimensions: ['page'],
      rowLimit: 25000,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(GscApiError)
    expect((err as GscApiError).httpStatus).toBe(403)
    expect((err as GscApiError).googleReason).toBe('forbidden')
    expect((err as GscApiError).retryAfterMs).toBeNull()
  })

  it('network failure → GscApiError status 0', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('socket hang up')
    })

    const err = await querySearchAnalyticsRows('tok', SITE, {
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      dimensions: ['page'],
      rowLimit: 25000,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(GscApiError)
    expect((err as GscApiError).httpStatus).toBe(0)
    expect((err as GscApiError).googleStatus).toBe('NETWORK_ERROR')
  })
})

describe('parseRetryAfterMs', () => {
  it('parses seconds, HTTP dates, and rejects garbage', () => {
    expect(parseRetryAfterMs('30')).toBe(30000)

    const now = new Date('2026-09-26T00:00:00Z')
    const httpDate = new Date(now.getTime() + 60_000).toUTCString()
    expect(parseRetryAfterMs(httpDate, now)).toBe(60000)

    expect(parseRetryAfterMs('garbage')).toBeNull()
    expect(parseRetryAfterMs(null)).toBeNull()
    expect(parseRetryAfterMs('  ')).toBeNull()
  })
})

describe('fetchFinalizedDayRange', () => {
  it('first / last finalised day, date dimension only', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json({
        rows: [
          { keys: ['2026-09-03'], clicks: 1, impressions: 1, ctr: 1, position: 1 },
          { keys: ['2026-09-01'], clicks: 1, impressions: 1, ctr: 1, position: 1 },
          { keys: ['2026-09-02'], clicks: 1, impressions: 1, ctr: 1, position: 1 },
        ],
      }),
    )

    const range = await fetchFinalizedDayRange('tok', SITE, '2026-09-01', '2026-09-03')

    expect(range).toEqual({ firstDay: '2026-09-01', lastDay: '2026-09-03' })

    const body = bodyOf(fetchSpy.mock.calls[0])
    expect(body.dimensions).toEqual(['date'])
    expect(body).not.toHaveProperty('orderBy')
    expect(body).not.toHaveProperty('dataState')
  })

  it('no finalised data → both null', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ rows: [] }))

    const range = await fetchFinalizedDayRange('tok', SITE, '2026-09-01', '2026-09-03')

    expect(range).toEqual({ firstDay: null, lastDay: null })
  })
})

describe('withGscAccess', () => {
  it('no token at all → null and fn never runs', async () => {
    mocks.getValidToken.mockRejectedValue(new mocks.PlatformConnectionNotFoundError('none'))
    mocks.getValidAccessToken.mockResolvedValue(null)

    const fn = vi.fn(async () => 'x')
    const result = await withGscAccess(CLIENT, fn)

    expect(result).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })

  it('401 → force-refresh once, then succeeds', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.getValidToken.mockResolvedValueOnce('stale').mockResolvedValueOnce('fresh')

    const fn = vi.fn(async (t: string) => {
      if (t === 'stale') throw new GscApiError(401, 'UNAUTHENTICATED', 'authError', 'expired')
      return t
    })

    const result = await withGscAccess(CLIENT, fn)

    expect(result).toBe('fresh')
    expect(mocks.getValidToken.mock.calls[1]).toEqual([CLIENT, 'google_gsc', { forceRefresh: true }])
  })

  it('second 401 propagates', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.getValidToken.mockResolvedValueOnce('a').mockResolvedValueOnce('b')

    const fn = vi.fn(async () => {
      throw new GscApiError(401, 'UNAUTHENTICATED', 'authError', 'expired')
    })

    const err = await withGscAccess(CLIENT, fn).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(GscApiError)
    expect((err as GscApiError).httpStatus).toBe(401)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('403 is not retried', async () => {
    mocks.getValidToken.mockResolvedValue('tok')

    const fn = vi.fn(async () => {
      throw new GscApiError(403, 'PERMISSION_DENIED', 'forbidden', 'nope')
    })

    const err = await withGscAccess(CLIENT, fn).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(GscApiError)
    expect(mocks.getValidToken).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('fetchGscSnapshot (regression: still retries a 401 through withGscAccess)', () => {
  it('force-refreshes a stale token and returns the snapshot', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.getValidToken.mockResolvedValueOnce('stale').mockResolvedValueOnce('fresh')

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined
      if (headers?.['Authorization'] === 'Bearer stale') {
        return json({ error: { status: 'UNAUTHENTICATED', message: 'expired' } }, 401)
      }
      return json({ rows: [{ keys: ['k'], clicks: 7, impressions: 70, ctr: 0.1, position: 2 }] })
    })

    const snap = await fetchGscSnapshot(SITE, CLIENT, 28)

    expect(snap).not.toBeNull()
    expect(snap?.total_clicks).toBe(7)
  })
})
