import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn(),
}))
vi.mock('@/lib/auth/whitelist', () => ({
  isGlobalAdminEmail: vi.fn(),
}))
vi.mock('@/lib/campaign/daily-plan-auto-publish-store', () => ({
  revokeAuthorization: vi.fn(),
}))
vi.mock('@/lib/campaign/daily-plan-auto-publish-records', () => ({
  readAutoPublishRecords: vi.fn(),
}))
vi.mock('@/lib/workflows/inngest-event', () => ({
  sendInngestEvent: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import { revokeAuthorization } from '@/lib/campaign/daily-plan-auto-publish-store'
import { readAutoPublishRecords } from '@/lib/campaign/daily-plan-auto-publish-records'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from '../route'

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000001'
const CAMPAIGN_ID = 'c0000000-0000-0000-0000-000000000002'
const PLAN_ID = 'c0000000-0000-0000-0000-000000000003'
const REQUEST_ID = 'c0000000-0000-0000-0000-000000000004'

const mockedAccess = vi.mocked(requireDashboardClientAccess)
const mockedAdmin = vi.mocked(isGlobalAdminEmail)
const mockedRevoke = vi.mocked(revokeAuthorization)
const mockedSend = vi.mocked(sendInngestEvent)
const mockedRecords = vi.mocked(readAutoPublishRecords)
const mockedFrom = vi.mocked(supabaseAdmin.from)

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/clients/' + CLIENT_ID + '/campaign-daily-plan/auto-publish/revoke', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function validBody(): Record<string, unknown> {
  return {
    client_id: CLIENT_ID,
    campaign_id: CAMPAIGN_ID,
    plan_id: PLAN_ID,
    reason: 'client asked to pause',
  }
}

function revokedRow() {
  return {
    id: 'c0000000-0000-0000-0000-0000000000aa',
    request_id: REQUEST_ID,
    client_id: CLIENT_ID,
    campaign_id: CAMPAIGN_ID,
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
    expires_at: '2026-09-15T00:00:00.000Z',
    revoked_at: '2026-09-02T00:00:00.000Z',
    revoked_by_email: 'admin@example.com',
    revoked_reason: 'client asked to pause',
  }
}

/** A `social_plans` read that returns no row — the "cannot check" case. */
function mockPlanReadMissing() {
  mockedFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  } as never)
}

/** A `social_plans` read that returns a row with the given `publish_meta`. */
function mockPlanRead(publishMeta: unknown) {
  mockedFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { plan_data: { publish_meta: publishMeta } },
            error: null,
          }),
        }),
      }),
    }),
  } as never)
}

function validPublishMeta(published: unknown[]) {
  return {
    schema_version: 1,
    event_name: 'daily_plan.post.published',
    status: 'PUBLISHED',
    request_id: REQUEST_ID,
    client_id: CLIENT_ID,
    campaign_id: CAMPAIGN_ID,
    plan_id: PLAN_ID,
    plan_revision: '2026-09-01T00:00:00.000Z',
    review_revision: 'c0000000-0000-0000-0000-0000000000bb',
    page_id: '1234567890',
    publishing_authorization: 'AUTHORIZED',
    approved_by_user_id: 'c0000000-0000-0000-0000-0000000000cc',
    created_at: '2026-09-01T00:00:00.000Z',
    published,
    failed: [],
    event_ids: [],
  }
}

function publishedPost(overrides: Record<string, unknown>) {
  return {
    date: '2026-09-04',
    idempotency_key: 'fbpost_abc',
    post_id: '1234567890_987654321',
    post_id_source: 'post_id',
    page_id: '1234567890',
    published_at: '2026-09-01T00:00:00.000Z',
    permalink: 'https://www.facebook.com/1234567890_987654321',
    provider_response: {},
    ...overrides,
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
  mockedRevoke.mockResolvedValue(revokedRow())
  mockedSend.mockResolvedValue({ event_ids: ['evt-1'] })
  mockPlanReadMissing()
  mockedRecords.mockResolvedValue({ status: 'OK', posts: [], unconfirmed: [] })
})

