import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

vi.mock('@/lib/tour-catalog/access', () => ({
  requireCatalogAdmin: vi.fn(),
}))

vi.mock('@/lib/tour-catalog/store', () => ({
  listChanges: vi.fn(),
}))

import { requireCatalogAdmin } from '@/lib/tour-catalog/access'
import { listChanges } from '@/lib/tour-catalog/store'
import { GET as changesGET } from '../changes/route'

const requireCatalogAdminMock = vi.mocked(requireCatalogAdmin)
const listChangesMock = vi.mocked(listChanges)

const CLIENT_ID = 'client-1'
const UUID_A = '11111111-1111-1111-1111-111111111111'
const UUID_B = '22222222-2222-2222-2222-222222222222'

function makeRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/test${query}`, { method: 'GET' })
}

function makeParams(): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: CLIENT_ID }) }
}

function allowAccess(): void {
  requireCatalogAdminMock.mockResolvedValue({ ok: true, actor: 'admin@example.com' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /tour-catalog/changes', () => {
  it('returns 200 with the mapped changes', async () => {
    allowAccess()
    const changes = [
      {
        id: 'c1',
        entity: 'tour',
        entityId: UUID_A,
        action: 'update',
        before: null,
        after: { name: 'x' },
        actor: 'admin@example.com',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ]
    listChangesMock.mockResolvedValue(changes as never)

    const res = await changesGET(makeRequest(`?entityId=${UUID_A}`), makeParams())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ changes })
    expect(listChangesMock).toHaveBeenCalledWith({}, CLIENT_ID, [UUID_A], 50)
  })

  it('passes repeated entityId params through in order', async () => {
    allowAccess()
    listChangesMock.mockResolvedValue([] as never)

    await changesGET(
      makeRequest(`?entityId=${UUID_A}&entityId=${UUID_B}`),
      makeParams(),
    )
    expect(listChangesMock).toHaveBeenCalledWith({}, CLIENT_ID, [UUID_A, UUID_B], 50)
  })

  it('ignores ids that do not look like a uuid', async () => {
    allowAccess()
    listChangesMock.mockResolvedValue([] as never)

    await changesGET(
      makeRequest(`?entityId=not-a-uuid&entityId=${UUID_A}&entityId=123`),
      makeParams(),
    )
    expect(listChangesMock).toHaveBeenCalledWith({}, CLIENT_ID, [UUID_A], 50)
  })

  it('caps the number of ids at 50', async () => {
    allowAccess()
    listChangesMock.mockResolvedValue([] as never)

    const ids = Array.from(
      { length: 60 },
      (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    )
    const query = ids.map((id) => `entityId=${id}`).join('&')

    await changesGET(makeRequest(`?${query}`), makeParams())
    const passed = listChangesMock.mock.calls[0][2]
    expect(passed).toHaveLength(50)
    expect(passed).toEqual(ids.slice(0, 50))
  })

  it('returns 200 with an empty list when no entityId is provided', async () => {
    allowAccess()
    listChangesMock.mockResolvedValue([] as never)

    const res = await changesGET(makeRequest(''), makeParams())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ changes: [] })
    expect(listChangesMock).toHaveBeenCalledWith({}, CLIENT_ID, [], 50)
  })

  it('returns 500 changes_failed without echoing the error when listChanges throws', async () => {
    allowAccess()
    listChangesMock.mockRejectedValue(new Error('db_down'))

    const res = await changesGET(makeRequest(`?entityId=${UUID_A}`), makeParams())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'changes_failed' })
  })

  it('passes through the access denial response', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
    })
    requireCatalogAdminMock.mockResolvedValue({
      ok: false,
      response: denied as never,
    })

    const res = await changesGET(makeRequest(`?entityId=${UUID_A}`), makeParams())
    expect(res.status).toBe(403)
    expect(listChangesMock).not.toHaveBeenCalled()
  })
})
