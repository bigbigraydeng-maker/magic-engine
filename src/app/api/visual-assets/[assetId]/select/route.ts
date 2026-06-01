/**
 * PATCH /api/visual-assets/[assetId]/select
 *
 * Marks one image as the selected "hero" for its content post:
 *   - sets is_selected=true on this asset, false on all siblings of the same post
 *   - mirrors the chosen storage_url into content_posts.visual_brief so Launch
 *     Hub delivery and downstream readers use the selected image
 *
 * The other images stay in visual_assets — the user can re-select any time.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

export async function PATCH(
  _req: NextRequest,
  { params }: { params: { assetId: string } }
) {
  try {
    const { data: asset, error: assetErr } = await supabaseAdmin
      .from('visual_assets')
      .select('id, client_id, post_id, storage_url')
      .eq('id', params.assetId)
      .single()

    if (assetErr || !asset) {
      return NextResponse.json({ success: false, error: 'Asset not found' }, { status: 404 })
    }
    if (!asset.post_id) {
      return NextResponse.json(
        { success: false, error: 'Asset is not linked to a content post' },
        { status: 400 }
      )
    }

    const access = await requireDashboardClientAccess(asset.client_id)
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status })
    }

    // Clear selection on every image of this post, then select this one.
    const { error: clearErr } = await supabaseAdmin
      .from('visual_assets')
      .update({ is_selected: false })
      .eq('post_id', asset.post_id)
      .eq('asset_type', 'image')

    if (clearErr) throw clearErr

    const { error: setErr } = await supabaseAdmin
      .from('visual_assets')
      .update({ is_selected: true })
      .eq('id', asset.id)

    if (setErr) throw setErr

    // Mirror into content_posts.visual_brief (best-effort — selection already saved).
    if (asset.storage_url) {
      await supabaseAdmin
        .from('content_posts')
        .update({ visual_brief: asset.storage_url })
        .eq('id', asset.post_id)
        .then(({ error }) => {
          if (error) console.error('[visual-assets/select] visual_brief mirror failed:', error)
        })
    }

    return NextResponse.json({ success: true, asset_id: asset.id })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[visual-assets/select]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
