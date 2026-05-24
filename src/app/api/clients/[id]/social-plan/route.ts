/**
 * GET  /api/clients/[id]/social-plan?campaign_id=<uuid>
 *
 * Returns the 5 most recent social plans for this client.
 * If campaign_id is provided, filters to that campaign only.
 * Returns: { success: true, plans: { id, campaign_id, wave_number, created_at, plan_data }[] }
 *
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
  DEFAULT_CONFIG,
} from '@/lib/social/social-plan-templates'
import type { SocialPlanOutput, GenerationConfig } from '@/lib/social/social-plan-templates'
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
  view_count?:       number | null
  video_title?:      string | null
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}

/**
 * Formats viral reference data into a structured block for injection into the
 * Reels generation prompt. Includes Style Scores so SYSTEM_REELS can map them
 * directly to Seedance prompt fields (pacing, music arc, color grade, etc.).
 */
function formatViralInsights(refs: ViralRef[]): string {
  if (refs.length === 0) return ''
  const blocks = refs.map((r, i) => {
    const viewBadge  = r.view_count ? ` [${fmtViews(r.view_count)} views]` : ''
    const titlePart  = r.video_title ? ` "${r.video_title}"` : ''
    const desc       = r.style_description ?? 'N/A'
    const techniques = r.key_techniques?.join(', ') ?? 'N/A'
    const tags       = r.style_tags?.join(', ') ?? 'N/A'
    const personas   = r.persona_fit?.join(', ') ?? 'N/A'
    const scores     = r.style_scores
      ? Object.entries(r.style_scores)
          .map(([k, v]) => `${k}:${v}/10`)
          .join(' | ')
      : null

    const lines = [
      `REF ${i + 1}${titlePart}${viewBadge}: ${desc}`,
      `  Key Techniques : ${techniques}`,
      `  Style Tags     : ${tags}`,
      `  Target Persona : ${personas}`,
    ]
    if (scores) lines.push(`  Style Scores   : ${scores}`)
    return lines.join('\n')
  })
  return [
    'VIRAL REFERENCE INSIGHTS (mirror what works in your seedance_i2v_prompt):',
    ...blocks,
  ].join('\n\n')
}

// ─── GET: plan history ─────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const clientId = params.id
  const { searchParams } = new URL(req.url)
  const campaignId = searchParams.get('campaign_id')

  try {
    let query = supabaseAdmin
      .from('social_plans')
      .select('id, campaign_id, wave_number, created_at, plan_data')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(5)

    if (campaignId) {
      query = query.eq('campaign_id', campaignId)
    }

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ success: true, plans: data ?? [] })
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : JSON.stringify(err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// ─── POST: generate plan ───────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const clientId = params.id

  try {
    const body = await req.json().catch(() => ({})) as {
      campaign_brief_id?: string
      platform?:          string
      reels_count?:       number
      posts_count?:       number
      stories_count?:     number
      angle_focus?:       string
    }

    // ── campaign_brief_id is required ─────────────────────────────────────────
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

    // ── Viral reference library (best-effort, silent on error) ──────────────
    // Strategy:
    //   1. Fetch client's industry so we find relevant viral references
    //   2. Filter by industry + most viral (view_count DESC)
    //   3. If no industry match, fall back to global top references
    //   4. Include style_scores + persona_fit so AI can map scores to Seedance fields
    let viralInsightsText = ''
    try {
      const SELECT_FIELDS = 'style_scores, style_tags, style_description, key_techniques, persona_fit, view_count, video_title'

      // Step 1: get client's industry for targeted matching
      const { data: clientRow } = await supabaseAdmin
        .from('clients')
        .select('industry')
        .eq('id', clientId)
        .maybeSingle()
      const industry = clientRow?.industry ?? null

      // Step 2: industry-filtered query (most viral first)
      let refs: ViralRef[] | null = null
      if (industry) {
        const { data } = await supabaseAdmin
          .from('viral_reference_library')
          .select(SELECT_FIELDS)
          .eq('analysis_status', 'done')
          .eq('industry', industry)
          .order('view_count', { ascending: false, nullsFirst: false })
          .limit(3)
        refs = (data as ViralRef[]) ?? null
      }

      // Step 3: fallback to global top refs if industry filter yielded nothing
      if (!refs || refs.length === 0) {
        const { data } = await supabaseAdmin
          .from('viral_reference_library')
          .select(SELECT_FIELDS)
          .eq('analysis_status', 'done')
          .order('view_count', { ascending: false, nullsFirst: false })
          .limit(3)
        refs = (data as ViralRef[]) ?? null
      }

      if (refs && refs.length > 0) {
        viralInsightsText = formatViralInsights(refs)
      }
    } catch (viralErr) {
      console.warn('[social-plan] viral_reference_library fetch failed (non-blocking):', viralErr)
    }

    // 3. Build brief text
    const briefText = formatBriefForPrompt(brief as unknown as MasterBrief)

    // 3b. Build generation config — FDE values override defaults
    const genConfig: GenerationConfig = {
      platform:      (body.platform === 'instagram' || body.platform === 'tiktok')
                       ? body.platform : DEFAULT_CONFIG.platform,
      reels_count:   (typeof body.reels_count   === 'number' && body.reels_count   >= 1 && body.reels_count   <= 5)  ? body.reels_count   : DEFAULT_CONFIG.reels_count,
      posts_count:   (typeof body.posts_count   === 'number' && body.posts_count   >= 0 && body.posts_count   <= 10) ? body.posts_count   : DEFAULT_CONFIG.posts_count,
      stories_count: (typeof body.stories_count === 'number' && body.stories_count >= 0 && body.stories_count <= 5)  ? body.stories_count : DEFAULT_CONFIG.stories_count,
      ...(body.angle_focus ? { angle_focus: body.angle_focus } : {}),
    }

    // 4. Strategy first, then parallel content generation
    const strategy = await generateChannelStrategy(briefText, campaignText, genConfig)
    const [reels, posts, stories] = await Promise.all([
      generateReelsScripts(strategy, briefText, campaignText, viralInsightsText, genConfig),
      generatePosts(strategy, briefText, campaignText, genConfig),
      generateStories(strategy, briefText, campaignText, genConfig),
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
