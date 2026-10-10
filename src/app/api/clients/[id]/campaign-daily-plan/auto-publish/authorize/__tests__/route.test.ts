import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn(),
}))

vi.mock('@/lib/auth/whitelist', () => ({
  isGlobalAdminEmail: vi.fn(),
}))

vi.mock('@/lib/campaign/daily-plan-publish-runner', () => ({
  runDailyPlanPublish: vi.fn(),
}))

vi.mock('@/lib/campaign/daily-plan-auto-publish-store', () => ({
  insertAuthorization: vi.fn(),
  revokeAuthorization: vi.fn(),
}))

vi.mock('@/lib/workflows/inngest-event', () => ({
  sendInngestEvent: vi.fn(),
}))

import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import { runDailyPlanPublish } from '@/lib/campaign/daily-plan-publish-runner'
import {
  insertAuthorization,
  revokeAuthorization,
} from '@/lib/campaign/daily-plan-auto-publish-store'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { DAILY_PLAN_AUTO_PUBLISH_AUTHORIZED_EVENT } from '@/lib/campaign/daily-plan-auto-publish'

import { POST } from '../route'

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CAMPAIGN_ID = 'c0000000-0000-0000-0000-000000000001'
const PLAN_ID = 'c0000000-0000-0000-0000-000000000002'
const REVIEW_REVISION = 'c0000000-0000-0000-0000-000000000003'
const USER_ID = 'c0000000-0000-0000-0000-000000000004'
const PLAN_REVISION = '2024-01-01T00:00:00.000Z'
const PAGE_ID = '1234567890'

const mockedAccess = vi.mocked(requireDashboardClientAccess)
const mockedIsGlobalAdmin = vi.mocked(isGlobalAdminEmail)
const mockedRun = vi.mocked(runDailyPlanPublish)
const mockedInsert = vi.mocked(insertAuthorization)
const mockedRevoke = vi.mocked(revokeAuthorization)
const mockedSend = vi.mocked(sendInngestEvent)

function validCommand(overrides: Record<string, unknown> = {}) {
  return {
    client_id: CLIENT_ID,
    campaign_id: CAMPAIGN_ID,
    plan_id: PLAN_ID,
    plan_revision: PLAN_REVISION,
    review_revision: REVIEW_REVISION,
    page_id: PAGE_ID,
    dates: ['2024-02-01', '2024-02-02'],
    max_per_day: 1,
    expires_in_days: 14,
    confirm: true,
    ...overrides,
  }
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/clients/' + CLIENT_ID + '/campaign-daily-plan/auto-publish/authorize', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function callPost(body: unknown) {
  return POST(makeRequest(body), { params: { id: CLIENT_ID } })
}

const okAccess = {
  ok: true as const,
  user: { id: USER_ID, email: 'admin@magicengine.cloud' },
  role: 'admin' as const,
  tier: 'admin' as const,
  allowedClientId: null,
}

const dryRunBody = {
  success: true,
  mode: 'DRY_RUN',
  would_publish: [{ date: '2024-02-01' }],
  already_published: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedAccess.mockResolvedValue(okAccess as never)
  mockedIsGlobalAdmin.mockReturnValue(true)
  mockedRun.mockResolvedValue({ status: 200, body: dryRunBody })
  mockedInsert.mockResolvedValue({
    ok: true,
    authorization: {
      id: 'auth-1',
      request_id: 'req-1',
      client_id: CLIENT_ID,
      campaign_id: CAMPAIGN_ID,
      plan_id: PLAN_ID,
      plan_revision: PLAN_REVISION,
      review_revision: REVIEW_REVISION,
      page_id: PAGE_ID,
      dates: ['2024-02-01', '2024-02-02'],
      max_per_day: 1,
      authorized_by_email: 'admin@magicengine.cloud',
      authorized_by_user_id: USER_ID,
      authorized_at: '2024-01-01T00:00:00.000Z',
      expires_at: '2024-01-15T00:00:00.000Z',
      revoked_at: null,
      revoked_by_email: null,
      revoked_reason: null,
    },
  })
  mockedRevoke.mockResolvedValue(null)
  mockedSend.mockResolvedValue({ event_ids: ['evt-1'] })
})

