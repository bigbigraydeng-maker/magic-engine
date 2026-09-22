/**
 * Tests for the Campaign Daily Plan review slice (#1159 WP1 + 7-day remediation).
 *
 * This surface only ever reads/persists structured facts (via `social_plans`,
 * `campaign_briefs`, `master_briefs`, `client_assets`) — it never calls a
 * provider, publisher or worker. No provider/publisher/worker module is
 * imported anywhere in route.ts or daily-plan.ts (grep-verifiable), so there
 * is nothing to mock-and-assert-uncalled for those; the tests below instead
 * lock down the fail-closed tenant/grounding/asset behaviour that IS the
 * risk surface for this slice.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/content/campaign-injector', () => ({ getCampaignById: vi.fn() }))

import { GET, POST } from '../route'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { getCampaignById } from '@/lib/content/campaign-injector'
import { CampaignDailyPostReviewMetaSchema, CampaignDailyPublishQueueMetaSchema } from '@/lib/campaign/daily-plan'
import { CampaignDailyPublishMetaSchema } from '@/lib/campaign/daily-plan-publish'

const mockAccess = vi.mocked(requireDashboardClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)
const mockGetCampaign = vi.mocked(getCampaignById)

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const CAMPAIGN_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const BRIEF_ID = 'bbbbbbbb-0000-0000-0000-000000000001'
const ASSET_ID = 'cccccccc-0000-0000-0000-000000000001'
const FOREIGN_ASSET_ID = 'dddddddd-0000-0000-0000-000000000001'
const CAMPAIGN_URL = 'https://www.example-cts.test/tours/christmas'
/** Seven distinct image asset IDs — the Post-diversity contract requires
 * each day pick a different asset, so tests build a full snapshot from these. */
const POST_ASSET_IDS = [
  'e0000001-0000-0000-0000-000000000001',
  'e0000002-0000-0000-0000-000000000002',
  'e0000003-0000-0000-0000-000000000003',
  'e0000004-0000-0000-0000-000000000004',
  'e0000005-0000-0000-0000-000000000005',
  'e0000006-0000-0000-0000-000000000006',
  'e0000007-0000-0000-0000-000000000007',
]

function params(id = CTS) {
  return { params: { id } }
}

function getRequest(campaignId?: string): NextRequest {
  const url = new URL(`http://localhost:3001/api/clients/${CTS}/campaign-daily-plan`)
  if (campaignId) url.searchParams.set('campaign_id', campaignId)
  return new NextRequest(url)
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3001/api/clients/${CTS}/campaign-daily-plan`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function allow() {
  mockAccess.mockResolvedValue({
    ok: true,
    user: { email: 'bdm@ctstours.co.nz' } as never,
    role: 'client-viewer',
    tier: 'paid_client',
    allowedClientId: CTS,
  } as never)
}

const CAMPAIGN = {
  id: CAMPAIGN_ID,
  client_id: CTS,
  status: 'active',
  title: 'CTS Facebook Daily',
  offer: null,
  primary_cta: 'Book now',
  source_urls: [CAMPAIGN_URL],
} as never

function sevenDays() {
  return Array.from({ length: 7 }, (_, i) => ({
    date: `2026-08-2${i}`,
    slots: { post: 'PLANNED', story: 'PLANNED', reel: 'PLANNED' },
  }))
}

function bundle(overrides: Record<string, unknown> = {}) {
  const dateOverride = (overrides as { date?: string }).date ?? '2026-08-24'
  const idx = Math.max(
    0,
    sevenDays().findIndex(d => d.date === dateOverride)
  )
  return {
    date: dateOverride,
    post: {
      hook: 'hook',
      body: 'body copy',
      cta: 'Enquire Now',
      image_asset_id: POST_ASSET_IDS[idx] ?? POST_ASSET_IDS[0],
      cta_url: CAMPAIGN_URL,
    },
    story: {
      frames: [
        { order: 1, copy: 'frame one' },
        { order: 2, copy: 'frame two' },
        { order: 3, copy: 'frame three' },
        { order: 4, copy: 'frame four' },
      ],
    },
    reel: {
      brief: 'a brief',
      script: 'a script',
      caption: 'a caption',
      source_asset_ids: [ASSET_ID],
      media_status: 'NO_MEDIA',
    },
    ...overrides,
  }
}

/** A full seven-day snapshot (one bundle per scheduled day) with seven
 * distinct Post image_asset_id values — the complete-snapshot contract
 * plus the Post-diversity contract. */
function fullSevenDays() {
  return sevenDays().map(d => bundle({ date: d.date }))
}

function validCommand(overrides: Record<string, unknown> = {}) {
  return {
    campaign_id: CAMPAIGN_ID,
    days: sevenDays(),
    bundles: fullSevenDays(),
    ...overrides,
  }
}

/** Helper: stub the client_assets .in() query with valid CTS-owned image
 * rows for a given set of ids. Used by tests that expect POST to succeed. */
function validAssetsIn(ids: string[]) {
  return ids.map(id => ({ id, mime_type: 'image/jpeg', status: 'analyzed', archived_at: null }))
}

/** GET also reads the same usable-image gate columns and drops rows that
 * fail them (see route.ts). GET-side asset stubs must therefore carry
 * status/archived_at/mime_type; this helper stamps a full-shape row so
 * existing GET-side fixtures stay valid under the tightened boundary. */
function usableGetAsset(row: {
  id: string
  storage_url: string
  original_filename: string | null
  source: string
  ownership: string
  status?: string
  archived_at?: string | null
  mime_type?: string
}) {
  return {
    status: 'analyzed',
    archived_at: null,
    mime_type: 'image/jpeg',
    ...row,
  }
}

/** Minimal chainable Supabase query builder stub for a single table. */
function tableStub(handlers: Record<string, unknown>) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'or', 'order', 'limit', 'in', 'contains', 'maybeSingle', 'single', 'insert', 'update']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  Object.assign(chain, handlers)
  return chain
}

/** A `social_plans` row with the real column set (see the social_plans migration). */
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
 * In-memory `social_plans` table. Filters are applied to stored rows rather
 * than keyed to call order, so the route's read and its compare-and-set
 * update are both evaluated against the same rows. `plan_data->key IS NULL`
 * is SQL NULL, i.e. true only when the key is absent from the jsonb object.
 */
function socialPlansTable(
  rows: SocialPlanRow[],
  opts: { readError?: { message: string }; beforeUpdate?: (rows: SocialPlanRow[]) => void } = {}
) {
  const writes = { updates: [] as Array<Record<string, unknown>>, inserts: [] as Array<Record<string, unknown>> }

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
      for (const row of matched) Object.assign(row, patch)
      writes.updates.push(patch as Record<string, unknown>)
      return { data: matched.map(row => ({ id: row.id })), error: null }
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
      maybeSingle: async () => {
        if (opts.readError) return { data: null, error: opts.readError }
        return { data: readRows()[0] ?? null, error: null }
      },
      update: (values: Partial<SocialPlanRow>) => {
        patch = values
        return builder
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(patch ? runUpdate() : { data: readRows(), error: null }).then(resolve, reject),
      insert: (values: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            writes.inserts.push(values)
            const id = `inserted-${writes.inserts.length}`
            rows.push({ id, created_at: new Date().toISOString(), ...values } as SocialPlanRow)
            return { data: { id }, error: null }
          },
        }),
      }),
    }
    return builder
  }

  return { query, rows, writes }
}

const EXISTING_PLAN_ID = 'f0000000-0000-0000-0000-000000000001'
const STORED_PLAN_REVISION = '2026-09-08T00:00:00.000Z'
const STORED_REVIEW_REVISION = '10000000-0000-0000-0000-000000000009'
const CTS_PAGE_ID = '1616575215312482'

function storedReviewMeta() {
  return {
    schema_version: 1,
    plan_revision: STORED_PLAN_REVISION,
    revision: STORED_REVIEW_REVISION,
    updated_at: '2026-09-08T01:00:00.000Z',
    posts: Object.fromEntries(sevenDays().map(d => [d.date, {
      verdict: 'PASS',
      reason: null,
      reviewed_at: '2026-09-08T01:00:00.000Z',
      reviewed_by_user_id: '20000000-0000-0000-0000-000000000001',
    }])),
  }
}

function storedQueueMeta() {
  return {
    schema_version: 1,
    event_name: 'daily_plan.publish_queue.ready',
    event_id: '01J0000000000000000000QUEUE',
    request_id: '30000000-0000-0000-0000-000000000001',
    client_id: CTS,
    campaign_id: CAMPAIGN_ID,
    plan_id: EXISTING_PLAN_ID,
    plan_revision: STORED_PLAN_REVISION,
    review_revision: STORED_REVIEW_REVISION,
    status: 'READY_NO_PUBLISH',
    no_publish: true,
    publishing_authorization: 'NOT_AUTHORIZED',
    provider_impact: 'NONE',
    cost_usd: 0,
    created_at: '2026-09-08T02:00:00.000Z',
    created_by_user_id: '20000000-0000-0000-0000-000000000001',
    posts: sevenDays().map((d, i) => ({
      date: d.date,
      image_asset_id: POST_ASSET_IDS[i],
      cta_url: CAMPAIGN_URL,
      review_verdict: 'PASS',
    })),
  }
}

function publishedPost(date: string, i: number) {
  return {
    date,
    idempotency_key: `daily-plan:${EXISTING_PLAN_ID}:${date}`,
    post_id: `${CTS_PAGE_ID}_12200000000000${i}`,
    post_id_source: 'post_id',
    page_id: CTS_PAGE_ID,
    published_at: '2026-09-08T03:00:00.000Z',
    permalink: `https://www.facebook.com/${CTS_PAGE_ID}_12200000000000${i}`,
    provider_response: { id: `12200000000000${i}`, post_id: `${CTS_PAGE_ID}_12200000000000${i}` },
  }
}

