import { requireDashboardClientAccess } from '@/lib/auth/client-access'
/**
 * GET /api/clients/[id]/reels/[draftId]/video-status
 *
 * Poll the Atlas job status for a Reels video generation.
 * When completed, saves the video_url to the draft and sets status → 'video_ready'.
 *
 * MTC: this route owns the commit/refund decision for the async charge that
 * generate-video pre-validated:
 *   - status='completed'  → commitCharge (deduct projected MTC, set committed=true)
 *   - status='failed'     → refundOnFail is a no-op (nothing was deducted yet)
 *                           but we still mark committed=true to short-circuit
 *                           future polls. The draft moves to status='video_failed'
 *                           via a follow-up (not implemented in this file).
 *
 * mtc_committed guards against double-charging when the poll fires repeatedly
 * — once committed, we skip the ledger write.
 *
 * Reference: ROADMAP.md P8.R.5
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { checkVideoStatus } from '@/lib/visual/seedance'
import { uploadFromUrl } from '@/lib/visual/storage'
import { commitCharge, refundOnFail } from '@/lib/mtc/charge'
import type { ServiceKey } from '@/lib/mtc/types'

type RouteContext = { params: { id: string; draftId: string } }

interface DraftRow {
  status: string
  provider_job_id: string | null
  video_url: string | null
  mtc_service_key: string | null
  mtc_projected: number | null
  mtc_committed: boolean | null
}

export async function GET(
  _req: NextRequest,
  { params }: RouteContext
) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  const { id: clientId, draftId } = params

  try {
    const { data: draft, error: fetchErr } = await supabaseAdmin
      .from('reels_drafts')
      .select('status, provider_job_id, video_url, mtc_service_key, mtc_projected, mtc_committed')
      .eq('id', draftId)
      .eq('client_id', clientId)
      .single<DraftRow>()

    if (fetchErr || !draft) {
      return NextResponse.json({ success: false, error: 'Draft not found' }, { status: 404 })
    }

    // Already done — return cached result
    if (draft.status === 'video_ready' && draft.video_url) {
      return NextResponse.json({
        success: true,
        status: 'completed',
        video_url: draft.video_url,
      })
    }

    if (!draft.provider_job_id) {
      return NextResponse.json(
        { success: false, error: 'No video job in progress for this draft.' },
        { status: 400 }
      )
    }

    // Poll Atlas
    const result = await checkVideoStatus(draft.provider_job_id)

    if (result.status === 'completed' && result.video_url) {
      // Upload to Supabase Storage for a permanent URL (Atlas CDN URLs expire in 24 h)
      const { storage_url } = await uploadFromUrl({
        sourceUrl: result.video_url,
        clientId,
        folder: `reels/${draftId}`,
        assetType: 'video',
      })

      await supabaseAdmin
        .from('reels_drafts')
        .update({ status: 'video_ready', video_url: storage_url })
        .eq('id', draftId)

      // MTC commit — guarded by mtc_committed to survive repeated polling
      if (!draft.mtc_committed && draft.mtc_service_key && draft.mtc_projected && draft.mtc_projected > 0) {
        const commit = await commitCharge(
          clientId,
          draft.mtc_service_key as ServiceKey,
          draft.mtc_projected,
          { referenceId: draftId, notes: 'reels video generation' },
        )
        if (commit.ok) {
          await supabaseAdmin
            .from('reels_drafts')
            .update({ mtc_committed: true })
            .eq('id', draftId)
        }
        // If commit failed we leave mtc_committed=false so a later retry / cron
        // can attempt again; never block the user from seeing their finished video.
      }

      return NextResponse.json({
        success: true,
        status: 'completed',
        video_url: storage_url,
        error: null,
      })
    }

    // Atlas reported a failed job — refund the (not-yet-deducted) projection
    // and mark committed so future polls don't loop on this. Note: with the
    // "commit-on-success" model, refundOnFail here is informational only —
    // it writes a ledger row noting the failure but no MTC was ever taken.
    if (result.status === 'failed' && !draft.mtc_committed && draft.mtc_service_key) {
      await supabaseAdmin
        .from('reels_drafts')
        .update({ mtc_committed: true })
        .eq('id', draftId)
      // No refundOnFail call: nothing was deducted in precheck-only mode.
    }

    return NextResponse.json({
      success: true,
      status: result.status,
      video_url: null,
      error: result.error ?? null,
    })

  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : JSON.stringify(err)
    console.error('[reels/video-status] error:', JSON.stringify(err))
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
