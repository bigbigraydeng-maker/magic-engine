// @vitest-environment node
/**
 * Who can do what in the document library, with the REAL access guards.
 *
 * Nothing in the access path is mocked: the real requireDashboardClientAccess,
 * requirePaidClientAccess and requireOperatorAccess run, reading the real admin lists from the
 * environment and the membership rows from a table-shaped stand-in. Only the sign-in session and
 * the database client underneath them are replaced. (The route tests next door replace the guards
 * with mocks, which proves what the routes do with a guard's answer; this file proves the answers.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const world = vi.hoisted(() => ({ sessionEmail: null as string | null, hasSession: false }))

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: world.hasSession ? { id: 'user-1', email: world.sessionEmail } : null } }),
    },
  }),
}))
vi.mock('@/lib/supabase', () => import('@/lib/client-documents/__tests__/fake-supabase'))

import { fakeDb, type Row } from '@/lib/client-documents/__tests__/fake-supabase'
import { GET as listDocuments, POST as uploadDocument } from '../route'
import { PATCH as patchDocument } from '../[docId]/route'
import { GET as downloadDocument } from '../[docId]/download/route'

const CLIENT_A = '11111111-1111-4111-8111-111111111111'
const CLIENT_B = '22222222-2222-4222-8222-222222222222'
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`

function docRow(n: number, clientId: string, over: Row = {}): Row {
  return {
    id: id(n), client_id: clientId, category: 'brochure', title: `Doc ${n}`, description: null, version_label: null,
    visibility: 'internal', status: 'current', storage_bucket: 'me-client-documents',
    storage_path: `${clientId}/${id(n)}/file.pdf`, original_filename: 'file.pdf', mime_type: 'application/pdf',
    size_bytes: 100, sha256: n.toString(16).padStart(64, '0'), uploaded_by: 'ray@magiclab.test', replaces_id: null,
    created_at: `2026-11-0${n}T00:00:00.000Z`, archived_at: null, archived_by: null, ...over,
  }
}

const DOCS: Row[] = [
  docRow(1, CLIENT_A, { visibility: 'internal' }),
  docRow(2, CLIENT_A, { visibility: 'client' }),
  docRow(3, CLIENT_A, { visibility: 'client', status: 'archived', archived_at: '2026-11-05T00:00:00Z', archived_by: 'ray@magiclab.test' }),
  docRow(4, CLIENT_A, { visibility: 'internal', status: 'archived', archived_at: '2026-11-05T00:00:00Z', archived_by: 'ray@magiclab.test' }),
  docRow(5, CLIENT_B, { visibility: 'client' }),
]

type Kind = 'anonymous' | 'internal' | 'member' | 'refused'
interface Account {
  email: string | null
  env?: Record<string, string>
  rows?: Array<{ client_id: string; access_type: string; scoped_admin?: boolean }>
  /** What this account is, for client A. */
  kind: Kind
  /** Does it also get in for client B? */
  internalForB?: boolean
  /** Its own client is B (covered by its own test below). */
  belongsToB?: boolean
}

const ACCOUNTS: Record<string, Account> = {
  'not signed in': { email: null, kind: 'anonymous' },
  'global admin (ADMIN_EMAILS)': { email: 'ray@magiclab.test', env: { ADMIN_EMAILS: 'ray@magiclab.test' }, kind: 'internal', internalForB: true },
  'global admin (ADMIN_EMAIL_DOMAIN)': { email: 'dev@magiclab.test', env: { ADMIN_EMAIL_DOMAIN: 'magiclab.test' }, kind: 'internal', internalForB: true },
  'demo admin of client A (DEMO_ADMINS)': { email: 'demo@x.test', env: { DEMO_ADMINS: `demo@x.test:${CLIENT_A}` }, kind: 'internal' },
  'scoped admin of client A (database)': { email: 'fde@x.test', rows: [{ client_id: CLIENT_A, access_type: 'fde', scoped_admin: true }], kind: 'internal' },
  'fde member row of client A': { email: 'fdemember@cts.test', rows: [{ client_id: CLIENT_A, access_type: 'fde', scoped_admin: false }], kind: 'member' },
  'client row of client A': { email: 'lisa@cts.test', rows: [{ client_id: CLIENT_A, access_type: 'client' }], kind: 'member' },
  'dashboard row of client A': { email: 'd@cts.test', rows: [{ client_id: CLIENT_A, access_type: 'dashboard' }], kind: 'member' },
  'both row of client A': { email: 'b@cts.test', rows: [{ client_id: CLIENT_A, access_type: 'both' }], kind: 'member' },
  'self-serve row of client A': { email: 's@cts.test', rows: [{ client_id: CLIENT_A, access_type: 'self_serve' }], kind: 'refused' },
  'portal-only row of client A': { email: 'p@cts.test', rows: [{ client_id: CLIENT_A, access_type: 'portal' }], kind: 'refused' },
  'client row of client B only': { email: 'bob@other.test', rows: [{ client_id: CLIENT_B, access_type: 'client' }], kind: 'refused', belongsToB: true },
  'signed in but known nowhere': { email: 'nobody@nowhere.test', kind: 'refused' },
}

