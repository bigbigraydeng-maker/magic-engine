/**
 * Campaign Daily Plan — Facebook publish bridge contract (#1340).
 *
 * This module owns the *contract* only: command/receipt schemas, the
 * deterministic idempotency key, and pure selection helpers. It never talks to
 * a provider and never touches the database — the route does that, so the
 * fail-closed rules here stay unit-testable without a network or a Supabase
 * stub.
 *
 * Relationship to `publish_queue_meta`: that receipt is the *no-publish*
 * handoff ("these reviewed Posts are ready"). This module is the stage after
 * it, and it is the first stage in this pipeline permitted to cause a provider
 * side effect. It therefore refuses to act unless the queue receipt for the
 * exact same plan+review revision already exists.
 *
 * Platform note: the emitted event is deliberately client-agnostic
 * (`daily_plan.post.published`, with `client_id` in the payload) so the
 * downstream T+24/T+72 measurement workflow is shared runtime rather than a
 * per-client branch.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'

export const DAILY_PLAN_POST_PUBLISHED_EVENT = 'daily_plan.post.published' as const

/**
 * Hours after publish at which the measurement workflow should read back.
 *
 * First pass at T+4, not T+24: on Facebook the bulk of a post's early reach
 * and engagement lands within the first few hours, so a 4-hour read gives a
 * usable early signal a full day sooner — fast enough to act on the same day
 * the post went out. The T+72 pass stays as the settled-numbers read once the
 * post has finished circulating.
 */
export const PUBLISH_MEASUREMENT_OFFSETS_HOURS = [4, 72] as const

// Same loose UUID *shape* check as daily-plan.ts — this repo's seeded client
// ids (e.g. CTS `c0000000-…`) are not RFC4122-valid, so `z.uuid()` rejects them.
const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'invalid id')

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Meta Page ids are numeric strings; reject anything else before we spend a call. */
const pageIdSchema = z.string().regex(/^\d{5,25}$/, 'page_id must be a numeric Meta Page id')

/**
 * Inbound command.
 *
 * Every authorisation field is a `z.literal(true)`, so a caller that omits one,
 * sends `false`, or sends a truthy non-boolean is rejected at parse time —
 * before any read, any token lookup, and any provider call. That is the
 * fail-closed guarantee; it is enforced by the type, not by a runtime `if`
 * someone can later reorder away.
 *
 * `no_publish` defaults to `true`: a caller who says nothing gets a dry run.
 * Live publishing requires explicitly sending `no_publish: false` *in addition
 * to* both authorisation flags.
 */
export const CampaignDailyPublishCommandSchema = z.object({
  /** Echo of the path client id. Mismatch is refused (see route). */
  client_id: uuidLike,
  campaign_id: uuidLike,
  plan_id: uuidLike,
  plan_revision: z.string().datetime(),
  review_revision: uuidLike,
  page_id: pageIdSchema,
  approved: z.literal(true),
  publish_authorization: z.literal(true),
  no_publish: z.boolean().default(true),
  /** Optional allow-list of dates to publish. Omitted = every reviewed Post. */
  dates: z.array(dateStringSchema).min(1).optional(),
  /**
   * Shift every post's publish target by this many calendar days before the
   * scheduler decides "now vs schedule". Content stays labelled with its
   * planned date in the receipt; only the *delivery slot* moves.
   *
   * Why this exists: on 2026-09-04 we recalled the burst-published batch and
   * wanted to re-publish 09-04..09-09 with proper morning slots, but 09-04
   * 08:00 NZ had already passed by then. Without an offset, 09-04's content
   * would publish immediately at 13:12 NZ (afternoon) — the cadence we were
   * trying to escape from. Passing `date_offset_days: 1` shifts every post by
   * one day, so 09-04's content lands 09-05 08:00 NZ and the batch keeps its
   * morning rhythm.
   *
   * Bounded to ±30 to prevent a typo from producing months of drift. Negative
   * offsets are allowed because pulling a scheduled batch forward is a
   * legitimate business action (a launch date moves in).
   */
  date_offset_days: z.number().int().min(-30).max(30).default(0),
})

export type CampaignDailyPublishCommand = z.infer<typeof CampaignDailyPublishCommandSchema>

