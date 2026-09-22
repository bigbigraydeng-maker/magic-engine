/**
 * POST /api/clients/[id]/campaign-daily-plan/publish
 *
 * The Facebook publish bridge for reviewed Campaign Daily Plan Posts — the
 * first stage in this pipeline allowed to cause a real provider side effect.
 *
 * Fail-closed by construction:
 *  - `approved` and `publish_authorization` are `z.literal(true)`, so a
 *    command missing either is rejected at parse time, before any DB read,
 *    token lookup or Graph call.
 *  - `no_publish` defaults to `true`. A dry run performs no provider call, no
 *    event and no write; it only reports what a live run would do.
 *  - A live run additionally requires the no-publish queue receipt for the
 *    exact same plan+review revision to already exist, so unreviewed or
 *    re-edited content can never reach a Page.
 *  - Every Post carries a deterministic idempotency key; an already-published
 *    key is skipped rather than posted twice.
 *
 * It reuses the production Meta Graph module (`@/lib/meta/page-posts`) and the
 * existing client token resolution; it does not introduce a second publishing
 * client.
 */
import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import type { z } from 'zod'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { getMetaTokenForClient, getStoredPageToken } from '@/lib/meta/token-manager'
import { getPageAccessToken, publishPagePhotoPost } from '@/lib/meta/page-posts'
import {
  CAMPAIGN_DAILY_PLAN_KIND,
  CampaignDailyPostReviewMetaSchema,
  CampaignDailyPublishQueueMetaSchema,
  isReviewablePostDate,
  type CampaignDailyPlanData,
} from '@/lib/campaign/daily-plan'
import {
  CampaignDailyPublishCommandSchema,
  CampaignDailyPublishMetaSchema,
  DAILY_PLAN_POST_PUBLISHED_EVENT,
  DAILY_PLAN_POST_STORY_RESOLVE_EVENT,
  DailyPlanPostPublishedEventSchema,
  StoryResolveDueSchema,
  measurementSchedule,
  storyResolveEventId,
  partitionByIdempotency,
  publishIdempotencyKey,
  resolvePublishSchedule,
  resolvePublishStatus,
  type CampaignDailyPublishCommand,
  type CampaignDailyPublishFailure,
  type CampaignDailyPublishMeta,
  type CampaignDailyPublishPlannedPost,
  type CampaignDailyPublishedPost,
  type DailyPlanPostPublishedEvent,
  type StoryResolveDue,
} from '@/lib/campaign/daily-plan-publish'
import { writeMeasurementRecord } from '@/lib/campaign/daily-plan-measurement-record'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function conflict(error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status: 409 })
}

function hasUniqueDates(values: Array<{ date?: string }>): boolean {
  const dates = values.map(value => value?.date)
  return dates.every(date => typeof date === 'string') && new Set(dates).size === dates.length
}

interface PlanRow {
  id: string
  planData: CampaignDailyPlanData
  planRevision: string
  reviewRevision: string
}

/**
 * Load the newest plan snapshot and re-verify every precondition the reviewer
 * saw. Returns a NextResponse on refusal so the caller stays linear.
 */
async function loadReviewedPlan(
  clientId: string,
  command: CampaignDailyPublishCommand,
): Promise<PlanRow | NextResponse> {
  const { data: rows, error } = await supabaseAdmin
    .from('social_plans')
    .select('id, plan_data, created_at')
    .eq('client_id', clientId)
    .eq('campaign_id', command.campaign_id)
    .contains('plan_data', { plan_kind: CAMPAIGN_DAILY_PLAN_KIND })
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) throw error
  const row = rows?.[0] ?? null
  if (!row) return NextResponse.json({ success: false, error: 'PLAN_NOT_FOUND' }, { status: 404 })
  if (row.id !== command.plan_id) return conflict('PLAN_SUPERSEDED')

  const planData = row.plan_data as unknown as CampaignDailyPlanData
  if (
    !planData ||
    planData.plan_kind !== CAMPAIGN_DAILY_PLAN_KIND ||
    planData.campaign_id !== command.campaign_id ||
    !Array.isArray(planData.days) ||
    !Array.isArray(planData.bundles) ||
    !hasUniqueDates(planData.days) ||
    !hasUniqueDates(planData.bundles)
  ) {
    return conflict('PLAN_STATE_INVALID')
  }

  const planRevision = planData.command_meta?.received_at
  if (!planRevision || planRevision !== command.plan_revision) return conflict('PLAN_REVISION_MISMATCH')

  const review = CampaignDailyPostReviewMetaSchema.safeParse(planData.review_meta)
  if (
    !review.success ||
    review.data.plan_revision !== planRevision ||
    Object.keys(review.data.posts).some(date => !isReviewablePostDate(planData, date))
  ) {
    return conflict('REVIEW_STATE_INVALID')
  }
  if (review.data.revision !== command.review_revision) return conflict('REVIEW_REVISION_MISMATCH')

  // The no-publish queue receipt is the proof that these exact Posts passed
  // review and readiness. Publishing without it would bypass that gate.
  const queue = CampaignDailyPublishQueueMetaSchema.safeParse(planData.publish_queue_meta)
  if (!queue.success) return conflict('PUBLISH_QUEUE_RECEIPT_REQUIRED')
  if (queue.data.plan_revision !== planRevision || queue.data.review_revision !== review.data.revision) {
    return conflict('PUBLISH_QUEUE_RECEIPT_STALE')
  }

  return { id: row.id, planData, planRevision, reviewRevision: review.data.revision }
}

