import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))
vi.mock('@/lib/auth/whitelist', () => ({ isGlobalAdminEmail: vi.fn() }))
vi.mock('@/lib/campaign/daily-plan-publish-runner', () => ({ runDailyPlanPublish: vi.fn() }))
vi.mock('@/lib/campaign/daily-plan-auto-publish-store', () => ({
  activateAuthorization: vi.fn(),
  findReceiptRecalledDates: vi.fn(),
  findRecalledDates: vi.fn(),
  getActiveAuthorization: vi.fn(),
  insertAuthorization: vi.fn(),
  liftRecalledTombstones: vi.fn(),
  revokeAuthorization: vi.fn(),
}))
vi.mock('@/lib/campaign/daily-plan-auto-publish-worker-store', () => ({ clearNonStickyAttempts: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: vi.fn() }))

import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import { runDailyPlanPublish } from '@/lib/campaign/daily-plan-publish-runner'
import {
  activateAuthorization,
  findReceiptRecalledDates,
  findRecalledDates,
  getActiveAuthorization,
  insertAuthorization,
  liftRecalledTombstones,
  revokeAuthorization,
} from '@/lib/campaign/daily-plan-auto-publish-store'
import { clearNonStickyAttempts } from '@/lib/campaign/daily-plan-auto-publish-worker-store'
import type { AutoPublishAuthorization } from '@/lib/campaign/daily-plan-auto-publish'
import { supabaseAdmin } from '@/lib/supabase'
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
const DATES = ['2099-02-01', '2099-02-02']

const mockedAccess = vi.mocked(requireDashboardClientAccess)
const mockedIsGlobalAdmin = vi.mocked(isGlobalAdminEmail)
const mockedRun = vi.mocked(runDailyPlanPublish)
const mockedInsert = vi.mocked(insertAuthorization)
const mockedRevoke = vi.mocked(revokeAuthorization)
const mockedActivate = vi.mocked(activateAuthorization)
const mockedRecalled = vi.mocked(findRecalledDates)
const mockedReceiptRecalled = vi.mocked(findReceiptRecalledDates)
const mockedActive = vi.mocked(getActiveAuthorization)
const mockedLift = vi.mocked(liftRecalledTombstones)
const mockedClear = vi.mocked(clearNonStickyAttempts)
const mockedSend = vi.mocked(sendInngestEvent)
const mockedFrom = vi.mocked(supabaseAdmin.from)

function validCommand(overrides: Record<string, unknown> = {}) {
  return {
    client_id: CLIENT_ID,
    campaign_id: CAMPAIGN_ID,
    plan_id: PLAN_ID,
    plan_revision: PLAN_REVISION,
    review_revision: REVIEW_REVISION,
    page_id: PAGE_ID,
    dates: DATES,
    max_per_day: 1,
    expires_in_days: 14,
    confirm: true,
    ...overrides,
  }
}

