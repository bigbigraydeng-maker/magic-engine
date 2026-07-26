/**
 * Tests for the Facebook Page binding endpoint.
 *
 * Setting this field is what turns customer-message ingestion on for a client,
 * so the tests are about the two ways that goes wrong quietly:
 *   - storing something that is not a Page id (a vanity URL, a name) and leaving
 *     the sync pulling nothing until someone reads the logs
 *   - reporting success when ME cannot actually reach the Page it was told to watch
 *
 * A Meta outage must never block reading or clearing the binding, so the
 * pick-list degrades to null instead of failing the request.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: vi.fn() }))
vi.mock('@/lib/meta/page-posts', () => ({ listManagedPages: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { GET, PATCH } from '../route'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { listManagedPages } from '@/lib/meta/page-posts'

const mockAccess = vi.mocked(requireDashboardClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)
const mockToken = vi.mocked(getMetaTokenForClient)
const mockPages = vi.mocked(listManagedPages)

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const CTS_PAGE = '1616575215312482'

function params(id = CTS) {
  return { params: { id } }
}

function patchRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3001/api/clients/${CTS}/facebook-page`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function getRequest(): NextRequest {
  return new NextRequest(`http://localhost:3001/api/clients/${CTS}/facebook-page`)
}

function allow() {
  mockAccess.mockResolvedValue({
    ok: true,
    user: { email: 'bdm@ctstours.co.nz' } as never,
    role: 'client-viewer',
    tier: 'paid_client',
    allowedClientId: CTS,
  } as never)
}

/** Stubs the clients table for both the read and the write path. */
function stubClients(current: string | null) {
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { facebook_page_id: current }, error: null }),
      }),
    }),
    update,
  } as never)
  return { update }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('facebook-page — authorisation', () => {
  it('rejects a caller who is not a member of the client', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)

    const res = await GET(getRequest(), params(OZTOP))

    expect(res.status).toBe(403)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('will not write for an unauthenticated caller', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' } as never)

    const res = await PATCH(patchRequest({ page_id: CTS_PAGE }), params())

    expect(res.status).toBe(401)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

describe('facebook-page — what may be stored', () => {
  it('refuses a vanity URL instead of storing a Page the sync can never read', async () => {
    allow()
    const { update } = stubClients(null)

    const res = await PATCH(patchRequest({ page_id: 'facebook.com/CTSTOURS' }), params())

    expect(res.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
    expect((await res.json()).error).toContain('数字')
  })

  it('refuses a Page name', async () => {
    allow()
    const { update } = stubClients(null)

    const res = await PATCH(patchRequest({ page_id: 'CTS Tours NZ' }), params())

    expect(res.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses a number too short to be a real Page id', async () => {
    allow()
    const { update } = stubClients(null)

    const res = await PATCH(patchRequest({ page_id: '12345' }), params())

    expect(res.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('stores a valid id, trimming stray whitespace from a paste', async () => {
    allow()
    const { update } = stubClients(null)
    mockToken.mockResolvedValue('user-token')
    mockPages.mockResolvedValue([{ id: CTS_PAGE, name: 'CTS Tours NZ' }])

    const res = await PATCH(patchRequest({ page_id: `  ${CTS_PAGE} ` }), params())

    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith({ facebook_page_id: CTS_PAGE })
  })

  it('treats an empty string as "stop syncing this client"', async () => {
    allow()
    const { update } = stubClients(CTS_PAGE)
    mockToken.mockResolvedValue(null)

    const res = await PATCH(patchRequest({ page_id: '' }), params())

    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith({ facebook_page_id: null })
    expect(await res.json()).toMatchObject({ page_id: null, reachable: null })
  })
})

describe('facebook-page — telling the truth about whether it is live', () => {
  it('reports reachable when the saved Page is one Meta lets us act for', async () => {
    allow()
    stubClients(null)
    mockToken.mockResolvedValue('user-token')
    mockPages.mockResolvedValue([
      { id: '999', name: 'Other Page' },
      { id: CTS_PAGE, name: 'CTS Tours NZ' },
    ])

    const res = await PATCH(patchRequest({ page_id: CTS_PAGE }), params())

    expect(await res.json()).toMatchObject({ success: true, reachable: true })
  })

  it('saves but reports NOT reachable when the id is not among the managed Pages', async () => {
    allow()
    stubClients(null)
    mockToken.mockResolvedValue('user-token')
    mockPages.mockResolvedValue([{ id: '999', name: 'Other Page' }])

    const res = await PATCH(patchRequest({ page_id: CTS_PAGE }), params())

    // Saving still succeeds — the binding is legitimate, it just is not live yet.
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, reachable: false })
  })

  it('reports unknown rather than reachable when Meta is not connected', async () => {
    allow()
    stubClients(null)
    mockToken.mockResolvedValue(null)

    const res = await PATCH(patchRequest({ page_id: CTS_PAGE }), params())

    expect(await res.json()).toMatchObject({ reachable: null, pages_error: 'no_token' })
  })
})

describe('facebook-page — reading', () => {
  it('returns the pick-list so nobody has to hunt for a numeric id', async () => {
    allow()
    stubClients(CTS_PAGE)
    mockToken.mockResolvedValue('user-token')
    mockPages.mockResolvedValue([{ id: CTS_PAGE, name: 'CTS Tours NZ' }])

    const json = await (await GET(getRequest(), params())).json()

    expect(json).toMatchObject({
      page_id: CTS_PAGE,
      pages: [{ id: CTS_PAGE, name: 'CTS Tours NZ' }],
      pages_error: null,
    })
  })

  it('still returns the binding when Meta rejects the token', async () => {
    allow()
    stubClients(CTS_PAGE)
    mockToken.mockResolvedValue('stale-token')
    mockPages.mockResolvedValue(null)

    const res = await GET(getRequest(), params())

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      page_id: CTS_PAGE,
      pages: null,
      pages_error: 'meta_rejected',
    })
  })
})
