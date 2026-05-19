import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getVideoTranscript } from '@/lib/supadata/client'
import { analyzeViralVideo } from '@/lib/content/video-analyzer'
import { getActiveBrief } from '@/lib/content/brief-injector'
import { getCampaignById } from '@/lib/content/campaign-injector'
import { rewriteForBrand } from '@/lib/content/route-b-rewriter'
import { auditSocialPost } from '@/lib/content/social-quality-audit'
import type { SocialAuditMetadata } from '@/lib/content/social-quality-audit'

export async function POST(req: NextRequest) {
  try {
    const { video_url, client_id, platforms, campaign_id, execution_item_id } = await req.json()

    if (!video_url || !client_id) {
      return NextResponse.json(
        { success: false, error: 'video_url and client_id required', code: 'INVALID_INPUT' },
        { status: 400 }
      )
    }

    const targetPlatforms: string[] = platforms || ['facebook', 'tiktok']

    // 1. 获取 Master Brief
    const brief = await getActiveBrief(client_id)
    if (!brief) {
      return NextResponse.json(
        { success: false, error: 'No active Master Brief for this client. Create one first.', code: 'INVALID_INPUT' },
        { status: 400 }
      )
    }

    // 2. 转录视频
    console.log('[route-b] Transcribing video:', video_url)
    const { transcript, metadata } = await getVideoTranscript(video_url)

    if (!transcript || transcript.length < 50) {
      return NextResponse.json(
        { success: false, error: 'Could not extract transcript from video', code: 'SUPADATA_ERROR' },
        { status: 422 }
      )
    }

    // 3. 7维度分析
    console.log('[route-b] Analyzing viral structure...')
    const analysis = await analyzeViralVideo(transcript, metadata)

    // 3b. Load Campaign Brief if provided
    const campaign = campaign_id ? await getCampaignById(client_id, campaign_id) : null

    // 4. 并发生成2个变体
    console.log('[route-b] Generating content variants...')
    const [variant1, variant2] = await Promise.all([
      rewriteForBrand({ analysis, brief, targetPlatforms, variant: 1, campaign: campaign ?? undefined }),
      rewriteForBrand({ analysis, brief, targetPlatforms, variant: 2, campaign: campaign ?? undefined }),
    ])

    // 4b. Quality audit for each variant (non-blocking — errors must not block generation)
    const auditMeta: SocialAuditMetadata = {
      brand_name:       brief.brand_name ?? null,
      tone:             brief.tone ?? null,
      avoid_words:      brief.avoid_words ?? null,
      platforms:        brief.platforms ?? null,
      primary_audience: brief.primary_audience ?? null,
      campaign: campaign ? {
        title:                  campaign.title ?? null,
        offer:                  campaign.offer ?? null,
        primary_cta:            campaign.primary_cta ?? null,
        campaign_angle:         campaign.campaign_angle ?? null,
        target_audience_detail: campaign.target_audience_detail ?? null,
      } : null,
    }

    const buildAuditContent = (v: { script: string; caption: string; hashtags: string[] }) =>
      [v.script, v.caption, v.hashtags.join(' ')].filter(Boolean).join('\n')

    const [auditSettled1, auditSettled2] = await Promise.allSettled([
      auditSocialPost(buildAuditContent(variant1), targetPlatforms, 'social_b', auditMeta),
      auditSocialPost(buildAuditContent(variant2), targetPlatforms, 'social_b', auditMeta),
    ])

    const audit1 = auditSettled1.status === 'fulfilled' ? auditSettled1.value : null
    const audit2 = auditSettled2.status === 'fulfilled' ? auditSettled2.value : null
    if (auditSettled1.status === 'rejected') console.error('[route-b] audit v1 error:', auditSettled1.reason)
    if (auditSettled2.status === 'rejected') console.error('[route-b] audit v2 error:', auditSettled2.reason)

    // 5. 写入 Supabase content_posts
    const postBase = {
      client_id,
      route: 'route_b' as const,
      platforms: targetPlatforms,
      source_video_url: video_url,
      source_brief_id: brief.id,
      campaign_id: campaign?.id ?? null,
      content_mode: campaign ? 'campaign' : 'brand',
      status: 'draft' as const,
      execution_item_id: execution_item_id ?? null,
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[route-b] SUPABASE_SERVICE_ROLE_KEY not set — using anon client, insert will be silently blocked by RLS')
    }

    const { data: savedPosts, error } = await supabaseAdmin
      .from('content_posts')
      .insert([
        {
          ...postBase,
          title:                       `${variant1.title} [V1]`,
          script:                      variant1.script,
          caption:                     variant1.caption,
          hashtags:                    variant1.hashtags,
          visual_brief:                variant1.visual_brief,
          quality_score:               audit1?.rubricResult.overallScore ?? null,
          generation_context_snapshot: audit1?.contextSnapshot ?? null,
        },
        {
          ...postBase,
          title:                       `${variant2.title} [V2]`,
          script:                      variant2.script,
          caption:                     variant2.caption,
          hashtags:                    variant2.hashtags,
          visual_brief:                variant2.visual_brief,
          quality_score:               audit2?.rubricResult.overallScore ?? null,
          generation_context_snapshot: audit2?.contextSnapshot ?? null,
        },
      ])
      .select()

    if (error) {
      console.error('[route-b] DB insert error:', JSON.stringify(error))
      throw error
    }
    if (!savedPosts?.length) {
      console.error('[route-b] DB insert returned no rows — RLS may be blocking (anon key fallback?)')
      throw new Error('Content generated but failed to save — check Render logs for DB error')
    }

    return NextResponse.json({
      success: true,
      source_video: {
        url: video_url,
        platform: metadata.platform,
        title: metadata.title,
      },
      analysis,
      variants: [variant1, variant2],
      saved_posts: savedPosts,
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[route-b]', err)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
