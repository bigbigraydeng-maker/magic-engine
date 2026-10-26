import { allowedHostsFor, guardedGet, robotsAllows, type GuardedGetOptions } from './fetch'
import { parseProductPage, parseSitemapUrls, type ParsedProduct } from './parse'

export type ProductFactStatus = 'ok' | 'stale' | 'fetch_failed' | 'not_measured'
export const STALE_AFTER_DAYS = 14

export interface ProductFact extends ParsedProduct {
  source_url: string
  /** When a successful read confirmed these facts; null when nothing was verified. */
  verified_at: string | null
  status: ProductFactStatus
  error?: string
}

/** Per-client rule, from env `CLIENT_PRODUCT_FACT_SOURCES` (JSON keyed by client id): which site, which URL prefixes are products. */
export interface FactSource { origin: string; product_path_prefixes: string[] }

export function loadFactSource(clientId: string, raw: string | undefined = process.env.CLIENT_PRODUCT_FACT_SOURCES): FactSource | null {
  try {
    const entry = (JSON.parse(raw ?? '{}') as Record<string, Partial<FactSource>>)[clientId]
    const prefixes = entry?.product_path_prefixes
    if (!entry?.origin || !/^https:\/\/[^/\s]+$/.test(entry.origin)) return null
    if (!Array.isArray(prefixes) || !prefixes.length || !prefixes.every(p => typeof p === 'string' && /^\/.+\/$/.test(p))) return null
    return { origin: entry.origin, product_path_prefixes: prefixes }
  } catch {
    return null
  }
}

const EMPTY: ParsedProduct = { name: null, duration_days: null, from_price: null, price_basis: null, departures: null, inclusions: null }
const failed = (source_url: string, err: unknown): ProductFact =>
  ({ ...EMPTY, source_url, verified_at: null, status: 'fetch_failed', error: err instanceof Error ? err.message : 'unknown' })
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export interface CollectOptions { now?: Date; maxProducts?: number; gapMs?: number; fetchImpl?: GuardedGetOptions['fetchImpl'] }

/** Read-only crawl of the product pages named by the sitemap. Never throws: every failure becomes a `fetch_failed` record. */
export async function collectProductFacts(source: FactSource, opts: CollectOptions = {}): Promise<ProductFact[]> {
  const now = (opts.now ?? new Date()).toISOString()
  const get: GuardedGetOptions = { allowedHosts: allowedHostsFor(source.origin), fetchImpl: opts.fetchImpl }
  const sitemapUrl = `${source.origin}/sitemap.xml`
  let urls: string[]
  let robots = ''
  try {
    robots = await guardedGet(`${source.origin}/robots.txt`, get).catch(e => { if (e instanceof Error && e.message === 'http_404') return ''; throw e })
    urls = parseSitemapUrls(await guardedGet(sitemapUrl, get)).filter(u => {
      const p = new URL(u).pathname
      return source.product_path_prefixes.some(prefix => p.startsWith(prefix) && p.length > prefix.length) && robotsAllows(robots, p)
    })
  } catch (e) {
    return [failed(sitemapUrl, e)]
  }
  const facts: ProductFact[] = []
  for (const url of [...new Set(urls)].slice(0, opts.maxProducts ?? 30)) {
    if (facts.length) await sleep(opts.gapMs ?? 1500)
    try {
      const parsed = parseProductPage(await guardedGet(url, get))
      if (!parsed) { facts.push({ ...EMPTY, source_url: url, verified_at: null, status: 'not_measured', error: 'no_product_data' }); continue }
      const complete = parsed.from_price !== null && parsed.duration_days !== null
      facts.push({ ...parsed, source_url: url, verified_at: complete ? now : null, status: complete ? 'ok' : 'not_measured' })
    } catch (e) {
      facts.push(failed(url, e))
    }
  }
  return facts
}
