import { requireDashboardClientAccess } from '@/lib/auth/client-access'
/**
 * POST /api/clients/[id]/reels/[draftId]/regenerate-prompt
 *
 * Regenerate i2v_video_prompt for an existing draft.
 * Used when user uploads new reference frames to an old draft and wants fresh script.
 *
 * Reference: ROADMAP.md P8.R (bug fix - dual-frame issue detection)
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  generateReelsContent,
  formatMasterBriefForPrompt,
} from '@/lib/reels/generator'
import { formatCampaignForPrompt } from '@/lib/content/campaign-injector'

export async function POST(
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

  const clientId = params.id
  const draftId = params.draftId

  try {
    // 1. Fetch existing draft to get campaign_brief_id
    const { data: draft, error: draftErr } = await supabaseAdmin
      .from('reels_drafts')
      .select('*')
      .eq('id', draftId)
      .eq('client_id', clientId)
      .single()

    if (draftErr || !draft) {
      return NextResponse.json(
        { success: false, error: 'Draft not found' },
        { status: 404 }
      )
    }

    // 2. Fetch active master brief
    const { data: brief, error: briefErr } = await supabaseAdmin
      .from('master_briefs')
      .select('*')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .maybeSingle()

    if (briefErr) throw briefErr

    if (!brief) {
      return NextResponse.json(
        { success: false, error: 'No active Master Brief found' },
        { status: 400 }
      )
    }

    // 3. Optionally fetch campaign brief if associated
    let campaignContext: string | undefined
    if (draft.campaign_brief_id) {
      const { data: campaign } = await supabaseAdmin
        .from('campaign_briefs')
        .select('title, description, parsed_content, semrush_keywords, valid_from, valid_until, offer, target_audience_detail, proof_points, primary_cta, channel_goal, campaign_angle')
        .eq('id', draft.campaign_brief_id)
        .eq('client_id', clientId)
        .maybeSingle()

      if (campaign) {
        campaignContext = formatCampaignForPrompt(campaign)
      }
    }

    // 4. Generate new content
    const content = await generateReelsContent({
      masterBriefText: formatMasterBriefForPrompt(brief as unknown as Record<string, unknown>),
      campaignContext,
      brandName: brief.brand_name ?? 'the brand',
    })

    // 5. Update only the i2v_video_prompt (keep everything else)
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('reels_drafts')
      .update({ i2v_video_prompt: content.i2v_video_prompt })
      .eq('id', draftId)
      .eq('client_id', clientId)
      .select()
      .single()

    if (updateErr) throw updateErr

    return NextResponse.json({ success: true, draft: updated })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[regenerate-prompt]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
