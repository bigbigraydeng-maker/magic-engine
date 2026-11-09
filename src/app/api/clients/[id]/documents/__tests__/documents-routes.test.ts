// @vitest-environment node
/**
 * Document library API — who can see, download, upload and edit what.
 * Runs the real routes, store and storage code against an in-memory stand-in for the database
 * and the private bucket, so the answers below come from what a request can actually reach.
 */
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ paid: vi.fn(), operator: vi.fn() }))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: mocks.paid,
  requireOperatorAccess: mocks.operator,
}))
vi.mock('@/lib/supabase', () => import('@/lib/client-documents/__tests__/fake-supabase'))

import { DOCUMENTS_BUCKET } from '@/lib/client-documents/constants'
import { fakeDb, type Row } from '@/lib/client-documents/__tests__/fake-supabase'
import { GET as listDocuments, POST as uploadDocument } from '../route'
import { PATCH as patchDocument } from '../[docId]/route'
import { GET as downloadDocument } from '../[docId]/download/route'

const CLIENT_A = '11111111-1111-4111-8111-111111111111'
const CLIENT_B = '22222222-2222-4222-8222-222222222222'
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`

const INTERNAL = { ok: true, tier: 'admin', role: 'admin', allowedClientId: null, user: { id: 'u-admin', email: 'Ray@MagicLab.test' } }
const MEMBER = { ok: true, tier: 'paid_client', role: 'client-viewer', allowedClientId: CLIENT_A, user: { id: 'u-member', email: 'lisa@cts.test' } }
const SELF_SERVE_PASSED = { ok: true, tier: 'self_serve', role: 'client-viewer', allowedClientId: CLIENT_A, user: { id: 'u-self', email: 's@x.test' } }
const UNAUTH = { ok: false, status: 401, error: 'Unauthorized', reason: 'unauthorized' }
const PAID_ONLY = { ok: false, status: 403, error: 'This feature requires a paid plan.', reason: 'paid_only' }
const FORBIDDEN = { ok: false, status: 403, error: 'Forbidden', reason: 'forbidden' }

function docRow(n: number, over: Row = {}): Row {
  const clientId = typeof over.client_id === 'string' ? over.client_id : CLIENT_A
  return {
    id: id(n), client_id: clientId, category: 'brochure', title: `Doc ${n}`, description: null, version_label: null,
    visibility: 'internal', status: 'current', storage_bucket: DOCUMENTS_BUCKET,
    storage_path: `${clientId}/${id(n)}/file.pdf`, original_filename: 'file.pdf', mime_type: 'application/pdf',
    size_bytes: 100, sha256: n.toString(16).padStart(64, '0'), uploaded_by: 'ray@magiclab.test', replaces_id: null,
    created_at: `2026-11-0${n}T00:00:00.000Z`, archived_at: null, archived_by: null, ...over,
  }
}

const SEED: Row[] = [
  docRow(1, { visibility: 'internal' }),
  docRow(2, { visibility: 'client' }),
  docRow(3, { visibility: 'client', status: 'archived', archived_at: '2026-11-05T00:00:00Z', archived_by: 'ray@magiclab.test' }),
  docRow(4, { visibility: 'internal', status: 'archived', archived_at: '2026-11-05T00:00:00Z', archived_by: 'ray@magiclab.test' }),
  docRow(5, { client_id: CLIENT_B, visibility: 'client' }),
]

const rows = () => fakeDb.tables.client_documents
const rowById = (n: number) => rows().find(row => row.id === id(n))
const ctx = (clientId: string) => ({ params: Promise.resolve({ id: clientId }) })
const docCtx = (clientId: string, docId: string) => ({ params: Promise.resolve({ id: clientId, docId }) })
const get = (path: string) => new NextRequest(`http://localhost${path}`)
const pdf = (text: string) => Buffer.from(`%PDF-1.7\n${text}`)

function uploadRequest(fields: Record<string, string>, file: { name: string; bytes: Buffer } | null, headers: Record<string, string> = {}): NextRequest {
  const form = new FormData()
  if (file) form.set('file', new File([new Uint8Array(file.bytes)], file.name, { type: 'application/octet-stream' }))
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  return new NextRequest(`http://localhost/api/clients/${CLIENT_A}/documents`, { method: 'POST', body: form, headers })
}

function patchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/x', { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  fakeDb.reset({ clients: [{ id: CLIENT_A }, { id: CLIENT_B }], client_documents: SEED })
  mocks.paid.mockResolvedValue(INTERNAL)
  mocks.operator.mockResolvedValue(INTERNAL)
})

describe('GET /documents (list)', () => {
  it('refuses a caller who is not logged in, before touching the database', async () => {
    mocks.paid.mockResolvedValue(UNAUTH)
    const res = await listDocuments(get(`/api/clients/${CLIENT_A}/documents`), ctx(CLIENT_A))
    expect(res.status).toBe(401)
    expect(fakeDb.queries).toEqual([])
  })

  it('refuses a self-serve account', async () => {
    mocks.paid.mockResolvedValue(PAID_ONLY)
    const res = await listDocuments(get(`/api/clients/${CLIENT_A}/documents`), ctx(CLIENT_A))
    expect(res.status).toBe(403)
    expect(fakeDb.queries).toEqual([])
  })

  it('fails closed if the paid guard ever lets a non-paid tier through', async () => {
    mocks.paid.mockResolvedValue(SELF_SERVE_PASSED)
    const res = await listDocuments(get(`/api/clients/${CLIENT_A}/documents`), ctx(CLIENT_A))
    expect(res.status).toBe(403)
    expect(fakeDb.queries).toEqual([])
  })

  it('shows an internal account every current file of THIS client and nothing from another client', async () => {
    const res = await listDocuments(get(`/api/clients/${CLIENT_A}/documents`), ctx(CLIENT_A))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.canManage).toBe(true)
    expect(body.documents.map((d: Row) => d.id).sort()).toEqual([id(1), id(2)])
    for (const doc of body.documents) {
      expect(doc.uploaded_by).toBe('ray@magiclab.test')
      expect(Object.keys(doc)).not.toContain('storage_path')
    }
  })

  it('adds archived versions for an internal account only when asked', async () => {
    const res = await listDocuments(get(`/api/clients/${CLIENT_A}/documents?includeArchived=1`), ctx(CLIENT_A))
    const body = await res.json()
    expect(body.documents.map((d: Row) => d.id).sort()).toEqual([id(1), id(2), id(3), id(4)])
  })

  it('shows a client member only current files marked visible to the client', async () => {
    mocks.paid.mockResolvedValue(MEMBER)
    const res = await listDocuments(get(`/api/clients/${CLIENT_A}/documents?includeArchived=1`), ctx(CLIENT_A))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.canManage).toBe(false)
    expect(body.documents.map((d: Row) => d.id)).toEqual([id(2)])
    expect(Object.keys(body.documents[0])).not.toContain('uploaded_by')
    expect(Object.keys(body.documents[0])).not.toContain('storage_path')
  })

  it('answers 404 for an id that is not a client id, and 500 with a clear code when the table is missing', async () => {
    expect((await listDocuments(get('/x'), ctx('cts-client'))).status).toBe(404)
    fakeDb.failNext('client_documents', 'select', { message: 'relation does not exist', code: '42P01' })
    const res = await listDocuments(get('/x'), ctx(CLIENT_A))
    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('client_documents_unavailable')
  })
})