/** A PUBLISHED receipt with seven live Posts — the shape of the real CTS row this bug would erase. */
function storedPublishMeta(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    event_name: 'daily_plan.post.published',
    status: 'PUBLISHED',
    request_id: '40000000-0000-0000-0000-000000000001',
    client_id: CTS,
    campaign_id: CAMPAIGN_ID,
    plan_id: EXISTING_PLAN_ID,
    plan_revision: STORED_PLAN_REVISION,
    review_revision: STORED_REVIEW_REVISION,
    page_id: CTS_PAGE_ID,
    publishing_authorization: 'AUTHORIZED',
    approved_by_user_id: '20000000-0000-0000-0000-000000000001',
    created_at: '2026-09-08T03:00:00.000Z',
    published: sevenDays().map((d, i) => publishedPost(d.date, i)),
    failed: [],
    event_ids: ['01J00000000000000000PUBLISH'],
    ...overrides,
  }
}

function storedPlanRow(planDataExtras: Record<string, unknown> = {}): SocialPlanRow {
  return {
    id: EXISTING_PLAN_ID,
    client_id: CTS,
    campaign_id: CAMPAIGN_ID,
    platform: 'facebook',
    wave_number: 1,
    created_at: '2026-09-08T00:00:00.000Z',
    plan_data: {
      plan_kind: 'campaign_daily_v1',
      campaign_id: CAMPAIGN_ID,
      master_brief_ref: { id: BRIEF_ID, version: 1 },
      days: sevenDays(),
      bundles: fullSevenDays(),
      command_meta: { source: 'conversation_command', received_at: STORED_PLAN_REVISION, raw_summary: null },
      ...planDataExtras,
    },
  }
}

function mockPostTables(plans: ReturnType<typeof socialPlansTable>) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'master_briefs') {
      return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 1 } }) }) as never
    }
    if (table === 'client_assets') {
      return tableStub({ in: vi.fn().mockResolvedValue({ data: validAssetsIn([ASSET_ID, ...POST_ASSET_IDS]) }) }) as never
    }
    if (table === 'social_plans') return plans.query() as never
    return tableStub({}) as never
  })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('campaign-daily-plan GET — authorisation', () => {
  it('rejects a caller who is not a member of the client', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)

    const res = await GET(getRequest(CAMPAIGN_ID), params(OZTOP))

    expect(res.status).toBe(403)
    expect(mockGetCampaign).not.toHaveBeenCalled()
  })

  it('will not read for an unauthenticated caller', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' } as never)

    const res = await GET(getRequest(CAMPAIGN_ID), params())

    expect(res.status).toBe(401)
  })

  it('requires campaign_id', async () => {
    allow()
    const res = await GET(getRequest(), params())
    expect(res.status).toBe(400)
  })
})

describe('campaign-daily-plan GET — grounding', () => {
  it('resolves OK when the same-client campaign and an active Master Brief both exist', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 3 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.grounding).toMatchObject({ status: 'OK', has_master_brief: true, has_campaign: true })
    expect(json.days).toHaveLength(7)
  })

  it('reports NEEDS_BRIEF when no active Master Brief exists for this client', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.grounding).toMatchObject({ status: 'NEEDS_BRIEF', has_master_brief: false })
  })

  // Regression (#1159 WP1 scope-shrink comment 5388882992, finding 1): a
  // FAILED Master Brief lookup must never be read as "no active brief" —
  // that silently reports NEEDS_BRIEF (false success) instead of surfacing
  // the real error.
  it('propagates a Master Brief lookup error as 500, never as a fabricated NEEDS_BRIEF', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'connection reset' } }) }) as never
      }
      return tableStub({}) as never
    })

    const res = await GET(getRequest(CAMPAIGN_ID), params())
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.success).toBe(false)
  })

  // Regression (#1159 remediation, Build Control finding 2): grounding for a
  // SAVED plan must reflect what it was actually grounded in at save time
  // (plan_data.master_brief_ref), not "does any active brief happen to exist
  // right now".
  it('reports NEEDS_BRIEF for a saved plan whose master_brief_ref was null, even though an active brief exists NOW', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const savedWithoutBrief = {
      plan_kind: 'campaign_daily_v1',
      campaign_id: CAMPAIGN_ID,
      master_brief_ref: null,
      days: sevenDays(),
      // A legacy row with a stored bundle that has no real content — GET must
      // still surface the plan's saved master_brief_ref, not fabricate one.
      bundles: [bundle()],
      command_meta: { source: 'conversation_command', received_at: '2026-08-01T00:00:00.000Z', raw_summary: null },
    }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 1 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-1', plan_data: savedWithoutBrief }] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.grounding.status).toBe('NEEDS_BRIEF')
  })

  it('reports NEEDS_CAMPAIGN — and never invents a plan — when the campaign does not resolve for this client', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(null)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 1 } }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.grounding.status).toBe('NEEDS_CAMPAIGN')
    expect(json.bundles).toEqual([])
    expect(json.days.every((d: { slots: { post: string } }) => d.slots.post === 'NOT_PLANNED')).toBe(true)
  })
})

