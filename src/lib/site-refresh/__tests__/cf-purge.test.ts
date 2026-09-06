import { describe, it, expect, vi } from 'vitest'
import { purgeCloudflarePaths } from '../cf-purge'

function makeOkFetch() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ success: true, errors: [], messages: [], result: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

describe('purgeCloudflarePaths', () => {
  it('fails closed when required credentials are missing', async () => {
    const fetcher = vi.fn()
    const res = await purgeCloudflarePaths(['/tours/foo'], {
      fetcher: fetcher as unknown as typeof fetch,
    })
    expect(res.ok).toBe(false)
    expect(res.errors.some((e) => e.includes('CLOUDFLARE_MGMT_TOKEN'))).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('short-circuits with ok=true when no paths given', async () => {
    const fetcher = vi.fn()
    const res = await purgeCloudflarePaths([], {
      zoneId: 'z',
      token: 't',
      fetcher: fetcher as unknown as typeof fetch,
    })
    expect(res.ok).toBe(true)
    expect(res.purged).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('builds absolute URLs from paths and POSTs to CF purge_cache', async () => {
    const fetcher = makeOkFetch()
    const res = await purgeCloudflarePaths(['/tours/a', 'tours/b'], {
      origin: 'https://www.ctstours.co.nz',
      zoneId: 'zone123',
      token: 'tok',
      fetcher: fetcher as unknown as typeof fetch,
    })
    expect(res.ok).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.cloudflare.com/client/v4/zones/zone123/purge_cache')
    const body = JSON.parse((init as RequestInit).body as string) as { files: string[] }
    expect(body.files).toEqual([
      'https://www.ctstours.co.nz/tours/a',
      'https://www.ctstours.co.nz/tours/b',
    ])
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok')
  })

  it('chunks large path lists (25 per request)', async () => {
    const fetcher = makeOkFetch()
    const paths = Array.from({ length: 60 }, (_, i) => `/p${i}`)
    const res = await purgeCloudflarePaths(paths, {
      zoneId: 'z',
      token: 't',
      fetcher: fetcher as unknown as typeof fetch,
    })
    expect(res.ok).toBe(true)
    expect(fetcher.mock.calls.length).toBe(3) // 25 + 25 + 10
    expect(res.purged.length).toBe(60)
  })

  it('reports HTTP errors instead of throwing', async () => {
    const fetcher = vi.fn(async () => new Response('server error', { status: 500 }))
    const res = await purgeCloudflarePaths(['/a'], {
      zoneId: 'z',
      token: 't',
      fetcher: fetcher as unknown as typeof fetch,
    })
    expect(res.ok).toBe(false)
    expect(res.errors[0]).toContain('HTTP 500')
    expect(res.purged).toEqual([])
  })

  it('reports CF success:false payloads instead of pretending purge worked', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'nope' }] }), {
        status: 200,
      }),
    )
    const res = await purgeCloudflarePaths(['/a'], {
      zoneId: 'z',
      token: 't',
      fetcher: fetcher as unknown as typeof fetch,
    })
    expect(res.ok).toBe(false)
    expect(res.errors.length).toBeGreaterThan(0)
  })
})
