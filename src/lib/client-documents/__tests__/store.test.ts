// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => import('./fake-supabase'))

import { archiveCurrentDocument, getDocumentById, insertDocument, patchDocument, patchToUpdate } from '../store'
import { fakeDb, type Row } from './fake-supabase'

const CLIENT_A = '11111111-1111-4111-8111-111111111111'
const CLIENT_B = '22222222-2222-4222-8222-222222222222'
const DOC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DOC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NOW = new Date('2026-11-10T01:00:00.000Z')

function row(id: string, clientId: string, over: Row = {}): Row {
  return {
    id, client_id: clientId, category: 'sheet', title: 'T', description: null, version_label: null,
    visibility: 'client', status: 'current', storage_bucket: 'me-client-documents',
    storage_path: `${clientId}/${id}/file.pdf`, original_filename: 'file.pdf', mime_type: 'application/pdf',
    size_bytes: 10, sha256: id.replace(/-/g, '').padEnd(64, '0'), uploaded_by: 'ray@magiclab.test',
    replaces_id: null, created_at: '2026-11-09T00:00:00Z', archived_at: null, archived_by: null, ...over,
  }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  fakeDb.reset({ client_documents: [row(DOC_A, CLIENT_A), row(DOC_B, CLIENT_B)] })
})

describe('archiveCurrentDocument', () => {
  const rowOf = (id: string) => fakeDb.tables.client_documents.find(r => r.id === id)

  it('archives a current document of the same client and stamps who did it', async () => {
    const result = await archiveCurrentDocument(CLIENT_A, DOC_A, 'ray@magiclab.test')
    expect(result.ok).toBe(true)
    expect(rowOf(DOC_A)).toMatchObject({ status: 'archived', archived_by: 'ray@magiclab.test' })
    expect(rowOf(DOC_A)?.archived_at).toBeTruthy()
  })

  it('does not touch a document that belongs to another client, even with its real id', async () => {
    const result = await archiveCurrentDocument(CLIENT_A, DOC_B, 'ray@magiclab.test')
    expect(result.ok).toBe(true)
    expect(rowOf(DOC_B)).toMatchObject({ status: 'current', archived_at: null, archived_by: null })
  })

  it('leaves an already archived document (and its original stamp) alone', async () => {
    fakeDb.reset({ client_documents: [row(DOC_A, CLIENT_A, { status: 'archived', archived_at: '2026-11-01T00:00:00Z', archived_by: 'first@magiclab.test' })] })
    await archiveCurrentDocument(CLIENT_A, DOC_A, 'second@magiclab.test')
    expect(rowOf(DOC_A)).toMatchObject({ archived_at: '2026-11-01T00:00:00Z', archived_by: 'first@magiclab.test' })
  })

  it('reports a database failure instead of pretending it worked', async () => {
    fakeDb.failNext('client_documents', 'update', { message: 'down' })
    expect((await archiveCurrentDocument(CLIENT_A, DOC_A, 'x@magiclab.test')).ok).toBe(false)
  })
})

describe('patchToUpdate', () => {
  it('writes only what was sent', () => {
    expect(patchToUpdate({}, 'a@b.test', NOW)).toEqual({})
    expect(patchToUpdate({ title: 'New', versionLabel: null }, 'a@b.test', NOW)).toEqual({ title: 'New', version_label: null })
    expect(patchToUpdate({ category: 'price', visibility: 'client', description: 'd' }, 'a@b.test', NOW))
      .toEqual({ category: 'price', visibility: 'client', description: 'd' })
  })

  it('stamps who and when on archive, and clears both on restore', () => {
    expect(patchToUpdate({ status: 'archived' }, 'a@b.test', NOW))
      .toEqual({ status: 'archived', archived_at: '2026-11-10T01:00:00.000Z', archived_by: 'a@b.test' })
    expect(patchToUpdate({ status: 'current' }, 'a@b.test', NOW))
      .toEqual({ status: 'current', archived_at: null, archived_by: null })
  })
})