describe('campaign-daily-plan GET — multi-day bundles, provenance and readiness', () => {
  const day1 = bundle({ date: '2026-08-24' })
  const day2 = bundle({
    date: '2026-08-25',
    post: { hook: 'day 2 hook', body: 'day 2 body', cta: 'Book now' },
    story: {
      frames: [
        { order: 1, copy: 'day 2 frame' },
        { order: 2, copy: 'day 2 f2' },
        { order: 3, copy: 'day 2 f3' },
        { order: 4, copy: 'day 2 f4' },
      ],
    },
    reel: { brief: 'day 2 brief', script: 'day 2 script', caption: 'day 2 caption', source_asset_ids: [], media_status: 'NO_MEDIA' },
  })
  const persistedPlanData = {
    plan_kind: 'campaign_daily_v1',
    campaign_id: CAMPAIGN_ID,
    master_brief_ref: { id: BRIEF_ID, version: 2 },
    days: sevenDays(),
    bundles: [day1, day2],
    command_meta: { source: 'conversation_command', received_at: '2026-08-24T00:00:00.000Z', raw_summary: null },
  }

  function stubWithAssets(assetRows: unknown[]) {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 2 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-1', plan_data: persistedPlanData }] }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({ in: vi.fn().mockResolvedValue({ data: assetRows }) }) as never
      }
      return tableStub({}) as never
    })
  }

  it('returns Post/Story/Reel for EVERY persisted day, not just day 1', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    stubWithAssets([usableGetAsset({ id: ASSET_ID, storage_url: 'https://x/y.jpg', original_filename: 'y.jpg', source: 'stock', ownership: 'client_exclusive' })])

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.bundles).toHaveLength(2)
    const b1 = json.bundles.find((b: { date: string }) => b.date === '2026-08-24')
    const b2 = json.bundles.find((b: { date: string }) => b.date === '2026-08-25')
    expect(b1.post.hook).toBe('hook')
    expect(b2.post.hook).toBe('day 2 hook')
    expect(b2.story.frames[0].copy).toBe('day 2 frame')
    expect(b2.reel.media_status).toBe('NO_MEDIA')
  })

  it('computes readiness and provenance independently per day (Post image + Reel source both required when present)', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const day1PostAssetId = day1.post.image_asset_id
    // Stub the Reel asset AND day 1's Post image — day 1 must resolve
    // provenance across BOTH refs. Day 2 in this fixture dropped
    // image_asset_id and Reel has no source ids, so its required-set is
    // empty and provenance fails closed.
    stubWithAssets([
      usableGetAsset({ id: ASSET_ID, storage_url: 'https://x/reel.jpg', original_filename: 'reel.jpg', source: 'stock', ownership: 'client_exclusive' }),
      usableGetAsset({ id: day1PostAssetId, storage_url: 'https://x/day1.jpg', original_filename: 'day1.jpg', source: 'client_provided', ownership: 'client_exclusive' }),
    ])

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    const b1 = json.bundles.find((b: { date: string }) => b.date === '2026-08-24')
    const b2 = json.bundles.find((b: { date: string }) => b.date === '2026-08-25')
    expect(b1.readiness.client_asset_provenance).toBe(true)
    // Provenance surfaces BOTH the Post image and the Reel source, deduped
    // by asset id — Post first (referenced-order stable).
    expect(b1.provenance).toHaveLength(2)
    expect(b1.provenance.map((a: { id: string }) => a.id)).toEqual([day1PostAssetId, ASSET_ID])
    expect(b2.readiness.client_asset_provenance).toBe(false)
    expect(b2.provenance).toEqual([])
  })

  it('never claims media is ready without real output, for any day', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    stubWithAssets([])

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.bundles.every((b: { reel: { media_status: string } }) => b.reel.media_status === 'NO_MEDIA')).toBe(true)
  })

  // Regression (Build Control remediation 5394505714, required test 3):
  // a day marked PLANNED with no matching bundle entry must fail honestly,
  // never silently borrow another day's (e.g. Day 1's) content.
  it('a PLANNED day with no matching bundle entry is honestly absent from `bundles`, never borrowed from another day', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const partialPlanData = { ...persistedPlanData, bundles: [day1] }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 2 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-1', plan_data: partialPlanData }] }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({ in: vi.fn().mockResolvedValue({ data: [] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.bundles).toHaveLength(1)
    expect(json.bundles.find((b: { date: string }) => b.date === '2026-08-25')).toBeUndefined()
    expect(json.days.find((d: { date: string }) => d.date === '2026-08-25').slots.post).toBe('PLANNED')
  })

  it('publishing plan and ad candidate are always NOT_AUTHORIZED', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    stubWithAssets([])

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.publishing_plan.status).toBe('NOT_AUTHORIZED')
    expect(json.ad_candidate.status).toBe('NOT_AUTHORIZED')
  })

  it('projects per-Post review without converting it into bundle or publishing approval', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const reviewedPlan = {
      ...persistedPlanData,
      review_meta: {
        schema_version: 1,
        plan_revision: persistedPlanData.command_meta.received_at,
        revision: '10000000-0000-0000-0000-000000000001',
        updated_at: '2026-08-24T01:00:00.000Z',
        posts: {
          '2026-08-24': {
            verdict: 'PASS',
            reason: null,
            reviewed_at: '2026-08-24T01:00:00.000Z',
            reviewed_by_user_id: '20000000-0000-0000-0000-000000000001',
          },
          '2026-08-25': {
            verdict: 'NEEDS_REVISION',
            reason: 'Replace the image',
            reviewed_at: '2026-08-24T01:01:00.000Z',
            reviewed_by_user_id: '20000000-0000-0000-0000-000000000001',
          },
        },
      },
    }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 2 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-1', plan_data: reviewedPlan }] }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({ in: vi.fn().mockResolvedValue({ data: [usableGetAsset({
          id: day1.post.image_asset_id,
          storage_url: 'https://assets.test/day1.jpg',
          original_filename: 'day1.jpg',
          source: 'client_provided',
          ownership: 'client_exclusive',
        })] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()
    const passed = json.bundles.find((b: { date: string }) => b.date === '2026-08-24')
    const revise = json.bundles.find((b: { date: string }) => b.date === '2026-08-25')

    expect(passed.post_review).toEqual({
      verdict: 'PASS',
      reason: null,
      reviewed_at: '2026-08-24T01:00:00.000Z',
      is_current: true,
    })
    expect(passed.post_review.reviewed_by_user_id).toBeUndefined()
    expect(revise.post_review).toMatchObject({ verdict: 'NEEDS_REVISION', reason: 'Replace the image' })
    expect(passed.readiness.human_approval).toBe(false)
    expect(json.review_summary).toEqual({ passed: 1, needs_revision: 1, total: 2 })
    expect(json.review_revision).toBe('10000000-0000-0000-0000-000000000001')
    expect(json.publishing_plan.status).toBe('NOT_AUTHORIZED')
  })

  it('does not display or count an old PASS as current after its image becomes unusable', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const reviewedPlan = {
      ...persistedPlanData,
      review_meta: {
        schema_version: 1,
        plan_revision: persistedPlanData.command_meta.received_at,
        revision: '10000000-0000-0000-0000-000000000001',
        updated_at: '2026-08-24T01:00:00.000Z',
        posts: {
          '2026-08-24': {
            verdict: 'PASS',
            reason: null,
            reviewed_at: '2026-08-24T01:00:00.000Z',
            reviewed_by_user_id: '20000000-0000-0000-0000-000000000001',
          },
        },
      },
    }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 2 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-1', plan_data: reviewedPlan }] }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({ in: vi.fn().mockResolvedValue({ data: [usableGetAsset({
          id: day1.post.image_asset_id,
          storage_url: '',
          original_filename: 'day1.jpg',
          source: 'client_provided',
          ownership: 'client_exclusive',
        })] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()
    const stale = json.bundles.find((b: { date: string }) => b.date === '2026-08-24')

    expect(stale.post_image).toBeNull()
    expect(stale.post_review).toMatchObject({ verdict: 'PASS', is_current: false })
    expect(json.review_summary).toEqual({ passed: 0, needs_revision: 0, total: 2 })
  })

  it('fails closed when persisted Post review metadata is malformed or belongs to another plan revision', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const invalidReviewPlan = {
      ...persistedPlanData,
      review_meta: {
        schema_version: 1,
        plan_revision: '2026-01-01T00:00:00.000Z',
        revision: '10000000-0000-0000-0000-000000000001',
        updated_at: '2026-08-24T01:00:00.000Z',
        posts: {},
      },
    }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 2 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-1', plan_data: invalidReviewPlan }] }) }) as never
      }
      return tableStub({}) as never
    })

    const response = await GET(getRequest(CAMPAIGN_ID), params())

    expect(response.status).toBe(500)
    expect((await response.json()).error).toBe('INVALID_POST_REVIEW_STATE')
  })

  it('fails closed when persisted review metadata has an orphan date or a missing revision reason', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const invalidReviewPlan = {
      ...persistedPlanData,
      review_meta: {
        schema_version: 1,
        plan_revision: persistedPlanData.command_meta.received_at,
        revision: '10000000-0000-0000-0000-000000000001',
        updated_at: '2026-08-24T01:00:00.000Z',
        posts: {
          '2026-08-31': {
            verdict: 'NEEDS_REVISION',
            reason: null,
            reviewed_at: '2026-08-24T01:00:00.000Z',
            reviewed_by_user_id: '20000000-0000-0000-0000-000000000001',
          },
        },
      },
    }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 2 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-1', plan_data: invalidReviewPlan }] }) }) as never
      }
      return tableStub({}) as never
    })

    const response = await GET(getRequest(CAMPAIGN_ID), params())

    expect(response.status).toBe(500)
    expect((await response.json()).error).toBe('INVALID_POST_REVIEW_STATE')
  })

  // Regression (Build Control TRUTHFUL READINESS remediation): the review
  // page must NOT read the campaign's primary_cta as a publishing
  // destination. `lead_form_submit` is a conversion goal — the current
  // Campaign carries no proven Facebook Page/account, so destination
  // remains UNKNOWN while conversion_goal surfaces the primary_cta.
  it("surfaces lead_form_submit as conversion_goal (never as destination); destination stays UNKNOWN while no FB Page/account is bound", async () => {
    allow()
    // Rebuild a Campaign whose primary_cta is exactly `lead_form_submit` —
    // this was the production case Ray hit that misread as a destination.
    const campaignWithFormGoal = { ...(CAMPAIGN as Record<string, unknown>), primary_cta: 'lead_form_submit' } as never
    mockGetCampaign.mockResolvedValue(campaignWithFormGoal)
    stubWithAssets([])

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.publishing_plan.conversion_goal).toBe('lead_form_submit')
    // Destination must NOT echo the conversion goal — no proven FB Page.
    expect(json.publishing_plan.destination).toBe('UNKNOWN')
    expect(json.publishing_plan.status).toBe('NOT_AUTHORIZED')
  })

  // Regression (Ray-authorised remediation 5405438962): GET resolves each
  // Post image from the authoritative client_assets row and never fabricates
  // a preview. A legacy plan whose Post has no image_asset_id returns
  // post_image: null — not an invented URL.
  it('GET returns a resolved post_image per day when image_asset_id resolves under CTS, and null for legacy Post without image_asset_id', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    // Day 1 has image_asset_id (from bundle() default). Day 2's post override
    // above drops image_asset_id, so it's a legacy-shape Post — post_image
    // must be null (honest), not fabricated.
    const day1AssetId = day1.post.image_asset_id
    stubWithAssets([usableGetAsset({
      id: day1AssetId,
      storage_url: 'https://x/day1.jpg',
      original_filename: 'day1.jpg',
      source: 'client_provided',
      ownership: 'client_exclusive',
    })])

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    const b1 = json.bundles.find((b: { date: string }) => b.date === '2026-08-24')
    const b2 = json.bundles.find((b: { date: string }) => b.date === '2026-08-25')
    expect(b1.post_image).toEqual({
      id: day1AssetId,
      preview_url: 'https://x/day1.jpg',
      filename: 'day1.jpg',
      source: 'client_provided',
      ownership: 'client_exclusive',
    })
    expect(b2.post_image).toBeNull()
  })

  it('caller-supplied preview_url stored inside plan_data cannot override the resolved asset row', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    // A malicious plan_data that tries to stuff a spoofed preview URL into
    // the Post — the route reads image data ONLY from the resolved
    // client_assets row keyed by image_asset_id, ignoring any field the
    // caller stuck alongside it.
    const evilPersistedPlan = {
      plan_kind: 'campaign_daily_v1',
      campaign_id: CAMPAIGN_ID,
      master_brief_ref: { id: BRIEF_ID, version: 2 },
      days: sevenDays(),
      bundles: [
        {
          ...day1,
          post: { ...day1.post, preview_url: 'https://evil.example/steal.jpg', ownership: 'industry_shared' },
        },
      ],
      command_meta: { source: 'conversation_command', received_at: '2026-08-24T00:00:00.000Z', raw_summary: null },
    }
    const day1AssetId = day1.post.image_asset_id
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 2 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-x', plan_data: evilPersistedPlan }] }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({ in: vi.fn().mockResolvedValue({ data: [usableGetAsset({
          id: day1AssetId,
          storage_url: 'https://legit-cts/authoritative.jpg',
          original_filename: 'authoritative.jpg',
          source: 'client_provided',
          ownership: 'client_exclusive',
        })] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    const b1 = json.bundles.find((b: { date: string }) => b.date === '2026-08-24')
    // Preview URL, ownership come from the authoritative asset row — not from the plan JSON.
    expect(b1.post_image.preview_url).toBe('https://legit-cts/authoritative.jpg')
    expect(b1.post_image.ownership).toBe('client_exclusive')
  })

  // Regression (Build Control TRUTHFUL READINESS): provenance must include
  // the Post image asset even when the Reel lists no source assets, and
  // client_asset_provenance is true in that case.
  it('Post image resolves + Reel has no source_asset_ids → provenance contains the Post image; provenance = true', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const only = bundle({
      date: '2026-08-24',
      reel: { brief: 'br', script: 'sc', caption: 'cp', source_asset_ids: [], media_status: 'NO_MEDIA' },
    })
    const plan = {
      plan_kind: 'campaign_daily_v1',
      campaign_id: CAMPAIGN_ID,
      master_brief_ref: { id: BRIEF_ID, version: 2 },
      days: sevenDays(),
      bundles: [only],
      command_meta: { source: 'conversation_command', received_at: '2026-08-24T00:00:00.000Z', raw_summary: null },
    }
    const postId = only.post.image_asset_id
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 2 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-1', plan_data: plan }] }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({ in: vi.fn().mockResolvedValue({ data: [usableGetAsset({ id: postId, storage_url: 'https://x/only.jpg', original_filename: 'only.jpg', source: 'client_provided', ownership: 'client_exclusive' })] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()
    const b = json.bundles.find((x: { date: string }) => x.date === '2026-08-24')
    expect(b.provenance).toHaveLength(1)
    expect(b.provenance[0].id).toBe(postId)
    expect(b.readiness.client_asset_provenance).toBe(true)
    expect(b.readiness.format_completeness.post).toBe(true)
  })

  // Regression (Build Control TRUTHFUL READINESS): when a Post and a Reel
  // reference THE SAME asset id, provenance must include that asset only
  // once — dedup keyed by asset id, matching the required-set used by
  // client_asset_provenance.
  it('Post + Reel reference the same asset id → provenance contains that asset once (deduped)', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const shared = 'ffffffff-0000-0000-0000-000000000001'
    const b1 = bundle({
      date: '2026-08-24',
      post: { hook: 'h', body: 'b', cta: 'Enquire Now', image_asset_id: shared, cta_url: CAMPAIGN_URL },
      reel: { brief: 'br', script: 'sc', caption: 'cp', source_asset_ids: [shared], media_status: 'NO_MEDIA' },
    })
    const plan = {
      plan_kind: 'campaign_daily_v1',
      campaign_id: CAMPAIGN_ID,
      master_brief_ref: { id: BRIEF_ID, version: 2 },
      days: sevenDays(),
      bundles: [b1],
      command_meta: { source: 'conversation_command', received_at: '2026-08-24T00:00:00.000Z', raw_summary: null },
    }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 2 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-1', plan_data: plan }] }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({ in: vi.fn().mockResolvedValue({ data: [usableGetAsset({ id: shared, storage_url: 'https://x/shared.jpg', original_filename: 'shared.jpg', source: 'client_provided', ownership: 'client_exclusive' })] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()
    const b = json.bundles.find((x: { date: string }) => x.date === '2026-08-24')
    expect(b.provenance).toHaveLength(1)
    expect(b.provenance[0].id).toBe(shared)
    expect(b.readiness.client_asset_provenance).toBe(true)
  })
})

