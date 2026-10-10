import { describe, it, expect, vi, beforeEach } from 'vitest'
import { adminAccess } from './access-fixtures'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

vi.mock('@/lib/tour-catalog/access', () => ({
  requireCatalogAccess: vi.fn(),
}))

vi.mock('@/lib/tour-catalog/store-edit', () => ({
  listChanges: vi.fn(),
  listChangesForTour: vi.fn(),
  listRecentChanges: vi.fn(),
}))

vi.mock('@/lib/tour-catalog/store-access', () => ({
  listMemberEmails: vi.fn(),
}))

vi.mock('@/lib/tour-catalog/store', () => ({
  loadDraftCatalog: vi.fn(),
}))

import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { listChanges, listChangesForTour, listRecentChanges } from '@/lib/tour-catalog/store-edit'
import { listMemberEmails } from '@/lib/tour-catalog/store-access'
import { loadDraftCatalog } from '@/lib/tour-catalog/store'
import { editorAccess } from './access-fixtures'
import { GET as changesGET } from '../changes/route'

const requireCatalogAccessMock = vi.mocked(requireCatalogAccess)
const listChangesMock = vi.mocked(listChanges)
const listChangesForTourMock = vi.mocked(listChangesForTour)
const listRecentChangesMock = vi.mocked(listRecentChanges)
const listMemberEmailsMock = vi.mocked(listMemberEmails)
const loadDraftCatalogMock = vi.mocked(loadDraftCatalog)

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
  requireCatalogAccessMock.mockResolvedValue(adminAccess('admin@example.com'))
}

beforeEach(() => {
  vi.clearAllMocks()
  listMemberEmailsMock.mockResolvedValue(new Set<string>())
  listRecentChangesMock.mockResolvedValue([])
  loadDraftCatalogMock.mockResolvedValue({ tours: [], departures: [], aliases: [] })
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

  it('with neither tourId nor entityId it returns the whole-catalog view, not an entity lookup', async () => {
    allowAccess()

    const res = await changesGET(makeRequest(''), makeParams())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ changes: [] })
    expect(listRecentChangesMock).toHaveBeenCalledWith({}, CLIENT_ID, 1000)
    expect(listChangesMock).not.toHaveBeenCalled()
    expect(listChangesForTourMock).not.toHaveBeenCalled()
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
    requireCatalogAccessMock.mockResolvedValue({
      ok: false,
      response: denied as never,
    })

    const res = await changesGET(makeRequest(`?entityId=${UUID_A}`), makeParams())
    expect(res.status).toBe(403)
    expect(listChangesMock).not.toHaveBeenCalled()
  })
})

describe('GET /tour-catalog/changes?tourId=', () => {
  it('returns the whole tour history (tour + all its departures, even deleted ones) for a valid tourId', async () => {
    requireCatalogAccessMock.mockResolvedValue(adminAccess('a@b.c'))
    listChangesForTourMock.mockResolvedValue([])
    const res = await changesGET(makeRequest(`?tourId=${UUID_A}&entityId=${UUID_B}`), { params: Promise.resolve({ id: CLIENT_ID }) })
    expect(res.status).toBe(200)
    expect(listChangesForTourMock).toHaveBeenCalledWith({}, CLIENT_ID, UUID_A, 50)
    expect(listChangesMock).not.toHaveBeenCalled()
  })

  it('ignores a malformed tourId and falls back to entityId lookup', async () => {
    requireCatalogAccessMock.mockResolvedValue(adminAccess('a@b.c'))
    listChangesMock.mockResolvedValue([])
    await changesGET(makeRequest(`?tourId=not-a-uuid&entityId=${UUID_B}`), { params: Promise.resolve({ id: CLIENT_ID }) })
    expect(listChangesForTourMock).not.toHaveBeenCalled()
    expect(listChangesMock).toHaveBeenCalledWith({}, CLIENT_ID, [UUID_B], 50)
  })
})

const BATCH = 'b0000000-0000-4000-8000-000000000001'

function logRow(partial: Record<string, unknown>) {
  return {
    id: 'c0',
    entity: 'tour',
    entityId: UUID_A,
    action: 'update',
    before: null,
    after: null,
    actor: 'edit by admin@example.com',
    createdAt: '2026-10-10T00:00:00Z',
    ...partial,
  }
}

