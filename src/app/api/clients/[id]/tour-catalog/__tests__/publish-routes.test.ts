import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

vi.mock('@/lib/tour-catalog/access', () => ({
  requireCatalogAdmin: vi.fn(),
}))

vi.mock('@/lib/tour-catalog/store-publish', () => ({
  buildPublishPreview: vi.fn(),
  publishDraft: vi.fn(),
  buildRevertPreview: vi.fn(),
  revertPublished: vi.fn(),
  listPublishedVersions: vi.fn(),
}))

vi.mock('@/lib/tour-catalog/dates', () => ({
  todayIso: () => '2026-10-10',
}))

import { requireCatalogAdmin } from '@/lib/tour-catalog/access'
import {
  buildPublishPreview,
  publishDraft,
  buildRevertPreview,
  revertPublished,
  listPublishedVersions,
} from '@/lib/tour-catalog/store-publish'
import { GET as publishGET, POST as publishPOST } from '../publish/route'
import { GET as historyGET } from '../publish/history/route'
import { GET as revertGET, POST as revertPOST } from '../publish/revert/route'

const requireCatalogAdminMock = vi.mocked(requireCatalogAdmin)
const buildPublishPreviewMock = vi.mocked(buildPublishPreview)
const publishDraftMock = vi.mocked(publishDraft)
const buildRevertPreviewMock = vi.mocked(buildRevertPreview)
const revertPublishedMock = vi.mocked(revertPublished)
const listPublishedVersionsMock = vi.mocked(listPublishedVersions)

const CLIENT_ID = 'client-1'

function makeParams(): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: CLIENT_ID }) }
}

