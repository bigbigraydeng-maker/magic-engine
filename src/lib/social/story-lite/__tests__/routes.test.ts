/**
 * Draft tests for the three Story lite routes (preview / authorize / revoke).
 *
 * The route files live at src/app/api/clients/[id]/story-lite/[packId]/<verb>/route.ts.
 * The import specifiers below use the placeholder prefix `ROUTES/` so a later move can
 * rewrite them with a single sed. Everything else is real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { GET as previewGET } from '../../../../app/api/clients/[id]/story-lite/[packId]/preview/route'
import { POST as authorizePOST } from '../../../../app/api/clients/[id]/story-lite/[packId]/authorize/route'
import { POST as revokePOST } from '../../../../app/api/clients/[id]/story-lite/[packId]/revoke/route'

import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { createLiteServicePorts } from '@/lib/social/story-lite/ports'
import { InMemoryLiteStore } from '@/lib/social/story-lite/in-memory-store'
import type { LiteServicePorts } from '@/lib/social/story-lite/service'
import type { NewLiteItem } from '@/lib/social/story-lite/types'

vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))
vi.mock('@/lib/social/story-lite/ports', () => ({ createLiteServicePorts: vi.fn() }))

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const PACK_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const PAGE_ID = '1234567890'
const SLOT_1 = '2026-10-12T23:00:00.000Z'
const SLOT_2 = '2026-10-13T23:00:00.000Z'

const adminAccess = {
  ok: true,
  user: { id: USER_ID, email: 'pm@example.com' },
  role: 'admin',
  tier: 'admin',
  allowedClientId: null,
}

function liteItem(overrides: Partial<NewLiteItem> = {}): NewLiteItem {
  const base: NewLiteItem = {
    item_id: '44444444-4444-4444-8444-444444444444',
    channel: 'facebook_story',
    slot_at: SLOT_1,
    media_kind: 'image',
    media_url: 'https://cdn.example.com/a.jpg',
    media_sha256: 'a'.repeat(64),
    text_line: 'Hello world',
    account_id: PAGE_ID,
    source_ref: 'https://example.com/page',
  }
  return { ...base, ...overrides }
}

function makePorts(store: InMemoryLiteStore): LiteServicePorts {
  return {
    store,
    adminEmails: new Set(['pm@example.com']),
    checkFile: async () => 'OK',
    sendEvent: vi.fn(async () => {}),
  }
}

function seedGreenStore(): InMemoryLiteStore {
  const store = new InMemoryLiteStore()
  store.seedClient(CLIENT_ID, { facebook_page_id: PAGE_ID, client_status: 'active' })
  const items: NewLiteItem[] = [
    liteItem(),
    liteItem({
      item_id: '55555555-5555-4555-8555-555555555555',
      slot_at: SLOT_2,
      media_url: 'https://cdn.example.com/b.jpg',
      media_sha256: 'b'.repeat(64),
      text_line: 'Second line',
    }),
  ]
  void store.insertPack({ id: PACK_ID, client_id: CLIENT_ID, title: 'Weekly pack', now: new Date('2026-10-11T00:00:00.000Z') }, items)
  return store
}

let store: InMemoryLiteStore
let ports: LiteServicePorts

beforeEach(() => {
  // the routes use the real clock: pin it before the fixed slots so "slot in the past" never fires
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-11T23:00:00.000Z'))
  vi.clearAllMocks()
  store = seedGreenStore()
  ports = makePorts(store)
  vi.mocked(createLiteServicePorts).mockReturnValue(ports)
  vi.mocked(requireDashboardClientAccess).mockResolvedValue(
    adminAccess as Awaited<ReturnType<typeof requireDashboardClientAccess>>,
  )
})

afterEach(() => {
  vi.useRealTimers()
})

function params(id: string = CLIENT_ID, packId: string = PACK_ID) {
  return { params: { id, packId } }
}

function jsonRequest(method: string, body?: unknown, url = 'http://localhost/x'): NextRequest {
  return new NextRequest(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

/** A confirmation body carrying the hash its own preview returned. */
async function confirmBody(extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const preview = await previewGET(jsonRequest('GET'), params())
  const body = (await preview.json()) as { content_hash?: string }
  return { confirm: true, content_hash: body.content_hash, ...extra }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

describe('story lite routes — id and access guards', () => {
  it('preview returns 400 BAD_ID for a non-UUID client id without calling access', async () => {
    const res = await previewGET(jsonRequest('GET'), params('not-a-uuid'))
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ success: false, error: 'BAD_ID' })
    expect(requireDashboardClientAccess).not.toHaveBeenCalled()
  })

  it('preview returns 400 BAD_ID for a non-UUID pack id without calling access', async () => {
    const res = await previewGET(jsonRequest('GET'), params(CLIENT_ID, 'nope'))
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ success: false, error: 'BAD_ID' })
    expect(requireDashboardClientAccess).not.toHaveBeenCalled()
  })

  it('authorize returns 400 BAD_ID for a non-UUID client id', async () => {
    const res = await authorizePOST(jsonRequest('POST', {}), params('bad'))
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ success: false, error: 'BAD_ID' })
    expect(requireDashboardClientAccess).not.toHaveBeenCalled()
  })

  it('authorize returns 400 BAD_ID for a non-UUID pack id', async () => {
    const res = await authorizePOST(jsonRequest('POST', {}), params(CLIENT_ID, 'bad'))
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ success: false, error: 'BAD_ID' })
    expect(requireDashboardClientAccess).not.toHaveBeenCalled()
  })

  it('revoke returns 400 BAD_ID for a non-UUID client id', async () => {
    const res = await revokePOST(jsonRequest('POST', { reason: 'x' }), params('bad'))
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ success: false, error: 'BAD_ID' })
    expect(requireDashboardClientAccess).not.toHaveBeenCalled()
  })

  it('revoke returns 400 BAD_ID for a non-UUID pack id', async () => {
    const res = await revokePOST(jsonRequest('POST', { reason: 'x' }), params(CLIENT_ID, 'bad'))
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ success: false, error: 'BAD_ID' })
    expect(requireDashboardClientAccess).not.toHaveBeenCalled()
  })

  it('passes through a 401 access failure', async () => {
    vi.mocked(requireDashboardClientAccess).mockResolvedValue({
      ok: false,
      status: 401,
      error: 'UNAUTHENTICATED',
    } as Awaited<ReturnType<typeof requireDashboardClientAccess>>)
    const res = await previewGET(jsonRequest('GET'), params())
    expect(res.status).toBe(401)
    expect(await readJson(res)).toEqual({ success: false, error: 'UNAUTHENTICATED' })
  })

  it('passes through a 402 access failure', async () => {
    vi.mocked(requireDashboardClientAccess).mockResolvedValue({
      ok: false,
      status: 402,
      error: 'PAYMENT_REQUIRED',
    } as Awaited<ReturnType<typeof requireDashboardClientAccess>>)
    const res = await previewGET(jsonRequest('GET'), params())
    expect(res.status).toBe(402)
    expect(await readJson(res)).toEqual({ success: false, error: 'PAYMENT_REQUIRED' })
  })

  it('rejects a non-admin signed-in user with 403 GLOBAL_ADMIN_REQUIRED', async () => {
    vi.mocked(requireDashboardClientAccess).mockResolvedValue({
      ok: true,
      user: { id: USER_ID, email: 'someone@example.com' },
      role: 'client-viewer',
      tier: 'paid_client',
      allowedClientId: null,
    } as Awaited<ReturnType<typeof requireDashboardClientAccess>>)
    const res = await previewGET(jsonRequest('GET'), params())
    expect(res.status).toBe(403)
    expect(await readJson(res)).toEqual({ success: false, error: 'GLOBAL_ADMIN_REQUIRED' })
  })

  it('rejects a limited admin with 403 GLOBAL_ADMIN_REQUIRED', async () => {
    vi.mocked(requireDashboardClientAccess).mockResolvedValue({
      ok: true,
      user: { id: USER_ID, email: 'pm@example.com' },
      role: 'admin',
      tier: 'admin',
      allowedClientId: 'other',
    } as Awaited<ReturnType<typeof requireDashboardClientAccess>>)
    const res = await previewGET(jsonRequest('GET'), params())
    expect(res.status).toBe(403)
    expect(await readJson(res)).toEqual({ success: false, error: 'GLOBAL_ADMIN_REQUIRED' })
  })
})