describe('GET /tour-catalog/changes — whole catalog (no tourId)', () => {
  it('returns display-ready lines: source, tour name, a plain-Chinese summary, an import collapsed into one', async () => {
    allowAccess()
    loadDraftCatalogMock.mockResolvedValue({
      tours: [{ id: UUID_A, name: 'Golden China' }],
      departures: [],
      aliases: [],
    } as never)
    listRecentChangesMock.mockResolvedValue([
      logRow({
        id: 'c3',
        actor: 'edit by staff@cts.example (AI 助手)',
        before: { display_price_text: 'NZD $7,999' },
        after: { display_price_text: 'NZD $8,111' },
        createdAt: '2026-10-10T03:00:00Z',
      }),
      logRow({ id: 'c2', entity: 'departure', entityId: UUID_B, action: 'insert', actor: `import:${BATCH} by admin@example.com`, after: { tour_id: UUID_A, depart_on: '2027-03-11', status: 'open' }, createdAt: '2026-10-10T02:00:00Z' }),
      logRow({ id: 'c1', entity: 'departure', entityId: UUID_B, action: 'update', actor: `import:${BATCH} by admin@example.com`, after: { tour_id: UUID_A, depart_on: '2027-04-11', status: 'open' }, createdAt: '2026-10-10T02:00:00Z' }),
      logRow({ id: 'c0', actor: 'system', action: 'insert', after: { name: 'Golden China' }, createdAt: '2026-10-09T00:00:00Z' }),
    ] as never)

    const res = await changesGET(makeRequest(''), makeParams())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      changes: [
        { id: 'c3', createdAt: '2026-10-10T03:00:00Z', actorLabel: 'staff@cts.example', source: 'assistant', tourId: UUID_A, tourName: 'Golden China', summary: '展示价：NZD $7,999 → NZD $8,111' },
        { id: 'c2', createdAt: '2026-10-10T02:00:00Z', actorLabel: 'admin@example.com', source: 'import', tourId: UUID_A, tourName: 'Golden China', summary: '出团表导入：新增 1 个班期、更新 1 个' },
        { id: 'c0', createdAt: '2026-10-09T00:00:00Z', actorLabel: '系统', source: 'system', tourId: UUID_A, tourName: 'Golden China', summary: '新增团' },
      ],
    })
  })

  it('for a client editor, Magic Engine staff are masked and nothing internal appears', async () => {
    requireCatalogAccessMock.mockResolvedValue(editorAccess('staff@cts.example'))
    listMemberEmailsMock.mockResolvedValue(new Set(['staff@cts.example']))
    listRecentChangesMock.mockResolvedValue([
      logRow({ id: 'c2', actor: 'edit by admin@example.com', before: { name: 'A' }, after: { name: 'B' } }),
      logRow({ id: 'c1', actor: 'edit by staff@cts.example', before: { name: 'Z' }, after: { name: 'A' } }),
      logRow({ id: 'c0', entity: 'departure', entityId: UUID_B, actor: 'edit by admin@example.com', before: { tour_id: UUID_A, depart_on: '2027-03-11', status: 'open', internal: { airline: 'SECRET-AIR' } }, after: { tour_id: UUID_A, depart_on: '2027-03-11', status: 'open', internal: { airline: 'OTHER-AIR' } } }),
    ] as never)

    const res = await changesGET(makeRequest(''), makeParams())
    const text = await res.text()
    const body = JSON.parse(text) as { changes: Array<{ actorLabel: string }> }

    expect(body.changes.map((c) => c.actorLabel)).toEqual(['Magic Engine 团队', 'staff@cts.example', 'Magic Engine 团队'])
    expect(text).not.toContain('admin@example.com')
    expect(text).not.toContain('SECRET-AIR')
    expect(text).not.toContain('OTHER-AIR')
    expect(text).not.toContain('internal')
  })

  it('returns 500 changes_failed without the database text when the read fails', async () => {
    allowAccess()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    listRecentChangesMock.mockRejectedValue(new Error('relation "tour_catalog_change_log" does not exist'))
    const res = await changesGET(makeRequest(''), makeParams())
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('{"error":"changes_failed"}')
  })
})

describe('GET /tour-catalog/changes?tourId= — trimmed for a client editor', () => {
  const row = logRow({
    id: 'c9',
    entity: 'departure',
    entityId: UUID_B,
    actor: `import:${BATCH} by admin@example.com`,
    before: { tour_id: UUID_A, status: 'open', internal: { airline: 'SECRET-AIR' }, status_source: 'csv:x', status_as_of: 't0' },
    after: { tour_id: UUID_A, status: 'sold_out', internal: { airline: 'SECRET-AIR', capacity: 20 }, status_source: 'manual', status_as_of: 't1' },
  })

  it('removes internal / status_source / status_as_of from before and after, and masks the actor', async () => {
    requireCatalogAccessMock.mockResolvedValue(editorAccess('staff@cts.example'))
    listMemberEmailsMock.mockResolvedValue(new Set(['staff@cts.example']))
    listChangesForTourMock.mockResolvedValue([row] as never)

    const res = await changesGET(makeRequest(`?tourId=${UUID_A}`), makeParams())
    const text = await res.text()
    const body = JSON.parse(text) as { changes: Array<Record<string, unknown>> }

    expect(body.changes).toEqual([
      {
        ...row,
        before: { tour_id: UUID_A, status: 'open' },
        after: { tour_id: UUID_A, status: 'sold_out' },
        actor: `import:${BATCH} by Magic Engine 团队`,
      },
    ])
    expect(text).not.toContain('SECRET-AIR')
    expect(text).not.toContain('status_source')
    expect(text).not.toContain('status_as_of')
    expect(text).not.toContain('admin@example.com')
  })

  it('keeps a colleague\'s email visible to a client editor', async () => {
    requireCatalogAccessMock.mockResolvedValue(editorAccess('staff@cts.example'))
    listMemberEmailsMock.mockResolvedValue(new Set(['staff@cts.example', 'colleague@cts.example']))
    listChangesForTourMock.mockResolvedValue([logRow({ actor: 'edit by colleague@cts.example' })] as never)
    const res = await changesGET(makeRequest(`?tourId=${UUID_A}`), makeParams())
    const body = (await res.json()) as { changes: Array<{ actor: string }> }
    expect(body.changes[0].actor).toBe('edit by colleague@cts.example')
  })

  it('returns the rows untouched to a global admin', async () => {
    allowAccess()
    listChangesForTourMock.mockResolvedValue([row] as never)
    const res = await changesGET(makeRequest(`?tourId=${UUID_A}`), makeParams())
    expect(await res.json()).toEqual({ changes: [row] })
  })

  it('the entityId lookup is trimmed the same way', async () => {
    requireCatalogAccessMock.mockResolvedValue(editorAccess('staff@cts.example'))
    listChangesMock.mockResolvedValue([row] as never)
    const res = await changesGET(makeRequest(`?entityId=${UUID_B}`), makeParams())
    expect(await res.text()).not.toContain('SECRET-AIR')
  })
})

