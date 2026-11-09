import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { safeFetchText } from '@/lib/net/safe-fetch'
import { normaliseKeyword } from '@/lib/keywords/resolver'
import { officialWebsiteUrl, topicAlignmentGaps, type TopicAlignment, type WebsiteCheck } from '@/lib/factory/topic-alignment'
import { loadStoredGscEvidence } from '@/lib/factory/topic-gsc-evidence'
import { loadAlignmentContext, loadTopicAlignment, saveTopicAlignment } from '@/lib/factory/topic-alignment-store'

export const dynamic = 'force-dynamic'

const searchEvidence = z.object({
  status: z.enum(['observed', 'not_collected']),
  source: z.string().max(500).optional(),
  observedAt: z.string().max(50).optional(),
  dateRange: z.string().max(100).optional(),
  market: z.string().max(80).optional(),
  finding: z.string().max(1000).optional(),
  metricName: z.string().max(80).optional(),
  value: z.number().finite().nonnegative().nullable().optional(),
})

const alignmentInput = z.object({
  videoFormat: z.enum(['long', 'short']),
  primaryKeyword: z.string().trim().min(1).max(200),
  searchIntent: z.string().trim().min(1).max(500),
  audienceMarket: z.string().trim().min(1).max(100),
  googleEvidence: searchEvidence.optional(),
  youtubeEvidence: searchEvidence,
  websiteUrl: z.string().url().max(1000),
  websiteTheme: z.string().trim().min(1).max(500),
  promotionUrl: z.string().url().max(1000).nullable(),
  promotionAlignment: z.enum(['aligned', 'not_applicable', 'unknown', 'conflict']),
  promotionNote: z.string().trim().max(1000),
  campaignBriefId: z.string().uuid().nullable(),
  adsAlignment: z.enum(['aligned', 'not_applicable', 'unknown', 'conflict']),
  adsNote: z.string().trim().max(1000),
  socialPlanId: z.string().uuid().nullable(),
  socialAlignment: z.enum(['aligned', 'not_applicable', 'unknown', 'conflict']),
  socialNote: z.string().trim().max(1000),
  contentPromise: z.string().trim().min(1).max(500),
})

async function checkWebsite(url: string, allowedHosts: string[]): Promise<WebsiteCheck> {
  if (!officialWebsiteUrl(url, allowedHosts)) return { status: 'unverified', reason: 'not_official_website' }
  try {
    const response = await safeFetchText(url, { timeoutMs: 7_000, maxRedirects: 2, maxResponseBytes: 500_000 })
    if (!response.ok || !officialWebsiteUrl(response.url, allowedHosts)) {
      return { status: 'unverified', reason: `http_${response.status}` }
    }
    const title = response.text.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? ''
    if (!/<html[\s>]/i.test(response.text) || !title) {
      return { status: 'unverified', reason: 'not_an_html_page' }
    }
    return {
      status: 'verified',
      url,
      checkedAt: new Date().toISOString(),
      pageTitle: title.slice(0, 250),
      contentHash: createHash('sha256').update(response.text).digest('hex'),
    }
  } catch {
    return { status: 'unverified', reason: 'fetch_failed' }
  }
}

type Context = { params: { id: string; postId: string } }

export async function GET(_req: NextRequest, { params }: Context) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const context = await loadAlignmentContext(params.id, params.postId)
    if (!context) return NextResponse.json({ error: 'Content post not found' }, { status: 404 })
    const alignment = await loadTopicAlignment(params.id, params.postId)
    const campaignSourceHash = context.campaigns.find((c) => c.id === alignment?.campaignBriefId)?.sourceHash ?? null
    const socialSourceHash = context.socialPlans.find((p) => p.id === alignment?.socialPlanId)?.sourceHash ?? null
    const gaps = topicAlignmentGaps(alignment, context.websiteHosts, {
      title: context.post.title,
      ratio: context.post.ratio,
      campaignId: context.post.campaignId,
      keywords: context.primaryKeywords,
      campaignSourceHash,
      socialSourceHash,
    })
    return NextResponse.json({ context, alignment, ready: gaps.length === 0, gaps })
  } catch {
    return NextResponse.json({ error: 'Could not load topic alignment' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Context) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const parsed = alignmentInput.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid topic alignment fields' }, { status: 400 })
  try {
    const context = await loadAlignmentContext(params.id, params.postId)
    if (!context) return NextResponse.json({ error: 'Content post not found' }, { status: 404 })
    if (context.post.status === 'published') return NextResponse.json({ error: 'Published content cannot be changed here' }, { status: 409 })
    if (!context.post.platforms.some((p) => ['youtube', 'youtube_shorts', 'youtube-shorts'].includes(p.toLowerCase()))) {
      return NextResponse.json({ error: 'Topic alignment is for YouTube content' }, { status: 409 })
    }
    const input = parsed.data
    const primaryKeyword = normaliseKeyword(input.primaryKeyword)
    if (!context.primaryKeywords.includes(primaryKeyword)) {
      return NextResponse.json({ error: 'Keyword is not in this client’s configured SEO list' }, { status: 400 })
    }
    if (!officialWebsiteUrl(input.websiteUrl, context.websiteHosts) ||
        (input.promotionUrl && !officialWebsiteUrl(input.promotionUrl, context.websiteHosts))) {
      return NextResponse.json({ error: 'Website URLs must be on the configured official site' }, { status: 400 })
    }
    const campaign = context.campaigns.find((c) => c.id === input.campaignBriefId)
    const social = context.socialPlans.find((p) => p.id === input.socialPlanId)
    if (input.campaignBriefId && !campaign || input.socialPlanId && !social) {
      return NextResponse.json({ error: 'Campaign or social plan does not belong to this client' }, { status: 400 })
    }
    if (campaign && social?.campaignId && campaign.id !== social.campaignId) {
      return NextResponse.json({ error: 'Social plan and ad campaign refer to different campaigns' }, { status: 400 })
    }
    const [websiteCheck, promotionCheck, googleEvidence] = await Promise.all([
      checkWebsite(input.websiteUrl, context.websiteHosts),
      input.promotionAlignment === 'aligned' && input.promotionUrl
        ? checkWebsite(input.promotionUrl, context.websiteHosts)
        : Promise.resolve({ status: 'unverified' as const }),
      loadStoredGscEvidence(params.id, primaryKeyword, input.websiteUrl),
    ])
    const alignment: TopicAlignment = {
      ...input,
      contentTitleSnapshot: context.post.title,
      primaryKeyword,
      googleEvidence,
      websiteCheck,
      promotionCheck,
      campaignSourceHash: campaign?.sourceHash ?? null,
      socialSourceHash: social?.sourceHash ?? null,
    }
    await saveTopicAlignment(params.id, params.postId, alignment)
    const gaps = topicAlignmentGaps(alignment, context.websiteHosts, {
      title: context.post.title,
      ratio: context.post.ratio,
      campaignId: context.post.campaignId,
      keywords: context.primaryKeywords,
      campaignSourceHash: campaign?.sourceHash ?? null,
      socialSourceHash: social?.sourceHash ?? null,
    })
    return NextResponse.json({ alignment, ready: gaps.length === 0, gaps })
  } catch {
    return NextResponse.json({ error: 'Could not save topic alignment' }, { status: 500 })
  }
}