describe('POST auto-publish authorize', () => {
  it('returns 401 and does not run the gates when not logged in', async () => {
    mockedAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })

    const res = await callPost(validCommand())

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' })
    expect(mockedRun).not.toHaveBeenCalled()
    expect(mockedInsert).not.toHaveBeenCalled()
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('returns 403 and does not run the gates when not a global admin', async () => {
    mockedIsGlobalAdmin.mockReturnValue(false)

    const res = await callPost(validCommand())

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ success: false, error: 'GLOBAL_ADMIN_REQUIRED' })
    expect(mockedRun).not.toHaveBeenCalled()
    expect(mockedInsert).not.toHaveBeenCalled()
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid body', async () => {
    const res = await callPost({ client_id: CLIENT_ID })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe('INVALID_AUTHORIZE_COMMAND')
    expect(mockedRun).not.toHaveBeenCalled()
  })

  it('returns 400 when the body client id does not match the path', async () => {
    const res = await callPost(validCommand({ client_id: 'c0000000-0000-0000-0000-0000000000ff' }))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ success: false, error: 'CLIENT_ID_MISMATCH' })
    expect(mockedRun).not.toHaveBeenCalled()
  })

  it('passes through a gate refusal and stores nothing', async () => {
    mockedRun.mockResolvedValue({
      status: 409,
      body: { success: false, error: 'REVIEW_CHECKLIST_REQUIRED' },
    })

    const res = await callPost(validCommand())

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ success: false, error: 'REVIEW_CHECKLIST_REQUIRED' })
    expect(mockedInsert).not.toHaveBeenCalled()
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('previews without storing or sending when confirm is false', async () => {
    const res = await callPost(validCommand({ confirm: false }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mode).toBe('PREVIEW')
    expect(body.authorization).toBe('NOT_AUTHORIZED')
    expect(body.provider_impact).toBe('NONE')
    expect(body.would_publish).toEqual(dryRunBody.would_publish)
    expect(mockedInsert).not.toHaveBeenCalled()
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('stores the authorisation, sends the event and returns AUTHORIZED on confirm', async () => {
    const res = await callPost(validCommand())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mode).toBe('AUTHORIZED')
    expect(body.provider_impact).toBe('NONE')
    expect(body.authorization.id).toBe('auth-1')
    expect(body.note).toBe('Recorded only. The automatic publisher is not running yet.')

    expect(mockedInsert).toHaveBeenCalledTimes(1)
    const insertArg = mockedInsert.mock.calls[0][0]
    expect(insertArg.client_id).toBe(CLIENT_ID)
    expect(insertArg.plan_id).toBe(PLAN_ID)
    expect(insertArg.authorized_by_email).toBe('admin@magicengine.cloud')
    expect(insertArg.authorized_by_user_id).toBe(USER_ID)
    expect(insertArg.dates).toEqual(['2024-02-01', '2024-02-02'])

    expect(mockedSend).toHaveBeenCalledTimes(1)
    const sendArg = mockedSend.mock.calls[0][0]
    expect(sendArg.name).toBe(DAILY_PLAN_AUTO_PUBLISH_AUTHORIZED_EVENT)
    expect(sendArg.data.authorization).toBe('AUTHORIZED')
    expect(sendArg.data.provider_impact).toBe('NONE')
    expect(sendArg.data.plan_id).toBe(PLAN_ID)
  })

  it('returns 409 and sends no event when already authorised', async () => {
    mockedInsert.mockResolvedValue({ ok: false, error: 'ALREADY_AUTHORIZED' })

    const res = await callPost(validCommand())

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('ALREADY_AUTHORIZED')
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('returns 500 and revokes when the event cannot be sent', async () => {
    mockedSend.mockRejectedValue(new Error('inngest down'))

    const res = await callPost(validCommand())

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ success: false, error: 'AUTHORIZATION_EVENT_NOT_SENT', rollback: 'OK' })
    expect(mockedRevoke).toHaveBeenCalledTimes(1)
    expect(mockedRevoke.mock.calls[0][0]).toMatchObject({
      planId: PLAN_ID,
      byEmail: 'system:event-failed',
    })
  })

  it('🔴 says so loudly when the rollback itself fails (the grant may still be armed)', async () => {
    mockedSend.mockRejectedValue(new Error('inngest down'))
    mockedRevoke.mockRejectedValue(new Error('db down'))

    const res = await callPost(validCommand())
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toBe('AUTHORIZATION_EVENT_NOT_SENT')
    expect(json.rollback).toBe('FAILED')
    expect(json.hint).toMatch(/revoke/i)
  })

  it('always runs the gates as a dry run with no date offset', async () => {
    await callPost(validCommand())

    expect(mockedRun).toHaveBeenCalledTimes(1)
    const runArg = mockedRun.mock.calls[0][0]
    expect(runArg.clientId).toBe(CLIENT_ID)
    expect(runArg.approvedByUserId).toBe(USER_ID)
    expect(runArg.command.no_publish).toBe(true)
    expect(runArg.command.date_offset_days).toBe(0)
    expect(runArg.command.approved).toBe(true)
    expect(runArg.command.publish_authorization).toBe(true)
  })
})