describe('GET /documents/[docId]/download', () => {
  it('refuses callers who are not logged in or not on a paid plan, without signing anything', async () => {
    for (const refusal of [UNAUTH, PAID_ONLY]) {
      mocks.paid.mockResolvedValue(refusal)
      const res = await downloadDocument(get('/x'), docCtx(CLIENT_A, id(2)))
      expect(res.status).toBe(refusal.status)
    }
    expect(fakeDb.storage.signed).toEqual([])
  })

  it('fails closed if the paid guard ever lets a non-paid tier through', async () => {
    mocks.paid.mockResolvedValue(SELF_SERVE_PASSED)
    const res = await downloadDocument(get('/x'), docCtx(CLIENT_A, id(2)))
    expect(res.status).toBe(403)
    expect(fakeDb.queries).toEqual([])
    expect(fakeDb.storage.signed).toEqual([])
  })

  it('sends a client member to a 60-second signed link for a file marked visible to the client', async () => {
    mocks.paid.mockResolvedValue(MEMBER)
    const res = await downloadDocument(get('/x'), docCtx(CLIENT_A, id(2)))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain(`/sign/${DOCUMENTS_BUCKET}/${CLIENT_A}/${id(2)}/file.pdf`)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(fakeDb.storage.signed).toEqual([
      { path: `${CLIENT_A}/${id(2)}/file.pdf`, ttl: 60, download: 'file.pdf', bucket: DOCUMENTS_BUCKET },
    ])
  })

  it('answers 404, not 403, when a client member asks for an internal or archived file', async () => {
    mocks.paid.mockResolvedValue(MEMBER)
    for (const n of [1, 3, 4]) {
      const res = await downloadDocument(get('/x'), docCtx(CLIENT_A, id(n)))
      expect(res.status).toBe(404)
    }
    expect(fakeDb.storage.signed).toEqual([])
  })

  it('lets an internal account download internal and archived files', async () => {
    for (const n of [1, 4]) {
      const res = await downloadDocument(get('/x'), docCtx(CLIENT_A, id(n)))
      expect(res.status).toBe(302)
    }
    expect(fakeDb.storage.signed).toHaveLength(2)
  })

  it('never serves another client\'s file through this client\'s URL, for members and internal alike', async () => {
    mocks.paid.mockResolvedValue(MEMBER)
    expect((await downloadDocument(get('/x'), docCtx(CLIENT_A, id(5)))).status).toBe(404)
    mocks.paid.mockResolvedValue(INTERNAL)
    expect((await downloadDocument(get('/x'), docCtx(CLIENT_A, id(5)))).status).toBe(404)
    expect((await downloadDocument(get('/x'), docCtx(CLIENT_B, id(2)))).status).toBe(404)
    expect(fakeDb.storage.signed).toEqual([])
  })

  it('answers 404 for an unknown id and for ids that are not UUIDs (no database read for the latter)', async () => {
    expect((await downloadDocument(get('/x'), docCtx(CLIENT_A, id(99)))).status).toBe(404)
    fakeDb.queries = []
    expect((await downloadDocument(get('/x'), docCtx(CLIENT_A, '../../etc/passwd'))).status).toBe(404)
    expect((await downloadDocument(get('/x'), docCtx('not-a-client', id(2)))).status).toBe(404)
    expect(fakeDb.queries).toEqual([])
  })

  it('refuses to sign a stored path that does not belong to the client and document it came from', async () => {
    rows().push(docRow(6, { visibility: 'client', storage_path: `${CLIENT_B}/${id(6)}/file.pdf` }))
    rows().push(docRow(7, { visibility: 'client', storage_path: `${CLIENT_A}/${id(1)}/file.pdf` }))
    for (const n of [6, 7]) {
      const res = await downloadDocument(get('/x'), docCtx(CLIENT_A, id(n)))
      expect(res.status).toBe(500)
    }
    expect(fakeDb.storage.signed).toEqual([])
  })

  it('answers 500 without a redirect when the link cannot be signed', async () => {
    fakeDb.storageFailures.sign = 'Object not found'
    const res = await downloadDocument(get('/x'), docCtx(CLIENT_A, id(2)))
    expect(res.status).toBe(500)
    expect(res.headers.get('location')).toBeNull()
    expect(JSON.stringify(await res.json())).not.toContain('storage.example.test')
  })
})