const ENV_KEYS = ['ADMIN_EMAILS', 'ADMIN_EMAIL_DOMAIN', 'DEMO_ADMINS', 'CLIENT_VIEWERS']
const saved: Record<string, string | undefined> = {}

function signIn(account: Account): void {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, account.env ?? {})
  world.hasSession = account.email !== null
  world.sessionEmail = account.email
  const rows = (account.rows ?? []).map(row => ({ email: account.email, scoped_admin: false, ...row }))
  fakeDb.reset({ clients: [{ id: CLIENT_A }, { id: CLIENT_B }], client_documents: DOCS, client_portal_users: rows })
}

const ctx = (clientId: string) => ({ params: Promise.resolve({ id: clientId }) })
const docCtx = (clientId: string, docId: string) => ({ params: Promise.resolve({ id: clientId, docId }) })
const get = () => new NextRequest('http://localhost/x')
const patch = (body: unknown) => new NextRequest('http://localhost/x', { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const pdf = (text: string) => Buffer.from(`%PDF-1.7\n${text}`)
function upload(clientId: string, text: string): NextRequest {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(pdf(text))], 'a.pdf'))
  return new NextRequest(`http://localhost/api/clients/${clientId}/documents`, { method: 'POST', body: form })
}

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key]
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

const names = Object.keys(ACCOUNTS)

describe.each(names)('%s', name => {
  const account = ACCOUNTS[name]

  it('sees exactly what its kind of account may see in client A', async () => {
    signIn(account)
    const res = await listDocuments(get(), ctx(CLIENT_A))
    if (account.kind === 'anonymous') return expect(res.status).toBe(401)
    if (account.kind === 'refused') return expect(res.status).toBe(403)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.canManage).toBe(account.kind === 'internal')
    const ids = body.documents.map((d: Row) => d.id).sort()
    expect(ids).toEqual(account.kind === 'internal' ? [id(1), id(2)] : [id(2)])
    for (const doc of body.documents) {
      expect(Object.keys(doc)).not.toContain('storage_path')
      expect(Object.keys(doc).includes('uploaded_by')).toBe(account.kind === 'internal')
    }
  })

  it('downloads what it may, gets 404 for what it may not, and nothing from another client', async () => {
    signIn(account)
    const internalFile = await downloadDocument(get(), docCtx(CLIENT_A, id(1)))
    const clientFile = await downloadDocument(get(), docCtx(CLIENT_A, id(2)))
    const archivedClientFile = await downloadDocument(get(), docCtx(CLIENT_A, id(3)))
    const otherClientsFile = await downloadDocument(get(), docCtx(CLIENT_A, id(5)))
    if (account.kind === 'anonymous') {
      expect([internalFile, clientFile].map(r => r.status)).toEqual([401, 401])
    } else if (account.kind === 'refused') {
      expect([internalFile, clientFile].map(r => r.status)).toEqual([403, 403])
    } else if (account.kind === 'internal') {
      expect([internalFile, clientFile, archivedClientFile].map(r => r.status)).toEqual([302, 302, 302])
    } else {
      expect([internalFile.status, clientFile.status, archivedClientFile.status]).toEqual([404, 302, 404])
    }
    expect(otherClientsFile.status).not.toBe(302)
  })

  it('may upload and edit only if it is internal', async () => {
    signIn(account)
    const uploaded = await uploadDocument(upload(CLIENT_A, `by ${name}`), ctx(CLIENT_A))
    const edited = await patchDocument(patch({ title: 'Renamed' }), docCtx(CLIENT_A, id(2)))
    if (account.kind === 'internal') {
      expect([uploaded.status, edited.status]).toEqual([201, 200])
    } else {
      expect(uploaded.status).toBe(account.kind === 'anonymous' ? 401 : 403)
      expect(edited.status).toBe(account.kind === 'anonymous' ? 401 : 403)
      expect(fakeDb.storage.uploads).toEqual([])
      expect(fakeDb.tables.client_documents.find(r => r.id === id(2))?.title).toBe('Doc 2')
    }
  })

  it('reaches client B only if it is a global admin', async () => {
    if (account.belongsToB) return
    signIn(account)
    const list = await listDocuments(get(), ctx(CLIENT_B))
    const file = await downloadDocument(get(), docCtx(CLIENT_B, id(5)))
    if (account.internalForB) {
      expect([list.status, file.status]).toEqual([200, 302])
    } else {
      expect([list.status, file.status]).toEqual(account.kind === 'anonymous' ? [401, 401] : [403, 403])
    }
  })
})

