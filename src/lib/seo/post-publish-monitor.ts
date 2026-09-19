import { createHash } from 'node:crypto'
import { z } from 'zod'
import { normalisePath } from '@/lib/seo-intelligence/page-trends/path-utils'

export const POST_PUBLISH_WATCH_STARTED_EVENT = 'seo/page-watch.started'
export const POST_PUBLISH_CHECK_DUE_EVENT = 'seo/page-watch.check_due'
export const POST_PUBLISH_MONITOR_JOB = 'seo-post-publish-monitor'
export const POST_PUBLISH_CHECKPOINT_HOURS = [72, 168] as const

// Production has legacy tenant ids (for example CTS uses a c-prefixed UUID-like
// value whose version nibble predates RFC validation). Keep the same strict
// 8-4-4-4-12 hex shape used by the existing SEO workflow instead of z.uuid().
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const absoluteHttpUrl = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol
  return protocol === 'https:' || protocol === 'http:'
}, 'URL must use http or https')

export const WatchedPageSchema = z.object({
  url: absoluteHttpUrl,
  role: z.enum(['homepage', 'campaign', 'tour', 'conversion', 'guide_hub', 'guide']),
})

export const PostPublishWatchStartedSchema = z.object({
  client_id: uuid,
  origin_url: absoluteHttpUrl,
  launched_at: z.string().datetime({ offset: true }),
  pages: z.array(WatchedPageSchema).min(1).max(30),
  no_publish: z.literal(true),
}).superRefine((value, ctx) => {
  const origin = new URL(value.origin_url)
  const seen = new Set<string>()
  for (const [index, page] of value.pages.entries()) {
    const url = new URL(page.url)
    if (normaliseHost(url.hostname) !== normaliseHost(origin.hostname)) {
      ctx.addIssue({ code: 'custom', path: ['pages', index, 'url'], message: 'page must use origin host' })
    }
    const key = canonicalPageUrl(page.url)
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['pages', index, 'url'], message: 'duplicate page' })
    seen.add(key)
  }
})

export type PostPublishWatchStarted = z.infer<typeof PostPublishWatchStartedSchema>

export const PostPublishCheckDueSchema = z.object({
  client_id: uuid,
  origin_url: absoluteHttpUrl,
  launched_at: z.string().datetime({ offset: true }),
  page: WatchedPageSchema,
  checkpoint_hours: z.union([z.literal(72), z.literal(168)]),
  target_at: z.string().datetime({ offset: true }),
  no_publish: z.literal(true),
}).superRefine((value, ctx) => {
  if (normaliseHost(new URL(value.page.url).hostname) !== normaliseHost(new URL(value.origin_url).hostname)) {
    ctx.addIssue({ code: 'custom', path: ['page', 'url'], message: 'page must use origin host' })
  }
  const expected = Date.parse(value.launched_at) + value.checkpoint_hours * 3_600_000
  if (Date.parse(value.target_at) !== expected) {
    ctx.addIssue({ code: 'custom', path: ['target_at'], message: 'target must equal launch time plus checkpoint' })
  }
})

export type PostPublishCheckDue = z.infer<typeof PostPublishCheckDueSchema>

export interface PageProbe {
  status_code: number | null
  final_url: string | null
  canonical_url: string | null
  robots: string | null
  indexable: boolean | null
  canonical_matches: boolean | null
  final_url_matches: boolean | null
  error: string | null
}

export interface PageMetrics {
  gsc: {
    synced_at: string | null
    clicks: number | null
    impressions: number | null
    ctr: number | null
    position: number | null
  }
  ga4: {
    synced_at: string | null
    sessions: number | null
    pageviews: number | null
  }
}

export type MonitorStatus = 'healthy' | 'needs_attention' | 'insufficient_data' | 'failed'

export interface PostPublishReceipt {
  client_id: string
  url: string
  role: PostPublishCheckDue['page']['role']
  launched_at: string
  checkpoint_hours: 72 | 168
  target_at: string
  observed_at: string
  status: MonitorStatus
  probe: PageProbe
  metrics: PageMetrics
  recommendation: 'hold' | 'fix_technical' | 'wait_for_data' | 'investigate_failure'
  caveats: string[]
  no_publish: true
}

export function normaliseHost(host: string): string {
  return host.trim().toLowerCase().replace(/^www\./, '')
}

export function canonicalPageUrl(raw: string): string {
  const url = new URL(raw)
  url.hash = ''
  url.search = ''
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString()
}

export function watchEventId(watch: PostPublishWatchStarted): string {
  return `seo-watch-${stableHash([watch.client_id, watch.origin_url, watch.launched_at, ...watch.pages.map((p) => canonicalPageUrl(p.url))])}`
}

export function checkEventId(due: Pick<PostPublishCheckDue, 'client_id' | 'launched_at' | 'page' | 'checkpoint_hours'>): string {
  return `seo-check-${stableHash([due.client_id, canonicalPageUrl(due.page.url), due.launched_at, due.checkpoint_hours])}`
}

