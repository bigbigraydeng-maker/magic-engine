import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/campaign/daily-plan-auto-publish-worker-store', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/campaign/daily-plan-auto-publish-worker-store')>()),
  listFreshClaims: vi.fn(),
}))
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: vi.fn() }))
vi.mock('@/lib/meta/token-manager', () => ({
  getMetaTokenForClient: vi.fn(),
  getStoredPageToken: vi.fn(),
}))
vi.mock('@/lib/meta/page-posts', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/meta/page-posts')>()),
  getPageAccessToken: vi.fn(),
  publishPagePhotoPost: vi.fn(),
}))
vi.mock('@/lib/meta/first-comment', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/meta/first-comment')>()),
  ensureFacebookFirstComment: vi.fn(),
}))

import { POST } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { listFreshClaims } from '@/lib/campaign/daily-plan-auto-publish-worker-store'
import { getMetaTokenForClient, getStoredPageToken } from '@/lib/meta/token-manager'
import { getPageAccessToken, publishPagePhotoPost } from '@/lib/meta/page-posts'
import { ensureFacebookFirstComment } from '@/lib/meta/first-comment'
import {
  CampaignDailyPublishMetaSchema,
  DailyPlanPostPublishedEventSchema,
  StoryResolveDueSchema,
  publishIdempotencyKey,
} from '@/lib/campaign/daily-plan-publish'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)
const mockSendInngestEvent = vi.mocked(sendInngestEvent)
const mockFreshClaims = vi.mocked(listFreshClaims)
const mockGetMetaToken = vi.mocked(getMetaTokenForClient)
const mockGetStoredPageToken = vi.mocked(getStoredPageToken)
const mockGetPageToken = vi.mocked(getPageAccessToken)
const mockPublish = vi.mocked(publishPagePhotoPost)
const mockFirstComment = vi.mocked(ensureFacebookFirstComment)

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CAMPAIGN_ID = 'a0000000-0000-0000-0000-000000000001'
const PLAN_ID = 'b0000000-0000-0000-0000-000000000001'
const USER_ID = 'f0000000-0000-0000-0000-000000000001'
const PLAN_REVISION = '2026-09-01T15:00:04.513Z'
const REVIEW_REVISION = '10000000-0000-0000-0000-000000000001'
const PAGE_ID = '227633594573276'
const DATES = ['2026-09-03', '2026-09-04']
const ASSETS = ['e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002']
const POST_CHECK_KEYS = [
  'factual_claims_have_source', 'factual_claims_source_verified', 'logo_watermark_present',
  'asset_provenance_labeled', 'asset_provenance_matches_claim_context',
]
const POST_AUTO_KEYS = ['cta_in_first_comment_not_body', 'first_comment_link_has_tracking_params']
const PASS_POST_CHECKLIST = [
  ...POST_CHECK_KEYS.map(key => ({ key, judge: 'HUMAN', outcome: 'PASS', detail: null, source_ref: key.startsWith('factual_') ? 'https://example.test/source' : null })),
  ...POST_AUTO_KEYS.map(key => ({ key, judge: 'AUTO', outcome: 'PASS', detail: 'measured', source_ref: null })),
]

function keyFor(date: string) {
  return publishIdempotencyKey({
    clientId: CLIENT_ID,
    planId: PLAN_ID,
    planRevision: PLAN_REVISION,
    reviewRevision: REVIEW_REVISION,
    date,
  })
}

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/campaign-daily-plan/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      campaign_id: CAMPAIGN_ID,
      plan_id: PLAN_ID,
      plan_revision: PLAN_REVISION,
      review_revision: REVIEW_REVISION,
      page_id: PAGE_ID,
      approved: true,
      publish_authorization: true,
      ...overrides,
    }),
  })
}

const params = { params: { id: CLIENT_ID } }

function queueReceipt() {
  return {
    schema_version: 1,
    event_name: 'daily_plan.publish_queue.ready',
    event_id: 'evt_queue_1',
    request_id: '20000000-0000-0000-0000-000000000001',
    plan_revision: PLAN_REVISION,
    review_revision: REVIEW_REVISION,
    status: 'READY_NO_PUBLISH',
    no_publish: true,
    publishing_authorization: 'NOT_AUTHORIZED',
    provider_impact: 'NONE',
    cost_usd: 0,
    created_at: '2026-09-01T15:10:00.000Z',
    created_by_user_id: USER_ID,
    posts: DATES.map((date, index) => ({
      date,
      image_asset_id: ASSETS[index],
      cta_url: 'https://ctstours.co.nz/tours/china-classic',
      review_verdict: 'PASS',
    })),
  }
}

function planData(overrides: Record<string, unknown> = {}) {
  return {
    plan_kind: 'campaign_daily_v1',
    campaign_id: CAMPAIGN_ID,
    master_brief_ref: null,
    days: DATES.map(date => ({ date, slots: { post: 'PLANNED', story: 'PLANNED', reel: 'PLANNED' } })),
    bundles: DATES.map((date, index) => ({
      date,
      post: {
        hook: `Hook ${index + 1}`,
        body: `Body ${index + 1}`,
        cta: 'Enquire now',
        cta_url: 'https://ctstours.co.nz/tours/china-classic',
        image_asset_id: ASSETS[index],
      },
      story: null,
      reel: null,
    })),
    command_meta: { source: 'conversation_command', received_at: PLAN_REVISION, raw_summary: null },
    review_meta: {
      schema_version: 1,
      plan_revision: PLAN_REVISION,
      revision: REVIEW_REVISION,
      updated_at: '2026-09-01T15:05:00.000Z',
      posts: Object.fromEntries(DATES.map(date => [date, {
        verdict: 'PASS',
        reason: null,
        reviewed_at: '2026-09-01T15:05:00.000Z',
        reviewed_by_user_id: USER_ID,
        reviewer_role: 'admin',
        checklist: PASS_POST_CHECKLIST,
      }])),
    },
    publish_queue_meta: queueReceipt(),
    ...overrides,
  }
}