describe('client B\'s own member', () => {
  it('sees client B\'s client-visible file, and cannot use client A\'s address', async () => {
    signIn(ACCOUNTS['client row of client B only'])
    const own = await listDocuments(get(), ctx(CLIENT_B))
    expect((await own.json()).documents.map((d: Row) => d.id)).toEqual([id(5)])
    expect((await downloadDocument(get(), docCtx(CLIENT_B, id(5)))).status).toBe(302)
    expect((await downloadDocument(get(), docCtx(CLIENT_B, id(2)))).status).toBe(404)
    expect((await listDocuments(get(), ctx(CLIENT_A))).status).toBe(403)
  })
})

describe('an upper-case client id in the address', () => {
  const CLIENT_L = 'abcdef12-3456-4789-8abc-def012345678'

  function signInAsMemberOfL(): void {
    signIn({ email: 'lisa@cts.test', rows: [{ client_id: CLIENT_L, access_type: 'client' }], kind: 'member' })
    fakeDb.tables.clients.push({ id: CLIENT_L })
    fakeDb.tables.client_documents.push(docRow(9, CLIENT_L, { visibility: 'client' }))
  }

  it('works in the spelling the member was registered with', async () => {
    signInAsMemberOfL()
    expect(CLIENT_L.toUpperCase()).not.toBe(CLIENT_L)
    const res = await listDocuments(get(), ctx(CLIENT_L))
    expect(res.status).toBe(200)
    expect((await res.json()).documents.map((d: Row) => d.id)).toEqual([id(9)])
  })

  it('is refused for a member when spelled in upper case (the guard compares ids exactly: it fails closed)', async () => {
    signInAsMemberOfL()
    expect((await listDocuments(get(), ctx(CLIENT_L.toUpperCase()))).status).toBe(403)
    expect((await downloadDocument(get(), docCtx(CLIENT_L.toUpperCase(), id(9)))).status).toBe(403)
    expect(fakeDb.storage.signed).toEqual([])
  })
})

describe('a session with no e-mail address while an admin list has an empty entry', () => {
  it('is NOT let in by this feature (the shared guard alone would treat it as an administrator)', async () => {
    signIn({ email: '', env: { ADMIN_EMAILS: 'ray@magiclab.test,' }, kind: 'refused' })
    for (const res of [
      await listDocuments(get(), ctx(CLIENT_A)),
      await downloadDocument(get(), docCtx(CLIENT_A, id(1))),
      await uploadDocument(upload(CLIENT_A, 'empty email'), ctx(CLIENT_A)),
      await patchDocument(patch({ title: 'x' }), docCtx(CLIENT_A, id(1))),
    ]) {
      expect(res.status).toBe(403)
    }
    expect(fakeDb.storage.uploads).toEqual([])
    expect(fakeDb.storage.signed).toEqual([])
  })
})
