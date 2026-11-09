/**
 * POST /api/clients/[id]/campaign-daily-plan/recall
 *
 * Undo a publish: for each requested date, call Graph DELETE on the recorded
 * post_id, then update the plan's `publish_meta` receipt (move the entries
 * from `published[]` to `recalled[]`).
 *
 * ## Fail-closed, mirror of the publish route
 *
 * - `no_recall` defaults to `true`: a caller who says nothing gets a dry run.
 *   A live recall requires explicit `no_recall: false` **in addition to**
 *   `approved: true` and `publish_authorization: true`.
 * - Every authorisation field is a `z.literal(true)` in the schema, so an
 *   omitted or falsey field is rejected at parse time — before we read the
 *   plan, resolve a token, or touch Graph.
 * - Dates must be given explicitly and non-empty; "recall everything" is not
 *   an offered command, because the receipt spans the plan's whole life and
 *   a typo could wipe months of legitimate posts.
 *
 * ## What a successful dry run reports
 *
 * `{would_recall: [...], already_recalled: [...], not_published: [...]}` —
 * the caller sees exactly which dates would be touched and which are already
 * gone before authorising the live run. `not_published` returns as data, not
 * an error: it flags dates the caller thinks were published but the receipt
 * says weren't, so the human can decide whether it's a typo or a stale mental
 * model of what's live.
 *
 * ## Persistence
 *
 * Runs serially. Each successful delete moves that entry from `published[]`
 * to `recalled[]` on the in-memory receipt copy; the whole receipt is written
 * back once with a compare-and-set on the same `publish_meta.request_id` we
 * loaded. A concurrent recall or publish that changed the receipt while we
 * were mid-batch loses the CAS and gets a 409 — the caller retries with the
 * fresh state instead of stomping on it.
 *
 * ## No Inngest emission on recall
 *
 * The measurement workflow keyed off `daily_plan.post.published`. Recalling
 * doesn't produce another measurable event, and firing a synthetic "recalled"
 * event before there's a consumer for it would just be noise. The receipt
 * itself is the audit trail; a T+24/T+72 consumer, when it exists, can check
 * `recalled[]` before reading metrics.
 */

import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { tombstoneRecalledDates } from '@/lib/campaign/daily-plan-auto-publish-store'
import { readAutoPublishRecords } from '@/lib/campaign/daily-plan-auto-publish-records'
import { getMetaTokenForClient, getStoredPageToken } from '@/lib/meta/token-manager'
import { deletePagePost, getPageAccessToken } from '@/lib/meta/page-posts'
import {
  CAMPAIGN_DAILY_PLAN_KIND,
  type CampaignDailyPlanData,
} from '@/lib/campaign/daily-plan'
import {
  CampaignDailyPublishMetaSchema,
  type CampaignDailyPublishMeta,
} from '@/lib/campaign/daily-plan-publish'
import {
  CampaignDailyRecallCommandSchema,
  partitionRecallCandidates,
  type CampaignDailyRecallCommand,
} from '@/lib/campaign/daily-plan-recall'

export const maxDuration = 300

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function conflict(error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status: 409 })
}

interface PlanRow {
  id: string
  planData: CampaignDailyPlanData
  publishMeta: CampaignDailyPublishMeta
}

/**
 * Load the plan and validate its stored publish receipt.
 *
 * Rejects when no receipt exists (there's nothing to recall) and when the
 * receipt has drifted from the command's plan_revision + review_revision.
 * The second guard prevents recalling posts under a stale mental model of
 * which snapshot is live.
 */
