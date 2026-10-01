/**
 * PATCH /api/clients/[id]/campaign-daily-plan/post-review
 *
 * Records human review of one Facebook Post inside the existing seven-day
 * plan. This route never creates content_posts, calls a provider, schedules,
 * or publishes. Review is bound to the exact client, campaign, latest plan,
 * content revision and review revision supplied by the loaded UI.
 */
import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import {
  CAMPAIGN_DAILY_PLAN_KIND,
  CampaignDailyPostReviewCommandSchema,
  CampaignDailyPostReviewMetaSchema,
  campaignDailyPlanReceiptLock,
  isReviewablePostDate,
  type CampaignDailyPlanData,
  type CampaignDailyPlanReceiptLock,
  type CampaignDailyPostReviewMeta,
} from '@/lib/campaign/daily-plan'

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : JSON.stringify(error)
}

function conflict(error: string) {
  return NextResponse.json({ success: false, error }, { status: 409 })
}

/**
 * Changing a review after queueing would strand the plan: publish rejects
 * the queue receipt as stale, the queue refuses a second receipt, and the
 * plan POST refuses to overwrite a queued row. During an in-flight publish
 * it would also make the publish receipt write miss, leaving live Posts
 * that recall cannot find.
 */
function reviewLockedResponse(
  reason: CampaignDailyPlanReceiptLock,
  planId: string,
  planData: Partial<CampaignDailyPlanData> | null
) {
  const publishStatus = (planData?.publish_meta as { status?: unknown } | undefined)?.status
  return NextResponse.json(
    {
      success: false,
      error: reason,
      plan_id: planId,
      publish_status: typeof publishStatus === 'string' ? publishStatus : null,
      message: `${reason === 'PLAN_ALREADY_PUBLISHED'
        ? 'This plan already has a Facebook publish record.'
        : 'This plan is already in the publish queue.'} Post reviews are locked so the queue and publish records stay valid. Create a new campaign for changed content.`,
      next_step: 'CREATE_NEW_CAMPAIGN',
    },
    { status: 409 }
  )
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function hasUniqueDates(values: Array<{ date?: string }>): boolean {
  const dates = values.map(value => value?.date)
  return dates.every(date => typeof date === 'string') && new Set(dates).size === dates.length
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  const parsed = CampaignDailyPostReviewCommandSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'INVALID_REVIEW_COMMAND', details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const command = parsed.data

  try {
    // Select the latest plan under this client + campaign. The body plan_id
    // is compared afterwards so an old UI cannot update a superseded row.
    const { data: rows, error: readError } = await supabaseAdmin
      .from('social_plans')
      .select('id, plan_data, created_at')
      .eq('client_id', clientId)
      .eq('campaign_id', command.campaign_id)
      .contains('plan_data', { plan_kind: CAMPAIGN_DAILY_PLAN_KIND })
      .order('created_at', { ascending: false })
      .limit(1)

    if (readError) throw readError
    const row = rows?.[0] ?? null
    if (!row) {
      return NextResponse.json({ success: false, error: 'PLAN_NOT_FOUND' }, { status: 404 })
    }
    if (row.id !== command.plan_id) return conflict('PLAN_SUPERSEDED')

    const storedPlanData = row.plan_data as Partial<CampaignDailyPlanData> | null
    const receiptLock = campaignDailyPlanReceiptLock(storedPlanData)
    if (receiptLock) return reviewLockedResponse(receiptLock, row.id, storedPlanData)

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
    if (!planRevision || planRevision !== command.expected_plan_revision) {
      return conflict('PLAN_REVISION_MISMATCH')
    }

    const bundle = planData.bundles.find(item => item.date === command.date)
    if (!isReviewablePostDate(planData, command.date) || !bundle?.post) {
      return NextResponse.json({ success: false, error: 'POST_DATE_NOT_FOUND' }, { status: 404 })
    }

    let currentReview: CampaignDailyPostReviewMeta | null = null
    if (planData.review_meta !== undefined) {
      const reviewParsed = CampaignDailyPostReviewMetaSchema.safeParse(planData.review_meta)
      if (
        !reviewParsed.success ||
        reviewParsed.data.plan_revision !== planRevision ||
        Object.keys(reviewParsed.data.posts).some(date => !isReviewablePostDate(planData, date))
      ) {
        return conflict('REVIEW_STATE_INVALID')
      }
      currentReview = reviewParsed.data
    }

    if ((currentReview?.revision ?? null) !== command.expected_review_revision) {
      return conflict('REVIEW_CONFLICT')
    }

    const reason = command.verdict === 'NEEDS_REVISION' ? command.reason!.trim() : null
    const previous = currentReview?.posts[command.date]
    if (
      command.verdict === 'NEEDS_REVISION' &&
      previous?.verdict === command.verdict &&
      previous.reason === reason
    ) {
      return NextResponse.json({ success: true, changed: false, review_revision: currentReview?.revision ?? null })
    }

    // PASS is allowed only while the Post is still complete and its image is
    // a usable asset owned by this client. NEEDS_REVISION intentionally has
    // no such requirement, otherwise a reviewer could not reject bad input.
    if (command.verdict === 'PASS') {
      const post = bundle.post
      const copyComplete = Boolean(
        post.hook?.trim() &&
        post.body?.trim() &&
        post.cta?.trim() &&
        isHttpsUrl(post.cta_url) &&
        post.image_asset_id
      )
      if (!copyComplete) {
        return NextResponse.json({ success: false, error: 'POST_NOT_READY' }, { status: 422 })
      }

      const { data: asset, error: assetError } = await supabaseAdmin
        .from('client_assets')
        .select('id, storage_url, mime_type, status, archived_at')
        .eq('client_id', clientId)
        .eq('id', post.image_asset_id)
        .maybeSingle()
      if (assetError) throw assetError
      if (
        !asset ||
        asset.archived_at != null ||
        asset.status !== 'analyzed' ||
        typeof asset.storage_url !== 'string' ||
        asset.storage_url.trim().length === 0 ||
        typeof asset.mime_type !== 'string' ||
        !asset.mime_type.startsWith('image/')
      ) {
        return NextResponse.json({ success: false, error: 'POST_IMAGE_NOT_READY' }, { status: 422 })
      }

      // Identical PASS retries are idempotent only after current copy and
      // current client-owned image have been revalidated.
      if (previous?.verdict === command.verdict && previous.reason === reason) {
        return NextResponse.json({ success: true, changed: false, review_revision: currentReview?.revision ?? null })
      }
    }

    const now = new Date().toISOString()
    const nextReview: CampaignDailyPostReviewMeta = {
      schema_version: 1,
      plan_revision: planRevision,
      revision: randomUUID(),
      updated_at: now,
      posts: {
        ...(currentReview?.posts ?? {}),
        [command.date]: {
          verdict: command.verdict,
          reason,
          reviewed_at: now,
          reviewed_by_user_id: access.user.id,
        },
      },
    }
    const nextPlanData: CampaignDailyPlanData = { ...planData, review_meta: nextReview }
    const revisionFilter = {
      plan_kind: CAMPAIGN_DAILY_PLAN_KIND,
      command_meta: { received_at: planRevision },
    }

    // Atomic compare-and-set. The first decision only matches a missing/null
    // review_meta; later decisions must match the exact previous review token.
    // If another reviewer or a new plan wins the race, no row is returned.
    // A publish-queue or publish receipt that lands after the read above
    // also makes the update miss, so it never goes stale underneath.
    const updateQuery = supabaseAdmin
      .from('social_plans')
      .update({ plan_data: nextPlanData })
      .eq('id', row.id)
      .eq('client_id', clientId)
      .eq('campaign_id', command.campaign_id)
      .contains('plan_data', revisionFilter)
      .is('plan_data->publish_queue_meta', null)
      .is('plan_data->publish_meta', null)

    const { data: updated, error: updateError } = currentReview
      ? await updateQuery
          .contains('plan_data', { review_meta: { revision: currentReview.revision } })
          .select('id')
          .maybeSingle()
      : await updateQuery
          .is('plan_data->review_meta', null)
          .select('id')
          .maybeSingle()

    if (updateError) throw updateError
    if (!updated) return conflict('REVIEW_CONFLICT')

    return NextResponse.json({ success: true, changed: true, review_revision: nextReview.revision })
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 })
  }
}