interface PublishCandidate extends CampaignDailyPublishPlannedPost {
  message: string
  imageUrl: string
}

/**
 * Build the publish list from the queue receipt, re-resolving copy from the
 * plan bundle and the image URL from the authoritative `client_assets` row.
 * Caller-supplied content is never trusted here.
 */
async function buildCandidates(
  clientId: string,
  row: PlanRow,
  command: CampaignDailyPublishCommand,
): Promise<PublishCandidate[] | NextResponse> {
  const queue = reviewedPostsFromQueueReceipt(row)
  const wanted = command.dates ? new Set(command.dates) : null
  const selected = queue.filter(post => !wanted || wanted.has(post.date))
  if (wanted && selected.length !== wanted.size) return conflict('DATE_NOT_IN_REVIEWED_SET')
  if (selected.length === 0) return NextResponse.json({ success: false, error: 'NO_POSTS_TO_PUBLISH' }, { status: 422 })

  const assetIds = Array.from(new Set(selected.map(post => post.image_asset_id)))
  const { data: assets, error } = await supabaseAdmin
    .from('client_assets')
    .select('id, storage_url, mime_type, status, archived_at')
    .eq('client_id', clientId)
    .in('id', assetIds)
  if (error) throw error
  const assetById = new Map((assets ?? []).map(asset => [asset.id, asset]))

  const bundleByDate = new Map(row.planData.bundles.map(bundle => [bundle.date, bundle]))
  const candidates: PublishCandidate[] = []
  const notReady: string[] = []

  for (const entry of selected) {
    const post = bundleByDate.get(entry.date)?.post
    const asset = assetById.get(entry.image_asset_id)
    const usable =
      post &&
      asset &&
      asset.archived_at == null &&
      asset.status === 'analyzed' &&
      typeof asset.storage_url === 'string' &&
      asset.storage_url.trim().length > 0 &&
      typeof asset.mime_type === 'string' &&
      asset.mime_type.startsWith('image/')
    if (!usable) {
      notReady.push(entry.date)
      continue
    }
    candidates.push({
      date: entry.date,
      idempotency_key: publishIdempotencyKey({
        clientId,
        planId: row.id,
        planRevision: row.planRevision,
        reviewRevision: row.reviewRevision,
        date: entry.date,
      }),
      image_asset_id: entry.image_asset_id,
      cta_url: entry.cta_url,
      message: [post.hook, post.body, `${post.cta}: ${post.cta_url}`].map(part => part.trim()).join('\n\n'),
      imageUrl: asset.storage_url as string,
    })
  }

  if (notReady.length > 0) {
    return NextResponse.json({ success: false, error: 'POSTS_NOT_READY_FOR_PUBLISH', not_ready: notReady }, { status: 422 })
  }
  return candidates
}

/** The reviewed Post list, taken from the queue receipt (already validated). */
function reviewedPostsFromQueueReceipt(row: PlanRow) {
  const queue = CampaignDailyPublishQueueMetaSchema.parse(row.planData.publish_queue_meta)
  return queue.posts
}

/**
 * Resolve the Page token and confirm the caller's `page_id` is the Page this
 * client is actually registered against — a mistyped or borrowed Page id must
 * never publish a client's content to someone else's Page.
 */
