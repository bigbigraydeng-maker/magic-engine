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
      failed.push({ url: crawl.url, error: crawl.error ?? `antibot_${crawl.antibot.kind}` })
      crawledCount++
      let pagePath = '/'
      try { pagePath = new URL(crawl.url).pathname } catch { /* keep default */ }
      // Mark the row so subsequent diagnostic / page-rewriter passes can skip
      // these URLs until the underlying allowlist / IP issue is fixed.
      // NOTE: we explicitly DON'T pass title / markdown_content / word_count
      // — Supabase upsert with onConflict only overwrites the columns we
      // include, so previously-captured real data on this URL stays put.
      try {
        await supabase
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
      } catch {
        // Don't block the batch on a single upsert failure
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

    // 4. Crawl, classify, GEO-detect, upsert
    const { successful, failed } = await crawlAndClassifyPages(
      supabase,
      job.client_id,
      urls,
      jobId,
      resolvedOptions
    )

    // 5a. Complete
    await runner.updateProgress(jobId, {
      totalUrlsCrawled: successful.length + failed.length,
      totalPagesClassified: successful.length,
    })
    await runner.completeJob(jobId)
  } catch (err) {
    // 5b. Fail on unrecoverable error
    const message = err instanceof Error ? err.message : String(err)
    await runner.failJob(jobId, message, [])
  }
}
