/**
 * Daily Plan publish — provider side effects and receipt persistence.
 *
 * Extracted verbatim from the publish route so the manual route and the future
 * auto-publish worker run the exact same code path. Behaviour must stay
 * identical to the route's: serial publish, first comment, measurement hand-off,
 * compare-and-set receipt write.
 */
import type { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { PagePublishError, publishPagePhotoPost } from '@/lib/meta/page-posts'
import { CAMPAIGN_DAILY_PLAN_KIND, type CampaignDailyPlanData } from '@/lib/campaign/daily-plan'
import { buildFirstCommentMarker, ensureFacebookFirstComment } from '@/lib/meta/first-comment'
import { GRAPH_BASE } from '@/lib/meta/graph-base'
import {
  DAILY_PLAN_POST_PUBLISHED_EVENT,
  DAILY_PLAN_POST_STORY_RESOLVE_EVENT,
  DailyPlanPostPublishedEventSchema,
  StoryResolveDueSchema,
  measurementSchedule,
  storyResolveEventId,
  resolvePublishSchedule,
  ABORTED_BEFORE_SEND_ERROR,
  MISSED_WINDOW_ERROR,
  type CampaignDailyPublishCommand,
  type CampaignDailyPublishFailure,
  type CampaignDailyPublishMeta,
  type CampaignDailyPublishPlannedPost,
  type CampaignDailyPublishedPost,
  type DailyPlanPostPublishedEvent,
  type StoryResolveDue,
} from '@/lib/campaign/daily-plan-publish'
import { writeMeasurementRecord } from '@/lib/campaign/daily-plan-measurement-record'

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface PlanRow {
  id: string
  planData: CampaignDailyPlanData
  planRevision: string
  reviewRevision: string
}

export interface PublishCandidate extends CampaignDailyPublishPlannedPost {
  /** The Post body as published — hook + body, no CTA and no link. */
  message: string
  /** The first comment text (CTA + tracked link) posted after the Post. */
  firstCommentText: string
  /** What the price gates judge: the Post body *and* the first comment. */
  judgedText: string
  imageUrl: string
  imageSource: string | null
}

export interface LiveOutcome {
  published: CampaignDailyPublishedPost[]
  failed: CampaignDailyPublishFailure[]
  eventIds: string[]
}

/**
 * Publish each pending Post, then emit its measurement event. Runs serially so
 * a mid-batch failure cannot leave more than one Post in an unknown state, and
 * a failure on one date never aborts the receipt for dates already published.
 */
export async function publishPending(
  candidates: PublishCandidate[],
  context: {
    clientId: string
    pageId: string
    pageToken: string
    row: PlanRow
    command: CampaignDailyPublishCommand
    /** The instant the schedule is decided against; one value for the whole call. */
    now?: Date
    /** false = never publish immediately: a slot that has passed is a MISSED_WINDOW failure, not a late post. */
    allowImmediate?: boolean
    /** Request timeout for the Facebook call; unset = none (manual path). */
    requestTimeoutMs?: number
    /** Last-moment check, run right before the Facebook call. false = do not send. */
    beforeSend?: (date: string) => Promise<boolean>
  },
): Promise<LiveOutcome> {
  const published: CampaignDailyPublishedPost[] = []
  const failed: CampaignDailyPublishFailure[] = []
  const eventIds: string[] = []

  for (const candidate of candidates) {
    // Each Post carries the calendar date the client planned it for. Ask
    // Facebook to hold it until 08:00 NZ on that date, rather than firing
    // immediately — otherwise a "7-day plan" becomes "7 posts in one minute",
    // which is exactly the 2026-09-03 incident this contract now guards.
    // For today / past dates, resolvePublishSchedule returns publishNow: true.
    // The command's date_offset_days shifts every post by the same number of
    // days first, so a "recall + reschedule" batch after morning has passed
    // can push the whole rhythm forward by 1 day and keep every post landing
    // at 08:00 NZ instead of "today afternoon + morning tomorrow onward".
    const schedule = resolvePublishSchedule(candidate.date, context.now ?? new Date(), context.command.date_offset_days)
    if (schedule.publishNow && context.allowImmediate === false) {
      failed.push({
        date: candidate.date,
        idempotency_key: candidate.idempotency_key,
        error: MISSED_WINDOW_ERROR,
        failed_at: new Date().toISOString(),
        certainty: 'rejected',
      })
      continue
    }

    // A last-moment check that cannot even run (e.g. a database read failed) is a refusal to send, not a
    // send: nothing has gone out yet, so this is the safe side and must not be mistaken for an uncertain send.
    const clearToSend = context.beforeSend ? await context.beforeSend(candidate.date).catch(() => false) : true
    if (!clearToSend) {
      failed.push({
        date: candidate.date,
        idempotency_key: candidate.idempotency_key,
        error: ABORTED_BEFORE_SEND_ERROR,
        failed_at: new Date().toISOString(),
        certainty: 'rejected',
      })
      continue
    }

    let result: Awaited<ReturnType<typeof publishPagePhotoPost>>
    try {
      result = await publishPagePhotoPost({
        pageId: context.pageId,
        pageAccessToken: context.pageToken,
        message: candidate.message,
        imageUrl: candidate.imageUrl,
        scheduledPublishTime: schedule.publishNow ? undefined : schedule.scheduledPublishTime,
        timeoutMs: context.requestTimeoutMs,
      })
    } catch (error: unknown) {
      failed.push({
        date: candidate.date,
        idempotency_key: candidate.idempotency_key,
        error: errorMessage(error),
        failed_at: new Date().toISOString(),
        certainty: error instanceof PagePublishError ? error.certainty : 'unknown',
      })
      continue
    }

    const publishedAt = new Date().toISOString()
    const record: CampaignDailyPublishedPost = {
      date: candidate.date,
      idempotency_key: candidate.idempotency_key,
      post_id: result.postId,
      post_id_source: result.postIdSource,
      page_id: context.pageId,
      published_at: publishedAt,
      // Only present when we actually asked Facebook to hold it. Absent means
      // "went live immediately" — a downstream reader shouldn't have to guess.
      ...(schedule.publishNow ? {} : { scheduled_publish_time: schedule.scheduledPublishTime.toISOString() }),
      permalink: result.permalink,
      provider_response: result.raw,
    }

    await attachFirstComment(record, candidate, result, context)
    published.push(record)
    const sentIds = await startMeasurement(record, context, candidate.firstCommentText)
    eventIds.push(...sentIds)
  }

  return { published, failed, eventIds }
}

/**
 * Post the first comment for a live Post, or mark it pending for a scheduled
 * one. Never throws and never marks the Post failed: the Post is already on
 * Facebook, so a comment failure must not invite a duplicate re-post.
 */
async function attachFirstComment(
  record: CampaignDailyPublishedPost,
  candidate: PublishCandidate,
  result: Awaited<ReturnType<typeof publishPagePhotoPost>>,
  context: { clientId: string; pageId: string; pageToken: string; row: PlanRow; command: CampaignDailyPublishCommand },
): Promise<void> {
  if (result.postIdSource !== 'post_id') {
    // Scheduled photo: Meta only exposes the feed story id once the photo is
    // public, so the story-resolve workflow posts the comment then.
    record.first_comment_status = 'PENDING_PUBLISH'
    return
  }
  try {
    const commentId = await ensureFacebookFirstComment({
      graphBase: GRAPH_BASE,
      objectId: result.postId,
      expectedPageId: context.pageId,
      accessToken: context.pageToken,
      marker: buildFirstCommentMarker('daily-plan-first-comment', candidate.idempotency_key),
      message: candidate.firstCommentText,
      failureLabel: '每日计划帖',
    })
    record.first_comment_status = 'POSTED'
    record.first_comment_id = commentId
  } catch (error: unknown) {
    record.first_comment_status = 'FAILED'
    console.error('[daily-plan publish] first comment failed', record.date, errorMessage(error))
    await recordFirstCommentFailure(record, context, errorMessage(error), candidate.firstCommentText)
  }
}

/** Observability only: a failed write must not block saving the receipt. */
async function recordFirstCommentFailure(
  record: CampaignDailyPublishedPost,
  context: { clientId: string; row: PlanRow; command: CampaignDailyPublishCommand },
  reason: string,
  firstCommentText: string,
): Promise<void> {
  try {
    await writeMeasurementRecord(supabaseAdmin, {
      status: 'failed',
      outcome: 'first_comment_failed',
      reason: reason.slice(0, 300),
      attempts: 0,
      post: {
        client_id: context.clientId,
        campaign_id: context.command.campaign_id,
        plan_id: context.row.id,
        date: record.date,
        idempotency_key: record.idempotency_key,
        page_id: record.page_id,
        ...(record.post_id_source === 'id' ? { photo_id: record.post_id } : { post_id: record.post_id }),
        ...(record.scheduled_publish_time ? { scheduled_publish_time: record.scheduled_publish_time } : {}),
        first_comment_text: firstCommentText,
      },
    })
  } catch (error: unknown) {
    console.error('[daily-plan publish] first comment failure record not written', record.date, errorMessage(error))
  }
}

type MeasurementSkipCode = 'event_contract_invalid' | 'event_send_failed'

/**
 * Hand the published Post to measurement. Never throws and never marks the
 * Post failed: it is already accepted by Facebook, and `failed[]` would invite
 * a duplicate re-post. If the handoff cannot happen, the receipt entry gets a
 * fixed reason code and a failed record lands where the daily to-do list reads.
 */
async function startMeasurement(
  record: CampaignDailyPublishedPost,
  context: { clientId: string; row: PlanRow; command: CampaignDailyPublishCommand },
  firstCommentText?: string,
): Promise<string[]> {
  const event = buildMeasurementEvent(record, context, firstCommentText)
  if (!event.ok) {
    console.error('[daily-plan publish] measurement event not emitted', record.date, event.reason)
    await recordMeasurementSkipped(record, context, 'event_contract_invalid', firstCommentText)
    return []
  }
  try {
    const sent = await sendInngestEvent({ id: event.id, name: event.name, data: event.data })
    return sent.event_ids
  } catch (error: unknown) {
    console.error('[daily-plan publish] measurement event failed', record.date, errorMessage(error))
    await recordMeasurementSkipped(record, context, 'event_send_failed', firstCommentText)
    return []
  }
}

async function recordMeasurementSkipped(
  record: CampaignDailyPublishedPost,
  context: { clientId: string; row: PlanRow; command: CampaignDailyPublishCommand },
  code: MeasurementSkipCode,
  firstCommentText?: string,
): Promise<void> {
  record.measurement_skipped_reason = code
  try {
    await writeMeasurementRecord(supabaseAdmin, {
      status: 'failed',
      outcome: code,
      reason: code,
      attempts: 0,
      post: {
        client_id: context.clientId,
        campaign_id: context.command.campaign_id,
        plan_id: context.row.id,
        date: record.date,
        idempotency_key: record.idempotency_key,
        page_id: record.page_id,
        ...(record.post_id_source === 'id' ? { photo_id: record.post_id } : { post_id: record.post_id }),
        ...(record.scheduled_publish_time ? { scheduled_publish_time: record.scheduled_publish_time } : {}),
        // A scheduled Post's first comment is still pending at this point, so
        // the resolve workflow is the only thing that would ever post it. If
        // the handoff fails, carry the text here or it is lost for good.
        ...(record.post_id_source === 'id' && firstCommentText ? { first_comment_text: firstCommentText } : {}),
      },
    })
  } catch (error: unknown) {
    // Observability only: a failed write must not block saving the receipt.
    console.error('[daily-plan publish] measurement failure record not written', record.date, errorMessage(error))
  }
}

type MeasurementEvent =
  | { ok: true; id: string; name: string; data: DailyPlanPostPublishedEvent | StoryResolveDue }
  | { ok: false; reason: string }

function contractViolation(error: z.ZodError): { ok: false; reason: string } {
  const issues = error.issues.slice(0, 3).map(issue => `${issue.path.join('.')}: ${issue.message}`)
  return { ok: false, reason: `event payload violates contract: ${issues.join('; ')}` }
}

/**
 * Pick and validate the event that starts measurement for this Post.
 *
 * - Graph returned a feed `post_id` (immediate publish): the standard
 *   `daily_plan.post.published`, event id = idempotency key.
 * - Graph returned only a photo `id` (scheduled photo): Meta only exposes
 *   `page_story_id` once the photo is public, so emit a story-resolve event
 *   (id `<key>:resolve:<photo_id>`); the cloud workflow emits the standard event, with the
 *   same idempotency-key id, after it reads the story id back.
 *
 * Both are checked against the consumer's own schema *before* sending.
 */
function buildMeasurementEvent(
  record: CampaignDailyPublishedPost,
  context: { clientId: string; row: PlanRow; command: CampaignDailyPublishCommand },
  firstCommentText?: string,
): MeasurementEvent {
  const identity = {
    client_id: context.clientId,
    campaign_id: context.command.campaign_id,
    plan_id: context.row.id,
    plan_revision: context.row.planRevision,
    review_revision: context.row.reviewRevision,
    date: record.date,
    idempotency_key: record.idempotency_key,
    page_id: record.page_id,
    published_at: record.published_at,
    ...(record.scheduled_publish_time ? { scheduled_publish_time: record.scheduled_publish_time } : {}),
    // A scheduled receipt confirms submission, not public visibility.
    measure_at: measurementSchedule(record.scheduled_publish_time ?? record.published_at),
  }

  if (record.post_id_source === 'id') {
    const parsed = StoryResolveDueSchema.safeParse({
      ...identity,
      photo_id: record.post_id,
      ...(firstCommentText ? { first_comment_text: firstCommentText } : {}),
    })
    if (!parsed.success) return contractViolation(parsed.error)
    return {
      ok: true,
      id: storyResolveEventId(record.idempotency_key, parsed.data.photo_id),
      name: DAILY_PLAN_POST_STORY_RESOLVE_EVENT,
      data: parsed.data,
    }
  }

  const parsed = DailyPlanPostPublishedEventSchema.safeParse({ ...identity, post_id: record.post_id, permalink: record.permalink })
  if (!parsed.success) return contractViolation(parsed.error)
  return { ok: true, id: record.idempotency_key, name: DAILY_PLAN_POST_PUBLISHED_EVENT, data: parsed.data }
}

/** Compare-and-set write of the receipt onto the exact snapshot we validated. */
export async function persistReceipt(
  clientId: string,
  row: PlanRow,
  command: CampaignDailyPublishCommand,
  previous: CampaignDailyPublishMeta | null,
  receipt: CampaignDailyPublishMeta,
): Promise<boolean> {
  const nextPlanData: CampaignDailyPlanData = { ...row.planData, publish_meta: receipt }
  let query = supabaseAdmin
    .from('social_plans')
    .update({ plan_data: nextPlanData })
    .eq('id', row.id)
    .eq('client_id', clientId)
    .eq('campaign_id', command.campaign_id)
    .contains('plan_data', {
      plan_kind: CAMPAIGN_DAILY_PLAN_KIND,
      command_meta: { received_at: row.planRevision },
      review_meta: { revision: row.reviewRevision },
    })

  query = previous
    ? query.contains('plan_data', { publish_meta: { request_id: previous.request_id } })
    : query.is('plan_data->publish_meta', null)

  const { data, error } = await query.select('id').maybeSingle()
  if (error) throw error
  return Boolean(data)
}