async function resolvePageToken(
  clientId: string,
  pageId: string,
): Promise<{ token: string; tokenSource: 'stored_connection' | 'env_user_token' } | NextResponse> {
  const { data: client, error } = await supabaseAdmin
    .from('clients')
    .select('facebook_page_id')
    .eq('id', clientId)
    .maybeSingle()
  if (error) throw error
  const registered = (client as { facebook_page_id?: string | null } | null)?.facebook_page_id
  if (!registered) return conflict('CLIENT_HAS_NO_FACEBOOK_PAGE')
  if (registered !== pageId) return conflict('PAGE_ID_MISMATCH', { registered_page_id: registered })

  // Prefer the Page token stored by the "连接 Meta" button, exactly as
  // leads-sync and page-metrics-sync do. The env-var path below derives a Page
  // token from a *user* token someone pasted in by hand; for a client with no
  // Business Manager (CTS) that is a 60-day User Access Token, so it expires on
  // a clock and takes every dependent feature down with it. Reaching for it
  // first — as this route originally did — meant a stored, still-valid
  // connection was ignored in favour of the one guaranteed to rot.
  let token = await getStoredPageToken(clientId, pageId)
  let tokenSource: 'stored_connection' | 'env_user_token' = 'stored_connection'
  let userToken: string | null = null
  if (!token) {
    tokenSource = 'env_user_token'
    userToken = await getMetaTokenForClient(clientId)
    token = userToken ? await getPageAccessToken(userToken, pageId) : null
  }
  if (!token) {
    // 424, not 502. A CDN in front of the app (Cloudflare here) treats an
    // origin 502 as "origin is broken" and replaces our body with its own
    // branded error page — so this refusal reached the browser as
    // "Bad gateway" HTML and the real reason was invisible. 424 Failed
    // Dependency says the same thing (an upstream we depend on did not
    // cooperate) and is passed through untouched.
    return NextResponse.json(
      {
        success: false,
        error: 'PAGE_TOKEN_UNAVAILABLE',
        detail: userToken
          ? '没有存下来的主页授权，退回到手工配置的 Meta 令牌，但它换不出这个主页的 Page token —— 通常是那个令牌过期了（手工令牌 60 天到期），或它的账号没有这个主页的角色。请在客户设置 →「平台连接」点一次「连接 Meta」重新授权。'
          : '这个客户既没有存下来的主页授权，也没有配置 Meta 令牌。请在客户设置 →「平台连接」点一次「连接 Meta」。',
      },
      { status: 424 }
    )
  }
  return { token, tokenSource }
}

interface LiveOutcome {
  published: CampaignDailyPublishedPost[]
  failed: CampaignDailyPublishFailure[]
  eventIds: string[]
}

/**
 * Publish each pending Post, then emit its measurement event. Runs serially so
 * a mid-batch failure cannot leave more than one Post in an unknown state, and
 * a failure on one date never aborts the receipt for dates already published.
 */