/**
 * One table's query handle. `terminal` is the method that actually awaits for
 * that table's query in the route, so a shape change in the route surfaces as
 * a failing test instead of a silently pending promise.
 */
function chain(result: unknown, terminal: 'limit' | 'in' | 'maybeSingle') {
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'contains', 'order', 'limit', 'in', 'is', 'update', 'maybeSingle']) {
    query[method] = vi.fn().mockReturnValue(query)
  }
  query[terminal] = vi.fn().mockResolvedValue(result)
  return query
}

interface TableState {
  plan?: Record<string, unknown>
  assets?: unknown[]
  facebookPageId?: string | null
  updateResult?: unknown
  /** `source` on every stubbed client_assets row; null models a missing source. */
  assetSource?: string | null
  /** Error returned by the cron_run_logs insert (measurement failure record). */
  recordInsertError?: { message: string } | null
  /** `clients.factory_config` as the price fact check reads it. */
  factoryConfig?: Record<string, unknown> | null
  /** Make the `clients` read fail (the price fact check must then fail closed). */
  clientsReadError?: { message: string }
}

let updateSpy: ReturnType<typeof vi.fn>
let recordInsertSpy: ReturnType<typeof vi.fn>

/** Fake Supabase modelled by TABLE, not by call order. */
function stubTables(state: TableState = {}) {
  const plan = state.plan ?? planData()
  const assets = state.assets ?? ASSETS.map(id => ({
    id,
    storage_url: `https://assets.test/${id}.jpg`,
    mime_type: 'image/jpeg',
    status: 'analyzed',
    archived_at: null,
    source: state.assetSource === undefined ? 'client_verified' : state.assetSource,
  }))
  updateSpy = vi.fn()
  recordInsertSpy = vi.fn()

  mockFrom.mockImplementation(((table: string) => {
    if (table === 'cron_run_logs') {
      return {
        insert: vi.fn().mockImplementation(async (row: unknown) => {
          recordInsertSpy(row)
          return { error: state.recordInsertError ?? null }
        }),
      }
    }
    if (table === 'client_assets') return chain({ data: assets, error: null }, 'in')
    if (table === 'clients') {
      return chain(
        state.clientsReadError
          ? { data: null, error: state.clientsReadError }
          : { data: { facebook_page_id: state.facebookPageId ?? PAGE_ID, factory_config: state.factoryConfig ?? null }, error: null },
        'maybeSingle',
      )
    }
    if (table === 'social_plans') {
      const read = chain({ data: [{ id: PLAN_ID, plan_data: plan, created_at: PLAN_REVISION }], error: null }, 'limit')
      const write = chain(state.updateResult ?? { data: { id: PLAN_ID }, error: null }, 'maybeSingle')
      // `update()` marks this handle as the write path and records the payload.
      read.update = vi.fn().mockImplementation((payload: unknown) => {
        updateSpy(payload)
        return write
      })
      return read
    }
    throw new Error(`unexpected table ${table}`)
  }) as never)
}

function allow() {
  mockAccess.mockResolvedValue({
    ok: true,
    user: { id: USER_ID, email: 'ray@example.test' },
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  } as never)
}

function armProvider() {
  mockGetStoredPageToken.mockResolvedValue('stored-page-token')
  mockGetMetaToken.mockResolvedValue('user-token')
  mockGetPageToken.mockResolvedValue('page-token')
  mockSendInngestEvent.mockResolvedValue({ event_ids: ['evt_pub_1'] })
  let counter = 0
  mockPublish.mockImplementation(async () => {
    counter += 1
    return {
      postId: `${PAGE_ID}_175000009${counter}`,
      postIdSource: 'post_id' as const,
      permalink: `https://www.facebook.com/${PAGE_ID}_175000009${counter}`,
      raw: { id: `photo_${counter}`, post_id: `${PAGE_ID}_175000009${counter}` },
    }
  })
}

