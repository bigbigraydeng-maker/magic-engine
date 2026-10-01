/**
 * POST /api/clients/[id]/campaign-daily-plan/publish-queue
 *
 * Creates a no-publish handoff receipt for the reviewed Daily Plan Facebook
 * Posts and emits an Inngest event for the next workflow stage. This route
 * never creates legacy content board rows, schedules, publishes, or calls a
 * publishing provider.
 */
import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import {
  CAMPAIGN_DAILY_PLAN_KIND,
  CampaignDailyPostReviewMetaSchema,
  CampaignDailyPublishQueueCommandSchema,
  CampaignDailyPublishQueueMetaSchema,
  isReviewablePostDate,
  type CampaignDailyPlanData,
  type CampaignDailyPublishQueueMeta,
} from '@/lib/campaign/daily-plan'
import { postChecklistPasses } from '@/lib/social/content-review'

const DAILY_PLAN_PUBLISH_QUEUE_READY_EVENT = 'daily_plan.publish_queue.ready' as const

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

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  const parsed = CampaignDailyPublishQueueCommandSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'INVALID_PUBLISH_QUEUE_COMMAND', details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const command = parsed.data

  try {
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
    if (!planRevision || planRevision !== command.expected_plan_revision) return conflict('PLAN_REVISION_MISMATCH')

    const reviewParsed = CampaignDailyPostReviewMetaSchema.safeParse(planData.review_meta)
    if (
      !reviewParsed.success ||
      reviewParsed.data.plan_revision !== planRevision ||
      Object.keys(reviewParsed.data.posts).some(date => !isReviewablePostDate(planData, date))
    ) {
      return conflict('REVIEW_STATE_INVALID')
    }
    const reviewMeta = reviewParsed.data
    if (reviewMeta.revision !== command.expected_review_revision) return conflict('REVIEW_REVISION_MISMATCH')

    const uncheckedPosts = planData.bundles
      .filter(bundle => !!bundle.post)
      .filter(bundle => {
        const review = reviewMeta.posts[bundle.date]
        return !review || review.verdict !== 'PASS' || review.reviewer_role !== 'admin' || !postChecklistPasses(review.checklist)
      })
      .map(bundle => bundle.date)
    if (uncheckedPosts.length > 0) {
      return NextResponse.json({
        success: false,
        error: 'POSTS_NOT_READY_FOR_PUBLISH_QUEUE',
        not_ready: uncheckedPosts.map(date => ({ date, reason: 'REVIEW_CHECKLIST_INCOMPLETE' })),
      }, { status: 422 })
    }

    if (planData.publish_queue_meta !== undefined) {
      const existing = CampaignDailyPublishQueueMetaSchema.safeParse(planData.publish_queue_meta)
      if (!existing.success) return conflict('PUBLISH_QUEUE_STATE_INVALID')
      if (
        existing.data.plan_revision === planRevision &&
        existing.data.review_revision === reviewMeta.revision &&
        existing.data.no_publish === true
      ) {
        return NextResponse.json({ success: true, changed: false, receipt: existing.data })
      }
      return conflict('PUBLISH_QUEUE_CONFLICT')
    }

    const postBundles = planData.bundles.filter(bundle => !!bundle.post)
    if (postBundles.length === 0) {
      return NextResponse.json({ success: false, error: 'NO_POSTS_TO_QUEUE' }, { status: 422 })
    }

    const assetIds = postBundles
      .map(bundle => bundle.post?.image_asset_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    const { data: assets, error: assetError } = await supabaseAdmin
      .from('client_assets')
      .select('id, storage_url, mime_type, status, archived_at')
      .eq('client_id', clientId)
      .in('id', Array.from(new Set(assetIds)))
    if (assetError) throw assetError
    const assetById = new Map((assets ?? []).map(asset => [asset.id, asset]))

    const posts = postBundles.map(bundle => {
      const post = bundle.post!
      const review = reviewMeta.posts[bundle.date]
      const asset = assetById.get(post.image_asset_id)
      const copyReady = Boolean(
        post.hook?.trim() &&
        post.body?.trim() &&
        post.cta?.trim() &&
        isHttpsUrl(post.cta_url)
      )
      const assetReady = Boolean(
        asset &&
        asset.archived_at == null &&
        asset.status === 'analyzed' &&
        typeof asset.storage_url === 'string' &&
        asset.storage_url.trim().length > 0 &&
        typeof asset.mime_type === 'string' &&
        asset.mime_type.startsWith('image/')
      )
      const passCurrent = review?.verdict === 'PASS' && copyReady && assetReady
      return {
        ok: passCurrent,
        date: bundle.date,
        image_asset_id: post.image_asset_id,
        cta_url: post.cta_url,
        review_verdict: review?.verdict,
      }
    })

    const notReady = posts
      .filter(post => !post.ok)
      .map(post => ({ date: post.date, review_verdict: post.review_verdict ?? null }))
    if (notReady.length > 0) {
      return NextResponse.json({ success: false, error: 'POSTS_NOT_READY_FOR_PUBLISH_QUEUE', not_ready: notReady }, { status: 422 })
    }

    const now = new Date().toISOString()
    const requestId = randomUUID()
    const receiptWithoutEventId = {
      schema_version: 1 as const,
      event_name: DAILY_PLAN_PUBLISH_QUEUE_READY_EVENT,
      request_id: requestId,
      client_id: clientId,
      campaign_id: command.campaign_id,
      plan_id: command.plan_id,
      plan_revision: planRevision,
      review_revision: reviewMeta.revision,
      status: 'READY_NO_PUBLISH' as const,
      no_publish: true as const,
      publishing_authorization: 'NOT_AUTHORIZED' as const,
      provider_impact: 'NONE' as const,
      cost_usd: 0 as const,
      created_at: now,
      created_by_user_id: access.user.id,
      posts: posts.map(post => ({
        date: post.date,
        image_asset_id: post.image_asset_id,
        cta_url: post.cta_url,
        review_verdict: 'PASS' as const,
      })),
    }

    const sent = await sendInngestEvent({
      id: requestId,
      name: DAILY_PLAN_PUBLISH_QUEUE_READY_EVENT,
      data: receiptWithoutEventId,
    })
    const eventId = sent.event_ids[0]
    if (!eventId) throw new Error('INNGEST_EVENT_RECEIPT_MISSING')
    const receipt: CampaignDailyPublishQueueMeta = {
      ...receiptWithoutEventId,
      event_id: eventId,
    }

    const nextPlanData: CampaignDailyPlanData = { ...planData, publish_queue_meta: receipt }
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('social_plans')
      .update({ plan_data: nextPlanData })
      .eq('id', row.id)
      .eq('client_id', clientId)
      .eq('campaign_id', command.campaign_id)
      .contains('plan_data', {
        plan_kind: CAMPAIGN_DAILY_PLAN_KIND,
        command_meta: { received_at: planRevision },
        review_meta: { revision: reviewMeta.revision },
      })
      .is('plan_data->publish_queue_meta', null)
      .select('id')
      .maybeSingle()

    if (updateError) throw updateError
    if (!updated) return conflict('PUBLISH_QUEUE_CONFLICT')

    return NextResponse.json({ success: true, changed: true, receipt })
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 })
  }
}
