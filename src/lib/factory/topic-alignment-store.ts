import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { getClientKeywords } from '@/lib/keywords/resolver'
import { topicAlignmentGaps, websiteHosts, type TopicAlignment } from './topic-alignment'

function hashSource(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export interface AlignmentContext {
  post: { id: string; title: string; status: string; platforms: string[]; campaignId: string | null; ratio: string | null }
  websiteHosts: string[]
  primaryKeywords: string[]
  campaigns: Array<{ id: string; title: string; description: string | null; sourceUrls: string[]; sourceHash: string }>
  socialPlans: Array<{ id: string; campaignId: string | null; theme: string; sourceHash: string }>
}

export async function loadAlignmentContext(clientId: string, postId: string): Promise<AlignmentContext | null> {
  const [postResult, clientResult, briefResult, campaignResult, socialResult, keywordResult] = await Promise.all([
    supabaseAdmin.from('content_posts').select('id, title, status, platforms, campaign_id, ratio').eq('client_id', clientId).eq('id', postId).maybeSingle(),
    supabaseAdmin.from('clients').select('domain').eq('id', clientId).maybeSingle(),
    supabaseAdmin.from('master_briefs').select('website').eq('client_id', clientId).or('status.eq.active,is_active.eq.true').order('version', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('campaign_briefs').select('id, title, description, source_urls, valid_from, valid_until, updated_at').eq('client_id', clientId).eq('status', 'active').order('updated_at', { ascending: false }).limit(50),
    supabaseAdmin.from('social_plans').select('id, campaign_id, plan_data, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(50),
    getClientKeywords(clientId, 50, { strict: true }),
  ])
  for (const result of [postResult, clientResult, briefResult, campaignResult, socialResult]) {
    if (result.error) throw result.error
  }
  if (!postResult.data || !clientResult.data) return null

  const campaigns = (campaignResult.data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    sourceUrls: row.source_urls ?? [],
    sourceHash: hashSource(row),
  }))
  const socialPlans = (socialResult.data ?? []).map((row) => {
    const plan = row.plan_data as { strategy?: { theme?: unknown } } | null
    return {
      id: row.id,
      campaignId: row.campaign_id,
      theme: typeof plan?.strategy?.theme === 'string' ? plan.strategy.theme : '',
      sourceHash: hashSource(row),
    }
  })
  return {
    post: {
      id: postResult.data.id,
      title: postResult.data.title,
      status: postResult.data.status,
      platforms: postResult.data.platforms ?? [],
      campaignId: postResult.data.campaign_id ?? null,
      ratio: postResult.data.ratio ?? null,
    },
    websiteHosts: websiteHosts(clientResult.data.domain ?? null, briefResult.data?.website ?? null),
    primaryKeywords: keywordResult.keywords,
    campaigns,
    socialPlans,
  }
}

export async function loadTopicAlignment(clientId: string, postId: string): Promise<TopicAlignment | null> {
  const { data, error } = await supabaseAdmin.from('content_topic_alignments')
    .select('*').eq('client_id', clientId).eq('content_post_id', postId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    contentTitleSnapshot: data.content_title_snapshot,
    videoFormat: data.video_format,
    primaryKeyword: data.primary_keyword,
    searchIntent: data.search_intent,
    audienceMarket: data.audience_market,
    googleEvidence: data.google_evidence,
    youtubeEvidence: data.youtube_evidence,
    websiteUrl: data.website_url,
    websiteTheme: data.website_theme,
    websiteCheck: data.website_check,
    promotionUrl: data.promotion_url,
    promotionCheck: data.promotion_check,
    promotionAlignment: data.promotion_alignment,
    promotionNote: data.promotion_note ?? '',
    campaignBriefId: data.campaign_brief_id,
    campaignSourceHash: data.campaign_source_hash,
    adsAlignment: data.ads_alignment,
    adsNote: data.ads_note ?? '',
    socialPlanId: data.social_plan_id,
    socialSourceHash: data.social_source_hash,
    socialAlignment: data.social_alignment,
    socialNote: data.social_note ?? '',
    contentPromise: data.content_promise,
  } as TopicAlignment
}

export async function saveTopicAlignment(clientId: string, postId: string, value: TopicAlignment): Promise<void> {
  const { error } = await supabaseAdmin.from('content_topic_alignments').upsert({
    content_post_id: postId,
    client_id: clientId,
    content_title_snapshot: value.contentTitleSnapshot,
    video_format: value.videoFormat,
    primary_keyword: value.primaryKeyword,
    search_intent: value.searchIntent,
    audience_market: value.audienceMarket,
    google_evidence: value.googleEvidence,
    youtube_evidence: value.youtubeEvidence,
    website_url: value.websiteUrl,
    website_theme: value.websiteTheme,
    website_check: value.websiteCheck,
    promotion_url: value.promotionUrl,
    promotion_check: value.promotionCheck,
    promotion_alignment: value.promotionAlignment,
    promotion_note: value.promotionNote,
    campaign_brief_id: value.campaignBriefId,
    campaign_source_hash: value.campaignSourceHash,
    ads_alignment: value.adsAlignment,
    ads_note: value.adsNote,
    social_plan_id: value.socialPlanId,
    social_source_hash: value.socialSourceHash,
    social_alignment: value.socialAlignment,
    social_note: value.socialNote,
    content_promise: value.contentPromise,
  }, { onConflict: 'content_post_id' })
  if (error) throw error
}

export async function checkTopicAlignment(clientId: string, postId: string): Promise<{ ready: boolean; gaps: string[] }> {
  const context = await loadAlignmentContext(clientId, postId)
  if (!context) return { ready: false, gaps: ['内容不存在或不属于当前客户'] }
  const value = await loadTopicAlignment(clientId, postId)
  const campaignSourceHash = context.campaigns.find((c) => c.id === value?.campaignBriefId)?.sourceHash ?? null
  const socialSourceHash = context.socialPlans.find((p) => p.id === value?.socialPlanId)?.sourceHash ?? null
  const gaps = topicAlignmentGaps(value, context.websiteHosts, {
    title: context.post.title,
    ratio: context.post.ratio,
    campaignId: context.post.campaignId,
    keywords: context.primaryKeywords,
    campaignSourceHash,
    socialSourceHash,
  })
  return { ready: gaps.length === 0, gaps }
}