async function publishPending(
  candidates: PublishCandidate[],
  context: { clientId: string; pageId: string; pageToken: string; row: PlanRow; command: CampaignDailyPublishCommand },
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
    const schedule = resolvePublishSchedule(candidate.date, new Date(), context.command.date_offset_days)

    let result: Awaited<ReturnType<typeof publishPagePhotoPost>>
    try {
      result = await publishPagePhotoPost({
        pageId: context.pageId,
        pageAccessToken: context.pageToken,
        message: candidate.message,
        imageUrl: candidate.imageUrl,
        scheduledPublishTime: schedule.publishNow ? undefined : schedule.scheduledPublishTime,
      })
    } catch (error: unknown) {
      failed.push({
        date: candidate.date,
        idempotency_key: candidate.idempotency_key,
        error: errorMessage(error),
        failed_at: new Date().toISOString(),
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

    published.push(record)
    const sentIds = await startMeasurement(record, context)
    eventIds.push(...sentIds)
  }

  return { published, failed, eventIds }
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
): Promise<string[]> {
  const event = buildMeasurementEvent(record, context)
  if (!event.ok) {
    console.error('[daily-plan publish] measurement event not emitted', record.date, event.reason)
    await recordMeasurementSkipped(record, context, 'event_contract_invalid')
    return []
  }
  try {
    const sent = await sendInngestEvent({ id: event.id, name: event.name, data: event.data })
    return sent.event_ids
  } catch (error: unknown) {
    console.error('[daily-plan publish] measurement event failed', record.date, errorMessage(error))
    await recordMeasurementSkipped(record, context, 'event_send_failed')
    return []
  }
}

async function recordMeasurementSkipped(
  record: CampaignDailyPublishedPost,
  context: { clientId: string; row: PlanRow; command: CampaignDailyPublishCommand },
  code: MeasurementSkipCode,
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
    const parsed = StoryResolveDueSchema.safeParse({ ...identity, photo_id: record.post_id })
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
async function persistReceipt(
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

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  const parsed = CampaignDailyPublishCommandSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'INVALID_PUBLISH_COMMAND', details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const command = parsed.data
  if (command.client_id !== clientId) {
    return NextResponse.json({ success: false, error: 'CLIENT_ID_MISMATCH' }, { status: 400 })
  }

  try {
    const row = await loadReviewedPlan(clientId, command)
    if (row instanceof NextResponse) return row

    const candidates = await buildCandidates(clientId, row, command)
    if (candidates instanceof NextResponse) return candidates

    const previousParsed = row.planData.publish_meta
      ? CampaignDailyPublishMetaSchema.safeParse(row.planData.publish_meta)
      : null
    if (previousParsed && !previousParsed.success) return conflict('PUBLISH_STATE_INVALID')
    const previous = previousParsed?.data ?? null
    const alreadyPublished = previous?.published ?? []

    const { pending, skipped } = partitionByIdempotency(candidates, alreadyPublished)

    if (command.no_publish) {
      return NextResponse.json({
        success: true,
        mode: 'DRY_RUN',
        status: 'DRY_RUN',
        provider_impact: 'NONE',
        page_id: command.page_id,
        would_publish: pending.map(post => ({
          date: post.date,
          idempotency_key: post.idempotency_key,
          image_asset_id: post.image_asset_id,
          cta_url: post.cta_url,
          message_preview: post.message.slice(0, 200),
        })),
        already_published: skipped.map(post => ({ date: post.date, idempotency_key: post.idempotency_key })),
      })
    }

    const page = await resolvePageToken(clientId, command.page_id)
    if (page instanceof NextResponse) return page

    const outcome = pending.length === 0
      ? { published: [], failed: [], eventIds: [] }
      : await publishPending(pending, {
          clientId,
          pageId: command.page_id,
          pageToken: page.token,
          row,
          command,
        })

    const merged = [...alreadyPublished, ...outcome.published]
    const receipt: CampaignDailyPublishMeta = {
      schema_version: 1,
      event_name: DAILY_PLAN_POST_PUBLISHED_EVENT,
      status: resolvePublishStatus(merged.length, outcome.failed.length),
      request_id: randomUUID(),
      client_id: clientId,
      campaign_id: command.campaign_id,
      plan_id: row.id,
      plan_revision: row.planRevision,
      review_revision: row.reviewRevision,
      page_id: command.page_id,
      publishing_authorization: 'AUTHORIZED',
      approved_by_user_id: access.user.id,
      created_at: new Date().toISOString(),
      published: merged,
      failed: outcome.failed,
      event_ids: [...(previous?.event_ids ?? []), ...outcome.eventIds],
      // Persist only when non-default. Absent means "labels match delivery" —
      // future audits shouldn't see date_offset_days:0 on every legacy receipt.
      ...(command.date_offset_days !== 0 ? { date_offset_days: command.date_offset_days } : {}),
      // Preserve prior recalls so a re-publish doesn't lose the audit trail
      // (the recall entries live on the receipt, not on separate rows).
      ...(previous?.recalled ? { recalled: previous.recalled } : {}),
    }

    // Posts are already live at this point. If the receipt cannot be stored we
    // must still hand back the real ids rather than lose them silently.
    let persisted = false
    let persistError: string | null = null
    try {
      persisted = await persistReceipt(clientId, row, command, previous, receipt)
    } catch (error: unknown) {
      persistError = errorMessage(error)
    }
    if (!persisted) {
      console.error('[daily-plan publish] receipt not persisted', { clientId, planId: row.id, persistError })
      return NextResponse.json(
        {
          success: false,
          error: 'PUBLISH_RECEIPT_NOT_PERSISTED',
          persist_error: persistError,
          receipt,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: outcome.failed.length === 0,
      mode: 'LIVE',
      status: receipt.status,
      receipt,
      skipped_as_duplicate: skipped.map(post => ({ date: post.date, idempotency_key: post.idempotency_key })),
      // Posts that are on Facebook but will not be measured — surfaced here so
      // the caller sees it without digging through the receipt or server logs.
      measurement_skipped: outcome.published
        .filter(post => post.measurement_skipped_reason)
        .map(post => ({ date: post.date, post_id: post.post_id, reason: post.measurement_skipped_reason })),
    })
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 })
  }
}
