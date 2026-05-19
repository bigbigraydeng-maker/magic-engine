/**
 * POST /api/clients/[id]/reels/generate
 *
 * Generate initial Reels content (4 fields) from Master Brief + optional Campaign Brief.
 * Creates a new reels_draft row and returns it with the generated content.
 *
 * Body: { campaign_brief_id?: string }
 * Reference: ROADMAP.md P8.R.5
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
    if (body.campaign_brief_id) {
      const { data: campaign } = await supabaseAdmin
        .from('campaign_briefs')
        .select('title, description, parsed_content, semrush_keywords, valid_from, valid_until')
        .eq('id', body.campaign_brief_id)
        .eq('client_id', clientId)
        .maybeSingle()

      if (campaign) {
        campaignContext = formatCampaignForPrompt(campaign)
      }
    }

    // 3. Generate prompts via Claude
    const masterBriefText = formatMasterBriefForPrompt(
      brief as unknown as Record<string, unknown>
    )

    const content = await generateReelsContent({
      masterBriefText,
      campaignContext,
      brandName: brief.brand_name ?? 'the brand',
    })

    // 4. Upsert into reels_drafts
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
