/** Bounded, public Website capture. Actor schema verified 2026-09-09:
 * https://apify.com/apify/website-content-crawler/input-schema
 * https://docs.apify.com/api/v2/actors-runs-post
 * Callers must reserve budget and persist start uncertainty before invoking.
 */
import { getDatasetItems, getRun, runActor } from './client'
import type { ApifyRunResult } from './types'

export const WEBSITE_ACTOR = 'apify/website-content-crawler'
export interface WebsiteCapture {
  status: 'pending' | 'failed' | 'complete'
  run: ApifyRunResult
  page?: { url: string; title: string; text: string }
  error?: string
}

function publicUrl(raw: string): URL {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error('Invalid public website URL')
  }
  return url
}

export async function startWebsiteCapture(args: {
  url: string; build: string; maxChargeUsd: number
}): Promise<ApifyRunResult> {
  const url = publicUrl(args.url)
  if (!/^\d+\.\d+\.\d+$/.test(args.build)) throw new Error('A pinned Actor build number is required')
  if (!Number.isFinite(args.maxChargeUsd) || args.maxChargeUsd <= 0) throw new Error('Invalid capture budget')
  return runActor(WEBSITE_ACTOR, {
    startUrls: [{ url: url.href }], crawlerType: 'playwright:firefox',
    maxCrawlDepth: 0, maxCrawlPages: 1, maxResults: 1,
    useSitemaps: false, useLlmsTxt: false, respectRobotsTxtFile: true,
    initialConcurrency: 1, maxConcurrency: 1, maxRequestRetries: 0, maxSessionRotations: 0,
    requestTimeoutSecs: 60, dynamicContentWaitSecs: 10,
    // The official Actor rejects a disabled proxy (validated against build 0.3.97).
    proxyConfiguration: { useApifyProxy: true },
    saveMarkdown: true, saveHtml: false, saveHtmlAsFile: false,
    saveFiles: false, saveContentTypes: '', saveScreenshots: false,
    summarize: false, blockMedia: true, expandIframes: false, clickElementsCssSelector: '',
    // Product pages often place pricing and availability outside the article-like
    // overview. Keep the complete cleaned page, then let ME's business projection
    // remove framework noise without dropping commercial evidence.
    htmlTransformer: 'none', maxScrollHeightPixels: 20_000, aggressivePrune: false,
  }, { build: args.build, maxTotalChargeUsd: args.maxChargeUsd, timeout: 120, memory: 1024 })
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function pageIdentity(url: URL): string {
  const host = url.hostname.replace(/^www\./, '').toLowerCase()
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !key.toLowerCase().startsWith('utm_') && !['gclid', 'dclid', 'fbclid', 'msclkid', '_ga', '_gl'].includes(key.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b))
  const query = new URLSearchParams(kept).toString()
  return `${host}${path}${query ? `?${query}` : ''}`
}

function parsePage(raw: unknown, expectedUrl: string): NonNullable<WebsiteCapture['page']> {
  const item = record(raw)
  const crawl = record(item.crawl)
  const metadata = record(item.metadata)
  const finalUrl = publicUrl(String(crawl.loadedUrl ?? item.url ?? ''))
  const expected = publicUrl(expectedUrl)
  const host = (url: URL) => url.hostname.replace(/^www\./, '')
  if (host(finalUrl) !== host(expected) || (expected.protocol === 'https:' && finalUrl.protocol !== 'https:')) {
    throw new Error('Capture redirected outside the approved origin')
  }
  if (pageIdentity(finalUrl) !== pageIdentity(expected)) throw new Error('Capture redirected to a different page')
  const status = crawl.httpStatusCode ?? item.statusCode
  if (typeof status !== 'number' || status < 200 || status >= 400) throw new Error('Capture has no successful HTTP status')
  const text = typeof item.markdown === 'string' ? item.markdown.trim() : ''
  const title = typeof metadata.title === 'string' ? metadata.title : typeof item.title === 'string' ? item.title : ''
  if (text.length < 100 || text.length > 500_000 || item.truncated === true || crawl.truncated === true) {
    throw new Error('Capture is empty, too short, or truncated')
  }
  if (/captcha|verify (?:that )?you are (?:a )?human|checking your browser|access denied|just a moment/i.test(`${title}\n${text.slice(0, 1500)}`)) {
    throw new Error('Capture contains a challenge or access-denied page')
  }
  if (/^(?:404\b|page not found\b|not found\b)/i.test(title.trim()) || /^#{0,2}\s*(?:404\b|page not found\b)/im.test(text.slice(0, 800))) {
    throw new Error('Capture contains a not-found page')
  }
  return { url: finalUrl.href, title, text }
}

export async function getWebsiteCapture(runId: string, expectedUrl: string): Promise<WebsiteCapture> {
  const run = await getRun(runId)
  if (['READY', 'RUNNING', 'TIMING-OUT', 'ABORTING'].includes(run.status)) return { status: 'pending', run }
  if (run.status !== 'SUCCEEDED') return { status: 'failed', run, error: `Actor ended: ${run.status}` }
  try {
    if (!run.defaultDatasetId) throw new Error('Capture dataset is missing')
    const items = await getDatasetItems<unknown>(run.defaultDatasetId)
    if (!Array.isArray(items) || items.length !== 1) throw new Error('Expected exactly one captured page')
    return { status: 'complete', run, page: parsePage(items[0], expectedUrl) }
  } catch (error) {
    return { status: 'failed', run, error: error instanceof Error ? error.message : 'Invalid capture' }
  }
}