export function receiptRunId(due: Pick<PostPublishCheckDue, 'client_id' | 'launched_at' | 'page' | 'checkpoint_hours'>): string {
  const hex = stableHash([due.client_id, canonicalPageUrl(due.page.url), due.launched_at, due.checkpoint_hours]).padEnd(32, '0').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function stableHash(parts: readonly (string | number)[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32)
}

export function buildCheckEvents(watch: PostPublishWatchStarted) {
  return watch.pages.flatMap((page) => POST_PUBLISH_CHECKPOINT_HOURS.map((checkpointHours) => {
    const due: PostPublishCheckDue = {
      client_id: watch.client_id,
      origin_url: canonicalPageUrl(watch.origin_url),
      launched_at: new Date(watch.launched_at).toISOString(),
      page: { ...page, url: canonicalPageUrl(page.url) },
      checkpoint_hours: checkpointHours,
      target_at: new Date(Date.parse(watch.launched_at) + checkpointHours * 3_600_000).toISOString(),
      no_publish: true,
    }
    return { id: checkEventId(due), name: POST_PUBLISH_CHECK_DUE_EVENT, data: due }
  }))
}

export function parsePageProbe(input: { requestedUrl: string; status: number; finalUrl: string; html: string; xRobotsTag?: string | null }): PageProbe {
  const canonical = firstHtmlAttribute(input.html, 'link', 'rel', 'canonical', 'href')
  const metaRobots = firstHtmlAttribute(input.html, 'meta', 'name', 'robots', 'content')
  const robots = [metaRobots, input.xRobotsTag].filter((value): value is string => Boolean(value)).join(', ') || null
  const statusOk = input.status >= 200 && input.status < 300
  const noindex = robots?.toLowerCase().split(/[\s,]+/).includes('noindex') ?? false
  return {
    status_code: input.status,
    final_url: input.finalUrl,
    canonical_url: canonical ? new URL(canonical, input.finalUrl).toString() : null,
    robots,
    indexable: statusOk ? !noindex : false,
    canonical_matches: canonical ? canonicalPageUrl(new URL(canonical, input.finalUrl).toString()) === canonicalPageUrl(input.requestedUrl) : false,
    final_url_matches: canonicalPageUrl(input.finalUrl) === canonicalPageUrl(input.requestedUrl),
    error: null,
  }
}

function firstHtmlAttribute(html: string, tag: string, matchName: string, matchValue: string, wantedName: string): string | null {
  const tags = html.match(new RegExp(`<${tag}\\b[^>]*>`, 'gi')) ?? []
  for (const raw of tags) {
    const attrs = new Map<string, string>()
    for (const match of raw.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '')
    }
    const match = attrs.get(matchName)?.toLowerCase().split(/\s+/) ?? []
    if (match.includes(matchValue.toLowerCase())) return attrs.get(wantedName) ?? null
  }
  return null
}

export function emptyMetrics(): PageMetrics {
  return {
    gsc: { synced_at: null, clicks: null, impressions: null, ctr: null, position: null },
    ga4: { synced_at: null, sessions: null, pageviews: null },
  }
}

export function classifyReceipt(args: {
  due: PostPublishCheckDue
  observedAt: string
  probe: PageProbe
  metrics: PageMetrics
}): PostPublishReceipt {
  const caveats: string[] = []
  const { probe, metrics } = args
  let status: MonitorStatus
  let recommendation: PostPublishReceipt['recommendation']

  if (probe.error) {
    status = 'failed'
    recommendation = 'investigate_failure'
    caveats.push(probe.error)
  } else if (!probe.status_code || probe.status_code < 200 || probe.status_code >= 300 || probe.indexable === false || probe.canonical_matches === false || probe.final_url_matches === false) {
    status = 'needs_attention'
    recommendation = 'fix_technical'
    if (probe.status_code && (probe.status_code < 200 || probe.status_code >= 300)) caveats.push(`http_${probe.status_code}`)
    if (probe.indexable === false) caveats.push('page_not_indexable')
    if (probe.canonical_matches === false) caveats.push('canonical_mismatch')
    if (probe.final_url_matches === false) caveats.push('unexpected_redirect')
  } else {
    const launchMs = Date.parse(args.due.launched_at)
    const gscFresh = metrics.gsc.synced_at !== null && Date.parse(metrics.gsc.synced_at) >= launchMs
    const ga4Fresh = metrics.ga4.synced_at !== null && Date.parse(metrics.ga4.synced_at) >= launchMs
    const hasPageData = metrics.gsc.impressions !== null || metrics.ga4.sessions !== null
    if (!hasPageData || (!gscFresh && !ga4Fresh)) {
      status = 'insufficient_data'
      recommendation = 'wait_for_data'
      if (!hasPageData) caveats.push('page_absent_from_latest_snapshots')
      if (!gscFresh) caveats.push('gsc_snapshot_not_post_launch')
      if (!ga4Fresh) caveats.push('ga4_snapshot_not_post_launch')
    } else {
      status = 'healthy'
      recommendation = 'hold'
    }
  }

  return {
    client_id: args.due.client_id,
    url: canonicalPageUrl(args.due.page.url),
    role: args.due.page.role,
    launched_at: new Date(args.due.launched_at).toISOString(),
    checkpoint_hours: args.due.checkpoint_hours,
    target_at: new Date(args.due.target_at).toISOString(),
    observed_at: new Date(args.observedAt).toISOString(),
    status,
    probe,
    metrics,
    recommendation,
    caveats,
    no_publish: true,
  }
}
