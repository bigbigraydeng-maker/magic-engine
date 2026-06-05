/**
 * POST /api/clients/[id]/reels/[draftId]/generate-video
 *
 * Triggers Atlas Seedance 2.0 Image-to-Video generation.
 * Requires both opening_frame_url and closing_frame_url to be set.
 * Stores the Atlas job_id in the draft row and sets status → 'video_generating'.
 *
 * Reference: ROADMAP.md P8.R.5
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { submitI2VGeneration } from '@/lib/visual/seedance'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { precheckCharge } from '@/lib/mtc/charge'
import type { ServiceKey } from '@/lib/mtc/types'

/** Map (resolution, duration) → MTC ServiceKey. 1080p is FDE-only (no key). */
function resolveServiceKey(resolution: '480p' | '720p' | '1080p', duration: number): ServiceKey | null {
  if (resolution === '480p' && duration === 6) return 'reels_480p_6s'
  if (resolution === '720p' && duration === 6) return 'reels_720p_6s'
  if (resolution === '720p' && duration === 10) return 'reels_720p_10s'
  if (resolution === '720p' && duration === 15) return 'reels_720p_15s'
  return null  // 1080p or unsupported combo — not in MTC table
}

type RouteContext = { params: { id: string; draftId: string } }

export async function POST(
  req: NextRequest,
  { params }: RouteContext
) {
  const { id: clientId, draftId } = params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  // Optional body params: duration, resolution, generate_audio
  let duration = 15
  let resolution: '480p' | '720p' | '1080p' = '720p'
  let generate_audio = false
  try {
    const body = await req.json() as { duration?: number; resolution?: string; generate_audio?: boolean }
    if (body.duration && [6, 10, 15].includes(body.duration)) duration = body.duration
    if (body.resolution === '480p') resolution = '480p'
    else if (body.resolution === '1080p') resolution = '1080p'
    if (body.generate_audio === true) generate_audio = true
  } catch { /* body is optional */ }

  try {
    // 1. Load draft
    const { data: draft, error: fetchErr } = await supabaseAdmin
      .from('reels_drafts')
      .select('*')
      .eq('id', draftId)
      .eq('client_id', clientId)
      .single()

    if (fetchErr || !draft) {
      return NextResponse.json({ success: false, error: 'Draft not found' }, { status: 404 })
    }

    if (!draft.opening_frame_url) {
      return NextResponse.json(
        { success: false, error: 'Opening frame must be generated before creating video.' },
        { status: 400 }
      )
    }

    if (!draft.i2v_video_prompt) {
      return NextResponse.json(
        { success: false, error: 'Video prompt is required. Generate or write the prompt first.' },
        { status: 400 }
      )
    }

    if (draft.status === 'video_generating') {
      return NextResponse.json(
        { success: false, error: 'Video generation already in progress.' },
        { status: 409 }
      )
    }

    // 2. MTC precheck — validate balance/budget upfront; commit happens in
    //    video-status when the Atlas job completes. 1080p has no MTC key and
    //    skips this guard (FDE-only mode).
    const serviceKey = resolveServiceKey(resolution, duration)
    let projectedMtc: number | null = null
    if (serviceKey) {
      const charge = await precheckCharge(clientId, serviceKey, { referenceId: draftId })
      if (!charge.ok) {
        return NextResponse.json(charge.body, { status: charge.status })
      }
      projectedMtc = charge.projectedMtc
    }

    // 3. Submit I2V job to Atlas
    const { job_id } = await submitI2VGeneration({
      prompt: draft.i2v_video_prompt,
      opening_frame_url: draft.opening_frame_url,
      closing_frame_url: draft.closing_frame_url ?? draft.opening_frame_url,
      duration,
      resolution,
      aspect_ratio: '9:16',
      generate_audio,
    })

    // 4. Update draft status + record projected MTC for the worker to commit
    const { error: updateErr } = await supabaseAdmin
      .from('reels_drafts')
      .update({
        status: 'video_generating',
        provider_job_id: job_id,
        mtc_service_key: serviceKey,
        mtc_projected:   projectedMtc,
        mtc_committed:   false,
      })
      .eq('id', draftId)

    if (updateErr) throw updateErr

    return NextResponse.json({
      success: true,
      job_id,
      message: 'Video Studio is generating your Reel. Poll /video-status to check progress.',
    })

  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : JSON.stringify(err)
    console.error('[reels/generate-video] error:', JSON.stringify(err))
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