function callPost(body: unknown) {
  const req = new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/campaign-daily-plan/auto-publish/authorize`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  return POST(req, { params: { id: CLIENT_ID } })
}

const okAccess = {
  ok: true as const,
  user: { id: USER_ID, email: 'Admin@MagicEngine.cloud' },
  role: 'admin' as const,
  tier: 'admin' as const,
  allowedClientId: null,
}

const dryRunBody = {
  success: true,
  mode: 'DRY_RUN',
  would_publish: [{ date: DATES[0] }],
  already_published: [],
}

function grant(overrides: Partial<AutoPublishAuthorization> = {}): AutoPublishAuthorization {
  return {
    id: 'auth-1',
    request_id: 'req-1',
    client_id: CLIENT_ID,
    campaign_id: CAMPAIGN_ID,
    plan_id: PLAN_ID,
    plan_revision: PLAN_REVISION,
    review_revision: REVIEW_REVISION,
    page_id: PAGE_ID,
    dates: DATES,
    lifted_dates: [],
    max_per_day: 1,
    authorized_by_email: 'admin@magicengine.cloud',
    authorized_by_user_id: USER_ID,
    authorized_at: '2024-01-01T00:00:00.000Z',
    activated_at: null,
    expires_at: '2024-01-15T00:00:00.000Z',
    revoked_at: null,
    revoked_by_email: null,
    revoked_reason: null,
    ...overrides,
  }
}

function stubClientPage(page: string | null, error: unknown = null) {
  mockedFrom.mockImplementation(((table: string) => {
    if (table !== 'clients') throw new Error(`unexpected table ${table}`)
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn().mockResolvedValue({ data: page === null ? null : { facebook_page_id: page }, error }),
    }
    return query
  }) as never)
}

beforeEach(() => {
  vi.resetAllMocks()
  mockedAccess.mockResolvedValue(okAccess as never)
  mockedIsGlobalAdmin.mockReturnValue(true)
  stubClientPage(PAGE_ID)
  mockedRecalled.mockResolvedValue([])
  mockedReceiptRecalled.mockResolvedValue([])
  mockedActive.mockResolvedValue(null)
  mockedRun.mockResolvedValue({ status: 200, body: dryRunBody })
  mockedInsert.mockResolvedValue({ ok: true, authorization: grant() })
  mockedActivate.mockResolvedValue(grant({ activated_at: '2024-01-01T00:00:05.000Z' }))
  mockedRevoke.mockResolvedValue(null)
  mockedLift.mockResolvedValue(undefined)
  mockedClear.mockResolvedValue(undefined)
  mockedSend.mockResolvedValue({ event_ids: ['evt-1'] })
})

describe('POST auto-publish authorize — who may call it', () => {
  it('returns 401 and does nothing when not logged in', async () => {
    mockedAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    const res = await callPost(validCommand())
    expect(res.status).toBe(401)
    expect(mockedRun).not.toHaveBeenCalled()
    expect(mockedInsert).not.toHaveBeenCalled()
  })

  it('🔴 refuses a logged-in user who is not a global admin, before reading anything', async () => {
    mockedIsGlobalAdmin.mockReturnValue(false)
    const res = await callPost(validCommand())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('GLOBAL_ADMIN_REQUIRED')
    expect(mockedRun).not.toHaveBeenCalled()
    expect(mockedFrom).not.toHaveBeenCalled()
  })

  it('🔴 refuses an admin who is limited to one client (scoped/demo admin) even if the email is listed', async () => {
    mockedAccess.mockResolvedValue({ ...okAccess, allowedClientId: CLIENT_ID } as never)
    const res = await callPost(validCommand())
    expect(res.status).toBe(403)
    expect(mockedRun).not.toHaveBeenCalled()
    expect(mockedInsert).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid body and 400 for a client id that differs from the path', async () => {
    expect((await callPost({ nope: true })).status).toBe(400)
    const mismatch = await callPost(validCommand({ client_id: 'c0000000-0000-0000-0000-0000000000ff' }))
    expect(mismatch.status).toBe(400)
    expect((await mismatch.json()).error).toBe('CLIENT_ID_MISMATCH')
    expect(mockedRun).not.toHaveBeenCalled()
  })
})

describe('POST auto-publish authorize — refusals before the gates', () => {
  it('🔴 refuses past dates (they would publish immediately, not at the slot)', async () => {
    const res = await callPost(validCommand({ dates: ['2020-01-01'] }))
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: 'DATE_IN_PAST', dates: ['2020-01-01'] })
    expect(mockedRun).not.toHaveBeenCalled()
  })

  it('🔴 refuses a page id that is not the one registered for this client — and a client with no page', async () => {
    stubClientPage('999999999')
    const mismatch = await callPost(validCommand())
    expect(mismatch.status).toBe(409)
    expect((await mismatch.json()).error).toBe('PAGE_ID_MISMATCH')

    stubClientPage(null)
    const none = await callPost(validCommand())
    expect(none.status).toBe(409)
    expect((await none.json()).error).toBe('CLIENT_HAS_NO_FACEBOOK_PAGE')
    expect(mockedRun).not.toHaveBeenCalled()
    expect(mockedInsert).not.toHaveBeenCalled()
  })

  it('🔴 refuses recalled dates unless the PM explicitly lists them in lift_recalled_dates', async () => {
    mockedRecalled.mockResolvedValue([DATES[1]])
    const res = await callPost(validCommand())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'DATE_RECALLED', dates: [DATES[1]] })
    expect(mockedRun).not.toHaveBeenCalled()
    expect(mockedInsert).not.toHaveBeenCalled()
  })

  it('🔴 a date recalled on the receipt is blocked even when its tombstone is missing (tombstone write had failed)', async () => {
    mockedRecalled.mockResolvedValue([])
    mockedReceiptRecalled.mockResolvedValue([DATES[0]])
    const res = await callPost(validCommand())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'DATE_RECALLED', dates: [DATES[0]] })
    expect(mockedInsert).not.toHaveBeenCalled()
  })

  it('a receipt-recalled date can be sent again only when the PM lists it, and the grant records that', async () => {
    mockedReceiptRecalled.mockResolvedValue([DATES[0]])
    const res = await callPost(validCommand({ lift_recalled_dates: [DATES[0]] }))
    expect(res.status).toBe(200)
    expect(mockedInsert.mock.calls[0][0]).toMatchObject({ lifted_dates: [DATES[0]] })
  })

  it('passes a gate refusal through unchanged and stores nothing', async () => {
    mockedRun.mockResolvedValue({ status: 409, body: { success: false, error: 'PRICE_FACT_UNVERIFIED' } })
    const res = await callPost(validCommand())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('PRICE_FACT_UNVERIFIED')
    expect(mockedInsert).not.toHaveBeenCalled()
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('always runs the gates as a dry run with no date offset', async () => {
    await callPost(validCommand({ confirm: false }))
    expect(mockedRun.mock.calls[0][0].command).toMatchObject({ no_publish: true, date_offset_days: 0, approved: true, publish_authorization: true })
    expect(mockedRun.mock.calls[0][0].approvedByUserId).toBe(USER_ID)
  })
})

describe('POST auto-publish authorize — preview and confirm', () => {
  it('previews without storing, sending or lifting anything when confirm is false', async () => {
    mockedRecalled.mockResolvedValue([DATES[1]])
    const res = await callPost(validCommand({ confirm: false, lift_recalled_dates: [DATES[1]] }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ mode: 'PREVIEW', authorization: 'NOT_AUTHORIZED', provider_impact: 'NONE', would_lift_recalled: [DATES[1]] })
    expect(mockedInsert).not.toHaveBeenCalled()
    expect(mockedSend).not.toHaveBeenCalled()
    expect(mockedLift).not.toHaveBeenCalled()
  })

  it('confirm: stores inactive, sends the event, arms the grant, and only then lifts recall blocks', async () => {
    mockedRecalled.mockResolvedValue([DATES[1]])
    const order: string[] = []
    mockedInsert.mockImplementation(async () => { order.push('insert'); return { ok: true, authorization: grant() } })
    mockedSend.mockImplementation(async () => { order.push('send'); return { event_ids: ['evt-1'] } })
    mockedActivate.mockImplementation(async () => { order.push('activate'); return grant({ activated_at: 'x' }) })
    mockedLift.mockImplementation(async () => { order.push('lift') })

    const res = await callPost(validCommand({ lift_recalled_dates: [DATES[1]] }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ mode: 'AUTHORIZED', provider_impact: 'NONE', lifted_recalled: [DATES[1]] })
    expect(order).toEqual(['insert', 'send', 'activate', 'lift'])
    // a new authorisation starts the covered dates clean (old 'not yet / not this time' rows removed)
    expect(mockedClear).toHaveBeenCalledWith({ planId: PLAN_ID, clientId: CLIENT_ID, dates: DATES })
    expect(mockedInsert.mock.calls[0][0]).toMatchObject({ authorized_by_email: 'admin@magicengine.cloud', authorized_by_user_id: USER_ID, lifted_dates: [DATES[1]] })
    expect(mockedSend.mock.calls[0][0].name).toBe(DAILY_PLAN_AUTO_PUBLISH_AUTHORIZED_EVENT)
    expect(mockedLift).toHaveBeenCalledWith({ planId: PLAN_ID, clientId: CLIENT_ID, dates: [DATES[1]], notNewerThan: expect.any(Date) })
  })

  it('returns 409 and sends no event when a live authorisation already exists', async () => {
    mockedInsert.mockResolvedValue({ ok: false, error: 'ALREADY_AUTHORIZED' })
    const res = await callPost(validCommand())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('ALREADY_AUTHORIZED')
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('🔴 supersedes an expired previous grant instead of blocking the new one', async () => {
    mockedActive.mockResolvedValue(grant({ activated_at: '2024-01-01T00:00:01.000Z' }))
    const res = await callPost(validCommand())
    expect(res.status).toBe(200)
    expect(mockedRevoke).toHaveBeenCalledTimes(1)
    expect(mockedRevoke.mock.calls[0][0]).toMatchObject({ authId: 'auth-1', clientId: CLIENT_ID, byEmail: 'system:superseded' })
    // the replaced grant leaves a machine-readable revoked event
    expect(mockedSend.mock.calls.some(call => call[0].id === 'req-1:superseded')).toBe(true)
  })

  it('does not supersede a live grant, nor a half-created one younger than five minutes', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    mockedActive.mockResolvedValue(grant({ activated_at: '2024-01-01T00:00:01.000Z', expires_at: future }))
    await callPost(validCommand())
    mockedActive.mockResolvedValue(grant({ activated_at: null, authorized_at: new Date().toISOString(), expires_at: future }))
    await callPost(validCommand())
    expect(mockedRevoke).not.toHaveBeenCalled()
  })
})

describe('POST auto-publish authorize — failure after the grant was written', () => {
  it('🔴 event failure: rolls back this exact grant by id and reports rollback OK; never arms it', async () => {
    mockedSend.mockRejectedValue(new Error('inngest down'))
    const res = await callPost(validCommand())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ success: false, error: 'AUTHORIZATION_EVENT_NOT_SENT', rollback: 'OK' })
    expect(mockedRevoke.mock.calls[0][0]).toMatchObject({ authId: 'auth-1', planId: PLAN_ID, clientId: CLIENT_ID })
    expect(mockedActivate).not.toHaveBeenCalled()
  })

  it('🔴 says so loudly when the rollback itself fails (the grant may still exist)', async () => {
    mockedSend.mockRejectedValue(new Error('inngest down'))
    mockedRevoke.mockRejectedValue(new Error('db down'))
    const json = await (await callPost(validCommand())).json()
    expect(json).toMatchObject({ error: 'AUTHORIZATION_EVENT_NOT_SENT', rollback: 'FAILED' })
    expect(json.hint).toMatch(/revoke/i)
  })

  it('arming failure: rolls back by id and does not lift recall blocks', async () => {
    mockedActivate.mockRejectedValue(new Error('db down'))
    const res = await callPost(validCommand())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('AUTHORIZATION_NOT_ACTIVATED')
    expect(mockedRevoke).toHaveBeenCalledTimes(1)
    expect(mockedLift).not.toHaveBeenCalled()
  })

  it('a grant revoked while it was being armed is reported, not returned as authorised', async () => {
    mockedActivate.mockResolvedValue(null)
    const res = await callPost(validCommand())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('AUTHORIZATION_REVOKED_DURING_ARMING')
  })

  it('lifting recall blocks fails: the grant is rolled back and the error is explicit', async () => {
    mockedLift.mockRejectedValue(new Error('db down'))
    const res = await callPost(validCommand())
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'RECALL_BLOCKS_NOT_LIFTED', rollback: 'OK' })
  })

  it('🔴 unexpected errors never leak internal text', async () => {
    mockedRun.mockRejectedValue(new Error('relation "daily_plan_auto_publish_auth" does not exist'))
    const res = await callPost(validCommand())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ success: false, error: 'INTERNAL_ERROR' })
  })
})
