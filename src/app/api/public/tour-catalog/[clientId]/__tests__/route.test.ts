import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { extractBearerMock, verifyApiKeyMock, loadPublishedMock } = vi.hoisted(() => ({
  extractBearerMock: vi.fn(),
  verifyApiKeyMock: vi.fn(),
  loadPublishedMock: vi.fn(),
}))

vi.mock('@/lib/auth/api-key-access', () => ({
  extractBearer: extractBearerMock,
  verifyApiKey: verifyApiKeyMock,
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/tour-catalog/store-publish', () => ({ loadPublished: loadPublishedMock }))

import { GET } from '../route'

const CLIENT_ID = 'client-cts-1'
function request() {
  return new NextRequest(`https://me.example.test/api/public/tour-catalog/${CLIENT_ID}`, {
    headers: { Authorization: 'Bearer test-token' },
  })
}

function context(clientId = CLIENT_ID) {
  return { params: Promise.resolve({ clientId }) }
}

describe('GET /api/public/tour-catalog/[clientId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    extractBearerMock.mockReturnValue('test-token')
    verifyApiKeyMock.mockResolvedValue({ ok: true, auth: { kind: 'client', clientId: CLIENT_ID, scopes: ['read:all'] } })
    loadPublishedMock.mockResolvedValue({ published: true, version: 8, createdAt: '2026-10-23T00:00:00.000Z', tours: [], departures: [] })
  })

  it('requires a client key locked to the requested client', async () => {
    verifyApiKeyMock.mockResolvedValue({ ok: true, auth: { kind: 'client', clientId: 'other-client', scopes: ['read:all'] } })

    const response = await GET(request(), context())

    expect(response.status).toBe(401)
    expect(loadPublishedMock).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('rejects keys without catalog-read scope and Meta Ads scoped keys', async () => {
    verifyApiKeyMock.mockResolvedValueOnce({ ok: true, auth: { kind: 'client', clientId: CLIENT_ID, scopes: ['read:client'] } })
    expect((await GET(request(), context())).status).toBe(403)

    verifyApiKeyMock.mockResolvedValueOnce({ ok: true, auth: { kind: 'client', clientId: CLIENT_ID, scopes: ['read:all', 'meta:ads:read'] } })
    expect((await GET(request(), context())).status).toBe(403)
    expect(loadPublishedMock).not.toHaveBeenCalled()
  })

  it('returns only the published public projection with no-store-friendly caching', async () => {
    loadPublishedMock.mockResolvedValue({
      published: true,
      version: 8,
      createdAt: '2026-10-23T00:00:00.000Z',
      tours: [{ id: 'tour-1', name: 'Natural China' }],
      departures: [{ id: 'internal-departure', tourId: 'tour-1', departOn: '2027-03-26', status: 'cancelled', internalNote: 'private' }],
    })

    const response = await GET(request(), context())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ published: true, version: 8, published_at: '2026-10-23T00:00:00.000Z', products: [] })
    expect(JSON.stringify(body)).not.toContain('internalNote')
    expect(loadPublishedMock).toHaveBeenCalledWith(expect.anything(), CLIENT_ID)
    expect(response.headers.get('cache-control')).toContain('must-revalidate')
  })

  it('returns service unavailable before the first publish', async () => {
    loadPublishedMock.mockResolvedValue({ published: false, tours: [], departures: [] })

    const response = await GET(request(), context())

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ published: false, version: null, products: [] })
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
})
