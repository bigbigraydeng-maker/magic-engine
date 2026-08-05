/**
 * POST /api/publer/quick-post
 *
 * Called by SocialPlanSection → LaunchHubScheduler "交付到 Launch Hub".
 * Stages the post as a draft in content_posts so FDE can review it in
 * Launch Hub before the final Publer publish step.
 *
 * Body: { client_id, caption, hashtags?, image_url?, platform, draft_only?, scheduled_at? }
 * draft_only=true → skip scheduled_at requirement, write pure draft
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { judgeOutgoingPost, priceGateMessage } from '@/lib/content/price-claim-gate'

interface QuickPostBody {
  client_id: string
  caption: string
  hashtags?: string[]
  image_url?: string
  platform: string
  draft_only?: boolean
  scheduled_at?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as QuickPostBody
    const { client_id, caption, hashtags, image_url, platform, draft_only, scheduled_at } = body

    if (!client_id?.trim() || !caption?.trim() || !platform) {
      return NextResponse.json(
        { success: false, error: 'client_id, caption, platform are required' },
        { status: 400 },
      )
    }
    if (!draft_only && !scheduled_at) {
      return NextResponse.json(
        { success: false, error: 'scheduled_at is required unless draft_only=true' },
        { status: 400 },
      )
    }

    const access = await requireDashboardClientAccess(client_id)
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status })
    }

    const fullCaption = hashtags?.length
      ? `${caption}\n\n${hashtags.join(' ')}`
      : caption

    // 真价只配真画面 —— 界面上已经挡过一道，这里挡绕过界面直调的路。
    const verdict = await judgeOutgoingPost(supabaseAdmin, {
      clientId: client_id,
      caption:  fullCaption,
      imageUrl: image_url,
    })
    if (verdict.blocked) {
      return NextResponse.json(
        { success: false, error: priceGateMessage(verdict.source), code: 'price_claim_unbacked' },
        { status: 409 },
      )
    }

    const { data: inserted, error } = await supabaseAdmin
      .from('content_posts')
      .insert({
        client_id,
        title:        `${platform} — ${caption.slice(0, 40)}`,
        route:        'route_a',
        platforms:    [platform],
        status:       'draft',
        caption:      fullCaption,
        hashtags:     hashtags ?? [],
        visual_brief: image_url ?? null,
        scheduled_at: scheduled_at ? new Date(scheduled_at).toISOString() : null,
        source:       'kanban',
      })
      .select('id')
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, post_id: (inserted as { id: string }).id })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[publer/quick-post]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
