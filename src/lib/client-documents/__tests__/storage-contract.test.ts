// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => import('./fake-supabase'))

import {
  DOCUMENTS_BUCKET,
  FILE_TYPES,
  MAX_DOCUMENT_BYTES,
  SIGNED_URL_TTL_SECONDS,
} from '../constants'
import { safeStorageName } from '../files'
import {
  buildStoragePath,
  createDownloadUrl,
  pathBelongsTo,
  removeDocumentFile,
  uploadDocumentFile,
} from '../storage'
import { fakeDb } from './fake-supabase'

const CLIENT_A = '11111111-1111-4111-8111-111111111111'
const CLIENT_B = '22222222-2222-4222-8222-222222222222'
const DOC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MIGRATION = readFileSync(
  path.resolve(__dirname, '../../../../supabase/migrations/20261110140000_client_documents.sql'),
  'utf8',
)

beforeEach(() => fakeDb.reset())

describe('storage paths', () => {
  it('builds <client>/<doc>/<name> in lower case', () => {
    expect(buildStoragePath(CLIENT_A.toUpperCase(), DOC.toUpperCase(), 'a.pdf')).toBe(`${CLIENT_A}/${DOC}/a.pdf`)
  })

  it('accepts only the exact client and document it was built for', () => {
    const good = buildStoragePath(CLIENT_A, DOC, 'a.pdf')
    expect(pathBelongsTo(good, CLIENT_A, DOC)).toBe(true)
    expect(pathBelongsTo(good, CLIENT_B, DOC)).toBe(false)
    expect(pathBelongsTo(good, CLIENT_A, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBe(false)
  })

  it('rejects traversal, missing or extra segments and odd file names', () => {
    for (const bad of [
      `${CLIENT_A}/${DOC}/../x.pdf`,
      `${CLIENT_A}/${DOC}/a/b.pdf`,
      `${CLIENT_A}/${DOC}`,
      `${CLIENT_A}/${DOC}/`,
      `${CLIENT_A}/${DOC}/.hidden.pdf`,
      `${CLIENT_A}/${DOC}/a b.pdf`,
      `/${CLIENT_A}/${DOC}/a.pdf`,
      `other/${DOC}/a.pdf`,
      '',
    ]) {
      expect(pathBelongsTo(bad, CLIENT_A, DOC)).toBe(false)
    }
  })
})

describe('storage calls', () => {
  it('uploads into the private documents bucket without overwriting', async () => {
    const error = await uploadDocumentFile(`${CLIENT_A}/${DOC}/a.pdf`, Buffer.from('x'), 'application/pdf')
    expect(error).toBeNull()
    expect(fakeDb.storage.uploads).toEqual([
      { path: `${CLIENT_A}/${DOC}/a.pdf`, contentType: 'application/pdf', upsert: false, bucket: DOCUMENTS_BUCKET },
    ])
  })

  it('reports an upload failure as a message', async () => {
    fakeDb.storageFailures.upload = 'bucket not found'
    expect(await uploadDocumentFile('p', Buffer.from('x'), 'application/pdf')).toBe('bucket not found')
  })

  it('signs a 60-second link that forces a download under the original name', async () => {
    const result = await createDownloadUrl(`${CLIENT_A}/${DOC}/a.pdf`, 'Brochure v11.pdf')
    expect(result.ok).toBe(true)
    expect(fakeDb.storage.signed).toEqual([
      { path: `${CLIENT_A}/${DOC}/a.pdf`, ttl: SIGNED_URL_TTL_SECONDS, download: 'Brochure v11.pdf', bucket: DOCUMENTS_BUCKET },
    ])
    expect(SIGNED_URL_TTL_SECONDS).toBe(60)
  })

  it('returns an error instead of a link when signing fails', async () => {
    fakeDb.storageFailures.sign = 'Object not found'
    expect(await createDownloadUrl('p', 'a.pdf')).toEqual({ ok: false, error: 'Object not found' })
  })

  it('cleans up an object and never throws', async () => {
    await removeDocumentFile(`${CLIENT_A}/${DOC}/a.pdf`)
    expect(fakeDb.storage.removed).toEqual([`${CLIENT_A}/${DOC}/a.pdf`])
  })
})

describe('code and migration agree', () => {
  it('uses the same bucket, size limit and file types', () => {
    expect(MIGRATION).toContain(`'${DOCUMENTS_BUCKET}'`)
    expect(MIGRATION).toContain(String(MAX_DOCUMENT_BYTES))
    const mimeTypes = [...new Set(Object.values(FILE_TYPES))]
    for (const mime of mimeTypes) {
      // once in the table CHECK, once in the bucket's allowed list
      expect(MIGRATION.split(`'${mime}'`).length - 1).toBeGreaterThanOrEqual(2)
    }
    const listedInSql = [...MIGRATION.matchAll(/'((?:application|image)\/[a-z0-9.+-]+)'/g)].map(m => m[1])
    expect(new Set(listedInSql)).toEqual(new Set(mimeTypes))
  })

  it('accepts every path the code can build, and refuses paths for another client or document', () => {
    const sqlPattern = /storage_path ~ '([^']+)'/.exec(MIGRATION)?.[1]
    expect(sqlPattern).toBeTruthy()
    const shape = new RegExp(sqlPattern ?? '^$')
    for (const original of ['Best of China.pdf', '中国手册.pdf', '../../x.pdf', '.pdf', `${'x'.repeat(300)}.pdf`]) {
      expect(buildStoragePath(CLIENT_A, DOC, safeStorageName(original, 'pdf'))).toMatch(shape)
    }
    expect(`${CLIENT_A}/${DOC}/../x.pdf`).not.toMatch(shape)
    expect(`${CLIENT_A}/${DOC}/.hidden`).not.toMatch(shape)
  })

  it('keeps the bucket private and the table locked to the server', () => {
    expect(MIGRATION).toMatch(/false,\s*52428800/)
    expect(MIGRATION).toMatch(/set public = false/)
    expect(MIGRATION).not.toMatch(/public\s*=\s*true/i)
    expect(MIGRATION).toMatch(/enable row level security/)
    expect(MIGRATION).toMatch(/for all\s+to service_role/)
    expect(MIGRATION).toMatch(/revoke all on public\.client_documents from anon, authenticated/)
    expect(MIGRATION).toMatch(/check \(visibility in \('internal', 'client'\)\)/)
    expect(MIGRATION).toMatch(/visibility text not null default 'internal'/)
    expect(MIGRATION).toMatch(/where status = 'current'/)
  })
})
