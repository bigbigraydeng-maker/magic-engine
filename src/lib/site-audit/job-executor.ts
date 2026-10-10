/**
 * job-executor.ts
 *
 * Orchestrates a single site-audit job end-to-end:
 *   discoverSitemapUrls → crawlPages → classifyPage → detectGEOBlock
 *   with progress updates and error handling via JobRunner.
 *
 * Reference: ROADMAP.md P8.0.5
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { JobRunner } from './job-runner'
import { discoverSitemapUrls as crawlerDiscoverUrls, crawlPages } from './crawler'
import { enrichCrawledPage } from './page-enrichment'
import { orderStalestFirst, summarizeCapSkips } from './crawl-order'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecuteJobOptions {
  /** Max pages to crawl. Default: 100 */
  maxPages?: number
  /** Delay between requests in ms. Default: 1000 */
  rateLimitMs?: number
}

export interface PageCrawlResult {
  url: string
  markdown: string
  title: string
  wordCount: number
  pageType: string
  topics: string[]
  primaryKeyword: string | null
  classificationConfidence: number
  hasGeoBlock: boolean
  geoDetectionMethod: string | null
  geoConfidence: number
  statusCode: number
  error?: string
}

export interface CrawlBatchResult {
  successful: string[]
  failed: { url: string; error: string }[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROGRESS_UPDATE_INTERVAL = 10
const DEFAULT_MAX_PAGES = 100
const DEFAULT_RATE_LIMIT_MS = 1000

// ---------------------------------------------------------------------------
// Public API — re-exported for mocking in tests
// ---------------------------------------------------------------------------

/**
 * Discover all crawlable URLs for a domain.
 * Thin wrapper around crawler.discoverSitemapUrls so tests can mock at this level.
 */
export async function discoverSitemapUrls(domain: string): Promise<string[]> {
  return crawlerDiscoverUrls(domain)
}

/**
 * Crawl, classify, and GEO-detect a list of URLs, then upsert results to
 * the `client_site_pages` table.
 *
 * Emits a progress update to JobRunner every PROGRESS_UPDATE_INTERVAL pages.
 * Individual page failures are captured; they never abort the entire batch.
 */
export async function crawlAndClassifyPages(
  supabase: SupabaseClient,
  clientId: string,
  urls: string[],
  jobId: string,
  options: ExecuteJobOptions
): Promise<CrawlBatchResult> {
  const runner = new JobRunner(supabase)
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
  const rateLimitMs = options.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS

  const targets = urls.slice(0, maxPages)
  const successful: string[] = []
  const failed: { url: string; error: string }[] = []

  let crawledCount = 0
  let classifiedCount = 0

  // Crawl all pages (rate-limited, fault-tolerant)
  const crawlResults = await crawlPages(targets, { limit: maxPages, rateLimitMs })

  for (let i = 0; i < crawlResults.length; i++) {
    const crawl = crawlResults[i]

    // Antibot challenge — record a stub row with crawl_status='antibot_challenged'
    // and DO NOT overwrite any previously-captured real data. This is the fix
    // for the 2026-06-20 Oztop incident where 30+ product-category pages got
    // stored as `title="Robot Challenge Screen"` because we trusted Jina's
    // output even when it relayed the WAF interstitial verbatim.
    if (crawl.antibot) {
      const failure = { url: crawl.url, error: crawl.error ?? `antibot_${crawl.antibot.kind}` }
      failed.push(failure)
      crawledCount++
      let pagePath = '/'
      try { pagePath = new URL(crawl.url).pathname } catch { /* keep default */ }
      // Mark the row so subsequent diagnostic / page-rewriter passes can skip
      // these URLs until the underlying allowlist / IP issue is fixed.
      // NOTE: we explicitly DON'T pass title / markdown_content / word_count
      // — Supabase upsert with onConflict only overwrites the columns we
      // include, so previously-captured real data on this URL stays put.
      try {
        const { error: markError } = await supabase
          .from('client_site_pages')
          .upsert(
            {
              client_id:    clientId,
              url:          crawl.url,
              path:         pagePath,
              status_code:  crawl.statusCode,
              crawled_at:   crawl.crawledAt.toISOString(),
              crawl_status: 'antibot_challenged',
              crawl_error:  crawl.error ?? `antibot_${crawl.antibot.kind}: ${crawl.antibot.evidence}`,
            },
            { onConflict: 'client_id,url' },
          )
        if (markError) {
          // supabase-js returns write errors instead of throwing. Until 2026-09-26
          // this branch ignored them, and a DB constraint rejected every mark.
          console.error('[site-audit] could not mark anti-bot page', crawl.url, markError.message)
          failure.error = `${failure.error}${MARK_FAILED_MARKER}${markError.message}`
        }
      } catch (err) {
        // Don't block the batch on a single upsert failure — but record it.
        const message = err instanceof Error ? err.message : String(err)
        console.error('[site-audit] could not mark anti-bot page', crawl.url, message)
        failure.error = `${failure.error}${MARK_FAILED_MARKER}${message}`
      }
      if ((i + 1) % PROGRESS_UPDATE_INTERVAL === 0) {
        await runner.updateProgress(jobId, {
          totalUrlsCrawled: crawledCount,
          totalPagesClassified: classifiedCount,
        })
      }
      continue
    }

    if (crawl.error) {
      failed.push({ url: crawl.url, error: crawl.error })
      crawledCount++
      // Record a first-time failure so the URL has a row. ignoreDuplicates keeps any
      // existing row untouched: a transient error must not overwrite the last
      // successful snapshot (status, crawled_at) that SEO signals and dedup read.
      try {
        let failPath = '/'
        try { failPath = new URL(crawl.url).pathname } catch { /* keep default */ }
        const { error: failMarkError } = await supabase.from('client_site_pages').upsert(
          {
            client_id:    clientId,
            url:          crawl.url,
            path:         failPath,
            crawled_at:   crawl.crawledAt.toISOString(),
            crawl_status: 'failed',
            crawl_error:  crawl.error,
          },
          { onConflict: 'client_id,url', ignoreDuplicates: true },
        )
        if (failMarkError) {
          console.warn('[site-audit] could not record failed attempt', crawl.url, failMarkError.message)
          failed[failed.length - 1].error = `${crawl.error}${RECORD_FAILED_MARKER}${failMarkError.message}`
        }

        // Refresh the attempt time for rows that never had a good crawl, so a
        // persistently-failing URL does not keep its first-failure timestamp and
        // hog the front of the staleness queue. Rows with crawl_status 'crawled'
        // (last good snapshot) or 'antibot_challenged' are left untouched.
        const { error: failRefreshError } = await supabase
          .from('client_site_pages')
          .update({ crawled_at: crawl.crawledAt.toISOString(), crawl_error: crawl.error })
          .eq('client_id', clientId)
          .eq('url', crawl.url)
          .eq('crawl_status', 'failed')
        if (failRefreshError) {
          console.warn('[site-audit] could not refresh failed attempt', crawl.url, failRefreshError.message)
          failed[failed.length - 1].error = `${crawl.error}${RECORD_FAILED_MARKER}${failRefreshError.message}`
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn('[site-audit] could not record failed attempt', crawl.url, message)
        failed[failed.length - 1].error = `${crawl.error}${RECORD_FAILED_MARKER}${message}`
      }

      // Periodic progress update
      if ((i + 1) % PROGRESS_UPDATE_INTERVAL === 0) {
        await runner.updateProgress(jobId, {
          totalUrlsCrawled: crawledCount,
          totalPagesClassified: classifiedCount,
        })
      }
      continue
    }

    crawledCount++

    // Steps 1-3: classify + GEO detect + word count.
    // Extracted verbatim into page-enrichment.ts so the #930 canonical-inventory
    // activation can enrich *before* deciding whether to write. Behaviour here is
    // unchanged: classification failure falls back to 'other' without counting.
    const enriched = await enrichCrawledPage(crawl)
    if (enriched.classified) classifiedCount++
    const {
      pageType,
      topics,
      primaryKeyword,
      classificationConfidence,
      hasGeoBlock,
      geoDetectionMethod,
      geoConfidence,
      wordCount,
    } = enriched

    // Step 4: Upsert to client_site_pages
    let pagePath = '/'
    try { pagePath = new URL(crawl.url).pathname } catch { /* keep default */ }

    try {
      const { error: upsertError } = await supabase
        .from('client_site_pages')
        .upsert(
          {
            client_id: clientId,
            url: crawl.url,
            path: pagePath,
            title: crawl.title,
            // undefined = not captured (keep old value); null = confirmed absent (clear it).
            ...(crawl.metaDescription !== undefined ? { meta_description: crawl.metaDescription } : {}),
            markdown_content: crawl.markdown,
            word_count: wordCount,
            page_type: pageType,
            topics,
            primary_keyword: primaryKeyword,
            classification_confidence: classificationConfidence,
            has_geo_block: hasGeoBlock,
            geo_detection_method: geoDetectionMethod,
            geo_confidence: geoConfidence,
            status_code: crawl.statusCode,
            crawled_at: crawl.crawledAt.toISOString(),
            crawl_status: 'crawled',
            // 以前被挡、这次读到了：清掉旧的拦截原因，排查指南让人看的就是这一列。
            crawl_error: null,
          },
          { onConflict: 'client_id,url' }
        )

      if (upsertError) {
        failed.push({ url: crawl.url, error: upsertError.message })
      } else {
        successful.push(crawl.url)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failed.push({ url: crawl.url, error: message })
    }

    // Periodic progress update
    if ((i + 1) % PROGRESS_UPDATE_INTERVAL === 0) {
      await runner.updateProgress(jobId, {
        totalUrlsCrawled: crawledCount,
        totalPagesClassified: classifiedCount,
      })
    }
  }

  // Final progress flush (captures remainder after last interval)
  await runner.updateProgress(jobId, {
    totalUrlsCrawled: crawledCount,
    totalPagesClassified: classifiedCount,
  })

  return { successful, failed }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/** Marker `crawlAndClassifyPages` appends to a blocked page's failure when its DB mark failed. */
const MARK_FAILED_MARKER = '; mark failed: '

/** Marker `crawlAndClassifyPages` appends to a failed crawl when recording the attempt failed. */
const RECORD_FAILED_MARKER = '; record failed: '

/**
 * One-line summary of blocked pages whose database mark failed, or null when none did.
 * Saved on the completed job so the reason is not left only in server logs.
 */
export function summarizeMarkFailures(failed: Array<{ url: string; error: string }>): string | null {
  const marks = failed.filter((f) => f.error.includes(MARK_FAILED_MARKER))
  if (marks.length === 0) return null
  const reason = marks[0].error.split(MARK_FAILED_MARKER)[1] ?? ''
  return `${marks.length} 个被防火墙挡住的页面没能标记上（第一个原因：${reason.slice(0, 200)}）`
}

/**
 * One-line summary of failed crawls whose attempt record could not be written, or null when none did.
 * Saved on the completed job so the reason is not left only in server logs.
 */
export function summarizeRecordFailures(failed: Array<{ url: string; error: string }>): string | null {
  const records = failed.filter((f) => f.error.includes(RECORD_FAILED_MARKER))
  if (records.length === 0) return null
  const reason = records[0].error.split(RECORD_FAILED_MARKER)[1] ?? ''
  return `${records.length} 个抓取失败的页面没能记录失败时间（第一个原因：${reason.slice(0, 200)}）`
}

const HISTORY_PAGE_SIZE = 1000
const HISTORY_MAX_PAGES = 50

interface CrawlHistoryRow {
  url: string
  crawled_at: string | null
  crawl_status: string | null
}

/**
 * Read every crawl-history row for a client, paging past the default row cap.
 * Returns null on any page error so the caller can fall back to sitemap order.
 */
async function readCrawlHistory(
  supabase: SupabaseClient,
  clientId: string,
): Promise<CrawlHistoryRow[] | null> {
  const rows: CrawlHistoryRow[] = []
  for (let page = 0; page < HISTORY_MAX_PAGES; page++) {
    const from = page * HISTORY_PAGE_SIZE
    const { data, error } = await supabase
      .from('client_site_pages')
      .select('url, crawled_at, crawl_status')
      .eq('client_id', clientId)
      .order('url', { ascending: true })
      .range(from, from + HISTORY_PAGE_SIZE - 1)
    if (error || !data) {
      console.warn('[site-audit] could not read crawl history, keeping sitemap order:', error?.message)
      return null
    }
    rows.push(...(data as CrawlHistoryRow[]))
    if (data.length < HISTORY_PAGE_SIZE) break
  }
  return rows
}

/**
 * Reorder discovered URLs so the longest-unrefreshed pages come first. Only matters
 * when the cap will cut something; a read failure keeps sitemap order (the old behaviour).
 */
async function orderByStaleness(
  supabase: SupabaseClient,
  clientId: string,
  urls: string[],
): Promise<string[]> {
  try {
    const data = await readCrawlHistory(supabase, clientId)
    if (!data) return urls
    const crawledAt = new Map<string, string>()
    for (const row of data) {
      // 'crawled' = real refresh; 'failed' = attempt time (back off repeat failures).
      // Anti-bot challenged / pending pages were never refreshed, so they stay first in line.
      const attempted = row.crawl_status === 'crawled' || row.crawl_status === 'failed'
      if (row.crawled_at && attempted) crawledAt.set(row.url, row.crawled_at)
    }
    return orderStalestFirst(urls, crawledAt)
  } catch (err) {
    console.warn('[site-audit] could not read crawl history, keeping sitemap order:', err instanceof Error ? err.message : String(err))
    return urls
  }
}

/**
 * Execute a single site-audit job identified by `jobId`.
 *
 * Flow:
 *   1. JobRunner.startJob         — mark in_progress
 *   2. discoverSitemapUrls        — URL discovery
 *   3. JobRunner.updateProgress   — record discovered count
 *   4. crawlAndClassifyPages      — crawl + classify + GEO + DB upsert
 *   5a. JobRunner.completeJob     — on success
 *   5b. JobRunner.failJob         — on unrecoverable error
 */
export async function executeJob(
  supabase: SupabaseClient,
  jobId: string,
  options?: ExecuteJobOptions
): Promise<void> {
  if (!jobId) throw new Error('Job ID is required')

  const runner = new JobRunner(supabase)

  // 1. Transition to in_progress
  const job = await runner.startJob(jobId)

  const resolvedOptions: ExecuteJobOptions = {
    maxPages: options?.maxPages ?? job.max_pages ?? DEFAULT_MAX_PAGES,
    rateLimitMs: options?.rateLimitMs ?? job.rate_limit_ms ?? DEFAULT_RATE_LIMIT_MS,
  }

  try {
    // 2. Discover URLs
    let urls: string[]
    try {
      urls = await discoverSitemapUrls(job.domain)
    } catch (discoverErr) {
      const message =
        discoverErr instanceof Error ? discoverErr.message : String(discoverErr)
      await runner.failJob(jobId, `URL discovery failed: ${message}`, [])
      return
    }

    // 3. Record discovered count
    await runner.updateProgress(jobId, { totalUrlsDiscovered: urls.length })

    if (urls.length === 0) {
      // No URLs found — fail with a user-visible message so the UI can surface it
      await runner.failJob(
        jobId,
        'No pages found. The site may block automated access (WAF/robots.txt) or the domain may be unreachable. Check that the domain is correct and publicly accessible.',
        [],
      )
      return
    }

    // 3b. If the site has more pages than the cap, crawl the stalest first so
    //     the same tail is not skipped every run (2026-10-05 CTS: 179 pages, cap 150).
    const orderedUrls = await orderByStaleness(supabase, job.client_id, urls)

    // 4. Crawl, classify, GEO-detect, upsert
    const { successful, failed } = await crawlAndClassifyPages(
      supabase,
      job.client_id,
      orderedUrls,
      jobId,
      resolvedOptions
    )

    // 5a. Complete
    await runner.updateProgress(jobId, {
      totalUrlsCrawled: successful.length + failed.length,
      totalPagesClassified: successful.length,
    })
    const failedUrls = failed.map((f) => f.url)
    const note = [
      summarizeMarkFailures(failed),
      summarizeRecordFailures(failed),
      summarizeCapSkips(urls.length, resolvedOptions.maxPages ?? DEFAULT_MAX_PAGES),
    ].filter((n): n is string => n !== null).join('；')
    if (note) {
      await runner.completeJob(jobId, failedUrls, note)
    } else {
      await runner.completeJob(jobId, failedUrls)
    }
  } catch (err) {
    // 5b. Fail on unrecoverable error
    const message = err instanceof Error ? err.message : String(err)
    await runner.failJob(jobId, message, [])
  }
}