describe('POST /documents (upload)', () => {
  it('refuses a client member and an anonymous caller, and stores nothing', async () => {
    for (const refusal of [FORBIDDEN, UNAUTH]) {
      mocks.operator.mockResolvedValue(refusal)
      const res = await uploadDocument(uploadRequest({}, { name: 'a.pdf', bytes: pdf('one') }), ctx(CLIENT_A))
      expect(res.status).toBe(refusal.status)
    }
    expect(fakeDb.storage.uploads).toEqual([])
    expect(rows()).toHaveLength(SEED.length)
  })

  it('stores a valid PDF as internal-only by default and never returns the storage path', async () => {
    const res = await uploadDocument(uploadRequest({}, { name: 'CTS Brochure v11.pdf', bytes: pdf('one') }), ctx(CLIENT_A))
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.document).toMatchObject({ title: 'CTS Brochure v11', category: 'other', visibility: 'internal', status: 'current', original_filename: 'CTS Brochure v11.pdf', mime_type: 'application/pdf' })
    expect(Object.keys(body.document)).not.toContain('storage_path')

    expect(fakeDb.storage.uploads).toHaveLength(1)
    const [stored] = fakeDb.storage.uploads
    expect(stored.bucket).toBe(DOCUMENTS_BUCKET)
    expect(stored.contentType).toBe('application/pdf')
    expect(stored.upsert).toBe(false)
    expect(stored.path).toBe(`${CLIENT_A}/${body.document.id}/CTS_Brochure_v11.pdf`)
    const saved = rows().find(row => row.id === body.document.id)
    expect(saved).toMatchObject({ client_id: CLIENT_A, uploaded_by: 'ray@magiclab.test', size_bytes: pdf('one').length })
  })

  it('saves the fields it was given', async () => {
    const res = await uploadDocument(
      uploadRequest({ title: 'Best of China', category: 'sheet', visibility: 'client', versionLabel: 'v11', description: 'one page' }, { name: 'a.pdf', bytes: pdf('two') }),
      ctx(CLIENT_A),
    )
    expect((await res.json()).document).toMatchObject({ title: 'Best of China', category: 'sheet', visibility: 'client', version_label: 'v11', description: 'one page' })
  })

  it('refuses files that are not what they claim to be, and stores nothing', async () => {
    const cases: Array<[string, Buffer]> = [['run.exe', pdf('x')], ['page.html', pdf('x')], ['photo.png', pdf('x')], ['x.pdf', Buffer.from('not a pdf')]]
    for (const [name, bytes] of cases) {
      const res = await uploadDocument(uploadRequest({}, { name, bytes }), ctx(CLIENT_A))
      expect(res.status).toBe(400)
    }
    expect((await uploadDocument(uploadRequest({}, null), ctx(CLIENT_A))).status).toBe(400)
    expect((await uploadDocument(uploadRequest({ category: 'secret' }, { name: 'a.pdf', bytes: pdf('y') }), ctx(CLIENT_A))).status).toBe(400)
    expect(fakeDb.storage.uploads).toEqual([])
    expect(rows()).toHaveLength(SEED.length)
  })

  it('refuses an oversized request from its declared length, before reading the body', async () => {
    const res = await uploadDocument(
      uploadRequest({}, { name: 'a.pdf', bytes: pdf('z') }, { 'content-length': String(60 * 1024 * 1024) }),
      ctx(CLIENT_A),
    )
    expect(res.status).toBe(413)
    expect(fakeDb.queries).toEqual([])
    expect(fakeDb.storage.uploads).toEqual([])
  })

  it('refuses a file whose content is already a current file for this client, but allows it after that one is archived', async () => {
    const same = pdf('duplicate')
    expect((await uploadDocument(uploadRequest({}, { name: 'a.pdf', bytes: same }), ctx(CLIENT_A))).status).toBe(201)
    const again = await uploadDocument(uploadRequest({}, { name: 'b.pdf', bytes: same }), ctx(CLIENT_A))
    expect(again.status).toBe(409)
    expect((await again.json()).code).toBe('duplicate_content')
    expect(fakeDb.storage.uploads).toHaveLength(1)

    const first = rows().find(row => row.title === 'a')
    expect(first).toBeTruthy()
    Object.assign(first ?? {}, { status: 'archived', archived_at: '2026-11-10T00:00:00Z' })
    expect((await uploadDocument(uploadRequest({}, { name: 'c.pdf', bytes: same }), ctx(CLIENT_A))).status).toBe(201)
  })

  it('allows the same content for a different client: duplicates are only refused inside one client', async () => {
    const same = pdf('shared content')
    rows().push(docRow(9, { client_id: CLIENT_B, sha256: createHash('sha256').update(same).digest('hex') }))
    const res = await uploadDocument(uploadRequest({}, { name: 'a.pdf', bytes: same }), ctx(CLIENT_A))
    expect(res.status).toBe(201)
  })

  it('answers 404 for an unknown client or a malformed client id, and 500 when the lookup fails', async () => {
    fakeDb.tables.clients = []
    expect((await uploadDocument(uploadRequest({}, { name: 'a.pdf', bytes: pdf('q') }), ctx(CLIENT_A))).status).toBe(404)
    expect((await uploadDocument(uploadRequest({}, { name: 'a.pdf', bytes: pdf('q') }), ctx('cts-client'))).status).toBe(404)
    fakeDb.failNext('clients', 'select', { message: 'down' })
    expect((await uploadDocument(uploadRequest({}, { name: 'a.pdf', bytes: pdf('q') }), ctx(CLIENT_A))).status).toBe(500)
    expect(fakeDb.storage.uploads).toEqual([])
  })

  it('replaces a current file with a new version: new row points at the old one, old one is archived by the uploader', async () => {
    const res = await uploadDocument(uploadRequest({ replaceId: id(2), visibility: 'client' }, { name: 'v12.pdf', bytes: pdf('v12') }), ctx(CLIENT_A))
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.warning).toBeUndefined()
    expect(body.document.replaces_id).toBe(id(2))
    expect(rowById(2)).toMatchObject({ status: 'archived', archived_by: 'ray@magiclab.test' })
    expect(rowById(2)?.archived_at).toBeTruthy()
  })

  it('refuses to replace a file of another client, an archived file, or one that does not exist', async () => {
    for (const target of [id(5), id(3), id(99)]) {
      const res = await uploadDocument(uploadRequest({ replaceId: target }, { name: 'n.pdf', bytes: pdf(`n${target}`) }), ctx(CLIENT_A))
      expect(res.status).toBe(404)
    }
    expect(fakeDb.storage.uploads).toEqual([])
    expect(rowById(5)).toMatchObject({ status: 'current', client_id: CLIENT_B })
  })

  it('removes the stored file again when the row cannot be written', async () => {
    fakeDb.failNext('client_documents', 'insert', { message: 'boom' })
    const res = await uploadDocument(uploadRequest({}, { name: 'a.pdf', bytes: pdf('rollback') }), ctx(CLIENT_A))
    expect(res.status).toBe(500)
    expect(fakeDb.storage.uploads).toHaveLength(1)
    expect(fakeDb.storage.removed).toEqual([fakeDb.storage.uploads[0].path])
    expect(fakeDb.objects.size).toBe(0)
    expect(rows()).toHaveLength(SEED.length)
  })

  it('treats a race on the unique index as a duplicate and still removes the stored file', async () => {
    fakeDb.failNext('client_documents', 'insert', { message: 'duplicate key', code: '23505' })
    const res = await uploadDocument(uploadRequest({}, { name: 'a.pdf', bytes: pdf('race') }), ctx(CLIENT_A))
    expect(res.status).toBe(409)
    expect(fakeDb.objects.size).toBe(0)
  })

  it('writes no row when the file itself cannot be stored', async () => {
    fakeDb.storageFailures.upload = 'bucket not found'
    const res = await uploadDocument(uploadRequest({}, { name: 'a.pdf', bytes: pdf('nobucket') }), ctx(CLIENT_A))
    expect(res.status).toBe(500)
    expect(rows()).toHaveLength(SEED.length)
  })

  it('still reports success, with a warning, when only archiving the old version fails', async () => {
    fakeDb.failNext('client_documents', 'update', { message: 'boom' })
    const res = await uploadDocument(uploadRequest({ replaceId: id(2) }, { name: 'v13.pdf', bytes: pdf('v13') }), ctx(CLIENT_A))
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.warning).toContain('旧版')
    expect(rowById(2)?.status).toBe('current')
  })
})