// ── Regression (Build Control final narrow patch, threads
// PRRT_kwDOSTHiF86cEPbL / PRRT_kwDOSTHiF86cEPbS): the GET-side asset
// read-back must apply the SAME usable-image gate POST uses at write
// time; and Post-required semantics must not let a valid Reel compensate
// for a missing Post image. ────────────────────────────────────────────
describe('campaign-daily-plan GET — usable-image read-back boundary (post-save asset changes)', () => {
  const persistedPlan = {
    plan_kind: 'campaign_daily_v1',
    campaign_id: CAMPAIGN_ID,
    master_brief_ref: { id: BRIEF_ID, version: 2 },
    days: sevenDays(),
    bundles: [bundle({ date: '2026-08-24' })],
    command_meta: { source: 'conversation_command', received_at: '2026-08-24T00:00:00.000Z', raw_summary: null },
  }
  const postId = persistedPlan.bundles[0].post.image_asset_id

  function stubReadBack(assetRow: Record<string, unknown>) {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 2 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-1', plan_data: persistedPlan }] }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({ in: vi.fn().mockResolvedValue({ data: [assetRow] }) }) as never
      }
      return tableStub({}) as never
    })
  }

  it('an ARCHIVED asset read back after save is excluded from resolvedAssetIds — provenance false, Post incomplete, post_image null', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    stubReadBack({
      id: postId,
      storage_url: 'https://x/archived.jpg',
      original_filename: 'archived.jpg',
      source: 'client_provided',
      ownership: 'client_exclusive',
      status: 'analyzed',
      archived_at: '2026-08-25T00:00:00Z',
      mime_type: 'image/jpeg',
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()
    const b = json.bundles.find((x: { date: string }) => x.date === '2026-08-24')
    expect(b.readiness.client_asset_provenance).toBe(false)
    expect(b.readiness.format_completeness.post).toBe(false)
    expect(b.post_image).toBeNull()
    expect(b.provenance).toEqual([])
  })

  it('a PENDING/analyzing asset read back after save is excluded (status !== analyzed)', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    stubReadBack({
      id: postId,
      storage_url: 'https://x/pending.jpg',
      original_filename: 'pending.jpg',
      source: 'client_provided',
      ownership: 'client_exclusive',
      status: 'analyzing',
      archived_at: null,
      mime_type: 'image/jpeg',
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()
    const b = json.bundles.find((x: { date: string }) => x.date === '2026-08-24')
    expect(b.readiness.client_asset_provenance).toBe(false)
    expect(b.readiness.format_completeness.post).toBe(false)
    expect(b.post_image).toBeNull()
  })

  it('an ERROR-status asset read back after save is excluded', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    stubReadBack({
      id: postId,
      storage_url: 'https://x/err.jpg',
      original_filename: 'err.jpg',
      source: 'client_provided',
      ownership: 'client_exclusive',
      status: 'error',
      archived_at: null,
      mime_type: 'image/jpeg',
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()
    const b = json.bundles.find((x: { date: string }) => x.date === '2026-08-24')
    expect(b.readiness.client_asset_provenance).toBe(false)
    expect(b.readiness.format_completeness.post).toBe(false)
    expect(b.post_image).toBeNull()
  })

  it('a NON-IMAGE mime asset (e.g. video/mp4 sneaked in later) is excluded from provenance and post_image', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    stubReadBack({
      id: postId,
      storage_url: 'https://x/notimg.mp4',
      original_filename: 'notimg.mp4',
      source: 'client_provided',
      ownership: 'client_exclusive',
      status: 'analyzed',
      archived_at: null,
      mime_type: 'video/mp4',
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()
    const b = json.bundles.find((x: { date: string }) => x.date === '2026-08-24')
    expect(b.readiness.client_asset_provenance).toBe(false)
    expect(b.readiness.format_completeness.post).toBe(false)
    expect(b.post_image).toBeNull()
  })

  it('LEGACY Post without image_asset_id + Reel with a VALID resolved asset → client_asset_provenance is FALSE (Reel cannot compensate)', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const legacyReelId = 'ffffffff-0000-0000-0000-00000000abcd'
    const legacyPlan = {
      plan_kind: 'campaign_daily_v1',
      campaign_id: CAMPAIGN_ID,
      master_brief_ref: { id: BRIEF_ID, version: 2 },
      days: sevenDays(),
      bundles: [{
        date: '2026-08-24',
        // Legacy Post: hook/body/cta only — no image_asset_id.
        post: { hook: 'h', body: 'b', cta: 'Enquire Now' },
        story: { frames: [
          { order: 1, copy: 'f1' }, { order: 2, copy: 'f2' },
          { order: 3, copy: 'f3' }, { order: 4, copy: 'f4' },
        ]},
        reel: { brief: 'br', script: 'sc', caption: 'cp', source_asset_ids: [legacyReelId], media_status: 'NO_MEDIA' },
      }],
      command_meta: { source: 'conversation_command', received_at: '2026-08-24T00:00:00.000Z', raw_summary: null },
    }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 2 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-1', plan_data: legacyPlan }] }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({ in: vi.fn().mockResolvedValue({ data: [{
          id: legacyReelId,
          storage_url: 'https://x/reel-valid.jpg',
          original_filename: 'reel-valid.jpg',
          source: 'client_provided',
          ownership: 'client_exclusive',
          status: 'analyzed',
          archived_at: null,
          mime_type: 'image/jpeg',
        }] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()
    const b = json.bundles.find((x: { date: string }) => x.date === '2026-08-24')
    // Reel asset IS resolved — but Post is present without image_asset_id,
    // so provenance and Post-completeness must both be false regardless.
    expect(b.readiness.client_asset_provenance).toBe(false)
    expect(b.readiness.format_completeness.post).toBe(false)
    // Reel's own asset is still surfaced for the reviewer to see, but does
    // not by itself satisfy the truthful-readiness contract for this bundle.
    expect(b.provenance.map((a: { id: string }) => a.id)).toEqual([legacyReelId])
  })
})