export interface CampaignDailyPublishedPost {
  date: string
  idempotency_key: string
  /** Real Graph API post id. Never synthesised. */
  post_id: string
  /** Which Graph field the id came from, so an audit can tell them apart.
   *  `id` = bare photo id (a scheduled photo); its feed story id is resolved
   *  after it goes public by the story-resolve workflow, not stored here. */
  post_id_source: 'post_id' | 'id'
  /** Fixed code, present when the measurement-bound event (published or
   *  story-resolve) was not handed off: `event_contract_invalid` or
   *  `event_send_failed`. The post is still on Facebook; only measurement is
   *  missing, and a failed record was written for the daily to-do list. */
  measurement_skipped_reason?: string
  page_id: string
  /** When *we* handed the post to Facebook. Same value whether Facebook
   *  publishes immediately or holds it until `scheduled_publish_time`. */
  published_at: string
  /** When Facebook is asked to actually make the post visible. Absent means
   *  "immediately"; present means Facebook is holding the post until then. */
  scheduled_publish_time?: string
  permalink: string
  /** Raw provider response, stored verbatim for audit. */
  provider_response: Record<string, unknown>
}

export interface CampaignDailyPublishFailure {
  date: string
  idempotency_key: string
  error: string
  failed_at: string
}

export interface CampaignDailyPublishPlannedPost {
  date: string
  idempotency_key: string
  image_asset_id: string
  cta_url: string
}

export type CampaignDailyPublishStatus = 'DRY_RUN' | 'PUBLISHED' | 'PARTIAL' | 'FAILED'

export interface CampaignDailyPublishMeta {
  schema_version: 1
  event_name: typeof DAILY_PLAN_POST_PUBLISHED_EVENT
  status: CampaignDailyPublishStatus
  request_id: string
  client_id: string
  campaign_id: string
  plan_id: string
  plan_revision: string
  review_revision: string
  page_id: string
  publishing_authorization: 'AUTHORIZED'
  approved_by_user_id: string
  created_at: string
  published: CampaignDailyPublishedPost[]
  failed: CampaignDailyPublishFailure[]
  /** Inngest receipt ids, one per successfully emitted published event. */
  event_ids: string[]
  /** The date_offset_days the caller passed for this batch (0 by default).
   *  Persisted so an audit can tell why 09-04 content landed 09-05 morning. */
  date_offset_days?: number
  /** Posts that were subsequently recalled — see `daily-plan-recall.ts`. The
   *  original entry stays out of `published[]` so a reader can trust that field
   *  as "currently live on the Page"; the recall row keeps the post_id for audit. */
  recalled?: Array<{ date: string; idempotency_key: string; post_id: string; recalled_at: string; already_gone: boolean }>
}

const publishedPostSchema = z.object({
  date: dateStringSchema,
  idempotency_key: z.string().min(1),
  post_id: z.string().min(1),
  post_id_source: z.enum(['post_id', 'id']),
  measurement_skipped_reason: z.string().min(1).optional(),
  page_id: pageIdSchema,
  published_at: z.string().datetime(),
  scheduled_publish_time: z.string().datetime().optional(),
  permalink: z.string().min(1),
  provider_response: z.record(z.string(), z.unknown()),
})

export const CampaignDailyPublishMetaSchema = z.object({
  schema_version: z.literal(1),
  event_name: z.literal(DAILY_PLAN_POST_PUBLISHED_EVENT),
  status: z.enum(['DRY_RUN', 'PUBLISHED', 'PARTIAL', 'FAILED']),
  request_id: uuidLike,
  client_id: uuidLike,
  campaign_id: uuidLike,
  plan_id: uuidLike,
  plan_revision: z.string().datetime(),
  review_revision: uuidLike,
  page_id: pageIdSchema,
  publishing_authorization: z.literal('AUTHORIZED'),
  approved_by_user_id: uuidLike,
  created_at: z.string().datetime(),
  published: z.array(publishedPostSchema),
  failed: z.array(z.object({
    date: dateStringSchema,
    idempotency_key: z.string().min(1),
    error: z.string(),
    failed_at: z.string().datetime(),
  })),
  event_ids: z.array(z.string().min(1)),
  date_offset_days: z.number().int().min(-30).max(30).optional(),
  recalled: z.array(z.object({
    date: dateStringSchema,
    idempotency_key: z.string().min(1),
    post_id: z.string().min(1),
    recalled_at: z.string().datetime(),
    already_gone: z.boolean(),
  })).optional(),
})

