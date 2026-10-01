/**
 * GET  /api/clients/[id]/campaign-daily-plan?campaign_id=<uuid>
 *
 * Read-only projection: Master Brief/Campaign grounding, the seven-day
 * Post/Story/Reel slot grid, every persisted day's bundle (so Ray can select
 * any populated date, not just "today"), source asset provenance and
 * factual readiness gates per day. Publishing/ad status is always
 * NOT_AUTHORIZED — WP1 makes zero provider/publisher/worker calls.
 *
 * POST /api/clients/[id]/campaign-daily-plan
 *
 * Conversation-command persistence seam (WP1 §A). The agent (Claude/Codex)
 * interprets Ray's spoken instruction into a normalised ME_CONTENT_COMMAND_V1
 * -shaped payload; this route only validates and persists structured facts —
 * it never calls an LLM/provider itself.
 *
 * Storage: reuses `social_plans` (jsonb `plan_data`, no migration) tagged
 * `plan_kind: 'campaign_daily_v1'`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getCampaignById } from '@/lib/content/campaign-injector'
import {
  CAMPAIGN_DAILY_PLAN_KIND,
  CampaignDailyCommandSchema,
  CampaignDailyPostReviewMetaSchema,
  CampaignDailyPublishQueueMetaSchema,
  computeGrounding,
  computeReadiness,
  buildPublishingPlan,
  buildAdCandidate,
  buildEmptyDays,
  campaignDailyPlanReceiptLock,
  isReviewablePostDate,
  todayIso,
  type CampaignDailyPlanData,
  type CampaignDailyPlanReceiptLock,
  type CampaignDailyPostReviewMeta,
} from '@/lib/campaign/daily-plan'
import { CampaignDailyPublishMetaSchema } from '@/lib/campaign/daily-plan-publish'

interface ActiveMasterBriefRef {
  id: string
  version: number | null
}

async function resolveActiveMasterBrief(clientId: string): Promise<ActiveMasterBriefRef | null> {
  const { data, error } = await supabaseAdmin
    .from('master_briefs')
    .select('id, version')
    .eq('client_id', clientId)
    .or('status.eq.active,is_active.eq.true')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  // A failed lookup must never read as "no active brief" (NEEDS_BRIEF) — that
  // would be a false success. Propagate so GET/POST return 500 instead.
  if (error) throw error
  return data ? { id: data.id, version: data.version ?? null } : null
}

function errorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : JSON.stringify(err)
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  const { searchParams } = new URL(req.url)
  const campaignId = searchParams.get('campaign_id')
  if (!campaignId) {
    return NextResponse.json({ success: false, error: 'campaign_id is required' }, { status: 400 })
  }

  try {
    const [campaign, masterBrief] = await Promise.all([
      getCampaignById(clientId, campaignId), // fail-closed: null on wrong-client campaign
      resolveActiveMasterBrief(clientId),
    ])

    if (!campaign) {
      const grounding = computeGrounding(campaign, masterBrief)
      return NextResponse.json({
        success: true,
        campaign: null,
        grounding,
        days: buildEmptyDays(todayIso()),
        bundles: [],
        publishing_plan: buildPublishingPlan(null),
        ad_candidate: null,
        plan_id: null,
        plan_revision: null,
        review_revision: null,
        review_summary: { passed: 0, needs_revision: 0, total: 0 },
        publish_queue_receipt: null,
        publish_receipt: null,
        review_lock: null,
        facebook_page_id: null,
      })
    }

    const { data: rows, error: planReadError } = await supabaseAdmin
      .from('social_plans')
      .select('id, plan_data, created_at')
      .eq('client_id', clientId)
      .eq('campaign_id', campaignId)
      .contains('plan_data', { plan_kind: CAMPAIGN_DAILY_PLAN_KIND })
      .order('created_at', { ascending: false })
      .limit(1)

    if (planReadError) throw planReadError

    const planRow = rows?.[0] ?? null
    const planData = (planRow?.plan_data ?? null) as CampaignDailyPlanData | null
    // Back-compat: rows written before the `bundles[]` migration only have a
    // singular `current_bundle`. Without this fallback the 7-day grid still
    // shows PLANNED slots but the only real content silently disappears.
    // TODO(#1159): remove once the data backfill to `bundles[]` has run.
    const legacyBundle = (planData as unknown as { current_bundle?: CampaignDailyPlanData['bundles'][number] | null })
      ?.current_bundle
    const bundles = planData?.bundles ?? (legacyBundle ? [legacyBundle] : [])
    const days = planData?.days ?? buildEmptyDays(todayIso())
    const planRevision = planData?.command_meta?.received_at ?? null
    let reviewMeta: CampaignDailyPostReviewMeta | null = null
    if (planData?.review_meta !== undefined) {
      const parsedReview = CampaignDailyPostReviewMetaSchema.safeParse(planData.review_meta)
      if (
        !parsedReview.success ||
        parsedReview.data.plan_revision !== planRevision ||
        planData.plan_kind !== CAMPAIGN_DAILY_PLAN_KIND ||
        planData.campaign_id !== campaignId ||
        Object.keys(parsedReview.data.posts).some(date => !isReviewablePostDate(planData, date))
      ) {
        throw new Error('INVALID_POST_REVIEW_STATE')
      }
      reviewMeta = parsedReview.data
    }
    let publishQueueMeta = null
    if (planData?.publish_queue_meta !== undefined) {
      const parsedPublishQueue = CampaignDailyPublishQueueMetaSchema.safeParse(planData.publish_queue_meta)
      if (
        !parsedPublishQueue.success ||
        parsedPublishQueue.data.plan_revision !== planRevision ||
        parsedPublishQueue.data.review_revision !== reviewMeta?.revision
      ) {
        throw new Error('INVALID_PUBLISH_QUEUE_STATE')
      }
      publishQueueMeta = parsedPublishQueue.data
    }
    // Provider publish receipt. A receipt from an older snapshot is reported
    // as absent rather than thrown on: the plan has since been re-edited, so
    // those post ids no longer describe the content on screen.
    let publishMeta = null
    if (planData?.publish_meta !== undefined) {
      const parsedPublish = CampaignDailyPublishMetaSchema.safeParse(planData.publish_meta)
      if (
        parsedPublish.success &&
        parsedPublish.data.plan_revision === planRevision &&
        parsedPublish.data.review_revision === reviewMeta?.revision
      ) {
        publishMeta = parsedPublish.data
      }
    }

    // The Page this client is registered against — the publish route refuses
    // any other Page id, so the UI shows it instead of asking anyone to type one.
    const { data: clientRow } = await supabaseAdmin
      .from('clients')
      .select('facebook_page_id')
      .eq('id', clientId)
      .maybeSingle()

    // Grounding must reflect what the SAVED plan was actually grounded in,
    // not "does an active brief happen to exist right now" — otherwise a plan
    // saved with no brief (or against an older brief) reads as freshly
    // grounded the moment someone later adds/changes the active Master Brief,
    // which is a false claim about content nobody re-validated.
    // Only when nothing has been saved yet do we fall back to the live brief,
    // to describe "would a save right now be grounded".
    const grounding = planData
      ? computeGrounding(campaign, planData.master_brief_ref)
      : computeGrounding(campaign, masterBrief)

    // Asset provenance — fail-closed: only assets that resolve under THIS
    // client's rows are surfaced; a cross-client id is silently excluded.
    // Resolved once across every day's bundle, not per-day, since the same
    // reference asset is often reused across multiple days.
    //
    // We now also resolve the Post `image_asset_id` here so GET returns the
    // authoritative preview URL/filename/source/ownership. The stored plan
    // never carries a caller-supplied preview URL — this is the only place
    // the review UI gets image data from.
    const reelAssetIds = bundles.flatMap(b => b.reel?.source_asset_ids ?? [])
    const postImageIds = bundles
      .map(b => (b as unknown as { post?: { image_asset_id?: string } }).post?.image_asset_id)
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
    const referencedAssetIds = Array.from(new Set([...reelAssetIds, ...postImageIds]))
    let resolvedAssets: Array<{
      id: string
      storage_url: string
      original_filename: string | null
      source: string
      ownership: string
    }> = []
    if (referencedAssetIds.length > 0) {
      // Read the same usable-image gate columns POST enforces at write
      // time (status='analyzed', archived_at IS NULL, mime_type image/*).
      // A row whose status/mime_type/archived_at changed AFTER save must
      // NOT read back as truthful provenance — filter it out here so it
      // never enters resolvedAssetIds or assetById.
      const { data: assets, error: assetReadError } = await supabaseAdmin
        .from('client_assets')
        .select('id, storage_url, original_filename, source, ownership, status, archived_at, mime_type')
        .eq('client_id', clientId)
        .in('id', referencedAssetIds)
      if (assetReadError) throw assetReadError
      resolvedAssets = (assets ?? [])
        .filter(a =>
          a.archived_at == null &&
          a.status === 'analyzed' &&
          typeof a.storage_url === 'string' &&
          a.storage_url.trim().length > 0 &&
          typeof a.mime_type === 'string' &&
          a.mime_type.startsWith('image/'))
        .map(a => ({
          id: a.id,
          storage_url: a.storage_url,
          original_filename: a.original_filename,
          source: a.source,
          ownership: a.ownership,
        }))
    }
    const resolvedAssetIds = new Set(resolvedAssets.map(a => a.id))
    const assetById = new Map(resolvedAssets.map(a => [a.id, a]))

    // A day's bundle is included only when it actually exists in storage —
    // a PLANNED slot with no matching bundle entry is a data-shape bug, and
    // fails closed to an honest null rather than silently borrowing another
    // day's content.
    //
    // For each day's Post, attach a `post_image` block resolved from the
    // authoritative `client_assets` row, or null when the asset cannot be
    // resolved under this client (legacy row without image_asset_id, or a
    // stale id that no longer exists). Legacy rows produce null — GET
    // must never fabricate an image or CTA when the data is not proven.
    const bundlesWithReadiness = bundles.map(bundle => {
      const postField = (bundle as unknown as { post?: { image_asset_id?: string; cta_url?: string } | null }).post
      const imgId = postField?.image_asset_id
      const asset = imgId ? assetById.get(imgId) : undefined
      const postImage = asset
        ? {
            id: asset.id,
            preview_url: asset.storage_url,
            filename: asset.original_filename,
            source: asset.source,
            ownership: asset.ownership,
          }
        : null
      // Provenance surfaces every RESOLVED asset actually referenced by
      // this day's bundle — Post image + Reel source assets — deduped by
      // asset id so a Post and a Reel referencing the same file are shown
      // once. This matches the `client_asset_provenance` required-set in
      // `computeReadiness`; a reviewer sees exactly the assets that were
      // checked, in the order Post-then-Reel.
      const referencedIdsForDay: string[] = []
      if (imgId) referencedIdsForDay.push(imgId)
      for (const rid of bundle.reel?.source_asset_ids ?? []) referencedIdsForDay.push(rid)
      const provenance = Array.from(new Set(referencedIdsForDay))
        .map(id => assetById.get(id))
        .filter((a): a is NonNullable<typeof a> => !!a)
      const storedReview = reviewMeta?.posts[bundle.date] ?? null
      const passStillCurrent = Boolean(
        postField?.image_asset_id &&
        postField.cta_url &&
        isHttpsUrl(postField.cta_url) &&
        bundle.post?.hook?.trim() &&
        bundle.post?.body?.trim() &&
        bundle.post?.cta?.trim() &&
        postImage
      )
      const postReview = storedReview
        ? {
            verdict: storedReview.verdict,
            reason: storedReview.reason,
            reviewed_at: storedReview.reviewed_at,
            is_current: storedReview.verdict !== 'PASS' || passStillCurrent,
          }
        : null
      return {
        ...bundle,
        post_image: postImage,
        readiness: computeReadiness({ grounding, bundle, resolvedAssetIds }),
        provenance,
        post_review: postReview,
      }
    })

    const reviewSummary = bundlesWithReadiness.reduce(
      (summary, bundle) => {
        if (!bundle.post) return summary
        summary.total += 1
        const review = bundle.post_review
        if (review?.verdict === 'PASS' && review.is_current) summary.passed += 1
        if (review?.verdict === 'NEEDS_REVISION') summary.needs_revision += 1
        return summary
      },
      { passed: 0, needs_revision: 0, total: 0 }
    )

    // Ad candidate stays scoped to the earliest day that actually has a
    // Reel — WP1 previews at most one candidate, never one per day.
    const firstReelBundle = bundles.find(b => !!b.reel) ?? null

    return NextResponse.json({
      success: true,
      campaign: { id: campaign.id, title: campaign.title, offer: campaign.offer ?? null, primary_cta: campaign.primary_cta ?? null },
      grounding,
      days,
      bundles: bundlesWithReadiness,
      publishing_plan: buildPublishingPlan(campaign),
      ad_candidate: buildAdCandidate(firstReelBundle),
      plan_id: planRow?.id ?? null,
      plan_revision: planRevision,
      review_revision: reviewMeta?.revision ?? null,
      review_summary: reviewSummary,
      publish_queue_receipt: publishQueueMeta,
      publish_receipt: publishMeta,
      // Raw receipt presence, not the validated receipts above: a stale
      // publish_meta reads as null there but still locks Post review.
      review_lock: campaignDailyPlanReceiptLock(planData),
      facebook_page_id: (clientRow as { facebook_page_id?: string | null } | null)?.facebook_page_id ?? null,
    })
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 500 })
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

/**
 * A complete-snapshot POST rebuilds `plan_data` from scratch, so overwriting
 * a row drops every receipt stored on it.
 *
 * - `publish_meta` is the only record of Posts live on the client's Page:
 *   recall needs it to delete them and publish needs it for idempotency.
 *   Any receipt counts (including FAILED or fully recalled) — failed and
 *   recalled entries are the audit trail too.
 * - `publish_queue_meta` is the gate publish reads; while it exists a publish
 *   may be in flight, and its Inngest receipt must not silently disappear.
 * - `review_meta` alone is NOT a lock: reviews belong to the old copy and a
 *   new snapshot must be re-reviewed (GET rejects a review whose
 *   plan_revision no longer matches), with no external side effect lost.
 *
 * Inserting a second row instead is not safe either: every reader picks the
 * newest row by created_at, which would orphan the old receipt (recall would
 * answer PLAN_ID_MISMATCH for posts that are still live).
 */
