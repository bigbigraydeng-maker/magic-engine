/**
 * POST /api/clients/[id]/reels/generate
 *
 * Generate initial Reels content (4 fields) from Master Brief + optional Campaign Brief.
 * Creates a new reels_draft row and returns it with the generated content.
 * Applies quality rubric with up to 2 retries; writes quality_score + snapshot.
 *
 * Body: { campaign_brief_id?: string }
 * Reference: ROADMAP.md P8.R.5, P12.Q.5
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  generateReelsContent,
  formatMasterBriefForPrompt,
} from '@/lib/reels/generator'
import type { ReelsContent } from '@/lib/reels/generator'
import { formatCampaignForPrompt } from '@/lib/content/campaign-injector'
import { auditReelsDraft } from '@/lib/reels/quality-audit'
import type { ReelsAuditMetadata } from '@/lib/reels/quality-audit'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const clientId = params.id

  try {
    const body = await req.json().catch(() => ({})) as {
      campaign_brief_id?: string
      production_package_id?: string
    }

    // 1. Fetch active master brief
    const { data: brief, error: briefErr } = await supabaseAdmin
      .from('master_briefs')
      .select('*')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .maybeSingle()

    if (briefErr) throw briefErr

    if (!brief) {
      return NextResponse.json(
        { success: false, error: 'No active Master Brief found. Please set up the brand brief first.' },
        { status: 400 }
      )
    }

    // 2. Optionally fetch campaign brief
    let campaignContext: string | undefined
    let campaignMeta: ReelsAuditMetadata['campaign'] = null

    if (body.campaign_brief_id) {
      const { data: campaign } = await supabaseAdmin
        .from('campaign_briefs')
        .select('title, description, parsed_content, semrush_keywords, valid_from, valid_until, offer, target_audience_detail, proof_points, primary_cta, channel_goal, campaign_angle')
        .eq('id', body.campaign_brief_id)
        .eq('client_id', clientId)
        .maybeSingle()

      if (campaign) {
        campaignContext = formatCampaignForPrompt(campaign)
        campaignMeta = {
          title:                  campaign.title ?? null,
          offer:                  campaign.offer ?? null,
          primary_cta:            campaign.primary_cta ?? null,
          campaign_angle:         campaign.campaign_angle ?? null,
          target_audience_detail: campaign.target_audience_detail ?? null,
        }
      }
    }

    // 3. Build audit metadata from master brief
    const auditMeta: ReelsAuditMetadata = {
      brand_name:       brief.brand_name ?? null,
      tone:             brief.tone ?? null,
      avoid_words:      Array.isArray(brief.avoid_words) ? brief.avoid_words : null,
      platforms:        Array.isArray(brief.platforms) ? brief.platforms : null,
      primary_audience: brief.primary_audience ?? null,
      campaign:         campaignMeta,
    }

    // 4. Generate with quality retry (up to 3 attempts)
    const masterBriefText = formatMasterBriefForPrompt(
      brief as unknown as Record<string, unknown>
    )

    const { content, qualityScore, contextSnapshot } = await generateWithQualityRetry(
      masterBriefText,
      campaignContext,
      brief.brand_name ?? 'the brand',
      auditMeta,
    )

    // 5. Insert into reels_drafts
    const { data: draft, error: insertErr } = await supabaseAdmin
      .from('reels_drafts')
      .insert({
        client_id: clientId,
        campaign_brief_id: body.campaign_brief_id ?? null,
        opening_frame_prompt: content.opening_frame_prompt,
        closing_frame_prompt: content.closing_frame_prompt,
        i2v_video_prompt: content.i2v_video_prompt,
        fb_caption: content.fb_caption,
        status: 'draft',
        quality_score: qualityScore,
        generation_context_snapshot: contextSnapshot,
      })
      .select()
      .single()

    if (insertErr) throw insertErr

    // Link to production package if provided (non-blocking)
    if (body.production_package_id && draft) {
      supabaseAdmin
        .from('production_items')
        .insert({
          package_id: body.production_package_id,
          client_id: clientId,
          content_type: 'reel',
          reel_id: draft.id,
          sort_order: 0,
          status: 'ready',
        })
        .select('id')
        .single()
        .then(({ data: item, error: itemErr }) => {
          if (itemErr) {
            console.error('[reels/generate] production_items insert failed:', itemErr)
            return
          }
          if (item) {
            supabaseAdmin
              .from('reels_drafts')
              .update({ production_item_id: item.id })
              .eq('id', draft.id)
              .then(({ error: upErr }) => {
                if (upErr) console.error('[reels/generate] production_item_id back-ref failed:', upErr)
              })
          }
        })
    }

    return NextResponse.json({ success: true, draft })

  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : JSON.stringify(err)
    console.error('[reels/generate] error:', JSON.stringify(err))
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate Reels content with up to 2 quality-rubric retries (3 attempts total).
 * Audits fb_caption; failed dimension reasons are fed back as a hint on retry.
 * On any audit error or missing API key, proceeds with the last generated result.
 */
async function generateWithQualityRetry(
  masterBriefText: string,
  campaignContext: string | undefined,
  brandName: string,
  auditMeta: ReelsAuditMetadata,
): Promise<{
  content: ReelsContent
  qualityScore: number | null
  contextSnapshot: Record<string, unknown> | null
}> {
  const MAX_ATTEMPTS = 3
  let lastContent: ReelsContent | null = null
  let qualityScore: number | null = null
  let contextSnapshot: Record<string, unknown> | null = null
  let qualityHint: string | undefined

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    lastContent = await generateReelsContent({
      masterBriefText,
      campaignContext,
      brandName,
      qualityHint,
    })

    try {
      const audit = await auditReelsDraft(lastContent.fb_caption, auditMeta)

      if (!audit) break  // skipped (no API key) — proceed without retry

      qualityScore = audit.rubricResult.overallScore
      contextSnapshot = { ...audit.contextSnapshot, attempts: attempt }

      if (audit.rubricResult.pass || attempt === MAX_ATTEMPTS) {
        if (!audit.rubricResult.pass) {
          console.warn(
            `[reels quality] Draft failed quality threshold after ${attempt} attempt(s)` +
            ` (score: ${audit.rubricResult.overallScore}). Proceeding with last result.`
          )
        }
        break
      }

      const failed = audit.rubricResult.dimensions.filter(d => !d.pass)
      if (failed.length > 0) {
        qualityHint = failed.map(d => `- ${d.dimension}: ${d.reason}`).join('\n')
      }
    } catch (err) {
      console.error('[reels quality] Audit error (non-blocking):', err)
      break
    }
  }

  return { content: lastContent!, qualityScore, contextSnapshot }
}
