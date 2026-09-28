import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: vi.fn() }))

import { POST } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import type { ContentCheckItemResult } from '@/lib/social/content-review'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)
const mockSendInngestEvent = vi.mocked(sendInngestEvent)

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CAMPAIGN_ID = 'a0000000-0000-0000-0000-000000000001'
const PLAN_ID = 'b0000000-0000-0000-0000-000000000001'
const USER_ID = 'f0000000-0000-0000-0000-000000000001'
const PLAN_REVISION = '2026-09-01T15:00:04.513Z'
const REVIEW_REVISION = '10000000-0000-0000-0000-000000000001'
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

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/campaign-daily-plan/publish-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      campaign_id: CAMPAIGN_ID,
      plan_id: PLAN_ID,
      expected_plan_revision: PLAN_REVISION,
      expected_review_revision: REVIEW_REVISION,
      no_publish: true,
      ...overrides,
    }),
  })
}

function params(id = CLIENT_ID) {
  return { params: { id } }
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
        cta_url: 'https://example.test/tour',
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
    ...overrides,
  }
}

function chain(resolveAt: string, result: unknown) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['select', 'eq', 'contains', 'order', 'limit', 'update', 'is', 'in', 'maybeSingle']) {
    query[method] = vi.fn().mockReturnValue(query)
  }
  query[resolveAt].mockResolvedValue(result)
  return query
}

function allow() {
  mockAccess.mockResolvedValue({
    ok: true,
    user: { id: USER_ID, email: 'reviewer@example.test' },
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  } as never)
}

function stubLatestPlan(data = planData()) {
  const read = chain('limit', { data: [{ id: PLAN_ID, plan_data: data, created_at: PLAN_REVISION }], error: null })
  mockFrom.mockReturnValueOnce(read as never)
  return read
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('campaign daily publish queue — no-publish Inngest handoff', () => {
  it('rejects missing no_publish=true before reading the database', async () => {
    allow()

    const response = await POST(request({ no_publish: false }), params())

    expect(response.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockSendInngestEvent).not.toHaveBeenCalled()
  })

  it('creates a no-publish receipt only after all reviewed Posts are still ready', async () => {
    allow()
    stubLatestPlan()
    const assets = chain('in', {
      data: ASSETS.map(id => ({ id, storage_url: `https://assets.test/${id}.jpg`, mime_type: 'image/jpeg', status: 'analyzed', archived_at: null })),
      error: null,
    })
    const update = chain('maybeSingle', { data: { id: PLAN_ID }, error: null })
    mockFrom.mockReturnValueOnce(assets as never).mockReturnValueOnce(update as never)
    mockSendInngestEvent.mockResolvedValue({ event_ids: ['evt_123'] })

    const response = await POST(request(), params())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.changed).toBe(true)
    expect(json.receipt).toMatchObject({
      event_name: 'daily_plan.publish_queue.ready',
      event_id: 'evt_123',
      plan_revision: PLAN_REVISION,
      review_revision: REVIEW_REVISION,
      status: 'READY_NO_PUBLISH',
      no_publish: true,
      publishing_authorization: 'NOT_AUTHORIZED',
      provider_impact: 'NONE',
      cost_usd: 0,
      created_by_user_id: USER_ID,
      posts: [
        { date: DATES[0], image_asset_id: ASSETS[0], cta_url: 'https://example.test/tour', review_verdict: 'PASS' },
        { date: DATES[1], image_asset_id: ASSETS[1], cta_url: 'https://example.test/tour', review_verdict: 'PASS' },
      ],
    })
    expect(mockSendInngestEvent).toHaveBeenCalledWith(expect.objectContaining({
      id: json.receipt.request_id,
      name: 'daily_plan.publish_queue.ready',
      data: expect.objectContaining({ no_publish: true, status: 'READY_NO_PUBLISH' }),
    }))
    expect(update.update.mock.calls[0][0].plan_data.publish_queue_meta.event_id).toBe('evt_123')
    expect(mockFrom).not.toHaveBeenCalledWith('content_posts')
  })

  it('fails closed when any Post is not currently PASS', async () => {
    allow()
    const data = planData({
      review_meta: {
        ...planData().review_meta,
        posts: {
          [DATES[0]]: planData().review_meta.posts[DATES[0]],
          [DATES[1]]: { ...planData().review_meta.posts[DATES[1]], verdict: 'NEEDS_REVISION', reason: 'Weak hook' },
        },
      },
    })
    stubLatestPlan(data)

    const response = await POST(request(), params())
    const json = await response.json()

    expect(response.status).toBe(422)
    expect(json.error).toBe('POSTS_NOT_READY_FOR_PUBLISH_QUEUE')
    expect(mockSendInngestEvent).not.toHaveBeenCalled()
  })

  it('fails closed when first-comment checks are NOT_MEASURED', async () => {
    const data = planData()
    const decision = data.review_meta.posts[DATES[0]] as unknown as { checklist: ContentCheckItemResult[] }
    decision.checklist = decision.checklist.map(item => item.judge === 'AUTO'
      ? { ...item, outcome: 'NOT_MEASURED', detail: 'first-comment publishing unavailable' }
      : item)
    stubLatestPlan(data)

    const response = await POST(request(), params())

    expect(response.status).toBe(422)
    expect((await response.json()).error).toBe('POSTS_NOT_READY_FOR_PUBLISH_QUEUE')
    expect(mockSendInngestEvent).not.toHaveBeenCalled()
  })

  it('fails closed when Inngest does not return a receipt id', async () => {
    allow()
    stubLatestPlan()
    const assets = chain('in', {
      data: ASSETS.map(id => ({ id, storage_url: `https://assets.test/${id}.jpg`, mime_type: 'image/jpeg', status: 'analyzed', archived_at: null })),
      error: null,
    })
    mockFrom.mockReturnValueOnce(assets as never)
    mockSendInngestEvent.mockRejectedValue(new Error('INNGEST_EVENT_RECEIPT_MISSING'))

    const response = await POST(request(), params())
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error).toBe('INNGEST_EVENT_RECEIPT_MISSING')
    expect(mockFrom).toHaveBeenCalledTimes(2)
  })

  it('returns an existing matching receipt without sending a duplicate Inngest event', async () => {
    allow()
    const existingReceipt = {
      schema_version: 1,
      event_name: 'daily_plan.publish_queue.ready',
      event_id: 'evt_existing',
      request_id: '90000000-0000-0000-0000-000000000001',
      plan_revision: PLAN_REVISION,
      review_revision: REVIEW_REVISION,
      status: 'READY_NO_PUBLISH',
      no_publish: true,
      publishing_authorization: 'NOT_AUTHORIZED',
      provider_impact: 'NONE',
      cost_usd: 0,
      created_at: '2026-09-01T16:00:00.000Z',
      created_by_user_id: USER_ID,
      posts: DATES.map((date, index) => ({
        date,
        image_asset_id: ASSETS[index],
        cta_url: 'https://example.test/tour',
        review_verdict: 'PASS',
      })),
    }
    stubLatestPlan(planData({ publish_queue_meta: existingReceipt }))

    const response = await POST(request(), params())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.changed).toBe(false)
    expect(json.receipt.event_id).toBe('evt_existing')
    expect(mockSendInngestEvent).not.toHaveBeenCalled()
  })
})