describe('patchDocument: archiving', () => {
  const rowOf = (id: string) => fakeDb.tables.client_documents.find(r => r.id === id)
  const STAMP = { status: 'archived', archived_at: '2026-11-01T00:00:00Z', archived_by: 'first@magiclab.test' }

  it('stamps a current file with who and when', async () => {
    const result = await patchDocument(CLIENT_A, DOC_A, { status: 'archived' }, 'ray@magiclab.test')
    expect(result.ok).toBe(true)
    expect(rowOf(DOC_A)).toMatchObject({ status: 'archived', archived_by: 'ray@magiclab.test' })
  })

  it('never re-stamps a file that is already archived, but still applies the other fields', async () => {
    fakeDb.reset({ client_documents: [row(DOC_A, CLIENT_A, STAMP)] })
    const result = await patchDocument(CLIENT_A, DOC_A, { status: 'archived', title: 'Renamed' }, 'second@magiclab.test')
    expect(result).toMatchObject({ ok: true, data: { title: 'Renamed', archived_by: 'first@magiclab.test' } })
    expect(rowOf(DOC_A)).toMatchObject({ title: 'Renamed', archived_at: '2026-11-01T00:00:00Z', archived_by: 'first@magiclab.test' })
  })

  it('returns an archived file unchanged when the request carries nothing else', async () => {
    fakeDb.reset({ client_documents: [row(DOC_A, CLIENT_A, STAMP)] })
    const result = await patchDocument(CLIENT_A, DOC_A, { status: 'archived' }, 'second@magiclab.test')
    expect(result).toMatchObject({ ok: true, data: { id: DOC_A, archived_by: 'first@magiclab.test' } })
  })

  it('finds nothing for another client\'s file, and changes nothing', async () => {
    expect(await patchDocument(CLIENT_A, DOC_B, { status: 'archived', title: 'Hacked' }, 'x@magiclab.test')).toEqual({ ok: true, data: null })
    expect(rowOf(DOC_B)).toMatchObject({ title: 'T', status: 'current' })
  })
})

describe('getDocumentById', () => {
  it('reads one file of this client with the internal columns, and nothing of another client', async () => {
    const own = await getDocumentById(CLIENT_A, DOC_A)
    expect(own).toMatchObject({ ok: true, data: { id: DOC_A, uploaded_by: 'ray@magiclab.test' } })
    expect(Object.keys(own.ok && own.data ? own.data : {})).not.toContain('storage_path')
    expect(await getDocumentById(CLIENT_A, DOC_B)).toEqual({ ok: true, data: null })
  })
})

describe('database failures say whether the statement may have happened', () => {
  const NEW_DOC = {
    id: DOC_A, client_id: CLIENT_A, category: 'sheet' as const, title: 'T', description: null, version_label: null,
    visibility: 'internal' as const, storage_path: `${CLIENT_A}/${DOC_A}/file.pdf`, original_filename: 'file.pdf',
    mime_type: 'application/pdf', size_bytes: 10, sha256: 'f'.repeat(64), uploaded_by: 'ray@magiclab.test', replaces_id: null,
  }

  it.each([
    ['23505', { duplicate: true, ambiguous: false }],
    ['23514', { duplicate: false, ambiguous: false }],
    ['42P01', { duplicate: false, ambiguous: false }],
    ['', { duplicate: false, ambiguous: true }],
    ['PGRST301', { duplicate: false, ambiguous: true }],
    ['08006', { duplicate: false, ambiguous: true }],
    ['57P01', { duplicate: false, ambiguous: true }],
    ['40001', { duplicate: false, ambiguous: false }],
  ])('code "%s"', async (code, expected) => {
    fakeDb.reset({ client_documents: [] })
    fakeDb.failNext('client_documents', 'insert', { message: 'boom', code })
    expect(await insertDocument(NEW_DOC)).toMatchObject({ ok: false, ...expected })
  })

  it('a failure without any code at all is ambiguous too', async () => {
    fakeDb.reset({ client_documents: [] })
    fakeDb.failNext('client_documents', 'insert', { message: 'fetch failed' })
    expect(await insertDocument(NEW_DOC)).toMatchObject({ ok: false, ambiguous: true, duplicate: false })
  })
})
