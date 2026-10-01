/**
 * Campaign Daily Plan — WP1 (#1159) projection shape and pure helpers.
 *
 * Storage: reuses the existing `social_plans` table (jsonb `plan_data`,
 * no migration). A row is tagged `plan_data.plan_kind === 'campaign_daily_v1'`
 * so it never collides with the legacy wave-batch `SocialPlanOutput` shape
 * already stored there by /api/clients/[id]/social-plan.
 */

import { z } from 'zod'
import type { CampaignBrief } from '@/types/magic-engine'
import type { CampaignDailyPublishMeta } from '@/lib/campaign/daily-plan-publish'

export const CAMPAIGN_DAILY_PLAN_KIND = 'campaign_daily_v1' as const

export type SlotStatus = 'PLANNED' | 'NOT_PLANNED'
export type GroundingStatus = 'OK' | 'NEEDS_BRIEF' | 'NEEDS_CAMPAIGN'
export type ReelMediaStatus = 'NO_MEDIA' | 'DRAFT_MEDIA' | 'READY'

export interface CampaignDailyDaySlots {
  post: SlotStatus
  story: SlotStatus
  reel: SlotStatus
}

export interface CampaignDailyDay {
  date: string // YYYY-MM-DD
  slots: CampaignDailyDaySlots
}

export interface CampaignDailyPostDraft {
  hook: string
  body: string
  cta: string
  /** Exact CTS-client-scoped asset ID for the Post image. Never trusted from
   *  caller-supplied URL/ownership — the server re-resolves both from the
   *  authoritative `client_assets` row. */
  image_asset_id: string
  /** HTTPS destination for the Post's Enquire Now link. Must exactly match
   *  the selected Campaign's persisted source URL — no arbitrary caller
   *  destination is accepted (route.ts enforces). */
  cta_url: string
}

export interface CampaignDailyStoryFrame {
  order: number
  copy: string
}

export interface CampaignDailyStoryDraft {
  frames: CampaignDailyStoryFrame[]
}

export interface CampaignDailyReelDraft {
  brief: string
  script: string
  caption: string
  source_asset_ids: string[]
  media_status: ReelMediaStatus
}

export interface CampaignDailyBundle {
  date: string
  post: CampaignDailyPostDraft | null
  story: CampaignDailyStoryDraft | null
  reel: CampaignDailyReelDraft | null
}

export interface CampaignDailyPlanData {
  plan_kind: typeof CAMPAIGN_DAILY_PLAN_KIND
  campaign_id: string
  master_brief_ref: { id: string; version: number | null } | null
  days: CampaignDailyDay[]
  /**
   * One entry per day that has real content — may be 1 to 7 entries.
   * A day present in `days` with PLANNED slots but no matching entry here
   * is a data-shape bug (route.ts fails closed to an honest empty bundle
   * for that date), not silently borrowed from another day.
   */
  bundles: CampaignDailyBundle[]
  command_meta: {
    source: 'conversation_command'
    received_at: string
    raw_summary: string | null
  }
  /**
   * Human review of the Facebook Post for individual dates. This is kept
   * inside the plan snapshot so a new complete-snapshot POST naturally
   * clears every decision instead of carrying approval onto changed copy or
   * imagery. It is deliberately separate from bundle-level readiness and
   * publishing authorisation.
   */
  review_meta?: CampaignDailyPostReviewMeta
  /**
   * Publish-queue handoff receipt. This is still `no_publish`: it records
   * that the seven reviewed Facebook Posts are ready for the next workflow
   * step and that an Inngest event was emitted. It is not a schedule or
   * provider publish receipt.
   */
  publish_queue_meta?: CampaignDailyPublishQueueMeta
  /**
   * Provider publish receipt written by the Facebook publish bridge. Unlike
   * `publish_queue_meta` this one *can* record a real side effect: post ids,
   * page id, published_at and the raw provider response. Its presence with a
   * matching plan+review revision is what makes a re-run idempotent.
   */
  publish_meta?: CampaignDailyPublishMeta
}

export type CampaignDailyPostReviewVerdict = 'PASS' | 'NEEDS_REVISION'

export interface CampaignDailyPostReviewDecision {
  verdict: CampaignDailyPostReviewVerdict
  reason: string | null
  reviewed_at: string
  reviewed_by_user_id: string
}

