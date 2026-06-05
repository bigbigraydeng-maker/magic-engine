/**
 * Tests for POST/PATCH /api/clients/[id]/cms/connect (B2 carryover #B2-4)
 *
 * Covers the four PATCH paths 魏征 flagged as missing in B1 review:
 *   - 403 unauthorized
 *   - 400 INVALID_CONTENT_TARGETS (via CmsContentTargetValidationError)
 *   - 404 NO_CONNECTION (no existing GitHub conn to PATCH)
 *   - 200 happy path
 *
 * Plus minimal POST coverage to exercise respondCmsConnectError consistency.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn(),
  requirePaidClientAccess: vi.fn(),
}))

vi.mock('@/lib/cms/connection-store', async () => {
  // Re-export the real error class — instanceof check in route.ts depends on
  // the same class identity, so we can't stub it with a vi.fn() alias.
  const actual = await vi.importActual<typeof import('@/lib/cms/connection-store')>('@/lib/cms/connection-store')
  return {
    ...actual,
    upsertConnection:      vi.fn(),
    deleteConnection:      vi.fn(),
    updateContentTargets:  vi.fn(),
  }
})

import { POST, PATCH } from '../route'
import { requireDashboardClientAccess, requirePaidClientAccess } from '@/lib/auth/client-access'
import {
  upsertConnection,
  updateContentTargets,
  CmsContentTargetValidationError,
} from '@/lib/cms/connection-store'

const CLIENT_ID = 'client-xyz'

function makeReq(method: 'POST' | 'PATCH', body: object) {
  return new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/cms/connect`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeCtx() {
  return { params: { id: CLIENT_ID } }
}

function mockAuth(ok: boolean) {
  const result = ok
    ? ({ ok: true, clientId: CLIENT_ID } as unknown as Awaited<ReturnType<typeof requireDashboardClientAccess>>)
    : ({ ok: false, error: 'Unauthorized', status: 403 } as unknown as Awaited<ReturnType<typeof requireDashboardClientAccess>>)
  vi.mocked(requireDashboardClientAccess).mockResolvedValue(result)
  vi.mocked(requirePaidClientAccess).mockResolvedValue(result)
}

const GOOD_STATUS = {
  connected:      true,
  provider:       'github' as const,
  repoOwner:      'acme',
  repoName:       'website',
  branch:         'main',
  tokenHint:      'oken',
  status:         'connected' as const,
  lastError:      null,
  lastTestedAt:   null,
  contentTargets: [],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PATCH /api/clients/[id]/cms/connect', () => {
  it('returns 403 when auth fails', async () => {
    mockAuth(false)
    const res = await PATCH(makeReq('PATCH', { content_targets: [] }), makeCtx())
    expect(res.status).toBe(403)
  })

  it('returns 400 INVALID_INPUT when content_targets missing from body', async () => {
    mockAuth(true)
    const res = await PATCH(makeReq('PATCH', {}), makeCtx())
    expect(res.status).toBe(400)
    expect((await res.json() as { code: string }).code).toBe('INVALID_INPUT')
  })

  it('returns 400 INVALID_CONTENT_TARGETS via CmsContentTargetValidationError', async () => {
    mockAuth(true)
    vi.mocked(updateContentTargets).mockRejectedValue(
      new CmsContentTargetValidationError('Invalid content target — path cannot be blank'),
    )
    const res = await PATCH(
      makeReq('PATCH', { content_targets: [{ path: '', syntax: 'html', role: 'global_head' }] }),
      makeCtx(),
    )
    expect(res.status).toBe(400)
    const body = await res.json() as { code: string; error: string }
    expect(body.code).toBe('INVALID_CONTENT_TARGETS')
    expect(body.error).toMatch(/path cannot be blank/)
  })

  it('returns 404 NO_CONNECTION when no GitHub connection exists', async () => {
    mockAuth(true)
    vi.mocked(updateContentTargets).mockResolvedValue(null)
    const res = await PATCH(
      makeReq('PATCH', { content_targets: [] }),
      makeCtx(),
    )
    expect(res.status).toBe(404)
    expect((await res.json() as { code: string }).code).toBe('NO_CONNECTION')
  })

  it('returns 500 DB_ERROR on unexpected non-validation error', async () => {
    mockAuth(true)
    vi.mocked(updateContentTargets).mockRejectedValue(new Error('connection terminated'))
    const res = await PATCH(makeReq('PATCH', { content_targets: [] }), makeCtx())
    expect(res.status).toBe(500)
    expect((await res.json() as { code: string }).code).toBe('DB_ERROR')
  })

  it('returns 200 with updated status on happy path', async () => {
    mockAuth(true)
    const newTargets = [{ path: 'header.php', syntax: 'php' as const, role: 'global_head' as const }]
    vi.mocked(updateContentTargets).mockResolvedValue({ ...GOOD_STATUS, contentTargets: newTargets })

    const res = await PATCH(
      makeReq('PATCH', { content_targets: newTargets }),
      makeCtx(),
    )
    expect(res.status).toBe(200)
    const body = await res.json() as { success: boolean; data: { contentTargets: typeof newTargets } }
    expect(body.success).toBe(true)
    expect(body.data.contentTargets).toEqual(newTargets)
    expect(vi.mocked(updateContentTargets)).toHaveBeenCalledWith(CLIENT_ID, newTargets)
  })
})

describe('POST /api/clients/[id]/cms/connect — error-class consistency', () => {
  it('returns 400 INVALID_CONTENT_TARGETS via CmsContentTargetValidationError', async () => {
    mockAuth(true)
    vi.mocked(upsertConnection).mockRejectedValue(
      new CmsContentTargetValidationError('Invalid content target — expected ...'),
    )
    const res = await POST(
      makeReq('POST', {
        repo_owner: 'acme',
        repo_name:  'website',
        token:      'ghp_1234567890',
        content_targets: [{ path: 'bad', syntax: 'jsx', role: 'global_head' }],
      }),
      makeCtx(),
    )
    expect(res.status).toBe(400)
    expect((await res.json() as { code: string }).code).toBe('INVALID_CONTENT_TARGETS')
  })

  it('returns 500 DB_ERROR on generic upsert failure', async () => {
    mockAuth(true)
    vi.mocked(upsertConnection).mockRejectedValue(new Error('pg connection lost'))
    const res = await POST(
      makeReq('POST', {
        repo_owner: 'acme',
        repo_name:  'website',
        token:      'ghp_1234567890',
      }),
      makeCtx(),
    )
    expect(res.status).toBe(500)
    expect((await res.json() as { code: string }).code).toBe('DB_ERROR')
  })
})
