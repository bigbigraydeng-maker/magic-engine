import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn(),
}))
vi.mock('@/lib/auth/whitelist', () => ({
  isGlobalAdminEmail: vi.fn(),
}))
vi.mock('@/lib/campaign/daily-plan-auto-publish-store', () => ({
  getActiveAuthorization: vi.fn(),
}))
vi.mock('@/lib/campaign/daily-plan-auto-publish-status-store', () => ({
  listPlanAttempts: vi.fn(),
}))

import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import { getActiveAuthorization } from '@/lib/campaign/daily-plan-auto-publish-store'
import { listPlanAttempts } from '@/lib/campaign/daily-plan-auto-publish-status-store'
import { GET } from '../route'

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000001'
const PLAN_ID = 'c0000000-0000-0000-0000-000000000003'

const mockedAccess = vi.mocked(requireDashboardClientAccess)
const mockedAdmin = vi.mocked(isGlobalAdminEmail)
const mockedGetAuth = vi.mocked(getActiveAuthorization)
const mockedListAttempts = vi.mocked(listPlanAttempts)

function makeRequest(query: string): NextRequest {
  return new NextRequest(
    'http://localhost/api/clients/' + CLIENT_ID + '/campaign-daily-plan/auto-publish/status' + query,
    { method: 'GET' },
  )
}

function storedAuth(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c0000000-0000-0000-0000-0000000000aa',
    request_id: 'c0000000-0000-0000-0000-000000000004',
    client_id: CLIENT_ID,
    campaign_id: 'c0000000-0000-0000-0000-000000000002',
    plan_id: PLAN_ID,
    plan_revision: '2026-09-01T00:00:00.000Z',
    review_revision: 'c0000000-0000-0000-0000-0000000000bb',
    page_id: '1234567890',
    dates: ['2026-09-04'],
    lifted_dates: [],
    max_per_day: 1,
    authorized_by_email: 'admin@example.com',
    authorized_by_user_id: 'c0000000-0000-0000-0000-0000000000cc',
    authorized_at: '2026-09-01T00:00:00.000Z',
    activated_at: '2026-09-01T00:00:05.000Z',
    expires_at: '2999-09-15T00:00:00.000Z',
    revoked_at: null,
    revoked_by_email: null,
    revoked_reason: null,
    ...overrides,
  }
}

function storedAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attempt-1',
    auth_id: 'auth-1',
    client_id: CLIENT_ID,
    plan_id: PLAN_ID,
    date: '2026-09-04',
    attempt_no: 1,
    status: 'published',
    reason_code: null,
    request_id: 'req-1',
    provider_impact: 'NONE',
    post_id: '1234567890_1',
    scheduled_publish_time: null,
    next_retry_at: null,
    updated_at: '2026-09-04T00:00:00.000Z',
    ...overrides,
  }
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  mockedAccess.mockResolvedValue({
    ok: true,
    user: { id: 'c0000000-0000-0000-0000-0000000000cc', email: 'Admin@Example.com' },
    allowedClientId: null,
  } as never)
  mockedAdmin.mockReturnValue(true)
  mockedGetAuth.mockResolvedValue(null)
  mockedListAttempts.mockResolvedValue([])
  delete process.env.DAILY_PLAN_AUTO_PUBLISH_LIVE
  delete process.env.DAILY_PLAN_AUTO_PUBLISH_CLIENTS
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('GET /auto-publish/status', () => {
  it('passes through the access status and does not read the store when not logged in', async () => {
    mockedAccess.mockResolvedValue({ ok: false, status: 401, error: 'UNAUTHENTICATED' } as never)

    const res = await GET(makeRequest('?plan_id=' + PLAN_ID), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ success: false, error: 'UNAUTHENTICATED' })
    expect(mockedGetAuth).not.toHaveBeenCalled()
    expect(mockedListAttempts).not.toHaveBeenCalled()
  })

  it('🔴 a non-admin gets exactly { success: true, can_manage: false } and the store is never called', async () => {
    mockedAdmin.mockReturnValue(false)

    const res = await GET(makeRequest('?plan_id=' + PLAN_ID), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, can_manage: false })
    expect(mockedGetAuth).not.toHaveBeenCalled()
    expect(mockedListAttempts).not.toHaveBeenCalled()
  })

  it('🔴 a scoped admin (allowedClientId set) gets the same bare response', async () => {
    mockedAccess.mockResolvedValue({
      ok: true,
      user: { id: 'c0000000-0000-0000-0000-0000000000cc', email: 'admin@example.com' },
      allowedClientId: CLIENT_ID,
    } as never)

    const res = await GET(makeRequest('?plan_id=' + PLAN_ID), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, can_manage: false })
    expect(mockedGetAuth).not.toHaveBeenCalled()
    expect(mockedListAttempts).not.toHaveBeenCalled()
  })

  it('rejects a bad plan id with 400 INVALID_PLAN_ID', async () => {
    const res = await GET(makeRequest('?plan_id=not-a-uuid'), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ success: false, error: 'INVALID_PLAN_ID' })
    expect(mockedGetAuth).not.toHaveBeenCalled()
  })

  it('rejects a missing plan id with 400 INVALID_PLAN_ID', async () => {
    const res = await GET(makeRequest(''), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ success: false, error: 'INVALID_PLAN_ID' })
  })

  it('defaults to practice mode', async () => {
    const res = await GET(makeRequest('?plan_id=' + PLAN_ID), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mode).toBe('practice')
  })

  it('reports live mode when the env says live and the client is listed', async () => {
    process.env.DAILY_PLAN_AUTO_PUBLISH_LIVE = 'true'
    process.env.DAILY_PLAN_AUTO_PUBLISH_CLIENTS = CLIENT_ID

    const res = await GET(makeRequest('?plan_id=' + PLAN_ID), { params: { id: CLIENT_ID } })

    const body = await res.json()
    expect(body.mode).toBe('live')
  })

  it('stays in practice mode when live but the client is not listed', async () => {
    process.env.DAILY_PLAN_AUTO_PUBLISH_LIVE = 'true'
    process.env.DAILY_PLAN_AUTO_PUBLISH_CLIENTS = 'c0000000-0000-0000-0000-0000000000ff'

    const res = await GET(makeRequest('?plan_id=' + PLAN_ID), { params: { id: CLIENT_ID } })

    const body = await res.json()
    expect(body.mode).toBe('practice')
  })

  it('returns a null authorization when there is no active grant', async () => {
    mockedGetAuth.mockResolvedValue(null)

    const res = await GET(makeRequest('?plan_id=' + PLAN_ID), { params: { id: CLIENT_ID } })

    const body = await res.json()
    expect(body.authorization).toBeNull()
  })

  it('🔴 reports state active for a live grant judged against its own revisions', async () => {
    mockedGetAuth.mockResolvedValue(storedAuth() as never)

    const res = await GET(makeRequest('?plan_id=' + PLAN_ID), { params: { id: CLIENT_ID } })

    const body = await res.json()
    expect(body.authorization.state).toBe('active')
    expect(body.authorization.id).toBe('c0000000-0000-0000-0000-0000000000aa')
    expect(body.authorization.dates).toEqual(['2026-09-04'])
  })

  it('reports state revoked for a revoked grant', async () => {
    mockedGetAuth.mockResolvedValue(storedAuth({ revoked_at: '2026-09-02T00:00:00.000Z' }) as never)

    const res = await GET(makeRequest('?plan_id=' + PLAN_ID), { params: { id: CLIENT_ID } })

    const body = await res.json()
    expect(body.authorization.state).toBe('revoked')
  })

  it('reports state not_activated for a grant that was never activated', async () => {
    mockedGetAuth.mockResolvedValue(storedAuth({ activated_at: null }) as never)

    const res = await GET(makeRequest('?plan_id=' + PLAN_ID), { params: { id: CLIENT_ID } })

    const body = await res.json()
    expect(body.authorization.state).toBe('not_activated')
  })

  it('reports state expired for an expired grant', async () => {
    mockedGetAuth.mockResolvedValue(storedAuth({ expires_at: '2000-01-01T00:00:00.000Z' }) as never)

    const res = await GET(makeRequest('?plan_id=' + PLAN_ID), { params: { id: CLIENT_ID } })

    const body = await res.json()
    expect(body.authorization.state).toBe('expired')
  })

  it('🔴 reports state plan_changed when the caller passes different revisions', async () => {
    mockedGetAuth.mockResolvedValue(storedAuth() as never)

    const res = await GET(
      makeRequest(
        '?plan_id=' + PLAN_ID + '&plan_revision=2026-10-01T00:00:00.000Z&review_revision=c0000000-0000-0000-0000-0000000000dd',
      ),
      { params: { id: CLIENT_ID } },
    )

    const body = await res.json()
    expect(body.authorization.state).toBe('plan_changed')
  })

  it('🔴 maps attempts and sorts them by date ascending', async () => {
    mockedListAttempts.mockResolvedValue([
      storedAttempt({ date: '2026-09-06', status: 'failed_final', reason_code: 'PROVIDER_REJECTED' }),
      storedAttempt({ date: '2026-09-04', status: 'published', post_id: '1234567890_1' }),
      storedAttempt({ date: '2026-09-05', status: 'unknown_outcome', reason_code: 'PROVIDER_OUTCOME_UNKNOWN' }),
    ] as never)

    const res = await GET(makeRequest('?plan_id=' + PLAN_ID), { params: { id: CLIENT_ID } })

    const body = await res.json()
    expect(body.attempts.map((a: { date: string }) => a.date)).toEqual(['2026-09-04', '2026-09-05', '2026-09-06'])
    expect(body.attempts[0]).toEqual({
      date: '2026-09-04',
      status: 'published',
      reason_code: null,
      attempt_no: 1,
      next_retry_at: null,
      post_id: '1234567890_1',
      updated_at: '2026-09-04T00:00:00.000Z',
    })
  })

  it('🔴 returns 500 INTERNAL_ERROR without leaking the message when the store throws', async () => {
    mockedListAttempts.mockRejectedValue(new Error('boom: secret detail'))

    const res = await GET(makeRequest('?plan_id=' + PLAN_ID), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ success: false, error: 'INTERNAL_ERROR' })
    expect(JSON.stringify(body)).not.toContain('secret detail')
  })
})