export interface CampaignDailyPostReviewMeta {
  schema_version: 1
  /** The content snapshot this review belongs to (`command_meta.received_at`). */
  plan_revision: string
  /** Independent compare-and-set token for concurrent review writes. */
  revision: string
  updated_at: string
  posts: Record<string, CampaignDailyPostReviewDecision>
}

export interface CampaignDailyPublishQueuePostReceipt {
  date: string
  image_asset_id: string
  cta_url: string
  review_verdict: 'PASS'
}

export interface CampaignDailyPublishQueueMeta {
  schema_version: 1
  event_name: 'daily_plan.publish_queue.ready'
  event_id: string
  request_id: string
  plan_revision: string
  review_revision: string
  status: 'READY_NO_PUBLISH'
  no_publish: true
  publishing_authorization: 'NOT_AUTHORIZED'
  provider_impact: 'NONE'
  cost_usd: 0
  created_at: string
  created_by_user_id: string
  posts: CampaignDailyPublishQueuePostReceipt[]
}

// ─── Inbound command schema (Section A — conversation-command persistence seam) ──
// The agent (Claude/Codex) interprets Ray's spoken instruction and calls this
// contract; this module never talks to an LLM/provider itself.

const slotStatusSchema = z.enum(['PLANNED', 'NOT_PLANNED'])

// Loose UUID *shape* check, not strict RFC4122 version validation — this
// repo's own seeded client ids (e.g. CTS `c0000000-0000-0000-0000-…`) do not
// carry a valid version/variant nibble, so zod's built-in `.uuid()` rejects
// them.
const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'invalid id')

const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }, 'invalid calendar date')

// HTTPS-only URL check for public-facing customer destinations.
const httpsUrl = z
  .string()
  .refine((v) => {
    try {
      const u = new URL(v)
      return u.protocol === 'https:'
    } catch {
      return false
    }
  }, { message: 'must be a well-formed HTTPS URL' })

const postReviewDecisionSchema = z
  .object({
    verdict: z.enum(['PASS', 'NEEDS_REVISION']),
    reason: z.string().max(500).nullable(),
    reviewed_at: z.string().datetime(),
    reviewed_by_user_id: uuidLike,
  })
  .superRefine((value, ctx) => {
    const reason = value.reason?.trim() ?? ''
    if (value.verdict === 'NEEDS_REVISION' && reason.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'reason is required when the Post needs revision',
      })
    }
    if (value.verdict === 'PASS' && value.reason !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'reason must be null when the Post passes',
      })
    }
  })

export const CampaignDailyPostReviewMetaSchema = z.object({
  schema_version: z.literal(1),
  plan_revision: z.string().datetime(),
  revision: uuidLike,
  updated_at: z.string().datetime(),
  posts: z.record(dateStringSchema, postReviewDecisionSchema),
})

export const CampaignDailyPostReviewCommandSchema = z
  .object({
    campaign_id: uuidLike,
    plan_id: uuidLike,
    expected_plan_revision: z.string().datetime(),
    expected_review_revision: uuidLike.nullable(),
    date: dateStringSchema,
    verdict: z.enum(['PASS', 'NEEDS_REVISION']),
    reason: z.string().max(500).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const reason = value.reason?.trim() ?? ''
    if (value.verdict === 'NEEDS_REVISION' && reason.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'reason is required when the Post needs revision',
      })
    }
  })

export type CampaignDailyPostReviewCommand = z.infer<typeof CampaignDailyPostReviewCommandSchema>

export const CampaignDailyPublishQueueCommandSchema = z.object({
  campaign_id: uuidLike,
  plan_id: uuidLike,
  expected_plan_revision: z.string().datetime(),
  expected_review_revision: uuidLike,
  no_publish: z.literal(true),
})

export const CampaignDailyPublishQueueMetaSchema = z.object({
  schema_version: z.literal(1),
  event_name: z.literal('daily_plan.publish_queue.ready'),
  event_id: z.string().min(1),
  request_id: uuidLike,
  plan_revision: z.string().datetime(),
  review_revision: uuidLike,
  status: z.literal('READY_NO_PUBLISH'),
  no_publish: z.literal(true),
  publishing_authorization: z.literal('NOT_AUTHORIZED'),
  provider_impact: z.literal('NONE'),
  cost_usd: z.literal(0),
  created_at: z.string().datetime(),
  created_by_user_id: uuidLike,
  posts: z.array(z.object({
    date: dateStringSchema,
    image_asset_id: uuidLike,
    cta_url: httpsUrl,
    review_verdict: z.literal('PASS'),
  })).min(1),
})

