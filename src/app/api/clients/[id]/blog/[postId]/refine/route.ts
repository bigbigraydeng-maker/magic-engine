/**
 * POST /api/clients/[id]/blog/[postId]/refine
 *
 * FDE-directed conversational editing of an existing blog post. The FDE sends
 * a natural-language instruction (knowledge from real customer conversations);
 * Claude refines the article while staying consistent with the Master Brief
 * and the active Campaign.
 *
 * Body: { message: string, history?: { role, content }[] }
 * Returns: { success, post, assistant_reply }
 *
 * Security: Bearer token (INTERNAL_API_KEY).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { refineBlogPost } from '@/lib/blog/refiner'
import type { ChatMessage, BlogRefineContent } from '@/lib/blog/refiner'
import { countWords } from '@/lib/blog/generator'
import { getActiveBrief, formatBriefForPrompt } from '@/lib/content/brief-injector'
import { getActiveCampaigns, formatCampaignForPrompt } from '@/lib/content/campaign-injector'
import type { BlogPost } from '@/types/magic-engine'

/** Cap on client-supplied chat history turns to bound prompt size. */
const MAX_HISTORY = 12
/** Per-instruction character cap — bounds prompt size, cost and injection surface. */
const MAX_MESSAGE_CHARS = 2000
/** Per-history-turn character cap. */
const MAX_TURN_CHARS = 4000

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } },
) {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { postId } = params
    const body = (await req.json()) as { message?: string; history?: unknown }

    const message = (body.message ?? '').trim().slice(0, MAX_MESSAGE_CHARS)
    if (!message) {
      return NextResponse.json({ success: false, error: 'message is required' }, { status: 400 })
    }

    // Sanitise client-supplied chat history — shape-checked, count- and length-capped.
    const history: ChatMessage[] = Array.isArray(body.history)
      ? (body.history as unknown[])
          .filter((m): m is ChatMessage =>
            !!m && typeof m === 'object' &&
            ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
            typeof (m as ChatMessage).content === 'string')
          .slice(-MAX_HISTORY)
          .map(m => ({ role: m.role, content: m.content.slice(0, MAX_TURN_CHARS) }))
      : []

    // 1. Load the post (ownership check via client_id)
    const { data: post, error: postErr } = await supabaseAdmin
      .from('blog_posts')
      .select('*')
      .eq('id', postId)
      .eq('client_id', clientId)
      .single<BlogPost>()

    if (postErr || !post) {
      if (postErr) console.error('[blog/:postId/refine] post fetch error:', postErr)
      return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 })
    }

    // 2. Load Master Brief + active Campaign — always injected so refinement stays on-brand.
    const [brief, campaigns] = await Promise.all([
      getActiveBrief(clientId).catch(() => null),
      getActiveCampaigns(clientId).catch(() => []),
    ])
    const briefText = brief ? formatBriefForPrompt(brief) : 'No brand brief on file.'
    const campaignText = campaigns[0] ? formatCampaignForPrompt(campaigns[0]) : undefined

    // 3. Refine via Claude
    const current: BlogRefineContent = {
      title:            post.title ?? '',
      meta_title:       post.meta_title ?? '',
      meta_description: post.meta_description ?? '',
      html_body:        post.html_body ?? '',
    }
    const { updated, assistantReply } = await refineBlogPost({
      current,
      briefText,
      campaignText,
      history,
      userMessage: message,
    })

    // 4. Persist refined content (slug left untouched — never break the post URL)
    const { data: saved, error: updateErr } = await supabaseAdmin
      .from('blog_posts')
      .update({
        title:            updated.title,
        meta_title:       updated.meta_title,
        meta_description: updated.meta_description,
        html_body:        updated.html_body,
        word_count:       countWords(updated.html_body),
      })
      .eq('id', postId)
      .eq('client_id', clientId)
      .select('*')
      .single<BlogPost>()

    if (updateErr || !saved) {
      console.error('[blog/:postId/refine] update error:', updateErr)
      return NextResponse.json({ success: false, error: 'Failed to save refined post' }, { status: 500 })
    }

    return NextResponse.json({ success: true, post: saved, assistant_reply: assistantReply })
  } catch (err: unknown) {
    console.error('[blog/:postId/refine] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}
