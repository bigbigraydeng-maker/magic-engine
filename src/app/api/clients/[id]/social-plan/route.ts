/**
 * POST /api/clients/[id]/social-plan
 *
 * Generate a Facebook social content plan (strategy + reels + posts + stories)
 * from Master Brief + optional Campaign Brief.
 *
 * Body: { campaign_brief_id?: string }
 * Returns: { success: true, plan: SocialPlanOutput }
 */
import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { supabaseAdmin } from '@/lib/supabase'
import { formatBriefForPrompt } from '@/lib/content/brief-injector'
import { formatCampaignForPrompt, getCampaignById } from '@/lib/content/campaign-injector'
import {
  generateChannelStrategy,
  generateReelsScripts,
  generatePosts,
  generateStories,
} from '@/lib/social/social-plan-templates'
import type { SocialPlanOutput } from '@/lib/social/social-plan-templates'
import { evaluate } from '@/lib/content/quality-rubric'
import type { RubricContext } from '@/lib/content/quality-rubric'
import type { MasterBrief } from '@/types/magic-engine'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const clientId = params.id

  try {
    const body = await req.json().catch(() => ({})) as { campaign_brief_id?: string }

    // 1. Fetch active master brief
    const { data: brief, error: briefErr } = await supabaseAdmin
      .from('master_briefs')
      .select('*')
      .eq('client_id', clientId)
      .or('status.eq.active,is_active.eq.true')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (briefErr) throw briefErr
    if (!brief) {
      return NextResponse.json(
        { success: false, error: 'No active Master Brief found. Please set up the brand brief first.' },
        { status: 400 }
      )
    }

    // 2. Optionally fetch campaign brief
    let campaignText: string | undefined
    let campaignMeta: RubricContext['campaign'] = null

    if (body.campaign_brief_id) {
      const campaign = await getCampaignById(clientId, body.campaign_brief_id)
      if (campaign) {
        campaignText = formatCampaignForPrompt(campaign)
        campaignMeta = {
          title:                  campaign.title ?? null,
          offer:                  campaign.offer ?? null,
          primary_cta:            campaign.primary_cta ?? null,
          campaign_angle:         campaign.campaign_angle ?? null,
          target_audience_detail: campaign.target_audience_detail ?? null,
        }
      }
    }

    // 3. Build brief text
    const briefText = formatBriefForPrompt(brief as unknown as MasterBrief)

    // 4. Strategy first, then parallel content generation
    const strategy = await generateChannelStrategy(briefText, campaignText)
    const [reels, posts, stories] = await Promise.all([
      generateReelsScripts(strategy, briefText, campaignText),
      generatePosts(strategy, briefText, campaignText),
      generateStories(strategy, briefText, campaignText),
    ])

    // 5. Quality rubric on each post — silent failure, non-blocking verdict
    const apiKey = process.env.OPENAI_API_KEY
    if (apiKey) {
      const openai = new OpenAI({ apiKey })
      const rubricCtx: RubricContext = {
        brief: {
          brand_name:       (brief as unknown as MasterBrief).brand_name ?? null,
          tone:             (brief as unknown as MasterBrief).tone ?? null,
          avoid_words:      Array.isArray(brief.avoid_words) ? brief.avoid_words : null,
          platforms:        Array.isArray(brief.platforms) ? brief.platforms : null,
          primary_audience: (brief as unknown as MasterBrief).primary_audience ?? null,
        },
        campaign:     campaignMeta,
        platform:     'facebook',
        contentType:  'social_a',
        primaryKeyword: campaignMeta?.title ?? null,
      }

      await Promise.all(
        posts.map(post =>
          evaluate(post.copy, rubricCtx, { llmClient: openai })
            .catch(err => {
              console.warn('[social-plan] quality rubric (non-blocking):', err)
              return null
            })
        )
      )
    }

    const plan: SocialPlanOutput = { strategy, reels, posts, stories }
    return NextResponse.json({ success: true, plan })

  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : JSON.stringify(err)
    console.error('[social-plan] error:', JSON.stringify(err))
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
