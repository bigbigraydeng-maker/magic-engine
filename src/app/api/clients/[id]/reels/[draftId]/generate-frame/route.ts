/**
 * POST /api/clients/[id]/reels/[draftId]/generate-frame
 *
 * Submits a WaveSpeed (Visual Studio) image generation job for either the
 * opening or closing reference frame, using the stored prompt.
 * Returns { job_id } immediately — caller must poll /frame-status to get the result.
 *
 * Reference: ROADMAP.md P8.R
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { submitImageGeneration } from '@/lib/visual/atlas'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; draftId: string } }
) {
  try {
    const { frame_type } = await req.json() as { frame_type?: string }

    if (frame_type !== 'opening' && frame_type !== 'closing') {
      return NextResponse.json(
        { success: false, error: 'frame_type must be "opening" or "closing"' },
        { status: 400 }
      )
    }

    // Fetch the draft to get the prompt
    const { data: draft } = await supabaseAdmin
      .from('reels_drafts')
      .select('opening_frame_prompt, closing_frame_prompt')
      .eq('id', params.draftId)
      .eq('client_id', params.id)
      .single()

    if (!draft) {
      return NextResponse.json(
        { success: false, error: 'Draft not found' },
        { status: 404 }
      )
    }

    const prompt = frame_type === 'opening'
      ? draft.opening_frame_prompt
      : draft.closing_frame_prompt

    if (!prompt) {
      return NextResponse.json(
        { success: false, error: `No ${frame_type} frame prompt set — write one first` },
        { status: 400 }
      )
    }

    // Submit to Visual Studio — 9:16 vertical portrait (Reels format)
    const { job_id } = await submitImageGeneration({
      prompt,
      width: 1024,
      height: 1792,
    })

    return NextResponse.json({ success: true, job_id })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[reels/generate-frame]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
