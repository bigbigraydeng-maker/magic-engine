/**
 * The promote check: only a live, public, owned Post with an unexpired poster
 * becomes an "add paused" intent. No Graph or database calls.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/winner-reel-sync/engine', () => ({}))

import {
  checkDailyPlanPromotion,
  findLivePublishedPost,
  nzToday,
  type PromoteDeps,
} from '../daily-plan-promote'
import {
  CAMPAIGN_DAILY_PLAN_KIND,
  type CampaignDailyPlanData,
  type CampaignDailyPosterMeta,
} from '../daily-plan'
import {
  DAILY_PLAN_POST_PUBLISHED_EVENT,
  type CampaignDailyPublishedPost,
  type CampaignDailyPublishMeta,
} from '../daily-plan-publish'

const CLIENT = 'client-1'
const PAGE = '1616575215312482'
const PLAN = '11111111-1111-4111-8111-111111111111'

function published(over: Partial<CampaignDailyPublishedPost> = {}): CampaignDailyPublishedPost {
  return {
    date: '2026-11-19',
    idempotency_key: 'fbpost_a',
    post_id: `${PAGE}_1750182150247306`,
    post_id_source: 'post_id',
    page_id: PAGE,
    published_at: '2026-11-18T20:00:00.000Z',
    permalink: 'https://www.facebook.com/x',
    provider_response: {},
    ...over,
  }
}

function publishMeta(posts: CampaignDailyPublishedPost[], recalledIds: string[] = []): CampaignDailyPublishMeta {
  return {
    schema_version: 1,
    event_name: DAILY_PLAN_POST_PUBLISHED_EVENT,
    status: 'PUBLISHED',
    request_id: 'req-1',
    client_id: CLIENT,
    campaign_id: 'c1',
    plan_id: PLAN,
    plan_revision: 'r1',
    review_revision: 'rv1',
    page_id: PAGE,
    publishing_authorization: 'AUTHORIZED',
    approved_by_user_id: 'u1',
    created_at: '2026-11-18T20:00:00.000Z',
    published: posts,
    failed: [],
    event_ids: [],
    recalled: recalledIds.map((post_id) => ({
      date: '2026-11-19', idempotency_key: 'k', post_id, recalled_at: '2026-11-19T00:00:00.000Z', already_gone: false,
    })),
  }
}

const POSTER: CampaignDailyPosterMeta = {
  recipe_id: 'tour_poster_v1',
  recipe_version: 2,
  source_asset_id: '22222222-2222-4222-8222-222222222222',
  status: 'composed',
  reason: null,
  poster_asset_id: 'asset-1',
  has_price: true,
  cost_usd: 0.054,
  provider_request_id: 'req',
  created_at: '2026-11-18T00:00:00.000Z',
  text_check: null,
}

function plan(opts: { posts?: CampaignDailyPublishedPost[]; recalled?: string[]; poster?: CampaignDailyPosterMeta } = {}): CampaignDailyPlanData {
  return {
    plan_kind: CAMPAIGN_DAILY_PLAN_KIND,
    campaign_id: 'c1',
    master_brief_ref: null,
    days: [],
    bundles: [],
    command_meta: {
      source: 'auto_image_post',
      received_at: '2026-11-18T00:00:00.000Z',
      raw_summary: null,
      ...(opts.poster ? { poster: opts.poster } : {}),
    },
    publish_meta: publishMeta(opts.posts ?? [published()], opts.recalled),
  }
}

function deps(over: Partial<PromoteDeps> = {}): PromoteDeps {
  return {
    loadPlan: vi.fn(async () => plan()),
    registeredPageId: vi.fn(async () => PAGE),
    readStoryId: vi.fn(async () => `${PAGE}_9999999999`),
    posterNextDepart: vi.fn(async () => null),
    target: vi.fn(async () => ({
      ok: true as const, pageId: PAGE, adAccountId: 'act_11', adsetId: '301', promotedPostIds: new Set<string>(),
    })),
    now: () => new Date('2026-11-19T03:00:00.000Z'),
    ...over,
  }
}

const input = { clientId: CLIENT, planId: PLAN, date: '2026-11-19' }

describe('daily plan promote check', () => {
  it('turns a live published Post into a paused-add intent for the pool ad set', async () => {
    const result = await checkDailyPlanPromotion(deps(), input)
    expect(result).toEqual({
      ok: true,
      intent: {
        postId: '1750182150247306', name: '每日帖 2026-11-19', score: 0, pageId: PAGE,
        adAccountId: 'act_11', adsetId: '301', origin: { kind: 'daily_plan', planId: PLAN, date: '2026-11-19' },
      },
    })
  })

  it('refuses a recalled Post', async () => {
    const post = published()
    const result = await checkDailyPlanPromotion(deps({ loadPlan: vi.fn(async () => plan({ posts: [post], recalled: [post.post_id] })) }), input)
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('撤回') })
  })

  it('refuses a Post on a Page other than the registered one', async () => {
    const result = await checkDailyPlanPromotion(deps({ registeredPageId: vi.fn(async () => '999999999') }), input)
    expect(result.ok).toBe(false)
  })

  it('refuses a scheduled photo that is not public yet, without reading Graph', async () => {
    const read = vi.fn(async () => `${PAGE}_1`)
    const post = published({ post_id: '1750835520181969', post_id_source: 'id', scheduled_publish_time: '2026-11-20T20:00:00.000Z' })
    const result = await checkDailyPlanPromotion(deps({ readStoryId: read, loadPlan: vi.fn(async () => plan({ posts: [post] })) }), input)
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('还没到公开时间') })
    expect(read).not.toHaveBeenCalled()
  })

  it('resolves a public scheduled photo to its feed story id', async () => {
    const post = published({ post_id: '1750835520181969', post_id_source: 'id', scheduled_publish_time: '2026-11-18T20:00:00.000Z' })
    const result = await checkDailyPlanPromotion(deps({ loadPlan: vi.fn(async () => plan({ posts: [post] })) }), input)
    expect(result.ok && result.intent.postId).toBe('9999999999')
  })

  it('refuses when the story id cannot be read or belongs to another Page', async () => {
    const post = published({ post_id: '1750835520181969', post_id_source: 'id' })
    const other = await checkDailyPlanPromotion(deps({
      loadPlan: vi.fn(async () => plan({ posts: [post] })),
      readStoryId: vi.fn(async () => '123456789_99999'),
    }), input)
    expect(other.ok).toBe(false)
    const none = await checkDailyPlanPromotion(deps({
      loadPlan: vi.fn(async () => plan({ posts: [post] })),
      readStoryId: vi.fn(async () => null),
    }), input)
    expect(none.ok).toBe(false)
  })

  it('refuses a poster whose printed departure has passed (NZ date), and one it cannot read', async () => {
    const withPoster = plan({ poster: POSTER })
    const past = await checkDailyPlanPromotion(deps({
      loadPlan: vi.fn(async () => withPoster),
      posterNextDepart: vi.fn(async () => '2026-11-18'),
    }), input)
    expect(past).toEqual({ ok: false, reason: expect.stringContaining('2026-11-18') })
    const unreadable = await checkDailyPlanPromotion(deps({
      loadPlan: vi.fn(async () => withPoster),
      posterNextDepart: vi.fn(async () => undefined),
    }), input)
    expect(unreadable.ok).toBe(false)
    const today = await checkDailyPlanPromotion(deps({
      loadPlan: vi.fn(async () => withPoster),
      posterNextDepart: vi.fn(async () => '2026-11-19'),
    }), input)
    expect(today.ok).toBe(true)
  })

  it('refuses when the pool ad set is missing or already has this Post', async () => {
    const missing = await checkDailyPlanPromotion(deps({ target: vi.fn(async () => ({ ok: false as const, reason: '没有配推广池广告组' })) }), input)
    expect(missing).toEqual({ ok: false, reason: '没有配推广池广告组' })
    const dup = await checkDailyPlanPromotion(deps({
      target: vi.fn(async () => ({ ok: true as const, pageId: PAGE, adAccountId: 'act_11', adsetId: '301', promotedPostIds: new Set(['1750182150247306']) })),
    }), input)
    expect(dup).toEqual({ ok: false, reason: expect.stringContaining('已经在推广池') })
  })

  it('refuses a missing plan, or a date with no live Post', async () => {
    expect((await checkDailyPlanPromotion(deps({ loadPlan: vi.fn(async () => null) }), input)).ok).toBe(false)
    expect((await checkDailyPlanPromotion(deps(), { ...input, date: '2026-11-20' })).ok).toBe(false)
  })

  it('treats two live entries for one date as ambiguous', () => {
    const p = plan({ posts: [published(), published({ post_id: `${PAGE}_2`, idempotency_key: 'b' })] })
    expect(findLivePublishedPost(p, '2026-11-19')).toBeNull()
  })

  it('uses the NZ calendar date', () => {
    expect(nzToday(new Date('2026-11-18T12:30:00.000Z'))).toBe('2026-11-19')
  })
})
