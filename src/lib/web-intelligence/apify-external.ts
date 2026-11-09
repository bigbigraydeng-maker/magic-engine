import { runActorAndGetResults } from '@/lib/apify/client'
import { estimateWebsiteTraffic } from '@/lib/apify/traffic-estimator'
import { scrapeSeek } from '@/lib/prospecting/job-boards/scrapers'
import { buildExternalObservation, sourceDefinition, sourceDefaultUrls } from './sources'
import type { ExternalObservation } from './contracts'

type RawExternalItem = Record<string, unknown>

export type ApifyExternalCollection = {
  observations: ExternalObservation[]
  rejected: number
  runId: string | null
  datasetId?: string | null
  costUsd?: number
  actorBuild?: string
  error?: string
}

function text(item: RawExternalItem, keys: string[]): string {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function jobExcerpt(item: RawExternalItem): string {
  const parts = [
    ['职位', text(item, ['title', 'name'])],
    ['公司', text(item, ['company', 'companyName'])],
    ['地点', text(item, ['location'])],
    ['薪资', text(item, ['salaryText', 'salary'])],
    ['简介', text(item, ['teaser', 'descriptionText', 'description'])],
  ]
  return parts.filter(([, value]) => value).map(([label, value]) => `${label}：${value}`).join('\n')
}

function optionalText(item: RawExternalItem, keys: string[]): string | null {
  return text(item, keys) || null
}

function validUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Adapt an Apify dataset into the shared WI observation contract.
 *
 * Actor schemas vary, so this adapter accepts common article/job fields but
 * fails closed for rows without a verifiable URL and useful text. It does not
 * infer facts or identify authors; interpretation happens after persistence.
 */
export async function collectApifyExternalObservations(input: {
  actorId: string
  actorInput: Record<string, unknown>
  sourceId: string
  clientId: string
  observedAt: string
  validUntil?: string | null
  timeoutMs?: number
}): Promise<ApifyExternalCollection> {
  if (!sourceDefinition(input.sourceId)) throw new Error('unknown_external_source')
  const result = await runActorAndGetResults<RawExternalItem>(input.actorId, input.actorInput, input.timeoutMs)
  if (!result.success) return { observations: [], rejected: 0, runId: result.runId, error: result.error }

  const observations: ExternalObservation[] = []
  let rejected = 0
  for (const item of result.data) {
    const sourceUrl = text(item, ['url', 'sourceUrl', 'source_url', 'link', 'articleUrl', 'jobUrl', 'postUrl', 'post_url', 'permalink'])
    const title = text(item, ['title', 'name', 'headline'])
    const excerpt = text(item, ['excerpt', 'description', 'descriptionText', 'teaser', 'text', 'content', 'summary', 'snippet'])
      || (input.sourceId === 'seek-nz' ? jobExcerpt(item) : '')
    if (!validUrl(sourceUrl) || !excerpt) {
      rejected += 1
      continue
    }
    try {
      observations.push(buildExternalObservation({
        client_id: input.clientId,
        source_id: input.sourceId,
        source_url: sourceUrl,
        title,
        excerpt,
        competitor_domain: optionalText(item, ['competitorDomain', 'competitor_domain', 'domain']),
        published_at: optionalText(item, ['publishedAt', 'published_at', 'publishedDate', 'pub_date', 'datePublished', 'date', 'postedAt', 'postedDate']),
        observed_at: input.observedAt,
        valid_until: input.validUntil,
        authorization_confirmed: input.sourceId === 'facebook-group-authorized' ? item.authorizationConfirmed === true : undefined,
      }))
    } catch {
      rejected += 1
    }
  }
  return { observations, rejected, runId: result.runId }
}

/** Actor IDs and input shapes verified against their current Apify Store pages.
 * Keep these in one place so a provider replacement does not spread through WI.
 */
export const WI_APIFY_ACTORS = {
  rssFeed: 'ef12/rss-scraper',
  articleExtractor: 'automation-lab/news-article-extractor',
  facebookPublicGroupPosts: 'automation-lab/facebook-group-posts-scraper',
} as const

export function collectRssFeed(input: {
  sourceId: string; clientId: string; feedUrl: string; observedAt: string; maxResults?: number
}): Promise<ApifyExternalCollection> {
  return collectApifyExternalObservations({
    actorId: WI_APIFY_ACTORS.rssFeed,
    actorInput: { feed_url: input.feedUrl, max_results: Math.min(input.maxResults ?? 25, 200) },
    sourceId: input.sourceId, clientId: input.clientId, observedAt: input.observedAt,
  })
}

export function collectIndustryWebsite(input: {
  sourceId: string; clientId: string; siteUrl: string; observedAt: string; maxArticles?: number
}): Promise<ApifyExternalCollection> {
  return collectApifyExternalObservations({
    actorId: WI_APIFY_ACTORS.articleExtractor,
    actorInput: {
      startUrls: [input.siteUrl], maxArticles: Math.min(input.maxArticles ?? 20, 50),
      extractFullContent: true, includeImages: false,
    },
    sourceId: input.sourceId, clientId: input.clientId, observedAt: input.observedAt,
  })
}

export function collectConfiguredIndustrySource(input: {
  sourceId: string; clientId: string; observedAt: string; siteUrl?: string; maxArticles?: number
}): Promise<ApifyExternalCollection> {
  const siteUrl = input.siteUrl ?? sourceDefaultUrls(input.sourceId)[0]
  if (!siteUrl) throw new Error('source_url_required')
  return collectIndustryWebsite({ ...input, siteUrl })
}

function publicFacebookGroupUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && ['facebook.com', 'www.facebook.com'].includes(url.hostname.toLowerCase())
      && /^\/groups\/\d+\/?$/.test(url.pathname)
  } catch {
    return false
  }
}