describe('POST /auto-publish/revoke', () => {
  it('passes through the access status and does not revoke when not logged in', async () => {
    mockedAccess.mockResolvedValue({ ok: false, status: 401, error: 'UNAUTHENTICATED' } as never)

    const res = await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ success: false, error: 'UNAUTHENTICATED' })
    expect(mockedRevoke).not.toHaveBeenCalled()
  })

  it('refuses a non-global-admin with 403 and does not revoke', async () => {
    mockedAdmin.mockReturnValue(false)

    const res = await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ success: false, error: 'GLOBAL_ADMIN_REQUIRED' })
    expect(mockedRevoke).not.toHaveBeenCalled()
  })

  it('🔴 refuses an admin limited to one client (scoped/demo admin) even if the email is listed', async () => {
    mockedAccess.mockResolvedValue({
      ok: true,
      user: { id: 'c0000000-0000-0000-0000-0000000000cc', email: 'admin@example.com' },
      allowedClientId: CLIENT_ID,
    } as never)

    const res = await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(403)
    expect(mockedRevoke).not.toHaveBeenCalled()
  })

  it('🔴 revokes only within the client in the path (a plan id from another client must not match)', async () => {
    await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })

    expect(mockedRevoke.mock.calls[0][0]).toMatchObject({ planId: PLAN_ID, clientId: CLIENT_ID })
  })

  it('a plan that was never handed to Facebook reports in_flight_status OK with an empty list, not UNKNOWN', async () => {
    mockPlanRead(undefined)

    const json = await (await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })).json()

    expect(json.in_flight).toEqual([])
    expect(json.in_flight_status).toBe('OK')
  })

  it('rejects an invalid body with 400', async () => {
    const res = await POST(makeRequest({ client_id: CLIENT_ID }), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe('INVALID_REVOKE_COMMAND')
    expect(mockedRevoke).not.toHaveBeenCalled()
  })

  it('returns 404 when there is no active authorisation', async () => {
    mockedRevoke.mockResolvedValue(null)

    const res = await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ success: false, error: 'NO_ACTIVE_AUTHORIZATION' })
  })

  it('returns REVOKED with event_status sent on success', async () => {
    const res = await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.mode).toBe('REVOKED')
    expect(body.event_status).toBe('sent')
    expect(body.authorization.request_id).toBe(REQUEST_ID)
    expect(mockedRevoke).toHaveBeenCalledWith({
      planId: PLAN_ID,
      clientId: CLIENT_ID,
      byEmail: 'admin@example.com',
      reason: 'client asked to pause',
    })
    expect(mockedSend).toHaveBeenCalledTimes(1)
  })

  it('still returns 200 with event_status failed when the event send fails', async () => {
    mockedSend.mockRejectedValue(new Error('inngest down'))

    const res = await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.mode).toBe('REVOKED')
    expect(body.event_status).toBe('failed')
    expect(mockedRevoke).toHaveBeenCalledTimes(1)
  })

  it('lists only posts still scheduled in the future as in_flight', async () => {
    const future = new Date(Date.now() + 3 * 24 * 3_600_000).toISOString()
    const past = new Date(Date.now() - 3 * 24 * 3_600_000).toISOString()
    mockPlanRead(
      validPublishMeta([
        publishedPost({ date: '2026-09-04', post_id: '1234567890_1', scheduled_publish_time: future }),
        publishedPost({ date: '2026-09-05', post_id: '1234567890_2', scheduled_publish_time: past }),
        publishedPost({ date: '2026-09-06', post_id: '1234567890_3' }),
      ])
    )

    const res = await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.in_flight_status).toBe('OK')
    expect(body.in_flight).toEqual([
      { date: '2026-09-04', post_id: '1234567890_1', scheduled_publish_time: future },
    ])
  })

  it('reports in_flight_status UNKNOWN when the plan cannot be read', async () => {
    mockedFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
          }),
        }),
      }),
    } as never)

    const res = await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.in_flight).toEqual([])
    expect(body.in_flight_status).toBe('UNKNOWN')
  })

  it('🔴 a scheduled post known only to the auto-publisher records is listed as in_flight, and receipt ids are passed down', async () => {
    const future = new Date(Date.now() + 3 * 24 * 3_600_000).toISOString()
    mockPlanRead(validPublishMeta([publishedPost({ date: '2026-09-04', post_id: '1234567890_1', scheduled_publish_time: future })]))
    mockedRecords.mockResolvedValue({
      status: 'OK',
      posts: [{ date: '2026-09-05', post_id: '1234567890_9', scheduled_publish_time: future }],
      unconfirmed: [],
    })

    const body = await (await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })).json()

    expect(body.in_flight.map((p: { post_id: string }) => p.post_id)).toEqual(['1234567890_1', '1234567890_9'])
    const arg = mockedRecords.mock.calls[0][0]
    expect(arg.dates).toEqual(['2026-09-04'])
    expect([...arg.receiptPostIds]).toEqual(['1234567890_1'])
  })

  it('an auto-published post whose time has already passed is not in_flight', async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString()
    mockedRecords.mockResolvedValue({
      status: 'OK',
      posts: [{ date: '2026-09-05', post_id: '1234567890_9', scheduled_publish_time: past }],
      unconfirmed: [],
    })
    const body = await (await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })).json()
    expect(body.in_flight).toEqual([])
  })

  it('🔴 unsettled dates are returned as in_flight_unconfirmed', async () => {
    mockedRecords.mockResolvedValue({ status: 'OK', posts: [], unconfirmed: [{ date: '2026-09-04', status: 'unknown_outcome' }] })
    const body = await (await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })).json()
    expect(body.in_flight_unconfirmed).toEqual([{ date: '2026-09-04', status: 'unknown_outcome' }])
  })

  it('🔴 an unreadable attempts table turns an otherwise OK answer into UNKNOWN', async () => {
    mockedRecords.mockResolvedValue({ status: 'UNKNOWN', posts: [], unconfirmed: [] })
    const body = await (await POST(makeRequest(validBody()), { params: { id: CLIENT_ID } })).json()
    expect(body.in_flight_status).toBe('UNKNOWN')
  })
})