export type CampaignDailyPublishQueueCommand = z.infer<typeof CampaignDailyPublishQueueCommandSchema>

/**
 * A review key is valid only when it identifies exactly one scheduled Post
 * and exactly one stored Post bundle. This rejects orphaned keys and
 * ambiguous duplicate dates in persisted JSON before they reach the UI or
 * a compare-and-set update.
 */
export function isReviewablePostDate(plan: CampaignDailyPlanData, date: string): boolean {
  const days = Array.isArray(plan.days) ? plan.days : []
  const bundles = Array.isArray(plan.bundles) ? plan.bundles : []
  const matchingDays = days.filter(day => day?.date === date)
  const matchingBundles = bundles.filter(bundle => bundle?.date === date)
  return (
    matchingDays.length === 1 &&
    matchingDays[0].slots?.post === 'PLANNED' &&
    matchingBundles.length === 1 &&
    !!matchingBundles[0].post
  )
}

export type CampaignDailyPlanReceiptLock = 'PLAN_ALREADY_PUBLISHED' | 'PLAN_PUBLISH_QUEUED'

/**
 * Once a plan carries a publish-queue or publish receipt, its reviewed
 * snapshot is frozen: publish validates the queue receipt against the exact
 * `review_meta.revision`, and its receipt write compare-and-sets on it.
 * Any receipt counts, valid or not — a malformed one still fails closed.
 */
export function campaignDailyPlanReceiptLock(
  planData: Partial<CampaignDailyPlanData> | null | undefined
): CampaignDailyPlanReceiptLock | null {
  if (!planData) return null
  if (planData.publish_meta !== undefined) return 'PLAN_ALREADY_PUBLISHED'
  if (planData.publish_queue_meta !== undefined) return 'PLAN_PUBLISH_QUEUED'
  return null
}

// A bundle inside a POST snapshot is COMPLETE: Post + 4-frame Story + Reel
// are all required. Partial days (e.g. Post-only) are not accepted through
// this seam — they would either force a per-bundle grounding/merge layer
// (deferred) or leave the stored snapshot ambiguous. GET keeps rendering
// null Post/Story/Reel entries from legacy rows honestly; that read
// tolerance does not extend to the write contract.
const bundleSchema = z.object({
  date: dateStringSchema,
  post: z.object({
    hook: z.string().min(1),
    body: z.string().min(1),
    cta: z.string().min(1),
    // Server re-resolves ownership/preview from client_assets — caller does
    // NOT supply URL, MIME, or ownership here. Just the ID.
    image_asset_id: uuidLike,
    cta_url: httpsUrl,
  }),
  story: z.object({
    frames: z
      .array(z.object({ order: z.number().int(), copy: z.string().min(1) }))
      .length(4),
  }),
  reel: z.object({
    brief: z.string().min(1),
    script: z.string().min(1),
    caption: z.string().min(1),
    source_asset_ids: z.array(uuidLike).default([]),
    // WP1 has no real-output verification path (no render job linkage
    // wired up), so the command may never assert READY — the server has
    // no way to check it and would just be relaying an unverified claim
    // to a reviewer who reads "READY" as "there is a real file". A
    // future WP that wires up verified output can derive READY
    // server-side; it must never come from caller input.
    media_status: z.enum(['NO_MEDIA', 'DRAFT_MEDIA']),
  }),
})