async function loadPlanWithReceipt(
  clientId: string,
  command: CampaignDailyRecallCommand,
): Promise<PlanRow | NextResponse> {
  const { data, error } = await supabaseAdmin
    .from('social_plans')
    .select('id, plan_data')
    .eq('client_id', clientId)
    .eq('campaign_id', command.campaign_id)
    .contains('plan_data', { plan_kind: CAMPAIGN_DAILY_PLAN_KIND })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  const row = data as { id: string; plan_data: CampaignDailyPlanData } | null
  if (!row) return conflict('PLAN_NOT_FOUND')
  if (row.id !== command.plan_id) {
    return conflict('PLAN_ID_MISMATCH', { current_plan_id: row.id })
  }

  const rawMeta = (row.plan_data as { publish_meta?: unknown }).publish_meta
  if (!rawMeta) return conflict('NOTHING_PUBLISHED')

  const parsed = CampaignDailyPublishMetaSchema.safeParse(rawMeta)
  if (!parsed.success) return conflict('PUBLISH_RECEIPT_INVALID', { detail: parsed.error.message })

  const receipt = parsed.data
  if (receipt.client_id !== clientId) return conflict('CLIENT_ID_MISMATCH')
  if (receipt.page_id !== command.page_id) {
    return conflict('PAGE_ID_MISMATCH', { receipt_page_id: receipt.page_id })
  }
  if (receipt.plan_revision !== command.plan_revision) {
    return conflict('PLAN_REVISION_MISMATCH', { receipt_plan_revision: receipt.plan_revision })
  }
  if (receipt.review_revision !== command.review_revision) {
    return conflict('REVIEW_REVISION_MISMATCH', { receipt_review_revision: receipt.review_revision })
  }

  return { id: row.id, planData: row.plan_data, publishMeta: receipt }
}

/**
 * Resolve the Page token — identical to the publish route's rule. Duplicated
 * intentionally rather than factored out mid-PR: recall and publish are
 * different commands, and their token-resolution stories should be free to
 * diverge (e.g. recall by a different reviewer). If they stay identical for
 * three PRs, factor then, not now.
 */
