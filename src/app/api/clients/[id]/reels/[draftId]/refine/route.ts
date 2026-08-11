import { requireDashboardClientAccess } from '@/lib/auth/client-access'
/**
 * POST /api/clients/[id]/reels/[draftId]/refine
 *
 * Chat-style refinement: user sends a natural-language instruction,
 * Claude updates one or more of the four content fields.
 * Appends the exchange to chat_history in the draft row.
 *
 * Body: { message: string }
 * Reference: ROADMAP.md P8.R.5
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { refineReelsContent } from '@/lib/reels/generator'
import type { ReelsContent, ChatMessage } from '@/lib/reels/generator'

type RouteContext = { params: { id: string; draftId: string } }

export async function POST(
  req: NextRequest,
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
    const { message } = await req.json() as { message: string }

    if (!message?.trim()) {
      return NextResponse.json({ success: false, error: 'message is required' }, { status: 400 })
    }

    // 1. Load current draft
    const { data: draft, error: fetchErr } = await supabaseAdmin
      .from('reels_drafts')
      .select('*')
      .eq('id', draftId)
      .eq('client_id', clientId)
      .single()

    if (fetchErr || !draft) {
      return NextResponse.json({ success: false, error: 'Draft not found' }, { status: 404 })
    }

    const current: ReelsContent = {
      opening_frame_prompt: draft.opening_frame_prompt ?? '',
      closing_frame_prompt: draft.closing_frame_prompt ?? '',
      i2v_video_prompt: draft.i2v_video_prompt ?? '',
      fb_caption: draft.fb_caption ?? '',
    }

    const history: ChatMessage[] = Array.isArray(draft.chat_history)
      ? (draft.chat_history as ChatMessage[])
      : []

    // 2. Call Claude to refine
    const { updated, assistantReply } = await refineReelsContent({
      current,
      history,
      userMessage: message,
    })

    // 3. Append to chat history
    const newHistory: ChatMessage[] = [
      ...history,
      { role: 'user', content: message },
      { role: 'assistant', content: assistantReply },
    ]

    // 4. Persist updated content + chat history
    const { data: savedDraft, error: updateErr } = await supabaseAdmin
      .from('reels_drafts')
      .update({
        opening_frame_prompt: updated.opening_frame_prompt,
        closing_frame_prompt: updated.closing_frame_prompt,
        i2v_video_prompt: updated.i2v_video_prompt,
        fb_caption: updated.fb_caption,
        chat_history: newHistory,
      })
      .eq('id', draftId)
      .eq('client_id', clientId)
      .select()
      .single()

    if (updateErr) throw updateErr

    return NextResponse.json({
      success: true,
      draft: savedDraft,
      assistant_reply: assistantReply,
    })

  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : JSON.stringify(err)
    console.error('[reels/refine] error:', JSON.stringify(err))
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
