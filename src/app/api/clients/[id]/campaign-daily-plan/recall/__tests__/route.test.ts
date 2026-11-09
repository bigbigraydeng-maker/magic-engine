/**
 * Recall route — the stored `post_id` is passed to Graph DELETE verbatim.
 *
 * Receipts hold two id shapes, both already in production and both still
 * written after the story-resolve change:
 *  - scheduled photo: `post_id` is the bare photo id (`post_id_source: 'id'`);
 *    the resolved story id lives only in the measurement action row;
 *  - immediate publish: `post_id` is the `<page>_<post>` feed id (`post_id`).
 * Both must stay recallable, and the route must not rewrite either id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/meta/token-manager', () => ({
  getMetaTokenForClient: vi.fn(),
  getStoredPageToken: vi.fn(),
}))
vi.mock('@/lib/meta/page-posts', () => ({
  getPageAccessToken: vi.fn(),
  deletePagePost: vi.fn(),
}))
vi.mock('@/lib/campaign/daily-plan-auto-publish-store', () => ({ tombstoneRecalledDates: vi.fn() }))
vi.mock('@/lib/campaign/daily-plan-auto-publish-records', () => ({ readAutoPublishRecords: vi.fn() }))

import { POST } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { getStoredPageToken } from '@/lib/meta/token-manager'
import { deletePagePost } from '@/lib/meta/page-posts'
import { tombstoneRecalledDates } from '@/lib/campaign/daily-plan-auto-publish-store'
import { readAutoPublishRecords } from '@/lib/campaign/daily-plan-auto-publish-records'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)
const mockStoredToken = vi.mocked(getStoredPageToken)
const mockDelete = vi.mocked(deletePagePost)
const mockTombstone = vi.mocked(tombstoneRecalledDates)
const mockRecords = vi.mocked(readAutoPublishRecords)

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CAMPAIGN_ID = 'a0000000-0000-0000-0000-000000000001'
const PLAN_ID = 'b0000000-0000-0000-0000-000000000001'
const USER_ID = 'f0000000-0000-0000-0000-000000000001'
const PLAN_REVISION = '2026-09-01T15:00:04.513Z'
const REVIEW_REVISION = '10000000-0000-0000-0000-000000000001'
const REQUEST_ID = '30000000-0000-0000-0000-000000000001'
const PAGE_ID = '1616575215312482'
const LEGACY_PHOTO_ID = '1750835520181969'
const STORY_ID = `${PAGE_ID}_1750835520182000`

function publishedEntry(date: string, postId: string, source: 'id' | 'post_id') {
  return {
    date,
    idempotency_key: `fbpost_${date}`,
    post_id: postId,
    post_id_source: source,
    page_id: PAGE_ID,
    published_at: '2026-09-02T00:00:00.000Z',
    scheduled_publish_time: '2026-09-02T20:00:00.000Z',
    permalink: `https://www.facebook.com/${postId}`,
    provider_response: { id: postId.split('_').pop() },
  }
}

function receipt() {
  return {
    schema_version: 1,
    event_name: 'daily_plan.post.published',
    status: 'PUBLISHED',
    request_id: REQUEST_ID,
    client_id: CLIENT_ID,
    campaign_id: CAMPAIGN_ID,
    plan_id: PLAN_ID,
    plan_revision: PLAN_REVISION,
    review_revision: REVIEW_REVISION,
    page_id: PAGE_ID,
    publishing_authorization: 'AUTHORIZED',
    approved_by_user_id: USER_ID,
    created_at: '2026-09-02T00:00:00.000Z',
    published: [
      publishedEntry('2026-09-03', LEGACY_PHOTO_ID, 'id'),
      publishedEntry('2026-09-04', STORY_ID, 'post_id'),
    ],
    failed: [],
    event_ids: [],
  }
}

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/campaign-daily-plan/recall`, {
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
      dates: ['2026-09-03', '2026-09-04'],
      ...overrides,
    }),
  })
}

const params = { params: { id: CLIENT_ID } }

function chain(result: unknown, terminal: string) {
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'contains', 'order', 'limit', 'maybeSingle', 'update']) {
    query[method] = vi.fn().mockReturnValue(query)
  }
  query[terminal] = vi.fn().mockResolvedValue(result)
  return query
}

let updateSpy: ReturnType<typeof vi.fn>

/** Fake Supabase modelled by table: plan read + CAS write, and the client row. */
function stubTables() {
  updateSpy = vi.fn()
  mockFrom.mockImplementation(((table: string) => {
    if (table === 'clients') return chain({ data: { facebook_page_id: PAGE_ID }, error: null }, 'maybeSingle')
    if (table === 'social_plans') {
      const read = chain({ data: { id: PLAN_ID, plan_data: { plan_kind: 'campaign_daily_v1', publish_meta: receipt() } }, error: null }, 'maybeSingle')
      const write = chain({ data: [{ id: PLAN_ID }], error: null }, 'select')
      read.update = vi.fn().mockImplementation((payload: unknown) => {
        updateSpy(payload)
        return write
      })
      return read
    }
    throw new Error(`unexpected table ${table}`)
  }) as never)
}