/**
 * Deterministic per-post idempotency key.
 *
 * Derived from the content identity, not from the attempt: retrying the same
 * command produces the same key, so a duplicate publish is detectable. Editing
 * a Post moves `plan_revision` (a fresh snapshot resets review), which changes
 * the key — republishing genuinely-new copy is allowed and is not mistaken for
 * a retry.
 */
export function publishIdempotencyKey(input: {
  clientId: string
  planId: string
  planRevision: string
  reviewRevision: string
  date: string
}): string {
  const material = [input.clientId, input.planId, input.planRevision, input.reviewRevision, input.date].join('|')
  return `fbpost_${createHash('sha256').update(material).digest('hex').slice(0, 32)}`
}

/**
 * Split candidate dates into "still needs publishing" and "already published".
 *
 * Matching is by idempotency key rather than by date, so a stored receipt from
 * a *different* plan revision never suppresses a genuinely new publish.
 */
export function partitionByIdempotency<T extends { idempotency_key: string }>(
  candidates: T[],
  alreadyPublished: Pick<CampaignDailyPublishedPost, 'idempotency_key'>[],
): { pending: T[]; skipped: T[] } {
  const seen = new Set(alreadyPublished.map(post => post.idempotency_key))
  const pending: T[] = []
  const skipped: T[] = []
  for (const candidate of candidates) {
    if (seen.has(candidate.idempotency_key)) skipped.push(candidate)
    else pending.push(candidate)
  }
  return { pending, skipped }
}

/**
 * The instant that corresponds to `08:00 Pacific/Auckland` on a given calendar
 * date. DST-safe because it iterates against Intl instead of assuming a fixed
 * UTC offset — NZ swaps between UTC+12 (NZST) and UTC+13 (NZDT) around
 * Sep/Apr, and hardcoding either would silently shift the send by an hour for
 * half the year.
 */
/**
 * Add N calendar days to a `YYYY-MM-DD` string, staying in that format.
 *
 * Uses UTC midnight so DST transitions and local-timezone quirks never bump
 * the date. The date field is a calendar label, not a wall-clock instant —
 * timezone comes into play later in nzMorningUtc when we resolve to a slot.
 */
export function shiftDateString(dateString: string, days: number): string {
  const [y, m, d] = dateString.split('-').map(Number)
  const shifted = new Date(Date.UTC(y, m - 1, d + days))
  const yy = shifted.getUTCFullYear().toString().padStart(4, '0')
  const mm = (shifted.getUTCMonth() + 1).toString().padStart(2, '0')
  const dd = shifted.getUTCDate().toString().padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function nzMorningUtc(dateString: string): Date {
  const [y, m, d] = dateString.split('-').map(Number)
  // Guess: interpret 08:00 as if NZ were UTC+12; then correct against the
  // actual offset by inspecting the local hour Intl reports.
  let instant = new Date(Date.UTC(y, m - 1, d, 8 - 12, 0, 0))
  for (let i = 0; i < 3; i++) {
    const hourStr = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Pacific/Auckland',
      hour: '2-digit',
      hour12: false,
    }).format(instant)
    // en-US with hour12:false can return "24" for midnight; normalise.
    const hour = Number(hourStr) % 24
    if (hour === 8) return instant
    instant = new Date(instant.getTime() - (hour - 8) * 3_600_000)
  }
  return instant
}

/**
 * "Publish now" vs "let Facebook hold it until date D".
 *
 * The daily plan's `date` field is the day the client expects the post to be
 * visible in NZ. Before this contract existed, the publisher ignored it and
 * fired everything immediately — a "7-day plan" turned into "7 posts in one
 * minute", which is exactly what happened on 2026-09-03 (see PR history).
 *
 * Rules:
 *  - Target = 08:00 Pacific/Auckland on `candidateDate`.
 *  - If the target is < 15 minutes from `now` (Facebook's own floor is 10min;
 *    the extra 5 buys margin for clock skew), publish immediately.
 *  - If it's > 6 months out, also publish immediately — Facebook's ceiling is
 *    ~180 days, and a plan that far ahead is almost certainly a data error.
 *  - Otherwise, return the target — the caller passes it to publishPagePhotoPost
 *    as `scheduledPublishTime`.
 */