describe('preview GET', () => {
  it('returns the green pack preview', async () => {
    const res = await previewGET(jsonRequest('GET'), params())
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.success).toBe(true)
    expect(body.pack_id).toBe(PACK_ID)
    expect(Array.isArray(body.items)).toBe(true)
    expect((body.items as unknown[]).length).toBe(2)
    expect(body.can_authorize).toBe(true)
    expect(typeof body.content_hash).toBe('string')
    expect(body.content_hash as string).toMatch(/^[0-9a-f]{64}$/)
  })

  it('?check_files=0 is the fast look: skips the picture re-check, says so, and the full preview still checks', async () => {
    const checkFile = vi.fn(async () => 'CHANGED' as const)
    vi.mocked(createLiteServicePorts).mockReturnValue({ ...ports, checkFile })
    const quick = await readJson(await previewGET(jsonRequest('GET', undefined, 'http://localhost/x?check_files=0'), params()))
    expect(checkFile).not.toHaveBeenCalled()
    expect(quick.files_checked).toBe(false)
    expect(quick.can_authorize).toBe(true) // unchecked: the page must not authorise on this
    const full = await readJson(await previewGET(jsonRequest('GET'), params()))
    expect(checkFile).toHaveBeenCalledTimes(2)
    expect(full.files_checked).toBeUndefined()
    expect(full.can_authorize).toBe(false) // the real check catches the changed file
  })

  it('returns 400 BAD_EXPIRY for lifetime_days=0', async () => {
    const res = await previewGET(jsonRequest('GET', undefined, 'http://localhost/x?lifetime_days=0'), params())
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ success: false, error: 'BAD_EXPIRY' })
  })

  it('returns 400 BAD_EXPIRY for lifetime_days=abc', async () => {
    const res = await previewGET(jsonRequest('GET', undefined, 'http://localhost/x?lifetime_days=abc'), params())
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ success: false, error: 'BAD_EXPIRY' })
  })

  it('returns 404 PACK_NOT_FOUND for an unknown pack', async () => {
    const res = await previewGET(jsonRequest('GET'), params(CLIENT_ID, '99999999-9999-4999-8999-999999999999'))
    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ success: false, error: 'PACK_NOT_FOUND' })
  })
})