function planLockedResponse(
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
      // Archiving keeps the old campaign out of active-campaign prompt
      // injection; GET and recall still resolve it by id regardless of status.
      message: `${reason === 'PLAN_ALREADY_PUBLISHED'
        ? 'This campaign plan already has Posts published to Facebook. Saving a new plan here would erase the publish record needed to recall them.'
        : 'This campaign plan is already in the publish queue. Saving a new plan here would discard that queue record.'} Create a new campaign for the new plan and archive this one.`,
      next_step: 'CREATE_NEW_CAMPAIGN',
    },
    { status: 409 }
  )
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  const rawBody = await req.json().catch(() => null)
  const parsed = CampaignDailyCommandSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'INVALID_COMMAND', details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const cmd = parsed.data

  try {
    // Fail-closed: getCampaignById scopes by client_id, so a campaign_id
    // belonging to another client resolves to null here.
    const campaign = await getCampaignById(clientId, cmd.campaign_id)
    if (!campaign) {
      return NextResponse.json({ success: false, error: 'NEEDS_CAMPAIGN' }, { status: 404 })
    }

    const masterBrief = await resolveActiveMasterBrief(clientId)
    const grounding = computeGrounding(campaign, masterBrief)

    // CTA hard-binding — every Post's cta_url must EXACTLY equal the
    // campaign's persisted source URL. No arbitrary caller destination.
    // A campaign_briefs row with zero source_urls means the campaign is not
    // yet valid for a public CTA — fail closed rather than fall back.
    const campaignSourceUrl = (campaign.source_urls ?? [])[0] ?? null
    if (!campaignSourceUrl) {
      return NextResponse.json(
        { success: false, error: 'CAMPAIGN_HAS_NO_CTA_SOURCE_URL' },
        { status: 400 }
      )
    }
    const ctaMismatches = cmd.bundles
      .filter(b => b.post.cta_url !== campaignSourceUrl)
      .map(b => ({ date: b.date, provided: b.post.cta_url }))
    if (ctaMismatches.length > 0) {
      return NextResponse.json(
        { success: false, error: 'CTA_URL_MISMATCH', expected: campaignSourceUrl, mismatches: ctaMismatches },
        { status: 400 }
      )
    }

    // Every referenced asset (both Reel `source_asset_ids` and every Post's
    // `image_asset_id`) must belong to this client AND be a valid, usable,
    // non-archived image. Server re-resolves ownership + MIME + status from
    // the authoritative `client_assets` row — the caller does not supply
    // URL/ownership/preview, so a spoofed payload can never override real
    // asset data.
    const reelAssetIds = cmd.bundles.flatMap(b => b.reel?.source_asset_ids ?? [])
    const postImageIds = cmd.bundles.map(b => b.post.image_asset_id)
    const referencedAssetIds = Array.from(new Set([...reelAssetIds, ...postImageIds]))
    if (referencedAssetIds.length > 0) {
      const { data: assets } = await supabaseAdmin
        .from('client_assets')
        .select('id, mime_type, status, archived_at')
        .eq('client_id', clientId)
        .in('id', referencedAssetIds)
      const byId = new Map((assets ?? []).map(a => [a.id, a]))
      const foreignReel = reelAssetIds.filter(id => !byId.has(id))
      if (foreignReel.length > 0) {
        return NextResponse.json(
          { success: false, error: 'ASSET_NOT_OWNED_BY_CLIENT', foreign_asset_ids: foreignReel },
          { status: 403 }
        )
      }
      // Post image-specific gates: exists (client-scoped), analyzed status,
      // not archived, image MIME. Reject on any failure with the exact per-day
      // reason so a reviewer can act.
      const invalidPostImages = cmd.bundles.map(b => {
        const a = byId.get(b.post.image_asset_id)
        if (!a) return { date: b.date, id: b.post.image_asset_id, reason: 'not_owned_by_client' }
        if (a.archived_at) return { date: b.date, id: b.post.image_asset_id, reason: 'archived' }
        if (a.status !== 'analyzed') return { date: b.date, id: b.post.image_asset_id, reason: `status_${a.status}` }
        if (!(a.mime_type ?? '').startsWith('image/')) {
          return { date: b.date, id: b.post.image_asset_id, reason: 'not_an_image' }
        }
        return null
      }).filter((x): x is { date: string; id: string; reason: string } => x !== null)
      if (invalidPostImages.length > 0) {
        return NextResponse.json(
          { success: false, error: 'POST_IMAGE_INVALID', invalid: invalidPostImages },
          { status: 400 }
        )
      }
    }

    // A failed lookup must not read as "no plan yet": inserting a second row
    // would become the newest snapshot and hide an existing publish receipt
    // from GET / publish / recall, all of which only read the newest row.
    const { data: existing, error: existingReadError } = await supabaseAdmin
      .from('social_plans')
      .select('id, plan_data')
      .eq('client_id', clientId)
      .eq('campaign_id', cmd.campaign_id)
      .contains('plan_data', { plan_kind: CAMPAIGN_DAILY_PLAN_KIND })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existingReadError) throw existingReadError

    const existingPlanData = (existing?.plan_data ?? null) as Partial<CampaignDailyPlanData> | null
    const blockedBy = campaignDailyPlanReceiptLock(existingPlanData)
    if (existing?.id && blockedBy) {
      return planLockedResponse(blockedBy, existing.id, existingPlanData)
    }

    // Complete-snapshot contract: the incoming command IS the new stored
    // seven-day plan; previously stored bundles are replaced wholesale, not
    // merged. Merging previously stored bundles into a new snapshot was
    // valid but reintroduced two risks the scope shrink is designed to
    // eliminate — preserved-old bundles carry the current save's
    // `master_brief_ref` (false grounding), and old dates outside the new
    // window leak into the render (stale window). Rejecting partial writes
    // and replacing wholesale removes both without adding per-bundle
    // grounding, migrations, or a merge/version framework.
    const planData: CampaignDailyPlanData = {
      plan_kind: CAMPAIGN_DAILY_PLAN_KIND,
      campaign_id: cmd.campaign_id,
      master_brief_ref: masterBrief,
      days: cmd.days,
      bundles: cmd.bundles,
      command_meta: {
        source: 'conversation_command',
        received_at: new Date().toISOString(),
        raw_summary: cmd.raw_summary ?? null,
      },
    }

    let planId: string
    if (existing?.id) {
      // Compare-and-set: a publish-queue or publish receipt that landed after
      // the read above must still stop the overwrite, not be erased by it.
      const { data: updated, error } = await supabaseAdmin
        .from('social_plans')
        .update({ plan_data: planData })
        .eq('id', existing.id)
        .eq('client_id', clientId)
        .is('plan_data->publish_meta', null)
        .is('plan_data->publish_queue_meta', null)
        .select('id')
      if (error) throw error
      if (!updated || updated.length === 0) {
        return NextResponse.json(
          { success: false, error: 'PLAN_CHANGED_DURING_SAVE', plan_id: existing.id },
          { status: 409 }
        )
      }
      planId = existing.id
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from('social_plans')
        .insert({
          client_id: clientId,
          campaign_id: cmd.campaign_id,
          platform: 'facebook',
          wave_number: 1,
          plan_data: planData,
        })
        .select('id')
        .single()
      if (error) throw error
      planId = inserted.id
    }

    return NextResponse.json({ success: true, plan_id: planId, grounding, plan_data: planData })
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 500 })
  }
}
