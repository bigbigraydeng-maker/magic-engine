/**
 * POST /api/clients/[id]/social-plan
 *
 * Generate a Facebook social content plan (strategy + reels + posts + stories)
 * from Master Brief + Campaign Brief + viral reference library.
 *
 * Body: { campaign_brief_id: string }   ← required; 400 if missing
 * Returns: { success: true, plan: SocialPlanOutput, plan_id: string }
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

// ─── Viral reference row shape (partial select) ────────────────────────────────

interface ViralRef {
  style_scores:      Record<string, number> | null
  style_tags:        string[] | null
  style_description: string | null
  key_techniques:    string[] | null
  persona_fit:       string[] | null
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatViralInsights(refs: ViralRef[]): string {
  if (refs.length === 0) return ''
  const lines = refs.map((r, i) => {
    const desc       = r.style_description ?? 'N/A'
    const techniques = r.key_techniques?.join(', ') ?? 'N/A'
    const tags       = r.style_tags?.join(', ') ?? 'N/A'
    return `Ref ${i + 1}: ${desc}. Techniques: ${techniques}. Tags: ${tags}.`
  })
  return `VIRAL REFERENCE INSIGHTS (study these — mirror what works):\n${lines.join('\n')}`
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const clientId = params.id

  try {
    const body = await req.json().catch(() => ({})) as { campaign_brief_id?: string }

    // ── Update 3: campaign_brief_id is required ────────────────────────────────
    if (!body.campaign_brief_id) {
      return NextResponse.json(
        { success: false, error: 'Social Plan must be tied to a Campaign. Please select a campaign first.' },
        { status: 400 }
      )
    }

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

    // 2. Fetch campaign brief
    const campaign = await getCampaignById(clientId, body.campaign_brief_id)
    if (!campaign) {
      return NextResponse.json(
        { success: false, error: 'Campaign Brief not found or does not belong to this client.' },
        { status: 400 }
      )
    }
    const campaignText = formatCampaignForPrompt(campaign)
    const campaignMeta: RubricContext['campaign'] = {
      title:                  campaign.title ?? null,
      offer:                  campaign.offer ?? null,
      primary_cta:            campaign.primary_cta ?? null,
      campaign_angle:         campaign.campaign_angle ?? null,
      target_audience_detail: campaign.target_audience_detail ?? null,
    }

    // ── Update 1: viral reference library (best-effort, silent on error) ───────
    let viralInsightsText = ''
    try {
      const { data: viralRefs } = await supabaseAdmin
        .from('viral_reference_library')
        .select('style_scores, style_tags, style_description, key_techniques, persona_fit')
        .eq('analysis_status', 'done')
        .order('analyzed_at', { ascending: false })
        .limit(3)

      if (viralRefs && viralRefs.length > 0) {
        viralInsightsText = formatViralInsights(viralRefs as ViralRef[])
      }
    } catch (viralErr) {
      console.warn('[social-plan] viral_reference_library fetch failed (non-blocking):', viralErr)
    }

    // 3. Build brief text
    const briefText = formatBriefForPrompt(brief as unknown as MasterBrief)

    // 4. Strategy first, then parallel content generation
    const strategy = await generateChannelStrategy(briefText, campaignText)
    const [reels, posts, stories] = await Promise.all([
      generateReelsScripts(strategy, briefText, campaignText, viralInsightsText),
      generatePosts(strategy, briefText, campaignText),
      generateStories(strategy, briefText, campaignText),
    ])

    // 5. Quality rubric on each post — silent failure, non-blocking
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
        campaign:      campaignMeta,
        platform:      'facebook',
        contentType:   'social_a',
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

    // ── Update 2: persist to social_plans ─────────────────────────────────────
    const plan: SocialPlanOutput = { strategy, reels, posts, stories }

    const { data: savedPlan, error: insertErr } = await supabaseAdmin
      .from('social_plans')
      .insert({
        client_id:   clientId,
        campaign_id: body.campaign_brief_id,
        platform:    'facebook',
        wave_number: 1,
        plan_data:   plan,
      })
      .select('id')
      .single()

    if (insertErr) throw insertErr

    return NextResponse.json({ success: true, plan, plan_id: savedPlan.id })

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