describe('authorize POST', () => {
  it('returns a PREVIEW and writes nothing when the body is empty', async () => {
    const res = await authorizePOST(jsonRequest('POST', {}), params())
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.success).toBe(true)
    expect(body.mode).toBe('PREVIEW')
    expect(store.allPacks()[0].authorized_at).toBeNull()
    expect(ports.sendEvent).not.toHaveBeenCalled()
  })

  it('authorises the pack when confirm is true', async () => {
    const res = await authorizePOST(jsonRequest('POST', await confirmBody()), params())
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.success).toBe(true)
    expect(body.mode).toBe('AUTHORIZED')
    expect(body.provider_impact).toBe('NONE')

    expect(store.allPacks()[0].authorized_at).not.toBeNull()
    for (const item of store.allItems()) {
      expect(item.authorized_fingerprint).not.toBeNull()
    }
    expect(ports.sendEvent).toHaveBeenCalledTimes(1)
  })

  it('returns 409 ALREADY_AUTHORIZED on a second authorise', async () => {
    const first = await authorizePOST(jsonRequest('POST', await confirmBody()), params())
    expect(first.status).toBe(200)

    const second = await authorizePOST(jsonRequest('POST', await confirmBody()), params())
    expect(second.status).toBe(409)
    expect(await readJson(second)).toMatchObject({ success: false, error: 'ALREADY_AUTHORIZED' })
  })

  it('returns 400 CONTENT_HASH_REQUIRED when confirm is true without a hash', async () => {
    const res = await authorizePOST(jsonRequest('POST', { confirm: true }), params())
    expect(res.status).toBe(400)
    expect(await readJson(res)).toMatchObject({ success: false, error: 'CONTENT_HASH_REQUIRED' })
  })

  it('returns 400 INVALID_AUTHORIZE_COMMAND for a malformed content_hash', async () => {
    const res = await authorizePOST(jsonRequest('POST', { confirm: true, content_hash: 'xyz' }), params())
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ success: false, error: 'INVALID_AUTHORIZE_COMMAND' })
  })

  it('returns 409 PACK_CHANGED_SINCE_PREVIEW for a stale hash', async () => {
    const res = await authorizePOST(jsonRequest('POST', { confirm: true, content_hash: 'a'.repeat(64) }), params())
    expect(res.status).toBe(409)
    expect(await readJson(res)).toMatchObject({ success: false, error: 'PACK_CHANGED_SINCE_PREVIEW' })
    expect(store.allPacks()[0].authorized_at).toBeNull()
  })

  it('returns 400 INVALID_AUTHORIZE_COMMAND for extra keys', async () => {
    const res = await authorizePOST(jsonRequest('POST', { confirm: true, extra: 1 }), params())
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ success: false, error: 'INVALID_AUTHORIZE_COMMAND' })
  })

  it('returns 400 INVALID_AUTHORIZE_COMMAND for lifetime_days=15', async () => {
    const res = await authorizePOST(jsonRequest('POST', { confirm: true, lifetime_days: 15 }), params())
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ success: false, error: 'INVALID_AUTHORIZE_COMMAND' })
  })
})

