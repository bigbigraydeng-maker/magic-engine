import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { PATCH } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { CampaignDailyPostReviewMetaSchema, CampaignDailyPublishQueueMetaSchema } from '@/lib/campaign/daily-plan'
import { CampaignDailyPublishMetaSchema } from '@/lib/campaign/daily-plan-publish'

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

  it('requires a reason when the Post needs revision', async () => {
    allow()

    const response = await PATCH(request({ verdict: 'NEEDS_REVISION', reason: '   ' }), params())

    expect(response.status).toBe(400)
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
  it('revalidates a current client-owned usable image before recording PASS', async () => {
    allow()
    stubLatestPlan()
    const asset = chain('maybeSingle', {
      data: { id: ASSET_ID, storage_url: 'https://assets.test/post.png', mime_type: 'image/png', status: 'analyzed', archived_at: null },
      error: null,
    })
    const update = chain('maybeSingle', { data: { id: PLAN_ID }, error: null })
    mockFrom.mockReturnValueOnce(asset as never).mockReturnValueOnce(update as never)

    const response = await PATCH(request(), params())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.changed).toBe(true)
    expect(json.review_revision).toEqual(expect.any(String))
    expect(json.review_meta).toBeUndefined()
    const written = update.update.mock.calls[0][0] as { plan_data: { review_meta: { posts: Record<string, unknown> } } }
    expect(written.plan_data.review_meta.posts[DATE]).toMatchObject({
      verdict: 'PASS',
      reason: null,
      reviewed_by_user_id: USER_ID,
    })
    expect(asset.eq).toHaveBeenCalledWith('client_id', CLIENT_ID)
    expect(asset.eq).toHaveBeenCalledWith('id', ASSET_ID)
    expect(update.is).toHaveBeenCalledWith('plan_data->review_meta', null)
    expect(update.eq).toHaveBeenCalledWith('client_id', CLIENT_ID)
    expect(update.eq).toHaveBeenCalledWith('campaign_id', CAMPAIGN_ID)
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
    allow()
    const incomplete = planData()
    incomplete.bundles[0].post.image_asset_id = ''
    stubLatestPlan(incomplete)
    const update = chain('maybeSingle', { data: { id: PLAN_ID }, error: null })
    mockFrom.mockReturnValueOnce(update as never)

    const response = await PATCH(request({ verdict: 'NEEDS_REVISION', reason: '  Replace the image  ' }), params())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.review_meta).toBeUndefined()
    const written = update.update.mock.calls[0][0] as { plan_data: { review_meta: { posts: Record<string, unknown> } } }
    expect(written.plan_data.review_meta.posts[DATE]).toMatchObject({
      verdict: 'NEEDS_REVISION',
      reason: 'Replace the image',
      reviewed_by_user_id: USER_ID,
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
    const asset = chain('maybeSingle', {
      data: { id: ASSET_ID, storage_url: 'https://assets.test/post.jpg', mime_type: 'image/jpeg', status: 'analyzed', archived_at: null },
      error: null,
    })
    const update = chain('maybeSingle', { data: null, error: null })
    mockFrom.mockReturnValueOnce(asset as never).mockReturnValueOnce(update as never)

    const response = await PATCH(request({ expected_review_revision: REVIEW_REVISION }), params())

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
        },
      },
    })
    stubLatestPlan(planData(existing))

    const response = await PATCH(request({
      expected_review_revision: REVIEW_REVISION,
      verdict: 'NEEDS_REVISION',
      reason: 'Replace the image',
    }), params())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.changed).toBe(false)
    expect(json.review_revision).toBe(REVIEW_REVISION)
    expect(json.review_meta).toBeUndefined()
    expect(JSON.stringify(json)).not.toContain(USER_ID)
    expect(mockFrom).toHaveBeenCalledTimes(1)
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
        },
      },
    })
    stubLatestPlan(planData(invalid))

    const response = await PATCH(request({ expected_review_revision: REVIEW_REVISION }), params())

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('REVIEW_STATE_INVALID')
  })
})

// ─── Receipt lock (2026-09-15) ───────────────────────────────────────────────
// Changing a review after the plan was queued stranded it (publish: queue
// receipt stale; queue: conflict; plan POST: queued), and a change during an
// in-flight publish made the publish receipt write miss so recall could not
// find live Posts. Review must fail closed once either receipt exists.

interface SocialPlanRow {
  id: string
  client_id: string
  campaign_id: string | null
  platform: string
  wave_number: number
  plan_data: Record<string, unknown>
  created_at: string
}

function isSubset(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return actual === expected
  if (actual === null || typeof actual !== 'object') return false
  return Object.entries(expected as Record<string, unknown>)
    .every(([key, value]) => isSubset((actual as Record<string, unknown>)[key], value))
}