async function resolvePageToken(
  clientId: string,
  pageId: string,
): Promise<{ token: string } | NextResponse> {
  const { data: client, error } = await supabaseAdmin
    .from('clients')
    .select('facebook_page_id')
    .eq('id', clientId)
    .maybeSingle()
  if (error) throw error
  const registered = (client as { facebook_page_id?: string | null } | null)?.facebook_page_id
  if (!registered) return conflict('CLIENT_HAS_NO_FACEBOOK_PAGE')
  if (registered !== pageId) return conflict('PAGE_ID_MISMATCH', { registered_page_id: registered })

  let token = await getStoredPageToken(clientId, pageId)
  if (!token) {
    const userToken = await getMetaTokenForClient(clientId)
    token = userToken ? await getPageAccessToken(userToken, pageId) : null
  }
  if (!token) {
    return NextResponse.json(
      { success: false, error: 'PAGE_TOKEN_UNAVAILABLE' },
      { status: 424 },
    )
  }
  return { token }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  const parsed = CampaignDailyRecallCommandSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'INVALID_COMMAND', detail: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const command = parsed.data

  if (command.client_id !== clientId) {
    return conflict('CLIENT_ID_MISMATCH')
  }

  try {
    const planOrError = await loadPlanWithReceipt(clientId, command)
    if (planOrError instanceof NextResponse) return planOrError
    const row = planOrError

    const { pending, already_recalled, not_published } = partitionRecallCandidates(
      command.dates,
      row.publishMeta,
    )

    // The unattended publisher may know about posts this receipt does not (its own record of a send whose
    // receipt write failed) or about dates whose outcome is unsettled. Recall only deletes what the receipt
    // lists, so these must be shown to the human instead of silently staying on the Page.
    const autoPublishRecords = await readAutoPublishRecords({
      planId: command.plan_id,
      clientId,
      dates: command.dates,
      receiptPostIds: new Set([
        ...row.publishMeta.published.map((p) => p.post_id),
        ...(row.publishMeta.recalled ?? []).map((p) => p.post_id),
      ]),
    })
    const autoPublishNote =
      autoPublishRecords.status === 'UNKNOWN'
        ? '没能读到自动发布器自己的记录，这几天主页上可能还有回执里没有的帖子，请到 Facebook 主页核对。'
        : autoPublishRecords.posts.length > 0 || autoPublishRecords.unconfirmed.length > 0
          ? '自动发布器的记录里有回执没列出的帖子，或有结果未确认的日期（见 auto_publish_records）。这些不会被本次撤回删除，请到 Facebook 主页核对。'
          : undefined

    if (command.no_recall) {
      return NextResponse.json({
        success: true,
        status: 'DRY_RUN',
        would_recall: pending.map((p) => ({
          date: p.date,
          post_id: p.post_id,
          permalink: `https://www.facebook.com/${p.post_id}`,
        })),
        already_recalled,
        not_published,
        auto_publish_records: autoPublishRecords,
        ...(autoPublishNote ? { auto_publish_note: autoPublishNote } : {}),
      })
    }

    // Live run authorised. Resolve token now, not earlier — dry run should
    // stay side-effect free even for a client with no token configured.
    const tokenOrError = await resolvePageToken(clientId, command.page_id)
    if (tokenOrError instanceof NextResponse) return tokenOrError
    const { token } = tokenOrError

    const recalled: Array<{ date: string; idempotency_key: string; post_id: string; recalled_at: string; already_gone: boolean }> = []
    const failed: Array<{ date: string; idempotency_key: string; error: string; failed_at: string }> = []

    // Serial by design: same rationale as publish. A mid-batch failure leaves
    // at most one post in an ambiguous state, and every earlier success is
    // already durable in memory to be written back at the end.
    for (const p of pending) {
      try {
        const result = await deletePagePost({ postId: p.post_id, pageAccessToken: token })
        recalled.push({
          date: p.date,
          idempotency_key: p.idempotency_key,
          post_id: p.post_id,
          recalled_at: new Date().toISOString(),
          already_gone: result.alreadyGone,
        })
      } catch (err) {
        failed.push({
          date: p.date,
          idempotency_key: p.idempotency_key,
          error: errorMessage(err),
          failed_at: new Date().toISOString(),
        })
      }
    }

    // Build the updated receipt: successful recalls move out of `published[]`
    // into a new `recalled[]`. Failures leave `published[]` unchanged so the
    // caller can see they're still live and retry.
    const recalledKeys = new Set(recalled.map((r) => r.idempotency_key))
    const nextReceipt: CampaignDailyPublishMeta = {
      ...row.publishMeta,
      published: row.publishMeta.published.filter((p) => !recalledKeys.has(p.idempotency_key)),
      recalled: [...(row.publishMeta.recalled ?? []), ...recalled],
    }

    const nextPlanData: CampaignDailyPlanData = { ...row.planData, publish_meta: nextReceipt }
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('social_plans')
      .update({ plan_data: nextPlanData })
      .eq('id', row.id)
      .eq('client_id', clientId)
      // Compare-and-set on the request_id we loaded: if a concurrent recall or
      // publish changed the receipt, our write silently no-ops and the caller
      // sees NOTHING_UPDATED — safer than clobbering the newer receipt.
      .eq('plan_data->publish_meta->>request_id', row.publishMeta.request_id)
      .select('id')

    if (updateError) throw updateError
    if (!updated || updated.length === 0) {
      return conflict('CONCURRENT_MODIFICATION', {
        request_id: row.publishMeta.request_id,
      })
    }

    // A recalled post must never be published again by the automatic publisher.
    // Mark its dates as blocked; if that write fails the recall itself still
    // stands (the post is gone), but the response says so loudly — the automatic
    // publisher also treats `recalled[]` on the receipt as final.
    let autoPublishTombstone: { status: 'OK'; tombstoned: number } | { status: 'FAILED'; detail: string } = {
      status: 'OK',
      tombstoned: 0,
    }
    if (recalled.length > 0 || already_recalled.length > 0) {
      try {
        const marked = await tombstoneRecalledDates({
          clientId,
          planId: row.id,
          dates: Array.from(new Set([...recalled.map((r) => r.date), ...already_recalled.map((r) => r.date)])),
        })
        autoPublishTombstone = { status: 'OK', tombstoned: marked.tombstoned }
      } catch (err) {
        console.error('[daily-plan recall] auto-publish tombstone failed', errorMessage(err))
        autoPublishTombstone = { status: 'FAILED', detail: 'tombstone write failed; see server log' }
      }
    }

    return NextResponse.json({
      success: true,
      status: failed.length === 0 ? 'RECALLED' : recalled.length === 0 ? 'FAILED' : 'PARTIAL',
      request_id: randomUUID(),
      recalled,
      failed,
      already_recalled,
      not_published,
      auto_publish_tombstone: autoPublishTombstone,
      auto_publish_records: autoPublishRecords,
      ...(autoPublishNote ? { auto_publish_note: autoPublishNote } : {}),
      ...(autoPublishTombstone.status === 'FAILED'
        ? { warning: '撤回成功，但没能在自动发布里把这些日期标成「已撤回」。请不要重新授权这些日期，并立刻告知开发。' }
        : {}),
    })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: 'RECALL_FAILED', detail: errorMessage(err) },
      { status: 500 },
    )
  }
}
