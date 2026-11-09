// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => import('./fake-supabase'))

import { archiveCurrentDocument, patchToUpdate } from '../store'
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