describe('campaign-daily-plan POST — persistence seam authorisation', () => {
  it('rejects an unauthenticated draft write', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' } as never)

    const res = await POST(postRequest(validCommand()), params())

    expect(res.status).toBe(401)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects malformed commands before touching the database', async () => {
    allow()
    const res = await POST(postRequest({ campaign_id: 'not-a-uuid' }), params())

    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  // Regression (Build Control scope shrink 5395216001): partial snapshots
  // are rejected — the seam is now complete-seven-day only.
  it('rejects a partial snapshot (bundles.length < 7) before touching the database', async () => {
    allow()
    const bundles = fullSevenDays().slice(0, 3)
    const res = await POST(postRequest(validCommand({ bundles })), params())

    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects a snapshot with duplicate bundle dates before touching the database', async () => {
    allow()
    const bundles = fullSevenDays()
    bundles[1] = { ...bundles[0] } // two entries for the same date
    const res = await POST(postRequest(validCommand({ bundles })), params())

    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects a snapshot where a bundle date is not one of the seven scheduled days', async () => {
    allow()
    const bundles = fullSevenDays()
    bundles[0] = bundle({ date: '2026-09-15' }) // outside the seven scheduled days
    const res = await POST(postRequest(validCommand({ bundles })), params())

    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  // Regression (#1159 earlier remediation, Build Control finding 3): the
  // server must never persist a caller-declared media_status of READY.
  it("rejects a command that declares any day's Reel media_status is READY, before touching the database", async () => {
    allow()
    const bundles = fullSevenDays()
    bundles[0] = bundle({ reel: { ...bundle().reel, media_status: 'READY' } })
    const cmd = validCommand({ bundles })

    const res = await POST(postRequest(cmd), params())

    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockGetCampaign).not.toHaveBeenCalled()
  })
})

describe('campaign-daily-plan POST — fail-closed tenant boundary', () => {
  it('rejects a campaign that does not belong to this client', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(null)

    const res = await POST(postRequest(validCommand()), params())

    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('NEEDS_CAMPAIGN')
  })

  it('rejects a source asset that belongs to a different client, referenced from any day', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 1 } }) }) as never
      }
      if (table === 'client_assets') {
        // Post images ARE valid CTS-owned; only the Reel foreign asset is
        // missing from the returned rows.
        return tableStub({ in: vi.fn().mockResolvedValue({ data: validAssetsIn(POST_ASSET_IDS) }) }) as never
      }
      return tableStub({}) as never
    })

    const bundles = fullSevenDays()
    bundles[1] = bundle({
      date: bundles[1].date,
      reel: { ...bundle().reel, source_asset_ids: [FOREIGN_ASSET_ID] },
    })
    const cmd = validCommand({ bundles })

    const res = await POST(postRequest(cmd), params())

    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('ASSET_NOT_OWNED_BY_CLIENT')
  })

  // Regressions (Ray-authorised remediation 5405438962, Post visual contract).

  it('rejects a snapshot with a wrong-client Post image_asset_id', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 1 } }) }) as never
      }
      if (table === 'client_assets') {
        // Only 6 of the 7 Post assets are owned by CTS — day 4's image is
        // missing. ASSET_ID (the Reel asset) IS present so the Post-specific
        // gate is reached before the reel-foreign 403.
        return tableStub({ in: vi.fn().mockResolvedValue({ data: validAssetsIn([ASSET_ID, ...POST_ASSET_IDS.filter((_, i) => i !== 3)]) }) }) as never
      }
      return tableStub({}) as never
    })

    const res = await POST(postRequest(validCommand()), params())
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe('POST_IMAGE_INVALID')
    expect(json.invalid[0].reason).toBe('not_owned_by_client')
  })

  it('rejects a snapshot with an archived Post image', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 1 } }) }) as never
      }
      if (table === 'client_assets') {
        // Include ASSET_ID for the Reel side so the Post-specific gate is
        // reached (else the earlier reel-foreign check would 403 first).
        const rows = validAssetsIn([ASSET_ID, ...POST_ASSET_IDS])
        // Post asset row for day 1 (POST_ASSET_IDS[0]) is at index 1 after
        // prepending ASSET_ID for the Reel; mark it archived.
        rows[1] = { ...rows[1], archived_at: '2026-07-01T00:00:00Z' as never as null }
        return tableStub({ in: vi.fn().mockResolvedValue({ data: rows }) }) as never
      }
      return tableStub({}) as never
    })

    const res = await POST(postRequest(validCommand()), params())
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe('POST_IMAGE_INVALID')
    expect(json.invalid.some((i: { reason: string }) => i.reason === 'archived')).toBe(true)
  })

  it('rejects a snapshot with a non-image Post asset (e.g. a video mime)', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 1 } }) }) as never
      }
      if (table === 'client_assets') {
        // Include ASSET_ID for the Reel side so the Post-specific gate is
        // reached (else the earlier reel-foreign check would 403 first).
        const rows = validAssetsIn([ASSET_ID, ...POST_ASSET_IDS])
        // rows[0] is the ASSET_ID (Reel); rows[1] is day-1's Post asset.
        rows[1] = { ...rows[1], mime_type: 'video/mp4' }
        return tableStub({ in: vi.fn().mockResolvedValue({ data: rows }) }) as never
      }
      return tableStub({}) as never
    })

    const res = await POST(postRequest(validCommand()), params())
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe('POST_IMAGE_INVALID')
    expect(json.invalid.some((i: { reason: string }) => i.reason === 'not_an_image')).toBe(true)
  })

  it('rejects a snapshot with a Post asset in error/analyzing status', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 1 } }) }) as never
      }
      if (table === 'client_assets') {
        // Include ASSET_ID for the Reel side so the Post-specific gate is
        // reached (else the earlier reel-foreign check would 403 first).
        const rows = validAssetsIn([ASSET_ID, ...POST_ASSET_IDS])
        // rows[0]=ASSET_ID (Reel); rows[1]=day1 Post; rows[3]=day3's Post.
        rows[3] = { ...rows[3], status: 'error' }
        return tableStub({ in: vi.fn().mockResolvedValue({ data: rows }) }) as never
      }
      return tableStub({}) as never
    })

    const res = await POST(postRequest(validCommand()), params())
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe('POST_IMAGE_INVALID')
    expect(json.invalid.some((i: { reason: string }) => i.reason === 'status_error')).toBe(true)
  })

  it('rejects a snapshot whose Post cta_url differs from the campaign source URL', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    // No DB call needed — CTA mismatch is rejected before the asset lookup.
    const bundles = fullSevenDays()
    bundles[0] = { ...bundles[0], post: { ...bundles[0].post, cta_url: 'https://example-cts.test/some-other-page' } }
    const res = await POST(postRequest(validCommand({ bundles })), params())
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe('CTA_URL_MISMATCH')
    expect(json.expected).toBe(CAMPAIGN_URL)
  })

  it('rejects a POST when the campaign has no source_urls to bind CTA against', async () => {
    allow()
    mockGetCampaign.mockResolvedValue({ ...(CAMPAIGN as Record<string, unknown>), source_urls: [] } as never)
    const res = await POST(postRequest(validCommand()), params())
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe('CAMPAIGN_HAS_NO_CTA_SOURCE_URL')
  })

  it('propagates a Master Brief lookup error as 500 and never touches social_plans', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const socialPlansSpy = vi.fn()
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'connection reset' } }) }) as never
      }
      if (table === 'social_plans') {
        socialPlansSpy()
        return tableStub({}) as never
      }
      return tableStub({}) as never
    })

    const res = await POST(postRequest(validCommand()), params())
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.success).toBe(false)
    expect(socialPlansSpy).not.toHaveBeenCalled()
  })
})