describe('revoke POST', () => {
  it('returns 400 INVALID_REVOKE_COMMAND when reason is missing', async () => {
    const res = await revokePOST(jsonRequest('POST', {}), params())
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ success: false, error: 'INVALID_REVOKE_COMMAND' })
  })

  it('returns 400 INVALID_REVOKE_COMMAND when reason is empty', async () => {
    const res = await revokePOST(jsonRequest('POST', { reason: '   ' }), params())
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ success: false, error: 'INVALID_REVOKE_COMMAND' })
  })

  it('returns 400 INVALID_REVOKE_COMMAND when reason is 301 chars', async () => {
    const res = await revokePOST(jsonRequest('POST', { reason: 'x'.repeat(301) }), params())
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ success: false, error: 'INVALID_REVOKE_COMMAND' })
  })

  it('revokes the live grant and says published stories are NOT removed', async () => {
    const authorized = await authorizePOST(jsonRequest('POST', await confirmBody()), params())
    expect(authorized.status).toBe(200)

    const res = await revokePOST(jsonRequest('POST', { reason: 'mistake' }), params())
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.success).toBe(true)
    expect(typeof body.note).toBe('string')
    expect(body.note as string).toContain('NOT removed')
  })

  it('returns 404 NOTHING_TO_REVOKE on a second revoke', async () => {
    await authorizePOST(jsonRequest('POST', await confirmBody()), params())
    const first = await revokePOST(jsonRequest('POST', { reason: 'mistake' }), params())
    expect(first.status).toBe(200)

    const second = await revokePOST(jsonRequest('POST', { reason: 'mistake' }), params())
    expect(second.status).toBe(404)
    expect(await readJson(second)).toEqual({ success: false, error: 'NOTHING_TO_REVOKE' })
  })
})

describe('unexpected failures', () => {
  it('returns a fixed 500 body and never leaks the underlying error', async () => {
    Object.assign(store, {
      getPack: async () => {
        throw new Error('secret-db-detail')
      },
    })

    const res = await previewGET(jsonRequest('GET'), params())
    expect(res.status).toBe(500)
    const body = await readJson(res)
    expect(body).toEqual({ success: false, error: 'INTERNAL_ERROR' })
    expect(JSON.stringify(body)).not.toContain('secret-db-detail')
  })
})

describe('state-changing routes accept JSON only', () => {
  function formRequest(): NextRequest {
    return new NextRequest('http://localhost/x', {
      method: 'POST',
      body: 'confirm=true',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
  }

  it('refuses a form post with 415 on authorize and revoke, and writes nothing', async () => {
    for (const handler of [authorizePOST, revokePOST]) {
      const res = await handler(formRequest(), params())
      expect(res.status).toBe(415)
      expect(await readJson(res)).toEqual({ success: false, error: 'UNSUPPORTED_MEDIA_TYPE' })
    }
    expect(store.allPacks()[0].authorized_at).toBeNull()
    expect(ports.sendEvent).not.toHaveBeenCalled()
  })

  it('refuses a text/plain post even when the body is valid JSON', async () => {
    const req = new NextRequest('http://localhost/x', {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
      headers: { 'content-type': 'text/plain' },
    })
    const res = await authorizePOST(req, params())
    expect(res.status).toBe(415)
    expect(store.allPacks()[0].authorized_at).toBeNull()
  })
})