export function resolvePublishSchedule(
  candidateDate: string,
  now: Date,
  offsetDays = 0,
): { publishNow: true } | { publishNow: false; scheduledPublishTime: Date } {
  const effectiveDate = offsetDays === 0 ? candidateDate : shiftDateString(candidateDate, offsetDays)
  const target = nzMorningUtc(effectiveDate)
  const leadMs = target.getTime() - now.getTime()
  const MIN_LEAD_MS = 15 * 60 * 1000
  const MAX_LEAD_MS = 175 * 24 * 3_600_000 // 175 days, well inside Meta's ~6 month ceiling
  if (leadMs < MIN_LEAD_MS) return { publishNow: true }
  if (leadMs > MAX_LEAD_MS) return { publishNow: true }
  return { publishNow: false, scheduledPublishTime: target }
}

/** ISO timestamps at which the T+24 / T+72 measurement passes should run. */
export function measurementSchedule(publishedAt: string): { hours: number; at: string }[] {
  const base = new Date(publishedAt).getTime()
  return PUBLISH_MEASUREMENT_OFFSETS_HOURS.map(hours => ({
    hours,
    at: new Date(base + hours * 3_600_000).toISOString(),
  }))
}

/** Overall status from the outcome of a live attempt. */
export function resolvePublishStatus(
  publishedCount: number,
  failedCount: number,
): Extract<CampaignDailyPublishStatus, 'PUBLISHED' | 'PARTIAL' | 'FAILED'> {
  if (failedCount === 0) return 'PUBLISHED'
  return publishedCount === 0 ? 'FAILED' : 'PARTIAL'
}

// ─── Published-event contract (shared by publisher + measurement consumer) ────

/**
 * `daily_plan.post.published` payload —— ONE event per published Post.
 *
 * 发布端与消费端共用：一方建，另一方拒绝任何不匹配的东西。存在的理由是消费者
 * 以前只能猜形状，而猜错是静默的（读 `published[0]` → 所有真事件被拒；从
 * `published_at` 重算 → 排期帖在公开前被测）。
 *
 * 🔴 `measure_at` 是权威。它在发布时按 `scheduled_publish_time ?? published_at`
 *    算好（#1380），已指向帖子真正可见的时刻。消费者绝不可从 `published_at` 重算：
 *    排期帖两者能差几天。在途事件保留发出时的偏移，改常量不会 retarget 已排的活。
 */
const measureWindowSchema = z.object({
  hours: z.number().int().positive().max(24 * 30),
  at: z.string().datetime(),
})

/** Upper bound on how far ahead a measurement may be scheduled. */
const MEASURE_AT_MAX_LEAD_MS = 200 * 24 * 3_600_000

export const DailyPlanPostPublishedEventSchema = z
  .object({
    client_id: uuidLike,
    campaign_id: uuidLike,
    plan_id: uuidLike,
    plan_revision: z.string().datetime(),
    review_revision: uuidLike,
    date: dateStringSchema,
    idempotency_key: z.string().min(1).max(512),
    post_id: z.string().regex(/^\d{5,25}_\d{5,25}$/, 'post_id must be <page_id>_<post>'),
    page_id: pageIdSchema,
    published_at: z.string().datetime(),
    scheduled_publish_time: z.string().datetime().optional(),
    permalink: z.string().url(),
    // Bounded on purpose: an unbounded array would fan out unbounded runs.
    measure_at: z.array(measureWindowSchema).min(1).max(4),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<number>()
    for (const w of value.measure_at) {
      if (seen.has(w.hours)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['measure_at'],
          message: `duplicate measurement window: ${w.hours}h`,
        })
      }
      seen.add(w.hours)

      // A wildly distant target would park a durable run for months. Anchor the
      // sanity check on the Post's own publish time, not on "now" — replays and
      // late deliveries are legitimate and must still validate.
      const lead = Date.parse(w.at) - Date.parse(value.published_at)
      if (lead > MEASURE_AT_MAX_LEAD_MS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['measure_at'],
          message: `measurement window ${w.hours}h is implausibly far from published_at`,
        })
      }
    }
  })