function makeGet(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/test${query}`, { method: 'GET' })
}

function makePost(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/test', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function makeRawPost(raw: string): NextRequest {
  return new NextRequest('http://localhost/api/test', { method: 'POST', body: raw })
}

function allowAccess(): void {
  requireCatalogAdminMock.mockResolvedValue({ ok: true, actor: 'admin@example.com' })
}

function denyAccess(): void {
  requireCatalogAdminMock.mockResolvedValue({
    ok: false,
    response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
  })
}

const VALID_PUBLISH_BODY = {
  draftVersion: 5,
  publishedVersion: 2,
  diffHash: 'abc',
  acknowledgeHighRisk: true,
  acknowledgeAfterRevert: false,
  confirmSellableCount: null,
  note: 'hello',
}

const VALID_REVERT_BODY = {
  version: 1,
  publishedVersion: 2,
  diffHash: 'abc',
  acknowledgeHighRisk: true,
  confirmSellableCount: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /tour-catalog/publish', () => {
  it('returns 403 and does not call the library when access is denied', async () => {
    denyAccess()
    const res = await publishGET(makeGet(), makeParams())
    expect(res.status).toBe(403)
    expect(buildPublishPreviewMock).not.toHaveBeenCalled()
  })

  it('returns 200 with the preview and calls the library with the right args', async () => {
    allowAccess()
    const preview = { publishedVersion: 2, draftVersion: 5, changes: [] }
    buildPublishPreviewMock.mockResolvedValue(preview as never)

    const res = await publishGET(makeGet(), makeParams())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(preview)
    expect(buildPublishPreviewMock).toHaveBeenCalledWith({}, CLIENT_ID, '2026-10-10')
  })

  it('returns 500 publish_failed when the library throws', async () => {
    allowAccess()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    buildPublishPreviewMock.mockRejectedValue(new Error('db_down'))

    const res = await publishGET(makeGet(), makeParams())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'publish_failed' })
  })
})

describe('POST /tour-catalog/publish', () => {
  it('returns 403 and does not call the library when access is denied', async () => {
    denyAccess()
    const res = await publishPOST(makePost(VALID_PUBLISH_BODY), makeParams())
    expect(res.status).toBe(403)
    expect(publishDraftMock).not.toHaveBeenCalled()
  })

  it('returns 200 with the version and passes the parsed body through', async () => {
    allowAccess()
    publishDraftMock.mockResolvedValue({ ok: true, version: 3 })

    const res = await publishPOST(makePost(VALID_PUBLISH_BODY), makeParams())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, version: 3 })
    expect(publishDraftMock).toHaveBeenCalledWith(
      {},
      CLIENT_ID,
      VALID_PUBLISH_BODY,
      'admin@example.com',
      '2026-10-10',
    )
  })

  it('returns 400 invalid_request for invalid JSON', async () => {
    allowAccess()
    const res = await publishPOST(makeRawPost('{not json'), makeParams())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_request' })
    expect(publishDraftMock).not.toHaveBeenCalled()
  })

  it.each([
    ['missing diffHash', { ...VALID_PUBLISH_BODY, diffHash: undefined }],
    ['draftVersion as a string', { ...VALID_PUBLISH_BODY, draftVersion: '5' }],
    ['negative publishedVersion', { ...VALID_PUBLISH_BODY, publishedVersion: -1 }],
    ['acknowledgeHighRisk as a string', { ...VALID_PUBLISH_BODY, acknowledgeHighRisk: 'yes' }],
    ['confirmSellableCount 1.5', { ...VALID_PUBLISH_BODY, confirmSellableCount: 1.5 }],
    ['body is an array', [VALID_PUBLISH_BODY]],
  ])('returns 400 invalid_request for %s', async (_label, body) => {
    allowAccess()
    const res = await publishPOST(makePost(body), makeParams())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_request' })
    expect(publishDraftMock).not.toHaveBeenCalled()
  })

  it('cuts a 600-character note to 500 characters', async () => {
    allowAccess()
    publishDraftMock.mockResolvedValue({ ok: true, version: 3 })
    const longNote = 'x'.repeat(600)

    await publishPOST(makePost({ ...VALID_PUBLISH_BODY, note: longNote }), makeParams())
    const passed = publishDraftMock.mock.calls[0][2]
    expect(passed.note).toHaveLength(500)
    expect(passed.note).toBe('x'.repeat(500))
  })

  it('treats a missing note as an empty string', async () => {
    allowAccess()
    publishDraftMock.mockResolvedValue({ ok: true, version: 3 })
    const { note: _note, ...withoutNote } = VALID_PUBLISH_BODY

    await publishPOST(makePost(withoutNote), makeParams())
    const passed = publishDraftMock.mock.calls[0][2]
    expect(passed.note).toBe('')
  })

  it.each([
    ['stale', 409],
    ['nothing_to_publish', 400],
    ['high_risk_unacknowledged', 400],
    ['after_revert_unacknowledged', 400],
    ['sellable_count_mismatch', 400],
    ['publish_failed', 500],
  ] as const)('maps error %s to status %i', async (code, status) => {
    allowAccess()
    publishDraftMock.mockResolvedValue({ ok: false, error: code })

    const res = await publishPOST(makePost(VALID_PUBLISH_BODY), makeParams())
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: code })
  })

  it('returns 500 publish_failed without echoing the thrown message', async () => {
    allowAccess()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    publishDraftMock.mockRejectedValue(new Error('secret_db_error'))

    const res = await publishPOST(makePost(VALID_PUBLISH_BODY), makeParams())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'publish_failed' })
    expect(JSON.stringify(body)).not.toContain('secret_db_error')
  })
})

describe('GET /tour-catalog/publish/history', () => {
  it('returns 403 and does not call the library when access is denied', async () => {
    denyAccess()
    const res = await historyGET(makeGet(), makeParams())
    expect(res.status).toBe(403)
    expect(listPublishedVersionsMock).not.toHaveBeenCalled()
  })

  it('returns 200 with the versions and calls the library with the right args', async () => {
    allowAccess()
    const versions = [{ version: 2, isCurrent: true }]
    listPublishedVersionsMock.mockResolvedValue(versions as never)

    const res = await historyGET(makeGet(), makeParams())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ versions })
    expect(listPublishedVersionsMock).toHaveBeenCalledWith({}, CLIENT_ID, 50)
  })

  it('returns 500 publish_failed when the library throws', async () => {
    allowAccess()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    listPublishedVersionsMock.mockRejectedValue(new Error('db_down'))

    const res = await historyGET(makeGet(), makeParams())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'publish_failed' })
  })
})

describe('GET /tour-catalog/publish/revert', () => {
  it('returns 403 and does not call the library when access is denied', async () => {
    denyAccess()
    const res = await revertGET(makeGet('?version=1'), makeParams())
    expect(res.status).toBe(403)
    expect(buildRevertPreviewMock).not.toHaveBeenCalled()
  })

  it('returns 200 with the preview and calls the library with the right args', async () => {
    allowAccess()
    const preview = { targetVersion: 1, publishedVersion: 2, changes: [] }
    buildRevertPreviewMock.mockResolvedValue(preview as never)

    const res = await revertGET(makeGet('?version=1'), makeParams())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(preview)
    expect(buildRevertPreviewMock).toHaveBeenCalledWith({}, CLIENT_ID, 1, '2026-10-10')
  })

  it.each([
    ['missing version', ''],
    ['non-numeric version', '?version=abc'],
    ['zero version', '?version=0'],
    ['negative version', '?version=-1'],
  ])('returns 400 invalid_request for %s', async (_label, query) => {
    allowAccess()
    const res = await revertGET(makeGet(query), makeParams())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_request' })
    expect(buildRevertPreviewMock).not.toHaveBeenCalled()
  })

  it.each([
    ['already_current', 400],
    ['version_not_found', 400],
  ] as const)('maps preview error %s to status %i', async (code, status) => {
    allowAccess()
    buildRevertPreviewMock.mockResolvedValue({ error: code } as never)

    const res = await revertGET(makeGet('?version=1'), makeParams())
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: code })
  })

  it('returns 500 publish_failed when the library throws', async () => {
    allowAccess()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    buildRevertPreviewMock.mockRejectedValue(new Error('db_down'))

    const res = await revertGET(makeGet('?version=1'), makeParams())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'publish_failed' })
  })
})

describe('POST /tour-catalog/publish/revert', () => {
  it('returns 403 and does not call the library when access is denied', async () => {
    denyAccess()
    const res = await revertPOST(makePost(VALID_REVERT_BODY), makeParams())
    expect(res.status).toBe(403)
    expect(revertPublishedMock).not.toHaveBeenCalled()
  })

  it('returns 200 with the version and passes the parsed body through', async () => {
    allowAccess()
    revertPublishedMock.mockResolvedValue({ ok: true, version: 4 })

    const res = await revertPOST(makePost(VALID_REVERT_BODY), makeParams())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, version: 4 })
    expect(revertPublishedMock).toHaveBeenCalledWith(
      {},
      CLIENT_ID,
      VALID_REVERT_BODY,
      'admin@example.com',
      '2026-10-10',
    )
  })

  it.each([
    ['version 0', { ...VALID_REVERT_BODY, version: 0 }],
    ['missing publishedVersion', { ...VALID_REVERT_BODY, publishedVersion: undefined }],
    ['empty diffHash', { ...VALID_REVERT_BODY, diffHash: '' }],
  ])('returns 400 invalid_request for %s', async (_label, body) => {
    allowAccess()
    const res = await revertPOST(makePost(body), makeParams())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_request' })
    expect(revertPublishedMock).not.toHaveBeenCalled()
  })

  it.each([
    ['stale', 409],
    ['already_current', 400],
    ['version_not_found', 400],
    ['high_risk_unacknowledged', 400],
    ['sellable_count_mismatch', 400],
    ['nothing_to_publish', 400],
    ['publish_failed', 500],
  ] as const)('maps error %s to status %i', async (code, status) => {
    allowAccess()
    revertPublishedMock.mockResolvedValue({ ok: false, error: code })

    const res = await revertPOST(makePost(VALID_REVERT_BODY), makeParams())
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: code })
  })

  it('returns 500 publish_failed when the library throws', async () => {
    allowAccess()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    revertPublishedMock.mockRejectedValue(new Error('db_down'))

    const res = await revertPOST(makePost(VALID_REVERT_BODY), makeParams())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'publish_failed' })
  })
})