describe('PATCH /documents/[docId] (edit, archive, restore)', () => {
  it('refuses a client member and an anonymous caller, and changes nothing', async () => {
    for (const refusal of [FORBIDDEN, UNAUTH]) {
      mocks.operator.mockResolvedValue(refusal)
      const res = await patchDocument(patchRequest({ title: 'Hacked' }), docCtx(CLIENT_A, id(2)))
      expect(res.status).toBe(refusal.status)
    }
    expect(rowById(2)?.title).toBe('Doc 2')
  })

  it('edits the fields that were sent and leaves the rest alone', async () => {
    const res = await patchDocument(patchRequest({ title: ' Renamed ', visibility: 'internal', versionLabel: 'v12' }), docCtx(CLIENT_A, id(2)))
    expect(res.status).toBe(200)
    expect((await res.json()).document).toMatchObject({ id: id(2), title: 'Renamed', visibility: 'internal', version_label: 'v12', category: 'brochure' })
  })

  it('changes the category and the description when asked', async () => {
    const res = await patchDocument(patchRequest({ category: 'price', description: 'new text' }), docCtx(CLIENT_A, id(2)))
    expect((await res.json()).document).toMatchObject({ id: id(2), category: 'price', description: 'new text', title: 'Doc 2', visibility: 'client' })
  })

  it('cannot change ownership or storage through extra fields', async () => {
    await patchDocument(patchRequest({ title: 'ok', client_id: CLIENT_B, storage_path: 'x/y/z.pdf', sha256: 'f', uploaded_by: 'someone' }), docCtx(CLIENT_A, id(2)))
    expect(rowById(2)).toMatchObject({ client_id: CLIENT_A, storage_path: `${CLIENT_A}/${id(2)}/file.pdf`, uploaded_by: 'ray@magiclab.test' })
  })

  it('cannot reach another client\'s document through this client\'s URL', async () => {
    const res = await patchDocument(patchRequest({ title: 'Hacked', status: 'archived' }), docCtx(CLIENT_A, id(5)))
    expect(res.status).toBe(404)
    expect(rowById(5)).toMatchObject({ title: 'Doc 5', status: 'current' })
  })

  it('archives with who and when, and restores by clearing both', async () => {
    const archived = await patchDocument(patchRequest({ status: 'archived' }), docCtx(CLIENT_A, id(2)))
    expect((await archived.json()).document).toMatchObject({ status: 'archived', archived_by: 'ray@magiclab.test' })
    expect(rowById(2)?.archived_at).toBeTruthy()

    const restored = await patchDocument(patchRequest({ status: 'current' }), docCtx(CLIENT_A, id(2)))
    expect((await restored.json()).document).toMatchObject({ status: 'current', archived_at: null, archived_by: null })
  })

  it('refuses to restore an old version when the same content is already current', async () => {
    rows().push(docRow(8, { sha256: String(rowById(3)?.sha256), visibility: 'client' }))
    const res = await patchDocument(patchRequest({ status: 'current' }), docCtx(CLIENT_A, id(3)))
    expect(res.status).toBe(409)
    expect(rowById(3)?.status).toBe('archived')
  })

  it('answers 400 for a bad body, 404 for an unknown or malformed id, 500 when the table is missing', async () => {
    expect((await patchDocument(patchRequest({ status: 'deleted' }), docCtx(CLIENT_A, id(2)))).status).toBe(400)
    expect((await patchDocument(patchRequest({}), docCtx(CLIENT_A, id(2)))).status).toBe(400)
    const broken = new NextRequest('http://localhost/x', { method: 'PATCH', body: '{not json', headers: { 'content-type': 'application/json' } })
    expect((await patchDocument(broken, docCtx(CLIENT_A, id(2)))).status).toBe(400)
    expect((await patchDocument(patchRequest({ title: 'x' }), docCtx(CLIENT_A, id(99)))).status).toBe(404)
    expect((await patchDocument(patchRequest({ title: 'x' }), docCtx(CLIENT_A, 'nope'))).status).toBe(404)
    fakeDb.failNext('client_documents', 'update', { message: 'relation does not exist', code: '42P01' })
    expect((await patchDocument(patchRequest({ title: 'x' }), docCtx(CLIENT_A, id(2)))).status).toBe(500)
  })
})