beforeEach(() => {
  mockAccess.mockResolvedValue({
    ok: true,
    user: { id: USER_ID, email: 'ray@example.test' },
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  } as never)
  mockStoredToken.mockResolvedValue('stored-page-token')
  mockDelete.mockResolvedValue({ alreadyGone: false, raw: { success: true } })
  mockTombstone.mockResolvedValue({ tombstoned: 2 })
  mockRecords.mockResolvedValue({ status: 'OK', posts: [], unconfirmed: [] })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('recall — bare photo id and feed post id receipts', () => {
  it('🔴 deletes each receipt entry by its stored post_id, unchanged', async () => {
    stubTables()

    const response = await POST(request({ no_recall: false }), params)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.status).toBe('RECALLED')
    expect(mockDelete).toHaveBeenCalledTimes(2)
    expect(mockDelete.mock.calls.map(call => call[0].postId)).toEqual([LEGACY_PHOTO_ID, STORY_ID])
    expect(mockDelete.mock.calls[0][0].pageAccessToken).toBe('stored-page-token')
    expect(json.recalled.map((r: { post_id: string }) => r.post_id)).toEqual([LEGACY_PHOTO_ID, STORY_ID])

    const written = updateSpy.mock.calls[0][0] as {
      plan_data: { publish_meta: { published: unknown[]; recalled: Array<{ post_id: string }> } }
    }
    expect(written.plan_data.publish_meta.published).toEqual([])
    expect(written.plan_data.publish_meta.recalled.map(r => r.post_id)).toEqual([LEGACY_PHOTO_ID, STORY_ID])
  })

  it('dry run lists both ids without calling Graph', async () => {
    stubTables()

    const json = await (await POST(request(), params)).json()

    expect(json.status).toBe('DRY_RUN')
    expect(json.would_recall.map((r: { post_id: string }) => r.post_id)).toEqual([LEGACY_PHOTO_ID, STORY_ID])
    expect(mockDelete).not.toHaveBeenCalled()
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('🔴 a live recall tombstones the recalled dates so the automatic publisher can never re-send them', async () => {
    stubTables()

    const json = await (await POST(request({ no_recall: false }), params)).json()

    expect(mockTombstone).toHaveBeenCalledTimes(1)
    const input = mockTombstone.mock.calls[0][0]
    expect(input.clientId).toBe(CLIENT_ID)
    expect(input.planId).toBe(PLAN_ID)
    expect(input.dates).toHaveLength(2)
    expect(json.auto_publish_tombstone).toEqual({ status: 'OK', tombstoned: 2 })
  })

  it('🔴 when the tombstone write fails the recall still stands but the response says so', async () => {
    stubTables()
    mockTombstone.mockRejectedValue(new Error('db down'))

    const response = await POST(request({ no_recall: false }), params)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.status).toBe('RECALLED')
    expect(json.auto_publish_tombstone.status).toBe('FAILED')
    // internal error text must not reach the (possibly customer) caller
    expect(JSON.stringify(json)).not.toContain('db down')
    expect(json.warning).toMatch(/撤回成功/)
  })

  it('a dry run never writes to the automatic-publish tables', async () => {
    stubTables()

    await POST(request(), params)

    expect(mockTombstone).not.toHaveBeenCalled()
  })

  it('🔴 posts known only to the auto-publisher (not in the receipt) are surfaced with a note, dry run and live', async () => {
    stubTables()
    mockRecords.mockResolvedValue({
      status: 'OK',
      posts: [{ date: '2026-09-04', post_id: '999_1', scheduled_publish_time: null }],
      unconfirmed: [{ date: '2026-09-03', status: 'unknown_outcome' }],
    })

    const dry = await (await POST(request(), params)).json()
    expect(dry.auto_publish_records.posts).toHaveLength(1)
    expect(dry.auto_publish_records.unconfirmed).toHaveLength(1)
    expect(dry.auto_publish_note).toMatch(/Facebook 主页核对/)

    stubTables()
    const live = await (await POST(request({ no_recall: false }), params)).json()
    expect(live.auto_publish_records.posts[0].post_id).toBe('999_1')
    expect(live.auto_publish_note).toMatch(/不会被本次撤回删除/)
  })

  it('🔴 an unreadable auto-publish record says so instead of implying there is nothing', async () => {
    stubTables()
    mockRecords.mockResolvedValue({ status: 'UNKNOWN', posts: [], unconfirmed: [] })

    const json = await (await POST(request(), params)).json()

    expect(json.auto_publish_records.status).toBe('UNKNOWN')
    expect(json.auto_publish_note).toMatch(/没能读到/)
  })

  it('nothing extra known → no note; receipt ids (published + recalled) are passed down', async () => {
    stubTables()

    const json = await (await POST(request(), params)).json()

    expect(json.auto_publish_note).toBeUndefined()
    const arg = mockRecords.mock.calls[0][0]
    expect(arg.dates).toEqual(['2026-09-03', '2026-09-04'])
    expect(arg.receiptPostIds.has(LEGACY_PHOTO_ID)).toBe(true)
  })
})
