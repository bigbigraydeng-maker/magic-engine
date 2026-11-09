import { afterEach, describe, expect, it, vi } from 'vitest'
import { revalidatePublishedTourWebsite } from '../website-revalidation'

const CLIENT_ID = 'client-cts-1'
const originals = {
  url: process.env.CTS_TOUR_CATALOG_REVALIDATE_URL,
  secret: process.env.CTS_TOUR_CATALOG_REVALIDATE_SECRET,
  clientId: process.env.CTS_TOUR_CATALOG_CLIENT_ID,
}

afterEach(() => {
  if (originals.url === undefined) delete process.env.CTS_TOUR_CATALOG_REVALIDATE_URL
  else process.env.CTS_TOUR_CATALOG_REVALIDATE_URL = originals.url
  if (originals.secret === undefined) delete process.env.CTS_TOUR_CATALOG_REVALIDATE_SECRET
  else process.env.CTS_TOUR_CATALOG_REVALIDATE_SECRET = originals.secret
  if (originals.clientId === undefined) delete process.env.CTS_TOUR_CATALOG_CLIENT_ID
  else process.env.CTS_TOUR_CATALOG_CLIENT_ID = originals.clientId
  vi.unstubAllGlobals()
})

describe('revalidatePublishedTourWebsite', () => {
  it('calls only the configured CTS website endpoint for the matching client', async () => {
    process.env.CTS_TOUR_CATALOG_REVALIDATE_URL = 'https://www.ctstours.co.nz/api/revalidate'
    process.env.CTS_TOUR_CATALOG_REVALIDATE_SECRET = 'test-secret'
    process.env.CTS_TOUR_CATALOG_CLIENT_ID = CLIENT_ID
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(revalidatePublishedTourWebsite(CLIENT_ID)).resolves.toBe('revalidated')
    expect(fetchMock).toHaveBeenCalledWith('https://www.ctstours.co.nz/api/revalidate', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer test-secret' }),
      body: JSON.stringify({ clientId: CLIENT_ID }),
      cache: 'no-store',
    }))
  })

  it('reports missing or mismatched configuration without calling the website', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    process.env.CTS_TOUR_CATALOG_REVALIDATE_URL = 'https://www.ctstours.co.nz/api/revalidate'
    process.env.CTS_TOUR_CATALOG_REVALIDATE_SECRET = 'test-secret'
    process.env.CTS_TOUR_CATALOG_CLIENT_ID = 'another-client'

    await expect(revalidatePublishedTourWebsite(CLIENT_ID)).resolves.toBe('not_configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a failed website refresh so the publish UI can show a warning', async () => {
    process.env.CTS_TOUR_CATALOG_REVALIDATE_URL = 'https://www.ctstours.co.nz/api/revalidate'
    process.env.CTS_TOUR_CATALOG_REVALIDATE_SECRET = 'test-secret'
    process.env.CTS_TOUR_CATALOG_CLIENT_ID = CLIENT_ID
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))

    await expect(revalidatePublishedTourWebsite(CLIENT_ID)).resolves.toBe('failed')
  })
})
