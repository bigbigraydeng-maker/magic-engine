import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn(),
}))
vi.mock('@/lib/auth/whitelist', () => ({
  isGlobalAdminEmail: vi.fn(),
}))
vi.mock('@/lib/campaign/daily-plan-auto-publish-worker-store', () => ({
  confirmUnknownOutcome: vi.fn(),
}))

import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import { confirmUnknownOutcome } from '@/lib/campaign/daily-plan-auto-publish-worker-store'
import { POST } from '../route'

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000001'
const PLAN_ID = 'c0000000-0000-0000-0000-000000000003'
const DATE = '2026-09-04'

const mockedAccess = vi.mocked(requireDashboardClientAccess)
const mockedAdmin = vi.mocked(isGlobalAdminEmail)
const mockedConfirm = vi.mocked(confirmUnknownOutcome)

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/clients/' + CLIENT_ID + '/campaign-daily-plan/auto-publish/confirm-unknown',
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }
  )
}

function validBody(): Record<string, unknown> {
  return {
    client_id: CLIENT_ID,
    plan_id: PLAN_ID,
    date: DATE,
    outcome: 'published',
  }
}

function attemptRow() {
  return {
    id: 'c0000000-0000-0000-0000-0000000000aa',
    auth_id: 'c0000000-0000-0000-0000-0000000000bb',
    client_id: CLIENT_ID,
    plan_id: PLAN_ID,
    date: DATE,
    attempt_no: 1,
    status: 'published',
    reason_code: 'CONFIRMED_BY_PM',
    request_id: 'c0000000-0000-0000-0000-0000000000cc',
    provider_impact: 'NONE',
    post_id: null,
    scheduled_publish_time: null,
    next_retry_at: null,
    updated_at: '2026-09-02T00:00:00.000Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedAccess.mockResolvedValue({
    ok: true,
    user: { id: 'c0000000-0000-0000-0000-0000000000cc', email: 'Admin@Example.com' },
    allowedClientId: null,
  } as never)
  mockedAdmin.mockReturnValue(true)
  mockedConfirm.mockResolvedValue(attemptRow() as never)
})

describe('POST /auto-publish/confirm-unknown', () => {
  it('passes through the access status and does not confirm when not logged in', async () => {
    mockedAccess.mockResolvedValue({ ok: false, status: 401, error: 'UNAUTHENTICATED' } as never)

    const res = await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ success: false, error: 'UNAUTHENTICATED' })
    expect(mockedConfirm).not.toHaveBeenCalled()
  })

  it('refuses a non-global-admin with 403 and does not confirm', async () => {
    mockedAdmin.mockReturnValue(false)

    const res = await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ success: false, error: 'GLOBAL_ADMIN_REQUIRED' })
    expect(mockedConfirm).not.toHaveBeenCalled()
  })

  it('🔴 refuses an admin limited to one client (scoped/demo admin) even if the email is listed', async () => {
    mockedAccess.mockResolvedValue({
      ok: true,
      user: { id: 'c0000000-0000-0000-0000-0000000000cc', email: 'admin@example.com' },
      allowedClientId: CLIENT_ID,
    } as never)

    const res = await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(403)
    expect(mockedConfirm).not.toHaveBeenCalled()
  })

  it('rejects an invalid body with 400', async () => {
    const res = await POST(makeRequest({ client_id: CLIENT_ID }), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe('INVALID_CONFIRM_COMMAND')
    expect(mockedConfirm).not.toHaveBeenCalled()
  })

  it('rejects a client_id that does not match the path with 400', async () => {
    const res = await POST(
      makeRequest({ ...validBody(), client_id: 'c0000000-0000-0000-0000-0000000000ff' }),
      { params: { id: CLIENT_ID } }
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ success: false, error: 'CLIENT_ID_MISMATCH' })
    expect(mockedConfirm).not.toHaveBeenCalled()
  })

  it('returns 404 when there is no unknown-outcome row', async () => {
    mockedConfirm.mockResolvedValue(null)

    const res = await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ success: false, error: 'NO_UNKNOWN_OUTCOME' })
  })

  it('records a published outcome and calls the store with the right arguments', async () => {
    const res = await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.attempt).toMatchObject({ plan_id: PLAN_ID, date: DATE, status: 'published' })
    expect(body.note).toBe('Recorded as published; it will not be sent again.')

    expect(mockedConfirm).toHaveBeenCalledTimes(1)
    const call = mockedConfirm.mock.calls[0][0]
    expect(call).toMatchObject({
      planId: PLAN_ID,
      clientId: CLIENT_ID,
      date: DATE,
      outcome: 'published',
    })
    expect(call.now).toBeInstanceOf(Date)
  })

  it('records a not_published outcome and calls the store with the right arguments', async () => {
    mockedConfirm.mockResolvedValue(
      attemptRow() as never
    )

    const res = await POST(
      makeRequest({ ...validBody(), outcome: 'not_published' }),
      { params: { id: CLIENT_ID } }
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.note).toBe(
      'Recorded as not published; the automatic publisher may send it again at its next run.'
    )

    expect(mockedConfirm).toHaveBeenCalledTimes(1)
    const call = mockedConfirm.mock.calls[0][0]
    expect(call).toMatchObject({
      planId: PLAN_ID,
      clientId: CLIENT_ID,
      date: DATE,
      outcome: 'not_published',
    })
    expect(call.now).toBeInstanceOf(Date)
  })

  it('returns 500 INTERNAL_ERROR without leaking the message when the store throws', async () => {
    mockedConfirm.mockRejectedValue(new Error('db exploded'))

    const res = await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ success: false, error: 'INTERNAL_ERROR' })
    expect(JSON.stringify(body)).not.toContain('db exploded')
  })
})
