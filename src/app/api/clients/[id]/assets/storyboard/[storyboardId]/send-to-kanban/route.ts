/**
 * POST /api/clients/[id]/assets/storyboard/[storyboardId]/send-to-kanban
 *
 * Phase 21.B — Send storyboard to Reels Kanban
 *
 * Creates a reels_draft from an existing asset_storyboard:
 *   - opening_frame_url   ← hook asset storage_url
 *   - closing_frame_url   ← cta asset storage_url
 *   - middle_frame_urls   ← middle asset storage_urls
 *   - i2v_video_prompt    ← storyboard.seedance_prompt
 *   - source_storyboard_id ← storyboard.id  (traceability)
 *
 * Returns { success, draft_id } so the UI can link to Launch Hub.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

type RouteContext = { params: { id: string; storyboardId: string } }

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId, storyboardId } = params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  // 1. Load the storyboard
  const { data: sb, error: sbErr } = await supabaseAdmin
    .from('asset_storyboards')
    .select('id, client_id, hook_asset_id, cta_asset_id, middle_asset_ids, seedance_prompt')
    .eq('id', storyboardId)
    .eq('client_id', clientId)
    .single()

  if (sbErr || !sb) {
    return NextResponse.json({ success: false, error: 'Storyboard not found' }, { status: 404 })
  }

  // 2. Look up storage_urls for all assets in one query
  const allAssetIds = [sb.hook_asset_id, sb.cta_asset_id, ...(sb.middle_asset_ids ?? [])]
    .filter(Boolean) as string[]

  const { data: assets, error: assetsErr } = await supabaseAdmin
    .from('client_assets')
    .select('id, storage_url')
    .in('id', allAssetIds)

  if (assetsErr) {
    return NextResponse.json({ success: false, error: assetsErr.message }, { status: 500 })
  }

  const urlMap = new Map((assets ?? []).map(a => [a.id, a.storage_url]))

  const openingFrameUrl = urlMap.get(sb.hook_asset_id) ?? null
  const closingFrameUrl = urlMap.get(sb.cta_asset_id)  ?? null
  const middleFrameUrls = (sb.middle_asset_ids ?? [])
    .map((id: string) => urlMap.get(id))
    .filter(Boolean) as string[]

  // 3. Create the reels_draft
  const { data: draft, error: draftErr } = await supabaseAdmin
    .from('reels_drafts')
    .insert({
      client_id:            clientId,
      source_storyboard_id: sb.id,
      i2v_video_prompt:     sb.seedance_prompt ?? '',
      opening_frame_url:    openingFrameUrl,
      closing_frame_url:    closingFrameUrl,
      middle_frame_urls:    middleFrameUrls,
      status:               'draft',
    })
    .select('id')
    .single()

  if (draftErr || !draft) {
    return NextResponse.json({ success: false, error: draftErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true, draft_id: draft.id }, { status: 201 })
}