beforeEach(() => {
  allow()
  mockFirstComment.mockResolvedValue('comment_1')
  mockFreshClaims.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('publish bridge — fail-closed authorisation', () => {
  it.each([
    ['approved missing', { approved: undefined }],
    ['publish_authorization missing', { publish_authorization: undefined }],
    ['approved false', { approved: false }],
    ['publish_authorization false', { publish_authorization: false }],
    ['page_id missing', { page_id: undefined }],
    ['plan_revision missing', { plan_revision: undefined }],
  ])('refuses (%s) before touching the database or Facebook', async (_label, overrides) => {
    const response = await POST(request(overrides), params)

    expect(response.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
    expect(mockGetMetaToken).not.toHaveBeenCalled()
    expect(mockSendInngestEvent).not.toHaveBeenCalled()
  })

  it('refuses when the body client_id disagrees with the path', async () => {
    const response = await POST(request({ client_id: 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84' }), params)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('CLIENT_ID_MISMATCH')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('refuses when the caller lacks paid client access', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'nope', reason: 'paid_only' } as never)

    const response = await POST(request({ no_publish: false }), params)

    expect(response.status).toBe(403)
    expect(mockPublish).not.toHaveBeenCalled()
  })
})

describe('publish bridge — dry run is the default', () => {
  it('performs no provider call, no event and no write when no_publish is omitted', async () => {
    stubTables()

    const response = await POST(request(), params)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.status).toBe('DRY_RUN')
    expect(json.provider_impact).toBe('NONE')
    expect(json.would_publish.map((p: { date: string }) => p.date)).toEqual(DATES)
    expect(json.would_publish[0].idempotency_key).toBe(keyFor(DATES[0]))
    expect(mockPublish).not.toHaveBeenCalled()
    expect(mockSendInngestEvent).not.toHaveBeenCalled()
    expect(mockGetMetaToken).not.toHaveBeenCalled()
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('reports already-published dates as duplicates instead of re-listing them', async () => {
    stubTables({
      plan: planData({
        publish_meta: {
          schema_version: 1,
          event_name: 'daily_plan.post.published',
          status: 'PARTIAL',
          request_id: '30000000-0000-0000-0000-000000000001',
          client_id: CLIENT_ID,
          campaign_id: CAMPAIGN_ID,
          plan_id: PLAN_ID,
          plan_revision: PLAN_REVISION,
          review_revision: REVIEW_REVISION,
          page_id: PAGE_ID,
          publishing_authorization: 'AUTHORIZED',
          approved_by_user_id: USER_ID,
          created_at: '2026-09-02T00:00:00.000Z',
          published: [{
            date: DATES[0],
            idempotency_key: keyFor(DATES[0]),
            post_id: `${PAGE_ID}_11`,
            post_id_source: 'post_id',
            page_id: PAGE_ID,
            published_at: '2026-09-02T00:00:00.000Z',
            permalink: `https://www.facebook.com/${PAGE_ID}_11`,
            provider_response: {},
          }],
          failed: [],
          event_ids: ['evt_old'],
        },
      }),
    })

    const json = await (await POST(request(), params)).json()

    expect(json.would_publish.map((p: { date: string }) => p.date)).toEqual([DATES[1]])
    expect(json.already_published.map((p: { date: string }) => p.date)).toEqual([DATES[0]])
  })
})

describe('publish bridge — review chain is mandatory', () => {
  it('refuses a legacy PASS whose structured checklist is absent', async () => {
    const plan = planData()
    const posts = (plan as unknown as { review_meta: { posts: Record<string, Record<string, unknown>> } }).review_meta.posts
    delete posts[DATES[0]].checklist
    delete posts[DATES[0]].reviewer_role
    stubTables({ plan })

    const response = await POST(request({ no_publish: false }), params)

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('REVIEW_CHECKLIST_REQUIRED')
    expect(mockPublish).not.toHaveBeenCalled()
    expect(mockGetMetaToken).not.toHaveBeenCalled()
  })

  it('refuses to publish a plan that never got a no-publish queue receipt', async () => {
    const plan = planData()
    delete (plan as Record<string, unknown>).publish_queue_meta
    stubTables({ plan })

    const response = await POST(request({ no_publish: false }), params)

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('PUBLISH_QUEUE_RECEIPT_REQUIRED')
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('refuses when the reviewer approved a different revision than the caller names', async () => {
    stubTables()

    const response = await POST(
      request({ no_publish: false, review_revision: '10000000-0000-0000-0000-000000000009' }),
      params
    )

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('REVIEW_REVISION_MISMATCH')
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('refuses a date that is not in the reviewed set', async () => {
    stubTables()

    const response = await POST(request({ no_publish: false, dates: ['2026-09-30'] }), params)

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('DATE_NOT_IN_REVIEWED_SET')
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('refuses when the caller names a Page the client is not registered against', async () => {
    stubTables({ facebookPageId: '999999999999999' })
    armProvider()

    const response = await POST(request({ no_publish: false }), params)

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('PAGE_ID_MISMATCH')
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('refuses with a status a CDN will pass through when no Page token resolves', async () => {
    stubTables()
    mockGetStoredPageToken.mockResolvedValue(null)
    mockGetMetaToken.mockResolvedValue('user-token')
    mockGetPageToken.mockResolvedValue(null)

    const response = await POST(request({ no_publish: false }), params)
    const json = await response.json()

    // Never 502/504: a proxy replaces those bodies with its own error page,
    // which is exactly how this refusal once reached the browser as
    // "Bad gateway" with the real reason stripped out.
    expect([502, 504]).not.toContain(response.status)
    expect(response.status).toBe(424)
    expect(json.error).toBe('PAGE_TOKEN_UNAVAILABLE')
    expect(json.detail).toContain('重新授权')
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('says plainly when the client has no Meta token configured at all', async () => {
    stubTables()
    mockGetStoredPageToken.mockResolvedValue(null)
    mockGetMetaToken.mockResolvedValue(null)

    const response = await POST(request({ no_publish: false }), params)
    const json = await response.json()

    expect(response.status).toBe(424)
    expect(json.detail).toContain('既没有存下来的主页授权，也没有配置 Meta 令牌')
    expect(mockPublish).not.toHaveBeenCalled()
  })
})

describe('publish bridge — token source', () => {
  it('uses the stored Page authorisation and never touches the hand-pasted token', async () => {
    stubTables()
    armProvider()

    await POST(request({ no_publish: false, dates: [DATES[0]] }), params)

    expect(mockGetStoredPageToken).toHaveBeenCalledWith(CLIENT_ID, PAGE_ID)
    expect(mockGetMetaToken).not.toHaveBeenCalled()
    expect(mockPublish.mock.calls[0][0].pageAccessToken).toBe('stored-page-token')
  })

  it('falls back to the env token only when nothing is stored', async () => {
    stubTables()
    armProvider()
    mockGetStoredPageToken.mockResolvedValue(null)

    await POST(request({ no_publish: false, dates: [DATES[0]] }), params)

    expect(mockGetMetaToken).toHaveBeenCalledWith(CLIENT_ID)
    expect(mockPublish.mock.calls[0][0].pageAccessToken).toBe('page-token')
  })

  it('tells the reader to re-authorise, naming where the button is', async () => {
    stubTables()
    mockGetStoredPageToken.mockResolvedValue(null)
    mockGetMetaToken.mockResolvedValue('user-token')
    mockGetPageToken.mockResolvedValue(null)

    const json = await (await POST(request({ no_publish: false }), params)).json()

    expect(json.detail).toContain('平台连接')
    expect(json.detail).toContain('连接 Meta')
  })
})

describe('publish bridge — live run records real provider ids', () => {
  it.each([
    { label: 'future post', now: '2026-09-02T00:00:00.000Z', offset: 0,
      scheduled: '2026-09-02T20:00:00.000Z', early: '2026-09-03T00:00:00.000Z', late: '2026-09-05T20:00:00.000Z' },
    { label: 'offset future post', now: '2026-09-03T00:00:00.000Z', offset: 1,
      scheduled: '2026-09-03T20:00:00.000Z', early: '2026-09-04T00:00:00.000Z', late: '2026-09-06T20:00:00.000Z' },
    { label: 'immediate post', now: '2026-09-03T00:00:00.000Z', offset: 0,
      scheduled: undefined, early: '2026-09-03T04:00:00.000Z', late: '2026-09-06T00:00:00.000Z' },
  ])('anchors measurement to delivery, not submission: $label', async ({ now, offset, scheduled, early, late }) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    stubTables()
    armProvider()

    const response = await POST(request({ no_publish: false, dates: [DATES[0]], date_offset_days: offset }), params)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(mockPublish.mock.calls[0][0].scheduledPublishTime?.toISOString()).toBe(scheduled)
    expect(json.receipt.published[0].scheduled_publish_time).toBe(scheduled)
    expect(json.receipt.published[0].published_at).toBe(now)
    expect(mockSendInngestEvent).toHaveBeenCalledTimes(1)
    const event = mockSendInngestEvent.mock.calls[0][0]
    expect(event.id).toBe(keyFor(DATES[0]))
    expect(event.name).toBe('daily_plan.post.published')
    expect(event.data.published_at).toBe(now)
    expect(event.data.measure_at).toEqual([{ hours: 4, at: early }, { hours: 72, at: late }])
    if (scheduled) expect(event.data.scheduled_publish_time).toBe(scheduled)
    else expect(event.data).not.toHaveProperty('scheduled_publish_time')
  })

  it('publishes each reviewed Post once and stores the real ids', async () => {
    stubTables()
    armProvider()

    const response = await POST(request({ no_publish: false }), params)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.status).toBe('PUBLISHED')
    expect(mockPublish).toHaveBeenCalledTimes(2)
    expect(json.receipt.published.map((p: { post_id: string }) => p.post_id)).toEqual([
      `${PAGE_ID}_1750000091`,
      `${PAGE_ID}_1750000092`,
    ])
    expect(json.receipt.published[0].page_id).toBe(PAGE_ID)
    expect(json.receipt.published[0].published_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(json.receipt.published[0].provider_response).toEqual({ id: 'photo_1', post_id: `${PAGE_ID}_1750000091` })
    expect(json.receipt.publishing_authorization).toBe('AUTHORIZED')
    expect(json.receipt.approved_by_user_id).toBe(USER_ID)
  })

  it('sends the caption built from the reviewed copy, not from caller input', async () => {
    stubTables()
    armProvider()

    await POST(request({ no_publish: false, dates: [DATES[0]] }), params)

    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(mockPublish.mock.calls[0][0]).toMatchObject({
      pageId: PAGE_ID,
      pageAccessToken: 'stored-page-token',
      imageUrl: `https://assets.test/${ASSETS[0]}.jpg`,
      message: 'Hook 1\n\nBody 1',
    })
  })

  it('emits one measurement event per Post with T+4/T+72 and the idempotency key', async () => {
    stubTables()
    armProvider()

    await POST(request({ no_publish: false, dates: [DATES[0]] }), params)

    expect(mockSendInngestEvent).toHaveBeenCalledTimes(1)
    const event = mockSendInngestEvent.mock.calls[0][0]
    expect(event.name).toBe('daily_plan.post.published')
    expect(event.id).toBe(keyFor(DATES[0]))
    expect(event.data).toMatchObject({
      client_id: CLIENT_ID,
      plan_id: PLAN_ID,
      date: DATES[0],
      post_id: `${PAGE_ID}_1750000091`,
      page_id: PAGE_ID,
      measure_at: [
        { hours: 4, at: expect.any(String) },
        { hours: 72, at: expect.any(String) },
      ],
    })
  })

  it('persists the receipt onto the plan snapshot', async () => {
    stubTables()
    armProvider()

    await POST(request({ no_publish: false }), params)

    expect(updateSpy).toHaveBeenCalledTimes(1)
    const written = updateSpy.mock.calls[0][0] as { plan_data: { publish_meta: { published: unknown[] } } }
    expect(written.plan_data.publish_meta.published).toHaveLength(2)
  })

  it('keeps going after one Post fails and reports PARTIAL', async () => {
    stubTables()
    armProvider()
    mockPublish.mockReset()
    mockPublish
      .mockRejectedValueOnce(new Error('publishPagePhotoPost: image url unreachable'))
      .mockResolvedValueOnce({
        postId: `${PAGE_ID}_1750000093`,
        postIdSource: 'post_id',
        permalink: `https://www.facebook.com/${PAGE_ID}_1750000093`,
        raw: { post_id: `${PAGE_ID}_1750000093` },
      } as never)

    const json = await (await POST(request({ no_publish: false }), params)).json()

    expect(json.status).toBe('PARTIAL')
    expect(json.success).toBe(false)
    expect(json.receipt.failed).toHaveLength(1)
    expect(json.receipt.failed[0].date).toBe(DATES[0])
    // a plain Error (not a classified Graph answer) must be recorded as `unknown`: the Post may exist
    expect(json.receipt.failed[0].certainty).toBe('unknown')
    expect(json.receipt.published).toHaveLength(1)
    expect(json.receipt.published[0].post_id).toBe(`${PAGE_ID}_1750000093`)
  })

  it('never posts a Post whose idempotency key is already on the receipt', async () => {
    stubTables({
      plan: planData({
        publish_meta: {
          schema_version: 1,
          event_name: 'daily_plan.post.published',
          status: 'PARTIAL',
          request_id: '30000000-0000-0000-0000-000000000001',
          client_id: CLIENT_ID,
          campaign_id: CAMPAIGN_ID,
          plan_id: PLAN_ID,
          plan_revision: PLAN_REVISION,
          review_revision: REVIEW_REVISION,
          page_id: PAGE_ID,
          publishing_authorization: 'AUTHORIZED',
          approved_by_user_id: USER_ID,
          created_at: '2026-09-02T00:00:00.000Z',
          published: [{
            date: DATES[0],
            idempotency_key: keyFor(DATES[0]),
            post_id: `${PAGE_ID}_11`,
            post_id_source: 'post_id',
            page_id: PAGE_ID,
            published_at: '2026-09-02T00:00:00.000Z',
            permalink: `https://www.facebook.com/${PAGE_ID}_11`,
            provider_response: {},
          }],
          failed: [],
          event_ids: ['evt_old'],
        },
      }),
    })
    armProvider()

    const json = await (await POST(request({ no_publish: false }), params)).json()

    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(mockPublish.mock.calls[0][0].message).toContain('Hook 2')
    expect(json.skipped_as_duplicate.map((p: { date: string }) => p.date)).toEqual([DATES[0]])
    expect(json.receipt.published).toHaveLength(2)
    expect(json.receipt.event_ids).toEqual(['evt_old', 'evt_pub_1'])
  })

  it('hands back the real post ids even when the receipt cannot be stored', async () => {
    stubTables({ updateResult: { data: null, error: null } })
    armProvider()

    const response = await POST(request({ no_publish: false }), params)
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error).toBe('PUBLISH_RECEIPT_NOT_PERSISTED')
    expect(json.receipt.published.map((p: { post_id: string }) => p.post_id)).toEqual([
      `${PAGE_ID}_1750000091`,
      `${PAGE_ID}_1750000092`,
    ])
  })

  it('🔴 scheduled photo (Graph returns only id): receipt keeps the photo id, a story-resolve event is sent, no published event', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'))
    stubTables()
    armProvider()
    mockPublish.mockReset()
    // Real Graph shape for a scheduled photo: `{id}` only.
    mockPublish.mockResolvedValueOnce({
      postId: '1750835520181969',
      postIdSource: 'id',
      permalink: 'https://www.facebook.com/1750835520181969',
      raw: { id: '1750835520181969' },
    })

    const response = await POST(request({ no_publish: false, dates: [DATES[0]] }), params)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.status).toBe('PUBLISHED')
    expect(json.receipt.failed).toEqual([])
    const entry = json.receipt.published[0]
    expect(entry.post_id).toBe('1750835520181969')
    expect(entry.post_id_source).toBe('id')
    expect(entry.scheduled_publish_time).toBe('2026-09-02T20:00:00.000Z')
    expect(entry).not.toHaveProperty('measurement_skipped_reason')
    expect(CampaignDailyPublishMetaSchema.safeParse(json.receipt).success).toBe(true)

    expect(mockSendInngestEvent).toHaveBeenCalledTimes(1)
    const event = mockSendInngestEvent.mock.calls[0][0]
    expect(event.name).toBe('daily_plan.post.story_resolve_due')
    expect(event.id).toBe(`${keyFor(DATES[0])}:resolve:1750835520181969`)
    expect(StoryResolveDueSchema.safeParse(event.data).success).toBe(true)
    expect(event.data).toMatchObject({
      client_id: CLIENT_ID,
      campaign_id: CAMPAIGN_ID,
      plan_id: PLAN_ID,
      plan_revision: PLAN_REVISION,
      review_revision: REVIEW_REVISION,
      date: DATES[0],
      idempotency_key: keyFor(DATES[0]),
      photo_id: '1750835520181969',
      page_id: PAGE_ID,
      scheduled_publish_time: '2026-09-02T20:00:00.000Z',
      measure_at: [
        { hours: 4, at: '2026-09-03T00:00:00.000Z' },
        { hours: 72, at: '2026-09-05T20:00:00.000Z' },
      ],
    })
    // It must not smuggle a post id in: the story id does not exist yet.
    expect(event.data).not.toHaveProperty('post_id')
    expect(DailyPlanPostPublishedEventSchema.safeParse(event.data).success).toBe(false)
    expect(json.receipt.event_ids).toEqual(['evt_pub_1'])
    expect(json.measurement_skipped).toEqual([])
  })

  it('🔴 contract violation: stays published (no re-post), no event sent, reason recorded and surfaced', async () => {
    stubTables()
    armProvider()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPublish.mockReset()
    // A non-numeric photo id cannot satisfy the story-resolve contract.
    mockPublish.mockResolvedValueOnce({
      postId: 'not-a-photo-id',
      postIdSource: 'id',
      permalink: 'https://www.facebook.com/not-a-photo-id',
      raw: { id: 'not-a-photo-id' },
    })

    const response = await POST(request({ no_publish: false, dates: [DATES[0]] }), params)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.status).toBe('PUBLISHED')
    expect(json.receipt.failed).toEqual([])
    const entry = json.receipt.published[0]
    expect(entry.measurement_skipped_reason).toBe('event_contract_invalid')
    expect(mockSendInngestEvent).not.toHaveBeenCalled()
    expect(recordInsertSpy).toHaveBeenCalledTimes(1)
    expect(recordInsertSpy.mock.calls[0][0]).toMatchObject({
      status: 'failed',
      summary: { outcome: 'event_contract_invalid', client_id: CLIENT_ID, date: DATES[0], idempotency_key: keyFor(DATES[0]), photo_id: 'not-a-photo-id' },
    })
    expect(json.receipt.event_ids).toEqual([])
    expect(json.measurement_skipped).toEqual([
      { date: DATES[0], post_id: 'not-a-photo-id', reason: entry.measurement_skipped_reason },
    ])
    expect(CampaignDailyPublishMetaSchema.safeParse(json.receipt).success).toBe(true)
  })

  it('🔴 scheduled photo: resolve event send fails → failed record for the to-do list, receipt PUBLISHED, posted once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'))
    stubTables()
    armProvider()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSendInngestEvent.mockRejectedValue(new Error('INNGEST_EVENT_KEY_MISSING'))
    mockPublish.mockReset()
    mockPublish.mockResolvedValueOnce({
      postId: '1750835520181969',
      postIdSource: 'id',
      permalink: 'https://www.facebook.com/1750835520181969',
      raw: { id: '1750835520181969' },
    })

    const response = await POST(request({ no_publish: false, dates: [DATES[0]] }), params)
    const json = await response.json()

    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
    expect(json.status).toBe('PUBLISHED')
    expect(json.receipt.failed).toEqual([])
    expect(json.receipt.published[0].measurement_skipped_reason).toBe('event_send_failed')
    expect(json.receipt.event_ids).toEqual([])
    expect(recordInsertSpy).toHaveBeenCalledTimes(1)
    expect(recordInsertSpy.mock.calls[0][0]).toMatchObject({
      job_name: 'daily-plan-post-story-resolve',
      status: 'failed',
      summary: {
        outcome: 'event_send_failed',
        client_id: CLIENT_ID,
        date: DATES[0],
        idempotency_key: keyFor(DATES[0]),
        photo_id: '1750835520181969',
      },
    })
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(json.measurement_skipped).toEqual([
      { date: DATES[0], post_id: '1750835520181969', reason: 'event_send_failed' },
    ])
  })

  it('🔴 immediate post: event send fails and the failure record cannot be written → receipt still saved, not a failed batch', async () => {
    stubTables({ recordInsertError: { message: 'cron_run_logs unavailable' } })
    armProvider()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSendInngestEvent.mockRejectedValue(new Error('network'))

    const response = await POST(request({ no_publish: false, dates: [DATES[0]] }), params)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.status).toBe('PUBLISHED')
    expect(json.success).toBe(true)
    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(recordInsertSpy).toHaveBeenCalledTimes(1)
    expect(recordInsertSpy.mock.calls[0][0]).toMatchObject({ summary: { outcome: 'event_send_failed', post_id: `${PAGE_ID}_1750000091` } })
    expect(json.receipt.published[0].measurement_skipped_reason).toBe('event_send_failed')
    expect(updateSpy).toHaveBeenCalledTimes(1)
  })

  it('🔴 a re-run over a receipt holding a bare photo id does not publish that date again', async () => {
    stubTables({
      plan: planData({
        publish_meta: {
          schema_version: 1,
          event_name: 'daily_plan.post.published',
          status: 'PUBLISHED',
          request_id: '30000000-0000-0000-0000-000000000001',
          client_id: CLIENT_ID,
          campaign_id: CAMPAIGN_ID,
          plan_id: PLAN_ID,
          plan_revision: PLAN_REVISION,
          review_revision: REVIEW_REVISION,
          page_id: PAGE_ID,
          publishing_authorization: 'AUTHORIZED',
          approved_by_user_id: USER_ID,
          created_at: '2026-09-02T00:00:00.000Z',
          // Legacy shape already in production: scheduled photo, bare photo id.
          published: [{
            date: DATES[0],
            idempotency_key: keyFor(DATES[0]),
            post_id: '1750835520181969',
            post_id_source: 'id',
            page_id: PAGE_ID,
            published_at: '2026-09-02T00:00:00.000Z',
            scheduled_publish_time: '2026-09-02T20:00:00.000Z',
            permalink: 'https://www.facebook.com/1750835520181969',
            provider_response: { id: '1750835520181969' },
          }],
          failed: [],
          event_ids: [],
        },
      }),
    })
    armProvider()

    const json = await (await POST(request({ no_publish: false, dates: [DATES[0]] }), params)).json()

    expect(json.status).toBe('PUBLISHED')
    expect(mockPublish).not.toHaveBeenCalled()
    expect(mockSendInngestEvent).not.toHaveBeenCalled()
    expect(json.skipped_as_duplicate.map((p: { date: string }) => p.date)).toEqual([DATES[0]])
    expect(json.receipt.published[0].post_id).toBe('1750835520181969')
  })

  it('still returns the post id when the measurement event fails to send', async () => {
    stubTables()
    armProvider()
    mockSendInngestEvent.mockRejectedValue(new Error('INNGEST_EVENT_KEY_MISSING'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const json = await (await POST(request({ no_publish: false, dates: [DATES[0]] }), params)).json()

    expect(json.status).toBe('PUBLISHED')
    expect(json.receipt.published[0].post_id).toBe(`${PAGE_ID}_1750000091`)
    expect(json.receipt.event_ids).toEqual([])
  })
})

describe('publish bridge — price claim gate', () => {
  /** Plan whose reviewed copy carries a real price in every Post body. */
  function pricedPlan() {
    const plan = planData()
    for (const bundle of (plan as unknown as { bundles: Array<{ post: { body: string } }> }).bundles) {
      bundle.post.body = 'Tour from NZD $2,699 per person'
    }
    return plan
  }

  it('blocks a dry run before any provider call, so the reviewer sees it pre-authorisation', async () => {
    stubTables({ plan: pricedPlan(), assetSource: 'stock' })

    const response = await POST(request(), params)
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.error).toBe('PRICE_CLAIM_UNBACKED')
    expect(json.blocked.map((b: { date: string }) => b.date)).toEqual(DATES)
    for (const block of json.blocked as Array<{ message: string }>) {
      expect(typeof block.message).toBe('string')
      expect(block.message.length).toBeGreaterThan(0)
    }
    expect(typeof json.hint).toBe('string')
    expect(json.hint.length).toBeGreaterThan(0)
    expect(mockPublish).not.toHaveBeenCalled()
    expect(mockSendInngestEvent).not.toHaveBeenCalled()
    expect(mockGetMetaToken).not.toHaveBeenCalled()
  })

  it('blocks a live run before token lookup, provider call or receipt write', async () => {
    stubTables({ plan: pricedPlan(), assetSource: 'stock' })
    armProvider()

    const response = await POST(request({ no_publish: false }), params)
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.error).toBe('PRICE_CLAIM_UNBACKED')
    expect(mockPublish).not.toHaveBeenCalled()
    expect(mockSendInngestEvent).not.toHaveBeenCalled()
    expect(mockGetStoredPageToken).not.toHaveBeenCalled()
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('lets a backed price claim publish normally', async () => {
    // Image is client-verified AND the price matches the client's confirmed facts (second gate).
    const factoryConfig = {
      render: { creatomate: { offers: { tour: { tour: 'Classic China', url: 'https://ctstours.co.nz/tours/china-classic', price_line: 'From NZD $2,699 pp' } } } },
    }
    stubTables({ plan: pricedPlan(), assetSource: 'client_verified', factoryConfig })
    armProvider()

    const response = await POST(request({ no_publish: false }), params)

    expect(response.status).toBe(200)
    expect(mockPublish).toHaveBeenCalledTimes(DATES.length)
  })

  it('fails closed when the asset row has no source at all', async () => {
    stubTables({ plan: pricedPlan(), assetSource: null })
    armProvider()

    const response = await POST(request({ no_publish: false }), params)
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.error).toBe('PRICE_CLAIM_UNBACKED')
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('does not block an unpriced Post even when the asset source is unbacked', async () => {
    stubTables({ assetSource: 'stock' })
    armProvider()

    const response = await POST(request({ no_publish: false }), params)

    expect(response.status).toBe(200)
    expect(mockPublish).toHaveBeenCalledTimes(DATES.length)
  })
})

describe('publish bridge — first comment', () => {
  it('posts the first comment on an immediate publish, keyed to the real post id', async () => {
    stubTables()
    armProvider()

    const json = await (await POST(request({ no_publish: false, dates: [DATES[0]] }), params)).json()

    expect(mockFirstComment).toHaveBeenCalledTimes(1)
    const call = mockFirstComment.mock.calls[0][0]
    expect(call.objectId).toBe(`${PAGE_ID}_1750000091`)
    expect(call.expectedPageId).toBe(PAGE_ID)
    expect(call.failureLabel).toBe('每日计划帖')
    expect(call.message).toContain('Enquire now')
    expect(call.message).toContain('utm_content=')
    expect(json.receipt.published[0].first_comment_status).toBe('POSTED')
    expect(json.receipt.published[0].first_comment_id).toBe('comment_1')
  })

  it('marks a scheduled photo PENDING_PUBLISH and carries the comment text into the resolve event', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'))
    stubTables()
    armProvider()
    mockPublish.mockReset()
    mockPublish.mockResolvedValueOnce({
      postId: '1750835520181969',
      postIdSource: 'id',
      permalink: 'https://www.facebook.com/1750835520181969',
      raw: { id: '1750835520181969' },
    })

    const json = await (await POST(request({ no_publish: false, dates: [DATES[0]] }), params)).json()

    expect(mockFirstComment).not.toHaveBeenCalled()
    expect(json.receipt.published[0].first_comment_status).toBe('PENDING_PUBLISH')
    expect(mockSendInngestEvent).toHaveBeenCalledTimes(1)
    const event = mockSendInngestEvent.mock.calls[0][0]
    expect(event.name).toBe('daily_plan.post.story_resolve_due')
    expect(event.data.first_comment_text).toContain('Enquire now')
  })

  it('🔴 scheduled publish: event send fails → failure record carries the pending first comment text', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'))
    stubTables()
    armProvider()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSendInngestEvent.mockRejectedValue(new Error('INNGEST_EVENT_KEY_MISSING'))
    mockPublish.mockReset()
    mockPublish.mockResolvedValueOnce({
      postId: '1750835520181969',
      postIdSource: 'id',
      permalink: 'https://www.facebook.com/1750835520181969',
      raw: { id: '1750835520181969' },
    })

    const response = await POST(request({ no_publish: false, dates: [DATES[0]] }), params)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.receipt.published[0].measurement_skipped_reason).toBe('event_send_failed')
    expect(json.receipt.published[0].first_comment_status).toBe('PENDING_PUBLISH')
    expect(recordInsertSpy).toHaveBeenCalledTimes(1)
    expect(recordInsertSpy.mock.calls[0][0]).toMatchObject({
      summary: {
        outcome: 'event_send_failed',
        photo_id: '1750835520181969',
        first_comment_text: expect.stringContaining('Enquire now'),
      },
    })
  })

  it('keeps the Post published when the first comment throws — no re-post, no failed entry', async () => {
    stubTables()
    armProvider()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFirstComment.mockRejectedValue(new Error('boom'))

    const response = await POST(request({ no_publish: false, dates: [DATES[0]] }), params)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(json.receipt.failed).toEqual([])
    expect(json.receipt.published[0].first_comment_status).toBe('FAILED')
  })

  it('refuses a Post whose body carries the CTA link, before any provider call', async () => {
    const plan = planData()
    const bundles = (plan as unknown as { bundles: Array<{ post: { body: string } }> }).bundles
    bundles[0].post.body = 'Book at https://ctstours.co.nz/x'
    stubTables({ plan })
    armProvider()

    const response = await POST(request({ no_publish: false }), params)
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.error).toBe('FIRST_COMMENT_CHECK_FAILED')
    expect(json.blocked.map((b: { date: string }) => b.date)).toEqual([DATES[0]])
    expect(mockPublish).not.toHaveBeenCalled()
    expect(mockSendInngestEvent).not.toHaveBeenCalled()
    expect(mockGetStoredPageToken).not.toHaveBeenCalled()
  })

  it('refuses the same leak on a dry run', async () => {
    const plan = planData()
    const bundles = (plan as unknown as { bundles: Array<{ post: { body: string } }> }).bundles
    bundles[0].post.body = 'Book at https://ctstours.co.nz/x'
    stubTables({ plan })

    const response = await POST(request(), params)

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('FIRST_COMMENT_CHECK_FAILED')
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('previews the first comment on a dry run without posting it', async () => {
    stubTables()

    const json = await (await POST(request(), params)).json()

    expect(typeof json.would_publish[0].first_comment_preview).toBe('string')
    expect(json.would_publish[0].first_comment_preview).toContain('Enquire now')
    expect(mockFirstComment).not.toHaveBeenCalled()
  })
})

describe('publish bridge — price fact check', () => {
  // Fictional operator; the check is client-agnostic and reads facts from `clients.factory_config`.
  const FACTORY_CONFIG = {
    render: {
      creatomate: {
        offers: {
          'alps-akl': {
            tour: 'Alpine Journeys — Swiss Alps Explorer (Auckland departure)',
            price_line: '8 Nights · From NZD $5,400 pp',
            single_supplement: 'NZD $650',
            url: 'https://ctstours.co.nz/tours/china-classic',
          },
        },
      },
    },
  }

  function pricedPlan(price: string) {
    return planData({
      bundles: DATES.map((date, index) => ({
        date,
        post: {
          hook: 'Swiss Alps Explorer',
          body: `Departing Auckland. ${price} per person twin share.`,
          cta: 'Enquire now',
          cta_url: 'https://ctstours.co.nz/tours/china-classic',
          image_asset_id: ASSETS[index],
        },
        story: null,
        reel: null,
      })),
    })
  }

  it('lets a price that matches the client facts through (dry run)', async () => {
    stubTables({ plan: pricedPlan('NZD $5,400'), factoryConfig: FACTORY_CONFIG })

    const response = await POST(request(), params)

    expect(response.status).toBe(200)
    expect((await response.json()).mode).toBe('DRY_RUN')
  })

  it('blocks a wrong price on a dry run, naming each date and the real number', async () => {
    stubTables({ plan: pricedPlan('NZD $4,400'), factoryConfig: FACTORY_CONFIG })

    const response = await POST(request(), params)
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.error).toBe('PRICE_FACT_UNVERIFIED')
    expect(json.blocked.map((b: { date: string }) => b.date)).toEqual(DATES)
    expect(json.blocked[0].reason).toBe('mismatch')
    expect(json.blocked[0].message).toContain('4,400')
    expect(json.blocked[0].message).toContain('5,400')
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('blocks a live run before token lookup, provider call, event or receipt write', async () => {
    stubTables({ plan: pricedPlan('NZD $4,400'), factoryConfig: FACTORY_CONFIG })
    armProvider()

    const response = await POST(request({ no_publish: false }), params)

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('PRICE_FACT_UNVERIFIED')
    expect(mockPublish).not.toHaveBeenCalled()
    expect(mockSendInngestEvent).not.toHaveBeenCalled()
    expect(mockGetStoredPageToken).not.toHaveBeenCalled()
    expect(mockGetMetaToken).not.toHaveBeenCalled()
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('blocks a priced post when the client has no price facts configured (cannot compare = block)', async () => {
    stubTables({ plan: pricedPlan('NZD $5,400'), factoryConfig: null })

    const response = await POST(request(), params)
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.error).toBe('PRICE_FACT_UNVERIFIED')
    expect(json.blocked[0].reason).toBe('no_facts')
  })

  it('fails closed when the client config cannot be read — never treats it as "nothing to check"', async () => {
    stubTables({ plan: pricedPlan('NZD $5,400'), factoryConfig: FACTORY_CONFIG, clientsReadError: { message: 'db down' } })
    armProvider()

    const response = await POST(request({ no_publish: false }), params)

    expect(response.status).toBe(500)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('does not stop a post that states no price, even with no facts configured', async () => {
    stubTables({ factoryConfig: null })

    const response = await POST(request(), params)

    expect(response.status).toBe(200)
  })

  it('keeps the image-provenance gate first when both gates would block', async () => {
    stubTables({ plan: pricedPlan('NZD $4,400'), factoryConfig: FACTORY_CONFIG, assetSource: 'stock' })

    const response = await POST(request(), params)

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('PRICE_CLAIM_UNBACKED')
  })
})

describe('publish bridge — never races the unattended publisher', () => {
  it('🔴 a live publish is refused while the unattended publisher holds a fresh claim on a requested date', async () => {
    stubTables()
    armProvider()
    mockFreshClaims.mockResolvedValue([{ date: DATES[0] } as never])

    const response = await POST(request({ no_publish: false }), params)
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json).toMatchObject({ error: 'AUTO_PUBLISH_IN_PROGRESS', dates: [DATES[0]] })
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('a claim on a date the caller did not ask for does not block it', async () => {
    stubTables()
    armProvider()
    mockFreshClaims.mockResolvedValue([{ date: '2099-01-01' } as never])

    const response = await POST(request({ no_publish: false, dates: [DATES[1]] }), params)

    expect(response.status).not.toBe(409)
  })

  it('a dry run never looks at claims', async () => {
    stubTables()
    await POST(request({ no_publish: true }), params)
    expect(mockFreshClaims).not.toHaveBeenCalled()
  })

  it('if the auto-publish tables do not exist at all, the manual publish is not blocked', async () => {
    stubTables()
    armProvider()
    mockFreshClaims.mockRejectedValue({ code: '42P01', message: 'relation "daily_plan_auto_publish_attempts" does not exist' })

    const response = await POST(request({ no_publish: false }), params)

    expect(response.status).toBe(200)
  })

  it('🔴 if the claims cannot be read the publish does not go ahead (fail closed)', async () => {
    stubTables()
    armProvider()
    mockFreshClaims.mockRejectedValue(new Error('db down'))

    const response = await POST(request({ no_publish: false }), params)

    expect(response.status).toBe(500)
    expect(mockPublish).not.toHaveBeenCalled()
  })
})