/**
 * In-memory `social_plans` table modelled on the campaign-daily-plan route
 * test: filters run against stored rows, so the read and the compare-and-set
 * update see the same data. `plan_data->key IS NULL` is SQL NULL, i.e. true
 * only when the key is absent from the jsonb object.
 */
function socialPlansTable(rows: SocialPlanRow[], opts: { beforeUpdate?: (rows: SocialPlanRow[]) => void } = {}) {
  const writes: Array<Record<string, unknown>> = []

  function query() {
    const filters: Array<(row: SocialPlanRow) => boolean> = []
    let patch: Partial<SocialPlanRow> | null = null
    let limit: number | null = null

    const readRows = () => {
      const matched = rows
        .filter(row => filters.every(f => f(row)))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
      return limit === null ? matched : matched.slice(0, limit)
    }
    const runUpdate = () => {
      opts.beforeUpdate?.(rows)
      const matched = rows.filter(row => filters.every(f => f(row)))
      for (const row of matched) Object.assign(row, structuredClone(patch))
      writes.push(patch as Record<string, unknown>)
      return matched
    }

    const builder = {
      select: () => builder,
      eq: (column: keyof SocialPlanRow, value: unknown) => {
        filters.push(row => row[column] === value)
        return builder
      },
      is: (path: string, value: null) => {
        const [column, key] = path.split('->') as [keyof SocialPlanRow, string]
        filters.push(row => value === null && (row[column] as Record<string, unknown>)[key] === undefined)
        return builder
      },
      contains: (column: keyof SocialPlanRow, value: unknown) => {
        filters.push(row => isSubset(row[column], value))
        return builder
      },
      order: () => builder,
      limit: (n: number) => {
        limit = n
        return builder
      },
      update: (values: Partial<SocialPlanRow>) => {
        patch = values
        return builder
      },
      maybeSingle: async () => {
        const matched = patch ? runUpdate() : readRows()
        return { data: matched[0] ? { id: matched[0].id } : null, error: null }
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve({ data: readRows(), error: null }).then(resolve, reject),
    }
    return builder
  }

  return { query, rows, writes }
}

const QUEUE_REQUEST_ID = '30000000-0000-0000-0000-000000000001'
const PAGE_ID = '900000000000001'

function passedReviewMeta() {
  return reviewMeta({
    posts: {
      [DATE]: { verdict: 'PASS', reason: null, reviewed_at: '2026-09-01T15:05:00.000Z', reviewed_by_user_id: USER_ID },
    },
  })
}

function storedQueueMeta() {
  return {
    schema_version: 1,
    event_name: 'daily_plan.publish_queue.ready',
    event_id: '01J0000000000000000000QUEUE',
    request_id: QUEUE_REQUEST_ID,
    plan_revision: PLAN_REVISION,
    review_revision: REVIEW_REVISION,
    status: 'READY_NO_PUBLISH',
    no_publish: true,
    publishing_authorization: 'NOT_AUTHORIZED',
    provider_impact: 'NONE',
    cost_usd: 0,
    created_at: '2026-09-01T15:10:00.000Z',
    created_by_user_id: USER_ID,
    posts: [{ date: DATE, image_asset_id: ASSET_ID, cta_url: 'https://example.test/tour', review_verdict: 'PASS' }],
  }
}

function storedPublishMeta() {
  return {
    schema_version: 1,
    event_name: 'daily_plan.post.published',
    status: 'PUBLISHED',
    request_id: '40000000-0000-0000-0000-000000000001',
    client_id: CLIENT_ID,
    campaign_id: CAMPAIGN_ID,
    plan_id: PLAN_ID,
    plan_revision: PLAN_REVISION,
    review_revision: REVIEW_REVISION,
    page_id: PAGE_ID,
    publishing_authorization: 'AUTHORIZED',
    approved_by_user_id: USER_ID,
    created_at: '2026-09-01T15:20:00.000Z',
    published: [{
      date: DATE,
      idempotency_key: `daily-plan:${PLAN_ID}:${DATE}`,
      post_id: `${PAGE_ID}_122000000000001`,
      post_id_source: 'post_id',
      page_id: PAGE_ID,
      published_at: '2026-09-01T15:20:00.000Z',
      permalink: `https://www.facebook.com/${PAGE_ID}_122000000000001`,
      provider_response: { id: '122000000000001', post_id: `${PAGE_ID}_122000000000001` },
    }],
    failed: [],
    event_ids: ['01J00000000000000000PUBLISH'],
  }
}

function storedRow(extras: Record<string, unknown> = {}): SocialPlanRow {
  return {
    id: PLAN_ID,
    client_id: CLIENT_ID,
    campaign_id: CAMPAIGN_ID,
    platform: 'facebook',
    wave_number: 1,
    created_at: PLAN_REVISION,
    plan_data: { ...planData(passedReviewMeta()), ...extras },
  }
}

function mockTables(plans: ReturnType<typeof socialPlansTable>) {
  const asset = chain('maybeSingle', {
    data: { id: ASSET_ID, storage_url: 'https://assets.test/post.png', mime_type: 'image/png', status: 'analyzed', archived_at: null },
    error: null,
  })
  mockFrom.mockImplementation((table: string) => {
    if (table === 'social_plans') return plans.query() as never
    if (table === 'client_assets') return asset as never
    throw new Error(`unexpected table ${table}`)
  })
}

const needsRevision = { expected_review_revision: REVIEW_REVISION, verdict: 'NEEDS_REVISION', reason: 'Swap the image' }
const passUnchanged = { expected_review_revision: REVIEW_REVISION, verdict: 'PASS', reason: null }

describe('campaign daily Post review — frozen once queued or published', () => {
  it('fixtures match the real stored receipt schemas', () => {
    expect(CampaignDailyPostReviewMetaSchema.safeParse(passedReviewMeta()).success).toBe(true)
    expect(CampaignDailyPublishQueueMetaSchema.safeParse(storedQueueMeta()).success).toBe(true)
    expect(CampaignDailyPublishMetaSchema.safeParse(storedPublishMeta()).success).toBe(true)
  })

  it.each([
    ['queued: flip to NEEDS_REVISION', { publish_queue_meta: storedQueueMeta() }, needsRevision, 'PLAN_PUBLISH_QUEUED', null],
    ['queued: identical PASS retry', { publish_queue_meta: storedQueueMeta() }, passUnchanged, 'PLAN_PUBLISH_QUEUED', null],
    ['published: flip to NEEDS_REVISION', { publish_queue_meta: storedQueueMeta(), publish_meta: storedPublishMeta() }, needsRevision, 'PLAN_ALREADY_PUBLISHED', 'PUBLISHED'],
    ['publish receipt without queue receipt', { publish_meta: storedPublishMeta() }, needsRevision, 'PLAN_ALREADY_PUBLISHED', 'PUBLISHED'],
    ['malformed queue receipt still locks', { publish_queue_meta: { junk: true } }, needsRevision, 'PLAN_PUBLISH_QUEUED', null],
    ['queue receipt stored as JSON null still locks', { publish_queue_meta: null }, needsRevision, 'PLAN_PUBLISH_QUEUED', null],
  ])('%s → 409 and the stored plan is untouched', async (_label, extras, body, code, publishStatus) => {
    allow()
    const row = storedRow(extras)
    const before = structuredClone(row.plan_data)
    const plans = socialPlansTable([row])
    mockTables(plans)

    const response = await PATCH(request(body), params())
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json).toMatchObject({
      success: false,
      error: code,
      plan_id: PLAN_ID,
      publish_status: publishStatus,
      next_step: 'CREATE_NEW_CAMPAIGN',
    })
    expect(plans.writes).toHaveLength(0)
    expect(plans.rows[0].plan_data).toEqual(before)
    expect(mockFrom).not.toHaveBeenCalledWith('client_assets')
  })

  it('still records a review on a plan that is not queued (lock filters do not block the normal path)', async () => {
    allow()
    const plans = socialPlansTable([storedRow()])
    mockTables(plans)

    const response = await PATCH(request(needsRevision), params())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.changed).toBe(true)
    expect(plans.writes).toHaveLength(1)
    const stored = plans.rows[0].plan_data.review_meta as { revision: string; posts: Record<string, { verdict: string }> }
    expect(stored.revision).toBe(json.review_revision)
    expect(stored.posts[DATE].verdict).toBe('NEEDS_REVISION')
  })

  it.each([
    ['publish_queue_meta', () => ({ publish_queue_meta: storedQueueMeta() })],
    ['publish_meta', () => ({ publish_meta: storedPublishMeta() })],
  ])('does not rewrite the review when %s lands between the read and the write', async (key, landed) => {
    allow()
    const plans = socialPlansTable([storedRow()], {
      beforeUpdate: rows => {
        rows[0].plan_data = { ...rows[0].plan_data, ...landed() }
      },
    })
    mockTables(plans)

    const response = await PATCH(request(needsRevision), params())

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('REVIEW_CONFLICT')
    expect(plans.rows[0].plan_data.review_meta).toEqual(passedReviewMeta())
    expect(plans.rows[0].plan_data[key]).toEqual(landed()[key as keyof ReturnType<typeof landed>])
  })
})
