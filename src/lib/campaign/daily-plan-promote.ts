/**
 * Promote one published Daily Plan Post: a person presses the button, this
 * checks the Post and proposes the existing winner-sync "add paused" card.
 *
 *   plan      the Post must be in the plan's publish receipt and not recalled
 *   public    a scheduled photo must already be public; its feed story id is
 *             read from Graph (the receipt only holds the photo id)
 *   poster    an AI poster's printed next departure must not have passed
 *   target    the client's pool ad set, ownership-checked; the Post must not
 *             already be an ad there
 *
 * This file never writes to Meta. The card's confirm runs the same check again
 * (`recheckDailyPlanPromotion`) and only then creates a paused ad; opening it
 * is a second card bound to the approved ads plan.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { CAMPAIGN_DAILY_PLAN_KIND, type CampaignDailyPlanData } from '@/lib/campaign/daily-plan'
import type { CampaignDailyPublishedPost } from '@/lib/campaign/daily-plan-publish'
import { readPosterLineage } from '@/lib/assets/provenance'
import type { AddIntent, DailyPlanOrigin } from '@/lib/winner-reel-sync/intents'
import type { PromotionTarget } from '@/lib/winner-reel-sync/engine'

const STORY_ID = /^\d{5,25}_\d{5,25}$/
const BARE_ID = /^\d{5,25}$/

export type PromoteCheck =
  | { ok: true; intent: AddIntent }
  | { ok: false; reason: string }

export interface PromoteDeps {
  loadPlan(clientId: string, planId: string): Promise<CampaignDailyPlanData | null>
  registeredPageId(clientId: string): Promise<string | null>
  /** Feed story id for a photo id, or null when it cannot be read yet. */
  readStoryId(clientId: string, pageId: string, photoId: string): Promise<string | null>
  /** Poster lineage `next_depart_on` (YYYY-MM-DD or null); undefined = the poster row could not be read. */
  posterNextDepart(clientId: string, posterAssetId: string): Promise<string | null | undefined>
  target(clientId: string): Promise<PromotionTarget>
  now(): Date
}

/** The live receipt entry for this date, ignoring any entry whose post was recalled. */
export function findLivePublishedPost(plan: CampaignDailyPlanData, date: string): CampaignDailyPublishedPost | null {
  const meta = plan.publish_meta
  if (!meta) return null
  const recalled = new Set((meta.recalled ?? []).map((r) => r.post_id))
  const live = meta.published.filter((p) => p.date === date && !recalled.has(p.post_id))
  return live.length === 1 ? live[0] ?? null : null
}

/** NZ calendar date for `now`, YYYY-MM-DD. */
export function nzToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(now)
}

export async function checkDailyPlanPromotion(
  deps: PromoteDeps,
  input: { clientId: string; planId: string; date: string },
): Promise<PromoteCheck> {
  const plan = await deps.loadPlan(input.clientId, input.planId)
  if (!plan || plan.plan_kind !== CAMPAIGN_DAILY_PLAN_KIND) return no('找不到这份每日计划。')
  const post = findLivePublishedPost(plan, input.date)
  if (!post) return no('这一天的帖子没有发出去，或者已经撤回了，不能推广。')

  const registered = await deps.registeredPageId(input.clientId)
  if (!registered || registered !== post.page_id) return no('帖子所在的主页跟这个客户登记的主页对不上，不能推广。')

  const now = deps.now()
  if (post.scheduled_publish_time && Date.parse(post.scheduled_publish_time) > now.getTime()) {
    return no('这条帖子还没到公开时间，公开以后才能推广。')
  }
  const storyId = await resolveStoryId(deps, input.clientId, post)
  if (!storyId) return no('读不到这条帖子在 Facebook 上的编号，没有出卡。可以稍后再试。')

  const posterReason = await posterBlock(deps, input.clientId, plan, now)
  if (posterReason) return no(posterReason)

  const target = await deps.target(input.clientId)
  if (!target.ok) return no(target.reason)
  if (target.pageId !== registered) return no('推广池广告组配的主页跟这个客户登记的主页对不上，不能推广。')
  const postId = storyId.split('_')[1] ?? ''
  if (target.promotedPostIds.has(postId)) return no('这条帖子已经在推广池广告组里了，不用再建。')

  const origin: DailyPlanOrigin = { kind: 'daily_plan', planId: input.planId, date: input.date }
  return {
    ok: true,
    intent: {
      postId,
      name: `每日帖 ${input.date}`,
      score: 0,
      pageId: target.pageId,
      adAccountId: target.adAccountId,
      adsetId: target.adsetId,
      origin,
    },
  }
}

async function resolveStoryId(deps: PromoteDeps, clientId: string, post: CampaignDailyPublishedPost): Promise<string | null> {
  if (STORY_ID.test(post.post_id)) return post.post_id.startsWith(`${post.page_id}_`) ? post.post_id : null
  if (!BARE_ID.test(post.post_id)) return null
  const story = await deps.readStoryId(clientId, post.page_id, post.post_id)
  return story && STORY_ID.test(story) && story.startsWith(`${post.page_id}_`) ? story : null
}

async function posterBlock(deps: PromoteDeps, clientId: string, plan: CampaignDailyPlanData, now: Date): Promise<string | null> {
  const posterId = plan.command_meta.poster?.poster_asset_id
  if (!posterId) return null
  const nextDepart = await deps.posterNextDepart(clientId, posterId)
  if (nextDepart === undefined) return '读不到这张海报的资料，核对不了出发日期，没有出卡。'
  if (nextDepart !== null && nextDepart < nzToday(now)) {
    return `海报上印的出发日期（${nextDepart}）已经过了，不能拿去投广告。`
  }
  return null
}

function no(reason: string): PromoteCheck {
  return { ok: false, reason }
}

export function supabasePromoteDeps(
  sb: SupabaseClient,
  ports: Pick<PromoteDeps, 'readStoryId' | 'target'>,
): PromoteDeps {
  return {
    async loadPlan(clientId, planId) {
      const { data, error } = await sb.from('social_plans')
        .select('plan_data')
        .eq('id', planId)
        .eq('client_id', clientId)
        .maybeSingle()
      if (error) throw new Error(`loadPlan: ${error.message}`)
      return ((data as { plan_data?: unknown } | null)?.plan_data ?? null) as CampaignDailyPlanData | null
    },
    async registeredPageId(clientId) {
      const { data, error } = await sb.from('clients').select('facebook_page_id').eq('id', clientId).maybeSingle()
      if (error) throw new Error(`registeredPageId: ${error.message}`)
      return (data as { facebook_page_id?: string | null } | null)?.facebook_page_id ?? null
    },
    async posterNextDepart(clientId, posterAssetId) {
      const { data, error } = await sb.from('client_assets')
        .select('vision_metadata')
        .eq('id', posterAssetId)
        .eq('client_id', clientId)
        .maybeSingle()
      if (error || !data) return undefined
      const lineage = readPosterLineage((data as { vision_metadata?: unknown }).vision_metadata)
      return lineage ? lineage.next_depart_on : undefined
    },
    readStoryId: ports.readStoryId,
    target: ports.target,
    now: () => new Date(),
  }
}