export async function collectFacebookPublicGroupPosts(input: {
  clientId: string; groupUrls: string[]; observedAt: string; searchTerms?: string[]; since?: string; maxItems?: number; maxPagesPerGroup?: number
}): Promise<ApifyExternalCollection> {
  const groupUrls = [...new Set(input.groupUrls.filter(publicFacebookGroupUrl))].slice(0, 10)
  if (!groupUrls.length) throw new Error('public_facebook_group_url_required')
  return collectApifyExternalObservations({
    actorId: WI_APIFY_ACTORS.facebookPublicGroupPosts,
    actorInput: {
      startUrls: groupUrls.map(url => ({ url })),
      maxItems: Math.min(input.maxItems ?? 25, 100),
      ...(input.searchTerms?.length ? { searchTerms: input.searchTerms.slice(0, 20) } : {}),
      ...(input.since ? { since: input.since } : {}),
      maxPagesPerGroup: Math.min(input.maxPagesPerGroup ?? 2, 20),
    },
    sourceId: 'facebook-group-public', clientId: input.clientId, observedAt: input.observedAt,
  })
}

export function collectSeekNzJobs(input: {
  clientId: string; query?: string; queries?: string[]; location?: string; observedAt: string; maxResults?: number
}): Promise<ApifyExternalCollection> {
  const keywords = [...(input.queries ?? []), ...(input.query ? [input.query] : [])].filter(Boolean)
  return scrapeSeek(keywords, Math.min(input.maxResults ?? 50, 100)).then(postings => {
    const location = input.location?.trim().toLowerCase()
    const scopedPostings = location ? postings.filter(posting => posting.location_raw.toLowerCase().includes(location)) : postings
    const observations: ExternalObservation[] = []
    let rejected = 0
    for (const posting of scopedPostings) {
      if (!posting.url) { rejected += 1; continue }
      try {
        observations.push(buildExternalObservation({
          client_id: input.clientId, source_id: 'seek-nz', source_url: posting.url,
          title: posting.title,
          excerpt: [`职位：${posting.title}`, `公司：${posting.company}`, posting.location_raw && `地点：${posting.location_raw}`, posting.classification && `分类：${posting.classification}`].filter(Boolean).join('\n'),
          published_at: posting.posted_at, observed_at: input.observedAt,
        }))
      } catch { rejected += 1 }
    }
    return { observations, rejected, runId: null }
  })
}

/**
 * Collect a low-confidence, public traffic direction signal for competitor
 * domains. This deliberately uses the shared observation contract so it can
 * be stored and reviewed alongside other WI evidence without implying that
 * the estimate is first-party analytics.
 */
export async function collectTrafficDirectionObservations(input: {
  clientId: string; domains: string[]; observedAt: string; maxChargeUsd?: number
}): Promise<ApifyExternalCollection> {
  try {
    const result = await estimateWebsiteTraffic(input.domains, { maxChargeUsd: input.maxChargeUsd })
    const observations: ExternalObservation[] = []
    let rejected = 0
    for (const estimate of result.data) {
      const sourceUrl = `https://www.similarweb.com/website/${estimate.domain}/`
      const excerpt = [
        `估算访问量：${estimate.total_visits ?? '未测量'}`,
        `访问量变化：${estimate.visits_change_pct === null ? '未测量' : `${estimate.visits_change_pct}%`}`,
        `主要国家：${estimate.top_country ?? '未测量'}`,
        `来源结构：${Object.entries(estimate.traffic_sources).map(([name, share]) => `${name} ${share}%`).join('；') || '未测量'}`,
        '数据性质：第三方公开估算，仅作为低置信度方向性证据，不代表真实访问量或销售影响。',
      ].join('\n')
      try {
        observations.push(buildExternalObservation({
          client_id: input.clientId, source_id: 'competitor-traffic-apify', source_url: sourceUrl,
          title: `${estimate.domain} · 网站流量方向`, excerpt, competitor_domain: estimate.domain,
          observed_at: estimate.checked_at || input.observedAt,
          valid_until: new Date(Date.parse(estimate.checked_at || input.observedAt) + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }))
      } catch { rejected += 1 }
    }
    return { observations, rejected, runId: result.run_id, datasetId: result.dataset_id, costUsd: result.cost_usd, actorBuild: '0.1.11' }
  } catch (error) {
    return { observations: [], rejected: 0, runId: null, error: error instanceof Error ? error.message : String(error) }
  }
}
