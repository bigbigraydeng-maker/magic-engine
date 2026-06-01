/**
 * POST /api/clients/[id]/reels/[draftId]/generate-storyboard
 *
 * Generates the 9-panel storyboard image using OpenAI gpt-image-1.
 * Synchronous — no polling needed. Returns the final image URL when done (~10–20s).
 *
 * Uses opening_frame_prompt (set by create-from-plan) as the image prompt.
 * Uploads the result to Supabase Storage and sets:
 *   opening_frame_url = closing_frame_url = <permanent_url>
 *   status → 'images_ready'
 *
 * The caller can then immediately POST to generate-video without any frame polling.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateImage } from '@/lib/visual/openai-images'
import { uploadFromBase64 } from '@/lib/visual/storage'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

type RouteContext = { params: { id: string; draftId: string } }

export async function POST(
  _req: NextRequest,
  { params }: RouteContext,
) {
  const { id: clientId, draftId } = params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  try {
    // 1. Load draft
    const { data: draft, error: fetchErr } = await supabaseAdmin
      .from('reels_drafts')
      .select('opening_frame_prompt, status')
      .eq('id', draftId)
      .eq('client_id', clientId)
      .single()

    if (fetchErr || !draft) {
      return NextResponse.json({ success: false, error: 'Draft not found' }, { status: 404 })
    }

    if (!draft.opening_frame_prompt) {
      return NextResponse.json(
        { success: false, error: 'opening_frame_prompt is required — create the draft via create-from-plan first.' },
        { status: 400 },
      )
    }

    // 2. Generate storyboard image via gpt-image-1 (synchronous, ~10–20s)
    const { b64 } = await generateImage({
      prompt: draft.opening_frame_prompt,
      aspect_ratio: '9:16', // 1024×1536 portrait — storyboard is a tall document
    })

    // 3. Upload to Supabase Storage for a permanent URL
    const { storage_url: imageUrl } = await uploadFromBase64({
      base64: b64,
      clientId,
      folder: `reels/${draftId}`,
      assetType: 'image',
    })

    // 4. Update draft — same image used for both opening and closing frames
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('reels_drafts')
      .update({
        opening_frame_url: imageUrl,
        closing_frame_url: imageUrl,
        status: 'images_ready',
        updated_at: new Date().toISOString(),
      })
      .eq('id', draftId)
      .eq('client_id', clientId)
      .select()
      .single()

    if (updateErr) throw updateErr

    return NextResponse.json({
      success: true,
      image_url: imageUrl,
      draft: updated,
    })

  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : JSON.stringify(err)
    console.error('[reels/generate-storyboard] error:', JSON.stringify(err))
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