// This seam is now a COMPLETE seven-day snapshot only:
//
// - exactly 7 unique day records;
// - exactly 7 unique bundles;
// - bundle date set must exactly equal day date set;
// - every day must have Post + 4-frame Story + Reel.
//
// Partial writes are rejected; the stored snapshot is REPLACED on success
// (see route.ts POST — no merge with previously stored bundles). This
// removes the stale-window and false-grounding risks that a per-bundle
// merge algorithm would otherwise reintroduce.
export const CampaignDailyCommandSchema = z
  .object({
    campaign_id: uuidLike,
    days: z
      .array(
        z.object({
          date: dateStringSchema,
          slots: z.object({ post: slotStatusSchema, story: slotStatusSchema, reel: slotStatusSchema }),
        })
      )
      .length(7)
      .refine(
        days => new Set(days.map(d => d.date)).size === days.length,
        { message: 'duplicate date in days — one entry per day only' }
      ),
    bundles: z
      .array(bundleSchema)
      .length(7)
      .refine(
        bundles => new Set(bundles.map(b => b.date)).size === bundles.length,
        { message: 'duplicate date in bundles — one entry per day only' }
      ),
    raw_summary: z.string().optional().nullable(),
  })
  // The bundle date set must exactly equal the days date set — a bundle for a
  // date not in the schedule (or a scheduled day with no bundle) would
  // silently disappear from the 7-day grid render.
  .superRefine((val, ctx) => {
    const dayDates = new Set(val.days.map(d => d.date))
    const bundleDates = new Set(val.bundles.map(b => b.date))
    val.bundles.forEach((b, i) => {
      if (!dayDates.has(b.date)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['bundles', i, 'date'],
          message: `bundle date ${b.date} is not one of the seven scheduled days`,
        })
      }
    })
    val.days.forEach((d, i) => {
      if (!bundleDates.has(d.date)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['days', i, 'date'],
          message: `scheduled day ${d.date} has no matching bundle`,
        })
      }
    })

    // Every day's Post image must be a DISTINCT asset — "one image for all
    // seven days" is exactly the review-blocker this contract closes.
    const imageIds = val.bundles.map((b) => b.post.image_asset_id)
    if (new Set(imageIds).size !== imageIds.length) {
      val.bundles.forEach((b, i) => {
        const firstIdx = imageIds.indexOf(b.post.image_asset_id)
        if (firstIdx !== i) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['bundles', i, 'post', 'image_asset_id'],
            message: `duplicate Post image_asset_id — day ${b.date} reuses the same asset as an earlier day`,
          })
        }
      })
    }
  })

export type CampaignDailyCommand = z.infer<typeof CampaignDailyCommandSchema>

// ─── Grounding ──────────────────────────────────────────────────────────────

export interface CampaignDailyGrounding {
  status: GroundingStatus
  has_master_brief: boolean
  has_campaign: boolean
}

export function computeGrounding(
  campaign: CampaignBrief | null,
  masterBrief: { id: string } | null
): CampaignDailyGrounding {
  if (!campaign) {
    return { status: 'NEEDS_CAMPAIGN', has_master_brief: !!masterBrief, has_campaign: false }
  }
  if (!masterBrief) {
    return { status: 'NEEDS_BRIEF', has_master_brief: false, has_campaign: true }
  }
  return { status: 'OK', has_master_brief: true, has_campaign: true }
}

// ─── Readiness gates — factual, never a fabricated percentage ───────────────

export interface CampaignDailyReadiness {
  master_brief_grounding: boolean
  campaign_grounding: boolean
  // Master Brief / Campaign grounding above means only "a record is
  // connected" — WP1 does no website crawling, evidence storage or claim
  // extraction, so whether the bundle's claims are factually supported is
  // always UNKNOWN, never inferred from record existence.
  evidence_grounding: 'UNKNOWN'
  client_asset_provenance: boolean
  format_completeness: { post: boolean; story: boolean; reel: boolean }
  human_approval: boolean
  provider_authorization: false
  publishing_authorization: false
  performance_outcome: 'UNKNOWN'
}