export type DailyPlanPostPublishedEvent = z.infer<typeof DailyPlanPostPublishedEventSchema>

/** Stable id for the internal per-window measurement event. */
export function measurementEventId(idempotencyKey: string, hours: number): string {
  return `${idempotencyKey}:measurement:${hours}`
}

// ─── Story-resolve contract (scheduled photo → feed story id) ───────────────

/**
 * A scheduled photo comes back from `/photos` with only its photo id, and Meta
 * documents `page_story_id` as applying only to *published* photos
 * (https://developers.facebook.com/docs/graph-api/reference/photo/). So the
 * publisher cannot know the feed post id at publish time. Instead it emits this
 * event; a cloud workflow waits until the photo is public, reads the story id
 * back, and only then emits the standard `daily_plan.post.published` with the
 * same idempotency key as its event id.
 *
 * The payload carries every field the standard event needs except `post_id`
 * and `permalink`, which only exist after resolution.
 */
export const DAILY_PLAN_POST_STORY_RESOLVE_EVENT = 'daily_plan.post.story_resolve_due' as const

export const StoryResolveDueSchema = z.object({
  client_id: uuidLike,
  campaign_id: uuidLike,
  plan_id: uuidLike,
  plan_revision: z.string().datetime(),
  review_revision: uuidLike,
  date: dateStringSchema,
  idempotency_key: z.string().min(1).max(512),
  photo_id: z.string().regex(/^\d{5,25}$/, 'photo_id must be a numeric Meta photo id'),
  page_id: pageIdSchema,
  published_at: z.string().datetime(),
  scheduled_publish_time: z.string().datetime().optional(),
  measure_at: z.array(measureWindowSchema).min(1).max(4),
})

export type StoryResolveDue = z.infer<typeof StoryResolveDueSchema>

/** `cron_run_logs.job_name` for the story-resolve workflow's outcome records (read by the daily to-do list). */
export const STORY_RESOLVE_JOB_NAME = 'daily-plan-post-story-resolve'

/**
 * Includes the photo id: recalling a Post and re-publishing the same content
 * reuses the idempotency key but creates a *new* photo. Keying on the key alone
 * would let Inngest's event dedupe swallow the re-publish's resolve event while
 * the old run wakes up, finds its photo recalled and ends — leaving the live
 * re-published Post unmeasured.
 */
export function storyResolveEventId(idempotencyKey: string, photoId: string): string {
  return `${idempotencyKey}:resolve:${photoId}`
}

/**
 * When to try reading the story id, in minutes after the photo is due to be
 * public. Bounded on purpose: a photo that still has no story id six hours
 * after its publish time needs a human, not another retry.
 */
export const STORY_RESOLVE_ATTEMPT_OFFSETS_MINUTES = [10, 60, 360] as const

export function storyResolveAttempts(due: Pick<StoryResolveDue, 'published_at' | 'scheduled_publish_time'>): { attempt: number; at: string }[] {
  const visibleAt = Date.parse(due.scheduled_publish_time ?? due.published_at)
  return STORY_RESOLVE_ATTEMPT_OFFSETS_MINUTES.map((minutes, index) => ({
    attempt: index + 1,
    at: new Date(visibleAt + minutes * 60_000).toISOString(),
  }))
}

/** The standard published-event payload, once the story id is known. Validate before sending. */
export function publishedEventFromResolved(due: StoryResolveDue, storyId: string): Record<string, unknown> {
  return {
    client_id: due.client_id,
    campaign_id: due.campaign_id,
    plan_id: due.plan_id,
    plan_revision: due.plan_revision,
    review_revision: due.review_revision,
    date: due.date,
    idempotency_key: due.idempotency_key,
    post_id: storyId,
    page_id: due.page_id,
    published_at: due.published_at,
    ...(due.scheduled_publish_time ? { scheduled_publish_time: due.scheduled_publish_time } : {}),
    permalink: `https://www.facebook.com/${storyId}`,
    measure_at: due.measure_at,
  }
}
