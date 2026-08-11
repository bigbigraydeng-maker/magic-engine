import { requireDashboardClientAccess } from '@/lib/auth/client-access'
/**
 * GET /api/clients/[id]/reels/[draftId]/frame-status?job_id=xxx&frame_type=opening
 *
 * Polls Atlas Cloud for the image generation result.
 * When completed, saves the image URL to the draft's opening_frame_url or
 * closing_frame_url and auto-advances status to "images_ready" if both frames exist.
 *
 * Reference: ROADMAP.md P8.R
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { checkImageStatus } from '@/lib/visual/atlas'
import { uploadFromUrl } from '@/lib/visual/storage'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; draftId: string } }
) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  try {
    const { searchParams } = new URL(req.url)
    const job_id = searchParams.get('job_id')
    const frame_type = searchParams.get('frame_type') as 'opening' | 'closing' | null

    if (!job_id || !frame_type) {
      return NextResponse.json(
        { success: false, error: 'job_id and frame_type query params are required' },
        { status: 400 }
      )
    }
    if (frame_type !== 'opening' && frame_type !== 'closing') {
      return NextResponse.json(
        { success: false, error: 'frame_type must be "opening" or "closing"' },
        { status: 400 }
      )
    }

    const result = await checkImageStatus(job_id)

    // Still pending/processing — tell client to keep polling
    if (result.status !== 'completed' && result.status !== 'failed') {
      return NextResponse.json({ success: true, status: result.status })
    }

    if (result.status === 'failed') {
      return NextResponse.json({
        success: true,
        status: 'failed',
        error: result.error ?? 'Visual Studio generation failed',
      })
    }

    // Completed — upload to Supabase Storage for permanent URL, then save to draft
    const frameUrlField = frame_type === 'opening' ? 'opening_frame_url' : 'closing_frame_url'

    const { storage_url: imageUrl } = await uploadFromUrl({
      sourceUrl: result.image_url!,
      clientId: params.id,
      folder: `reels/${params.draftId}`,
      assetType: 'image',
    })

    // Read the other frame's URL to decide new status
    const { data: current } = await supabaseAdmin
      .from('reels_drafts')
      .select('opening_frame_url, closing_frame_url')
      .eq('id', params.draftId)
      .single()

    const otherUrl = frame_type === 'opening'
      ? current?.closing_frame_url
      : current?.opening_frame_url

    const newStatus = otherUrl ? 'images_ready' : 'draft'

    const { data: draft, error } = await supabaseAdmin
      .from('reels_drafts')
      .update({
        [frameUrlField]: imageUrl,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.draftId)
      .eq('client_id', params.id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({
      success: true,
      status: 'completed',
      frame_url: imageUrl,
      draft,
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[reels/frame-status]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