export function computeReadiness(params: {
  grounding: CampaignDailyGrounding
  bundle: CampaignDailyBundle | null
  resolvedAssetIds: Set<string>
}): CampaignDailyReadiness {
  const { grounding, bundle, resolvedAssetIds } = params

  // Every REQUIRED asset reference on this bundle must resolve under the
  // current client for `client_asset_provenance` to be true. Required set:
  //   - Post `image_asset_id` — MANDATORY when a Post exists. A Post with
  //     no image_asset_id is itself a provenance failure; a valid Reel
  //     source CANNOT compensate for a missing Post image (Codex thread
  //     PRRT_kwDOSTHiF86cEPbS — "legacy Post + valid Reel" false-truthful
  //     readiness). Only when the bundle has no Post at all is Post
  //     unrequired.
  //   - Reel `source_asset_ids` — only required when the Reel actually
  //     lists source assets. A Reel with no listed sources is not by
  //     itself a provenance failure (Reel-completeness is separate).
  //
  // Deduped by asset id so a Post + Reel referencing the same asset count
  // once (matches the GET `provenance` output).
  const postImageId = bundle?.post?.image_asset_id
  // Fail-closed short-circuit: Post exists but its image_asset_id is
  // missing → provenance false, regardless of Reel state.
  const postExistsButMissingImage = !!bundle?.post && !postImageId

  const requiredIds: string[] = []
  if (postImageId) requiredIds.push(postImageId)
  for (const id of bundle?.reel?.source_asset_ids ?? []) requiredIds.push(id)
  const dedupedRequired = Array.from(new Set(requiredIds))
  // A bundle with no required references at all cannot demonstrate
  // client-scoped provenance — fail closed rather than silently declaring
  // an unproven bundle authentic.
  const assetProvenanceOk =
    !postExistsButMissingImage &&
    dedupedRequired.length > 0 &&
    dedupedRequired.every(id => resolvedAssetIds.has(id))

  // Post is COMPLETE only when copy + CTA text + image_asset_id + cta_url are
  // all present AND the image resolves under this client. Legacy Posts that
  // predate the image/CTA-URL contract fail closed here — they must not read
  // as "ready to publish" because the reviewer can no longer verify the
  // rendered image or the destination they are pushing traffic to.
  const post = bundle?.post
  const postComplete =
    !!post &&
    !!post.hook &&
    !!post.body &&
    !!post.cta &&
    !!post.image_asset_id &&
    !!post.cta_url &&
    resolvedAssetIds.has(post.image_asset_id)

  // Story requires exactly 4 frames — matches the write-contract enforced
  // in `CampaignDailyCommandSchema` (`.length(4)`), so a legacy row with
  // fewer than 4 frames reads as incomplete rather than as "ready".
  const storyComplete = !!(bundle?.story && bundle.story.frames.length === 4)

  // Reel completeness here means the SCRIPT draft is present — media_status
  // is displayed separately (NO_MEDIA / DRAFT_MEDIA / READY) so a
  // script-only Reel never reads as "there is a real file".
  const reelComplete = !!(bundle?.reel && bundle.reel.script.length > 0)

  return {
    master_brief_grounding: grounding.has_master_brief,
    campaign_grounding: grounding.has_campaign,
    evidence_grounding: 'UNKNOWN',
    client_asset_provenance: assetProvenanceOk,
    format_completeness: {
      post: postComplete,
      story: storyComplete,
      reel: reelComplete,
    },
    // WP1 ships no approval workflow yet — always honestly false, never inferred.
    human_approval: false,
    provider_authorization: false,
    publishing_authorization: false,
    performance_outcome: 'UNKNOWN',
  }
}

// ─── Publishing / ad preview — always plan-only in WP1 ───────────────────────

export interface CampaignDailyPublishingPlan {
  /**
   * Campaign-level conversion goal (e.g. `lead_form_submit`). Sourced from
   * `campaigns.primary_cta` — it describes WHAT the campaign converts on,
   * NOT the Facebook Page/account the content would be posted to.
   */
  conversion_goal: string | null
  /**
   * Publishing destination — always `'UNKNOWN'` in WP1. This slice does not
   * bind any Facebook Page/Instagram account/Publer channel; showing a
   * primary CTA (`lead_form_submit`) here would misread as "this is where
   * it will publish". A future WP that reads a proven connected account
   * can flip this to that account's identifier — never a CTA/URL/goal.
   */
  destination: 'UNKNOWN'
  status: 'NOT_AUTHORIZED'
}

export interface CampaignDailyAdCandidate {
  creative_ref: string | null
  goal: 'UNKNOWN'
  audience: 'UNKNOWN'
  destination: 'UNKNOWN'
  budget: 'UNKNOWN'
  status: 'NOT_AUTHORIZED'
}

export function buildPublishingPlan(campaign: CampaignBrief | null): CampaignDailyPublishingPlan {
  return {
    conversion_goal: campaign?.primary_cta ?? null,
    destination: 'UNKNOWN',
    status: 'NOT_AUTHORIZED',
  }
}

export function buildAdCandidate(bundle: CampaignDailyBundle | null): CampaignDailyAdCandidate | null {
  if (!bundle?.reel) return null
  return {
    creative_ref: bundle.date,
    goal: 'UNKNOWN',
    audience: 'UNKNOWN',
    destination: 'UNKNOWN',
    budget: 'UNKNOWN',
    status: 'NOT_AUTHORIZED',
  }
}

// ─── Empty 7-day grid (no plan persisted yet) ────────────────────────────────

export function buildEmptyDays(startDateIso: string): CampaignDailyDay[] {
  const start = new Date(`${startDateIso}T00:00:00Z`)
  const days: CampaignDailyDay[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    days.push({
      date: d.toISOString().slice(0, 10),
      slots: { post: 'NOT_PLANNED', story: 'NOT_PLANNED', reel: 'NOT_PLANNED' },
    })
  }
  return days
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