describe('campaign-daily-plan POST — persists structured facts (no LLM/provider call)', () => {
  it('inserts a new campaign_daily_v1 row with all seven days\' bundles', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const insertedSelect = vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'new-plan-id' }, error: null }) })
    const insert = vi.fn().mockReturnValue({ select: insertedSelect })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 1 } }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({ in: vi.fn().mockResolvedValue({ data: validAssetsIn([ASSET_ID, ...POST_ASSET_IDS]) }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: null }), insert }) as never
      }
      return tableStub({}) as never
    })

    const res = await POST(postRequest(validCommand()), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.plan_id).toBe('new-plan-id')
    // Insert payload must contain all seven days' bundles, matching days[].
    const insertArg = insert.mock.calls[0][0] as { plan_data: { plan_kind: string; bundles: Array<{ date: string }>; days: Array<{ date: string }> } }
    expect(insertArg.plan_data.plan_kind).toBe('campaign_daily_v1')
    expect(insertArg.plan_data.bundles).toHaveLength(7)
    expect(insertArg.plan_data.bundles.map(b => b.date).sort())
      .toEqual(insertArg.plan_data.days.map(d => d.date).sort())
  })

  it('updates the existing campaign_daily_v1 row instead of duplicating it', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const plans = socialPlansTable([storedPlanRow()])
    mockPostTables(plans)

    const res = await POST(postRequest(validCommand()), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.plan_id).toBe(EXISTING_PLAN_ID)
    expect(plans.writes.updates).toHaveLength(1)
    expect(plans.writes.inserts).toHaveLength(0)
    expect(plans.rows).toHaveLength(1)
  })

  // Regression (Build Control scope shrink 5395216001, required test 6):
  // a complete-snapshot UPDATE must REPLACE the stored bundles wholesale —
  // no preserved-old bundles carrying the new save's master_brief_ref can
  // sneak through. This removes the false-grounding and stale-window
  // risks the scope shrink is designed to eliminate.
  it('replaces the stored bundles on UPDATE — no preserved-old bundles from a previous save survive', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)

    // The old stored row includes a bundle for a date OUTSIDE the new seven-
    // day window. After a wholesale replace this old bundle must be gone.
    const previousRow = storedPlanRow({
      master_brief_ref: { id: 'OLD_BRIEF_ID', version: 99 },
      days: sevenDays().map(d => ({ ...d, date: `2026-07-${(Number(d.date.slice(-1)) + 20).toString().padStart(2, '0')}` })),
      bundles: [bundle({ date: '2026-07-20' })], // outside the incoming window
      command_meta: { source: 'conversation_command', received_at: '2026-07-20T00:00:00Z', raw_summary: null },
      review_meta: {
        schema_version: 1,
        plan_revision: '2026-07-20T00:00:00Z',
        revision: '10000000-0000-0000-0000-000000000001',
        updated_at: '2026-07-20T01:00:00Z',
        posts: {},
      },
    })
    const plans = socialPlansTable([previousRow])
    mockPostTables(plans)

    const res = await POST(postRequest(validCommand()), params())
    expect(res.status).toBe(200)

    const updateArg = plans.writes.updates[0] as { plan_data: { bundles: Array<{ date: string }>, days: Array<{ date: string }>, review_meta?: unknown } }
    expect(updateArg.plan_data.bundles).toHaveLength(7)
    // Old preserved date is GONE.
    expect(updateArg.plan_data.bundles.find(b => b.date === '2026-07-20')).toBeUndefined()
    // Persisted bundles exactly equal the incoming days set — no elevation
    // of previously-ungrounded old bundles under the new master_brief_ref.
    expect(updateArg.plan_data.bundles.map(b => b.date).sort())
      .toEqual(updateArg.plan_data.days.map(d => d.date).sort())
    // A new content snapshot invalidates all prior Post review decisions.
    expect(updateArg.plan_data.review_meta).toBeUndefined()
  })

  // Regression (Build Control scope shrink 5395216001, required test 5):
  // GET still honours the legacy singular current_bundle field on rows
  // written before the bundles[] migration — so pre-existing production
  // rows do not silently disappear before an authorised full rewrite.
  it('GET still surfaces a legacy current_bundle row (no bundles[]) as a single-entry bundles array', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const legacyPlanData = {
      plan_kind: 'campaign_daily_v1',
      campaign_id: CAMPAIGN_ID,
      master_brief_ref: { id: BRIEF_ID, version: 2 },
      days: sevenDays(),
      // NO bundles[] — only the pre-migration singular field.
      current_bundle: bundle({ date: '2026-08-24' }),
      command_meta: { source: 'conversation_command', received_at: '2026-08-24T00:00:00.000Z', raw_summary: null },
    }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 2 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'legacy-plan-1', plan_data: legacyPlanData }] }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({ in: vi.fn().mockResolvedValue({ data: [usableGetAsset({ id: ASSET_ID, storage_url: 'https://x/y.jpg', original_filename: 'y.jpg', source: 'stock', ownership: 'client_exclusive' })] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.bundles).toHaveLength(1)
    expect(json.bundles[0].date).toBe('2026-08-24')
    expect(json.bundles[0].post.hook).toBe('hook')
  })
})

