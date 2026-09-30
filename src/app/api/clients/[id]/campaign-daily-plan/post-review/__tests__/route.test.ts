import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { PATCH } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const OTHER_CLIENT_ID = 'd0000000-0000-0000-0000-000000000000'
const CAMPAIGN_ID = 'a0000000-0000-0000-0000-000000000001'
const PLAN_ID = 'b0000000-0000-0000-0000-000000000001'
const ASSET_ID = 'e0000000-0000-0000-0000-000000000001'
const USER_ID = 'f0000000-0000-0000-0000-000000000001'
const PLAN_REVISION = '2026-09-01T15:00:04.513Z'
const REVIEW_REVISION = '10000000-0000-0000-0000-000000000001'
const DATE = '2026-09-03'
const POST_HUMAN_KEYS = [
  'factual_claims_have_source',
  'factual_claims_source_verified',
  'logo_watermark_present',
  'asset_provenance_labeled',
  'asset_provenance_matches_claim_context',
]
const PASS_CHECKLIST = POST_HUMAN_KEYS.map(key => ({
  key,
  judge: 'HUMAN',
  outcome: 'PASS',
  detail: null,
  source_ref: key.startsWith('factual_') ? 'https://example.test/source' : null,
}))
const REVISION_CHECKLIST = PASS_CHECKLIST.map(item => item.key === 'logo_watermark_present'
  ? { ...item, outcome: 'FAIL', detail: 'Logo 缺失' }
  : item)

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/campaign-daily-plan/post-review`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      campaign_id: CAMPAIGN_ID,
      plan_id: PLAN_ID,
      expected_plan_revision: PLAN_REVISION,
      expected_review_revision: null,
      date: DATE,
      verdict: 'PASS',
      reason: null,
      checklist_human: PASS_CHECKLIST,
      ...overrides,
    }),
  })
}

function params(id = CLIENT_ID) {
  return { params: { id } }
}

function planData(reviewMeta?: unknown) {
  return {
    plan_kind: 'campaign_daily_v1',
    campaign_id: CAMPAIGN_ID,
    master_brief_ref: null,
    days: [{ date: DATE, slots: { post: 'PLANNED', story: 'PLANNED', reel: 'PLANNED' } }],
    bundles: [{
      date: DATE,
      post: {
        hook: 'A real hook',
        body: 'A real body',
        cta: 'Enquire now',
        cta_url: 'https://example.test/tour',
        image_asset_id: ASSET_ID,
      },
      story: null,
      reel: null,
    }],
    command_meta: { source: 'conversation_command', received_at: PLAN_REVISION, raw_summary: null },
    ...(reviewMeta === undefined ? {} : { review_meta: reviewMeta }),
  }
}

function reviewMeta(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    plan_revision: PLAN_REVISION,
    revision: REVIEW_REVISION,
    updated_at: '2026-09-01T15:05:00.000Z',
    posts: {},
    ...overrides,
  }
}

function chain(resolveAt: string, result: unknown) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['select', 'eq', 'contains', 'order', 'limit', 'update', 'is', 'maybeSingle']) {
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

function allowClientViewer() {
  mockAccess.mockResolvedValue({
    ok: true,
    user: { id: USER_ID, email: 'reviewer@example.test' },
    role: 'client-viewer',
    tier: 'paid_client',
    allowedClientId: CLIENT_ID,
  } as never)
}

function stubLatestPlan(data = planData()) {
  const read = chain('limit', { data: [{ id: PLAN_ID, plan_data: data, created_at: PLAN_REVISION }], error: null })
  mockFrom.mockReturnValueOnce(read as never)
  return read
}

afterEach(() => vi.clearAllMocks())

describe('campaign daily Post review — authorization and target binding', () => {
  it('rejects an unauthorized caller before reading the database', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)

    const response = await PATCH(request(), params(OTHER_CLIENT_ID))

    expect(response.status).toBe(403)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects an invalid review command before reading the database', async () => {
    allow()

    const response = await PATCH(request({ campaign_id: 'not-an-id' }), params())

    expect(response.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects caller-supplied reviewer_role instead of trusting a spoofed admin value', async () => {
    allowClientViewer()

    const response = await PATCH(request({ reviewer_role: 'admin' }), params())

    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('INVALID_REVIEW_COMMAND')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('blocks a client-viewer PASS using the server-derived role', async () => {
    allowClientViewer()

    const response = await PATCH(request(), params())

    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe('ADMIN_REVIEW_REQUIRED')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('requires a reason when the Post needs revision', async () => {
    allow()

    const response = await PATCH(request({ verdict: 'NEEDS_REVISION', reason: '   ', checklist_human: REVISION_CHECKLIST }), params())

    expect(response.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('requires at least one explicit failed checklist item for NEEDS_REVISION', async () => {
    allow()

    const response = await PATCH(request({ verdict: 'NEEDS_REVISION', reason: 'Please revise' }), params())

    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('REVISION_REQUIRES_FAILED_CHECK')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects a plan id that is no longer the latest plan', async () => {
    allow()
    stubLatestPlan()

    const response = await PATCH(request({ plan_id: 'b0000000-0000-0000-0000-000000000099' }), params())

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('PLAN_SUPERSEDED')
  })

  it('rejects a stale content revision', async () => {
    allow()
    stubLatestPlan()

    const response = await PATCH(request({ expected_plan_revision: '2026-08-01T00:00:00.000Z' }), params())

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('PLAN_REVISION_MISMATCH')
  })

  it('rejects a date that is not both scheduled and backed by a real Post bundle', async () => {
    allow()
    stubLatestPlan()

    const response = await PATCH(request({ date: '2026-09-10' }), params())

    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe('POST_DATE_NOT_FOUND')
  })
})

describe('campaign daily Post review — truthful PASS boundary', () => {
  it('validates a current image but fails closed because first-comment checks are not implemented', async () => {
    allow()
    stubLatestPlan()
    const asset = chain('maybeSingle', {
      data: { id: ASSET_ID, storage_url: 'https://assets.test/post.png', mime_type: 'image/png', status: 'analyzed', archived_at: null },
      error: null,
    })
    mockFrom.mockReturnValueOnce(asset as never)

    const response = await PATCH(request(), params())
    const json = await response.json()

    expect(response.status).toBe(422)
    expect(json.error).toBe('AUTO_CHECKS_UNAVAILABLE')
    expect(json.blocked_checks).toEqual(['cta_in_first_comment_not_body', 'first_comment_link_has_tracking_params'])
    expect(asset.eq).toHaveBeenCalledWith('client_id', CLIENT_ID)
    expect(asset.eq).toHaveBeenCalledWith('id', ASSET_ID)
    expect(mockFrom).toHaveBeenCalledTimes(2)
  })

  it('refuses PASS when the image is missing or no longer usable', async () => {
    allow()
    stubLatestPlan()
    const asset = chain('maybeSingle', { data: null, error: null })
    mockFrom.mockReturnValueOnce(asset as never)

    const response = await PATCH(request(), params())

    expect(response.status).toBe(422)
    expect((await response.json()).error).toBe('POST_IMAGE_NOT_READY')
    expect(mockFrom).toHaveBeenCalledTimes(2)
  })

  it('refuses PASS when an analyzed image has no displayable storage URL', async () => {
    allow()
    stubLatestPlan()
    const asset = chain('maybeSingle', {
      data: { id: ASSET_ID, storage_url: '   ', mime_type: 'image/png', status: 'analyzed', archived_at: null },
      error: null,
    })
    mockFrom.mockReturnValueOnce(asset as never)

    const response = await PATCH(request(), params())

    expect(response.status).toBe(422)
    expect((await response.json()).error).toBe('POST_IMAGE_NOT_READY')
  })

  it('refuses PASS when the persisted CTA is not HTTPS', async () => {
    allow()
    const invalidCta = planData()
    invalidCta.bundles[0].post.cta_url = 'http://example.test/tour'
    stubLatestPlan(invalidCta)

    const response = await PATCH(request(), params())

    expect(response.status).toBe(422)
    expect((await response.json()).error).toBe('POST_NOT_READY')
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('records NEEDS_REVISION for incomplete content without requiring a usable image', async () => {
    allowClientViewer()
    const incomplete = planData()
    incomplete.bundles[0].post.image_asset_id = ''
    stubLatestPlan(incomplete)
    const update = chain('maybeSingle', { data: { id: PLAN_ID }, error: null })
    mockFrom.mockReturnValueOnce(update as never)

    const response = await PATCH(request({ verdict: 'NEEDS_REVISION', reason: '  Replace the image  ', checklist_human: REVISION_CHECKLIST }), params())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.review_meta).toBeUndefined()
    const written = update.update.mock.calls[0][0] as { plan_data: { review_meta: { posts: Record<string, unknown> } } }
    expect(written.plan_data.review_meta.posts[DATE]).toMatchObject({
      verdict: 'NEEDS_REVISION',
      reason: 'Replace the image',
      reviewed_by_user_id: USER_ID,
      reviewer_role: 'client-viewer',
    })
    expect(mockFrom).toHaveBeenCalledTimes(2)
  })
})

describe('campaign daily Post review — concurrent state', () => {
  it('rejects a stale review revision before attempting an update', async () => {
    allow()
    stubLatestPlan(planData(reviewMeta()))

    const response = await PATCH(request({ expected_review_revision: null }), params())

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('REVIEW_CONFLICT')
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('returns 409 when compare-and-set loses a concurrent update', async () => {
    allow()
    stubLatestPlan(planData(reviewMeta()))
    const update = chain('maybeSingle', { data: null, error: null })
    mockFrom.mockReturnValueOnce(update as never)

    const response = await PATCH(request({
      expected_review_revision: REVIEW_REVISION,
      verdict: 'NEEDS_REVISION',
      reason: 'Replace the image',
      checklist_human: REVISION_CHECKLIST,
    }), params())

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('REVIEW_CONFLICT')
    expect(update.contains).toHaveBeenCalledWith('plan_data', { review_meta: { revision: REVIEW_REVISION } })
  })

  it('makes an identical retry idempotent without rewriting reviewer or timestamp', async () => {
    allow()
    const existing = reviewMeta({
      posts: {
        [DATE]: {
          verdict: 'NEEDS_REVISION',
          reason: 'Replace the image',
          reviewed_at: '2026-09-01T15:05:00.000Z',
          reviewed_by_user_id: USER_ID,
          reviewer_role: 'admin',
          checklist: REVISION_CHECKLIST,
        },
      },
    })
    stubLatestPlan(planData(existing))

    const response = await PATCH(request({
      expected_review_revision: REVIEW_REVISION,
      verdict: 'NEEDS_REVISION',
      reason: 'Replace the image',
      checklist_human: REVISION_CHECKLIST,
    }), params())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.changed).toBe(false)
    expect(json.review_revision).toBe(REVIEW_REVISION)
    expect(json.review_meta).toBeUndefined()
    expect(JSON.stringify(json)).not.toContain(USER_ID)
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('writes an updated checklist when the revision reason stays the same', async () => {
    allow()
    const existing = reviewMeta({
      posts: {
        [DATE]: {
          verdict: 'NEEDS_REVISION',
          reason: 'Replace the image',
          reviewed_at: '2026-09-01T15:05:00.000Z',
          reviewed_by_user_id: USER_ID,
          reviewer_role: 'admin',
          checklist: REVISION_CHECKLIST,
        },
      },
    })
    stubLatestPlan(planData(existing))
    const updated = chain('maybeSingle', { data: { id: PLAN_ID }, error: null })
    mockFrom.mockReturnValueOnce(updated as never)
    const revisedChecklist = REVISION_CHECKLIST.map(item => item.key === 'logo_watermark_present'
      ? { ...item, detail: 'Logo 与安全区重叠' }
      : item)

    const response = await PATCH(request({
      expected_review_revision: REVIEW_REVISION,
      verdict: 'NEEDS_REVISION',
      reason: 'Replace the image',
      checklist_human: revisedChecklist,
    }), params())
    const json = await response.json()
    const written = updated.update.mock.calls[0][0] as { plan_data: { review_meta: { posts: Record<string, { checklist: Array<{ key: string; detail: string | null }> }> } } }

    expect(response.status).toBe(200)
    expect(json.changed).toBe(true)
    expect(written.plan_data.review_meta.posts[DATE].checklist.find(item => item.key === 'logo_watermark_present')?.detail)
      .toBe('Logo 与安全区重叠')
  })

  it('revalidates an identical PASS retry and rejects it when the image later becomes unusable', async () => {
    allow()
    const existing = reviewMeta({
      posts: {
        [DATE]: {
          verdict: 'PASS',
          reason: null,
          reviewed_at: '2026-09-01T15:05:00.000Z',
          reviewed_by_user_id: USER_ID,
          reviewer_role: 'admin',
        },
      },
    })
    stubLatestPlan(planData(existing))
    const asset = chain('maybeSingle', {
      data: { id: ASSET_ID, storage_url: '', mime_type: 'image/jpeg', status: 'analyzed', archived_at: null },
      error: null,
    })
    mockFrom.mockReturnValueOnce(asset as never)

    const response = await PATCH(request({ expected_review_revision: REVIEW_REVISION }), params())

    expect(response.status).toBe(422)
    expect((await response.json()).error).toBe('POST_IMAGE_NOT_READY')
    expect(mockFrom).toHaveBeenCalledTimes(2)
  })

  it('rejects persisted review keys that do not identify a real scheduled Post', async () => {
    allow()
    const invalid = reviewMeta({
      posts: {
        '2026-09-04': {
          verdict: 'NEEDS_REVISION',
          reason: 'Wrong day',
          reviewed_at: '2026-09-01T15:05:00.000Z',
          reviewed_by_user_id: USER_ID,
          reviewer_role: 'client-viewer',
        },
      },
    })
    stubLatestPlan(planData(invalid))

    const response = await PATCH(request({ expected_review_revision: REVIEW_REVISION }), params())

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('REVIEW_STATE_INVALID')
  })
})
