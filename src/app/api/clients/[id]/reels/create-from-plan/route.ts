/**
 * POST /api/clients/[id]/reels/create-from-plan
 *
 * Creates a reels_draft pre-populated from a Social Plan Reel entry.
 * Sets opening_frame_prompt = closing_frame_prompt = storyboard_prompt
 * so generate-frame can be called immediately with frame_type=opening.
 * generate-video will use the same image for both frames (closing falls back
 * to opening — see generate-video/route.ts).
 *
 * Body: { storyboard_prompt, i2v_prompt, caption, campaign_brief_id? }
 * Returns: { success: true, draft }
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // 🔒 登录校验:此接口会消耗 AI 额度(生成内容),必须确认调用者有权访问该客户。
  // 此前完全裸奔 —— 知道 client_id 就能匿名反复调用烧钱。admin 直接过,client-viewer 限本人。
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const body = await req.json() as {
      storyboard_prompt?: string
      i2v_prompt?: string
      caption?: string
      campaign_brief_id?: string
    }

    if (!body.storyboard_prompt) {
      return NextResponse.json(
        { success: false, error: 'storyboard_prompt is required' },
        { status: 400 }
      )
    }

    const { data: draft, error } = await supabaseAdmin
      .from('reels_drafts')
      .insert({
        client_id:            params.id,
        campaign_brief_id:    body.campaign_brief_id ?? null,
        opening_frame_prompt: body.storyboard_prompt,
        closing_frame_prompt: body.storyboard_prompt, // same image used as both frames
        i2v_video_prompt:     body.i2v_prompt ?? null,
        fb_caption:           body.caption ?? null,
        status:               'draft',
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, draft })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[reels/create-from-plan]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