// Regression (2026-09-15): a new seven-day command for a campaign whose plan
// was already published rebuilt plan_data from scratch and erased
// `publish_meta` — the only record recall needs to delete the live Posts.
describe('campaign-daily-plan POST — never erases a publish or publish-queue receipt', () => {
  it('fixtures match the real stored receipt schemas', () => {
    expect(CampaignDailyPostReviewMetaSchema.safeParse(storedReviewMeta()).success).toBe(true)
    expect(CampaignDailyPublishQueueMetaSchema.safeParse(storedQueueMeta()).success).toBe(true)
    expect(CampaignDailyPublishMetaSchema.safeParse(storedPublishMeta()).success).toBe(true)
  })

  it('refuses with 409 PLAN_ALREADY_PUBLISHED and leaves the stored publish receipt untouched', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const row = storedPlanRow({
      review_meta: storedReviewMeta(),
      publish_queue_meta: storedQueueMeta(),
      publish_meta: storedPublishMeta(),
    })
    const before = structuredClone(row.plan_data)
    const plans = socialPlansTable([row])
    mockPostTables(plans)

    const res = await POST(postRequest(validCommand()), params())
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json).toMatchObject({
      success: false,
      error: 'PLAN_ALREADY_PUBLISHED',
      plan_id: EXISTING_PLAN_ID,
      publish_status: 'PUBLISHED',
      next_step: 'CREATE_NEW_CAMPAIGN',
    })
    expect(plans.writes.updates).toHaveLength(0)
    expect(plans.writes.inserts).toHaveLength(0)
    expect(plans.rows).toHaveLength(1)
    expect(plans.rows[0].plan_data).toEqual(before)
  })

  it('still refuses when every published Post was recalled — the recall entries are the audit trail', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const recalled = storedPublishMeta().published.map(p => ({
      date: p.date,
      idempotency_key: p.idempotency_key,
      post_id: p.post_id,
      recalled_at: '2026-09-09T00:00:00.000Z',
      already_gone: false,
    }))
    const publishMeta = storedPublishMeta({ published: [], recalled })
    expect(CampaignDailyPublishMetaSchema.safeParse(publishMeta).success).toBe(true)
    const plans = socialPlansTable([storedPlanRow({
      review_meta: storedReviewMeta(),
      publish_queue_meta: storedQueueMeta(),
      publish_meta: publishMeta,
    })])
    mockPostTables(plans)

    const res = await POST(postRequest(validCommand()), params())

    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('PLAN_ALREADY_PUBLISHED')
    expect(plans.writes.updates).toHaveLength(0)
    expect(plans.rows[0].plan_data.publish_meta).toEqual(publishMeta)
  })

  it('refuses with 409 PLAN_PUBLISH_QUEUED when the plan is queued but not yet published', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const plans = socialPlansTable([storedPlanRow({
      review_meta: storedReviewMeta(),
      publish_queue_meta: storedQueueMeta(),
    })])
    mockPostTables(plans)

    const res = await POST(postRequest(validCommand()), params())
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json).toMatchObject({ error: 'PLAN_PUBLISH_QUEUED', plan_id: EXISTING_PLAN_ID, publish_status: null })
    expect(plans.writes.updates).toHaveLength(0)
    expect(plans.rows[0].plan_data.publish_queue_meta).toEqual(storedQueueMeta())
  })

  it('still replaces a reviewed-but-unqueued plan and clears its now-stale review', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const plans = socialPlansTable([storedPlanRow({ review_meta: storedReviewMeta() })])
    mockPostTables(plans)

    const res = await POST(postRequest(validCommand()), params())

    expect(res.status).toBe(200)
    expect(plans.rows).toHaveLength(1)
    expect(plans.rows[0].plan_data.review_meta).toBeUndefined()
    expect((plans.rows[0].plan_data.command_meta as { received_at: string }).received_at)
      .not.toBe(STORED_PLAN_REVISION)
  })

  it('does not erase a publish receipt that lands between the read and the write (409 PLAN_CHANGED_DURING_SAVE)', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const plans = socialPlansTable([storedPlanRow({ review_meta: storedReviewMeta() })], {
      beforeUpdate: rows => {
        rows[0].plan_data = {
          ...rows[0].plan_data,
          publish_queue_meta: storedQueueMeta(),
          publish_meta: storedPublishMeta(),
        }
      },
    })
    mockPostTables(plans)

    const res = await POST(postRequest(validCommand()), params())
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json).toMatchObject({ error: 'PLAN_CHANGED_DURING_SAVE', plan_id: EXISTING_PLAN_ID })
    expect(plans.rows[0].plan_data.publish_meta).toEqual(storedPublishMeta())
    expect((plans.rows[0].plan_data.command_meta as { received_at: string }).received_at).toBe(STORED_PLAN_REVISION)
  })

  // Each compare-and-set guard is locked on its own: the realistic race is a
  // publish-queue write alone (publish needs that receipt first), but either
  // receipt landing alone must stop the overwrite.
  it.each([
    ['publish_queue_meta', () => ({ publish_queue_meta: storedQueueMeta() })],
    ['publish_meta', () => ({ publish_meta: storedPublishMeta() })],
  ])('refuses when only %s lands between the read and the write', async (key, landed) => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const plans = socialPlansTable([storedPlanRow({ review_meta: storedReviewMeta() })], {
      beforeUpdate: rows => {
        rows[0].plan_data = { ...rows[0].plan_data, ...landed() }
      },
    })
    mockPostTables(plans)

    const res = await POST(postRequest(validCommand()), params())

    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('PLAN_CHANGED_DURING_SAVE')
    expect(plans.rows[0].plan_data[key]).toEqual(landed()[key as keyof ReturnType<typeof landed>])
    expect((plans.rows[0].plan_data.command_meta as { received_at: string }).received_at).toBe(STORED_PLAN_REVISION)
  })

  it('a failed plan lookup returns 500 and never inserts a second row that would hide the receipt', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const plans = socialPlansTable(
      [storedPlanRow({ publish_meta: storedPublishMeta() })],
      { readError: { message: 'connection reset' } }
    )
    mockPostTables(plans)

    const res = await POST(postRequest(validCommand()), params())

    expect(res.status).toBe(500)
    expect(plans.writes.inserts).toHaveLength(0)
    expect(plans.writes.updates).toHaveLength(0)
    expect(plans.rows).toHaveLength(1)
  })
})
