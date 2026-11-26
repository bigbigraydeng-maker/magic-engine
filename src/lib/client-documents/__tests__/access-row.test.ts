// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { AccessTier } from '@/lib/auth/access-types'
import { actorOf, scopeForTier } from '../access'
import { toDocumentRow, toDocumentRows, toDownloadTarget, toIdTitle } from '../row'

const RAW = {
  id: 'd1',
  category: 'brochure',
  title: 'Brochure',
  description: null,
  version_label: 'v11',
  visibility: 'client',
  status: 'current',
  original_filename: 'brochure.pdf',
  mime_type: 'application/pdf',
  size_bytes: 1531841,
  created_at: '2026-11-10T00:00:00Z',
  uploaded_by: 'ray@example.test',
  replaces_id: null,
  archived_at: null,
  archived_by: null,
}

describe('scopeForTier', () => {
  it('maps tiers to what they may see, and gives everyone else nothing', () => {
    const cases: Array<[AccessTier, string | null]> = [
      ['admin', 'all'],
      ['paid_client', 'client_visible'],
      ['self_serve', null],
      ['portal_only', null],
    ]
    for (const [tier, scope] of cases) expect(scopeForTier(tier)).toBe(scope)
  })
})

describe('actorOf', () => {
  it('prefers the lower-cased email and falls back to the user id', () => {
    expect(actorOf({ id: 'u1', email: ' Ray@Example.TEST ' })).toBe('ray@example.test')
    expect(actorOf({ id: 'u1', email: null })).toBe('u1')
    expect(actorOf({ id: 'u1' })).toBe('u1')
  })
})

describe('toDocumentRow', () => {
  it('copies only whitelisted columns, so storage_path and the bucket can never leak', () => {
    const row = toDocumentRow({ ...RAW, storage_path: 'secret/path.pdf', storage_bucket: 'b', sha256: 'abc', client_id: 'c' }, 'all')
    expect(row).not.toBeNull()
    expect(Object.keys(row ?? {})).not.toContain('storage_path')
    expect(Object.keys(row ?? {})).not.toContain('storage_bucket')
    expect(Object.keys(row ?? {})).not.toContain('sha256')
    expect(Object.keys(row ?? {})).not.toContain('client_id')
  })

  it('hides who uploaded and archived from the client scope', () => {
    const client = toDocumentRow(RAW, 'client_visible')
    expect(client).not.toBeNull()
    for (const key of ['uploaded_by', 'replaces_id', 'archived_at', 'archived_by']) {
      expect(Object.keys(client ?? {})).not.toContain(key)
    }
    expect(toDocumentRow(RAW, 'all')).toMatchObject({ uploaded_by: 'ray@example.test', replaces_id: null })
  })

  it('reads bigint sizes sent as strings and refuses malformed rows', () => {
    expect(toDocumentRow({ ...RAW, size_bytes: '2048' }, 'all')?.size_bytes).toBe(2048)
    expect(toDocumentRow({ ...RAW, size_bytes: 'big' }, 'all')).toBeNull()
    expect(toDocumentRow({ ...RAW, visibility: 'public' }, 'all')).toBeNull()
    expect(toDocumentRow({ ...RAW, status: 'deleted' }, 'all')).toBeNull()
    expect(toDocumentRow({ ...RAW, title: undefined }, 'all')).toBeNull()
    expect(toDocumentRow(null, 'all')).toBeNull()
    expect(toDocumentRow('row', 'all')).toBeNull()
  })

  it('rejects a whole list when any row is malformed', () => {
    expect(toDocumentRows([RAW, RAW], 'all')).toHaveLength(2)
    expect(toDocumentRows([RAW, { ...RAW, id: 5 }], 'all')).toBeNull()
    expect(toDocumentRows({ not: 'a list' }, 'all')).toBeNull()
    expect(toDocumentRows([], 'all')).toEqual([])
  })
})

describe('toDownloadTarget / toIdTitle', () => {
  it('keeps only the columns each lookup needs', () => {
    expect(toDownloadTarget({ id: 'd1', storage_path: 'p', original_filename: 'f.pdf', title: 'x' }))
      .toEqual({ id: 'd1', storage_path: 'p', original_filename: 'f.pdf' })
    expect(toDownloadTarget({ id: 'd1' })).toBeNull()
    expect(toIdTitle({ id: 'd1', title: 'T', extra: 1 })).toEqual({ id: 'd1', title: 'T' })
    expect(toIdTitle({ id: 'd1' })).toBeNull()
  })
})
