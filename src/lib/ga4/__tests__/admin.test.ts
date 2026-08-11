import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listGa4Properties } from '../admin'

function accountSummariesResponse(
  accounts: Array<{ properties: Array<{ property: string; displayName: string }> }>,
  nextPageToken?: string,
) {
  return new Response(
    JSON.stringify({
      accountSummaries: accounts.map((a) => ({
        propertySummaries: a.properties,
      })),
      ...(nextPageToken ? { nextPageToken } : {}),
    }),
    { status: 200 },
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('listGa4Properties', () => {
  it('returns an empty (ok) result when the account has zero properties — not an error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(accountSummariesResponse([]))

    const result = await listGa4Properties('tok')

    expect(result).toEqual({ ok: true, properties: [] })
  })

  it('flattens properties across multiple GA4 accounts into one list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      accountSummariesResponse([
        { properties: [{ property: 'properties/1', displayName: 'Site A' }] },
        { properties: [{ property: 'properties/2', displayName: 'Site B' }] },
      ]),
    )

    const result = await listGa4Properties('tok')

    expect(result).toEqual({
      ok: true,
      properties: [
        { property: 'properties/1', displayName: 'Site A' },
        { property: 'properties/2', displayName: 'Site B' },
      ],
    })
  })

  it('follows pagination via nextPageToken', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        accountSummariesResponse([{ properties: [{ property: 'properties/1', displayName: 'Page 1' }] }], 'tok-2'),
      )
      .mockResolvedValueOnce(
        accountSummariesResponse([{ properties: [{ property: 'properties/2', displayName: 'Page 2' }] }]),
      )

    const result = await listGa4Properties('tok')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      ok: true,
      properties: [
        { property: 'properties/1', displayName: 'Page 1' },
        { property: 'properties/2', displayName: 'Page 2' },
      ],
    })
  })

  it('sends the access token as a Bearer header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(accountSummariesResponse([]))

    await listGa4Properties('my-token')

    const [, init] = fetchSpy.mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer my-token')
  })

  it('returns a distinct api_failed result on a non-2xx response — must not be conflated with "zero properties"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))

    const result = await listGa4Properties('tok')

    expect(result).toEqual({ ok: false, reason: 'api_failed' })
  })

  it('returns api_failed when the fetch call itself throws (network error)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down'))

    const result = await listGa4Properties('tok')

    expect(result).toEqual({ ok: false, reason: 'api_failed' })
  })
})
