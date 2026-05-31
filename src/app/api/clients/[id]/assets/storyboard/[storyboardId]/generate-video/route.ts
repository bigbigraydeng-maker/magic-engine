/**
 * POST /api/clients/[id]/assets/storyboard/[storyboardId]/generate-video
 *
 * Phase 21.B — Asset Storyboard → Seedance Video
 *
 * Creates a reels_draft from the storyboard's hook/cta assets + seedance_prompt,
 * submits to Atlas Seedance 2.0 I2V, and links back via asset_storyboards.reels_draft_id.
 *
 * Returns: { success, job_id, draft_id }
 * Poll: GET /api/clients/[id]/reels/[draftId]/video-status
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { submitI2VGeneration } from '@/lib/visual/seedance'

type RouteContext = { params: { id: string; storyboardId: string } }

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId, storyboardId } = params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  // Optional body params (mirrors reels/generate-video)
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
    // 1. Load storyboard
    const { data: storyboard, error: sbErr } = await supabaseAdmin
      .from('asset_storyboards')
      .select('id, seedance_prompt, hook_asset_id, cta_asset_id, reels_draft_id')
      .eq('id', storyboardId)
      .eq('client_id', clientId)
      .single()

    if (sbErr || !storyboard) {
      return NextResponse.json({ success: false, error: 'Storyboard not found' }, { status: 404 })
    }

    if (!storyboard.seedance_prompt) {
      return NextResponse.json({ success: false, error: 'No Seedance prompt found on this storyboard' }, { status: 400 })
    }

    // If already linked to a draft that is generating/ready, return it
    if (storyboard.reels_draft_id) {
      const { data: existing } = await supabaseAdmin
        .from('reels_drafts')
        .select('id, status, video_url, provider_job_id')
        .eq('id', storyboard.reels_draft_id)
        .single()

      if (existing && (existing.status === 'video_generating' || existing.status === 'video_ready')) {
        return NextResponse.json({
          success: true,
          job_id: existing.provider_job_id ?? null,
          draft_id: existing.id,
          status: existing.status,
          video_url: existing.video_url ?? null,
          message: existing.status === 'video_ready' ? 'Video already ready.' : 'Video generation already in progress.',
        })
      }
    }

    // 2. Load hook + cta asset URLs
    const { data: hookAsset } = await supabaseAdmin
      .from('client_assets')
      .select('storage_url')
      .eq('id', storyboard.hook_asset_id)
      .single()

    const { data: ctaAsset } = await supabaseAdmin
      .from('client_assets')
      .select('storage_url')
      .eq('id', storyboard.cta_asset_id)
      .single()

    if (!hookAsset?.storage_url) {
      return NextResponse.json({ success: false, error: 'Hook asset not found or missing URL' }, { status: 400 })
    }

    const openingUrl = hookAsset.storage_url
    const closingUrl = ctaAsset?.storage_url ?? hookAsset.storage_url

    // 3. Create reels_draft linking this storyboard
    const { data: draft, error: draftErr } = await supabaseAdmin
      .from('reels_drafts')
      .insert({
        client_id:          clientId,
        opening_frame_url:  openingUrl,
        closing_frame_url:  closingUrl,
        i2v_video_prompt:   storyboard.seedance_prompt,
        status:             'draft',
      })
      .select('id')
      .single()

    if (draftErr || !draft) {
      throw new Error(draftErr?.message ?? 'Failed to create reels draft')
    }

    // 4. Submit to Atlas Seedance 2.0
    const { job_id } = await submitI2VGeneration({
      prompt:            storyboard.seedance_prompt,
      opening_frame_url: openingUrl,
      closing_frame_url: closingUrl,
      duration,
      resolution,
      aspect_ratio:      '9:16',
      generate_audio,
    })

    // 5. Update draft status
    await supabaseAdmin
      .from('reels_drafts')
      .update({ status: 'video_generating', provider_job_id: job_id })
      .eq('id', draft.id)

    // 6. Link storyboard → draft
    await supabaseAdmin
      .from('asset_storyboards')
      .update({ reels_draft_id: draft.id })
      .eq('id', storyboardId)

    return NextResponse.json({
      success: true,
      job_id,
      draft_id: draft.id,
      message: 'Video Studio is generating your video. Poll /api/clients/[id]/reels/[draftId]/video-status.',
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[assets/storyboard/generate-video] error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
