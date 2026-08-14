/**
 * Magic Engine 2.0 · 抓取 + 富集阶段（Issue #930 · #960）
 *
 * 🔴 从 `activation.ts` 抽出来的原因只有一个：那个文件到 800 行了（CLAUDE.md 硬规则）。
 *    职责本来就是独立的一段 —— 闸门全过之后才会走到这里，这里一行闸门逻辑都没有。
 *
 * 🔴 抓取与富集**全部注入**，本文件不实现任何采集逻辑，也不 import supabase。
 */

import type { ActivationDeps, AcceptedPageRecord } from './types'
import type { CrawlResult } from '../crawler'
import type { EnrichedPage } from '../page-enrichment'

export interface CrawlOutcome {
  readonly records: readonly AcceptedPageRecord[]
  readonly failures: readonly { url: string; error: string }[]
}

function unexpectedText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---------------------------------------------------------------------------
// 抓取 + 富集（复用现有 site-audit，不另起一套）
// ---------------------------------------------------------------------------

export async function crawlAndEnrich(urls: readonly string[], deps: ActivationDeps): Promise<CrawlOutcome> {
  const records: AcceptedPageRecord[] = []
  const failures: { url: string; error: string }[] = []

  // 抓取结果里 antibot 挑战页也带 `error`，所以下面那道 error 判定同时挡住
  // 「WAF 拦截页被当成真页面写进台账」—— 那是 2026-06-20 Oztop 事故的形状。
  let crawled: readonly CrawlResult[]
  try {
    crawled = await deps.crawl(urls)
  } catch (err) {
    return { records: [], failures: urls.map((url) => ({ url, error: `crawl batch failed: ${unexpectedText(err)}` })) }
  }

  const byUrl = new Map(crawled.map((r) => [r.url, r]))
  for (const url of urls) {
    const result = byUrl.get(url)
    if (result === undefined) {
      // 抓取器没返回这一条 —— 不许当成「跳过」，它就是失败。
      failures.push({ url, error: 'crawler returned no result for this accepted URL' })
      continue
    }
    if (result.error !== undefined && result.error.length > 0) {
      failures.push({ url, error: result.error })
      continue
    }
    const shapeError = crawlResultShapeError(result)
    if (shapeError !== null) {
      failures.push({ url, error: shapeError })
      continue
    }
    const outcome = await enrichOne(url, result, deps)
    if (outcome.record !== null) records.push(outcome.record)
    else failures.push({ url, error: outcome.error })
  }
  return { records, failures }
}

/**
 * 抓取结果里「下面真的会去解引用」的字段。
 *
 * 🔴 `crawledAt.toISOString()` 在注入的抓取器返回字符串型 `crawledAt` 时会直接抛 ——
 *    而那一刻**已经跑完了 N 次真实网络请求**，调用方却拿不到审计。
 *    注入方虽然在信任边界内，但 `buildAudit` 存在的全部理由就是
 *    「入参不是我以为的类型时也要交得出账」。
 */
function crawlResultShapeError(result: CrawlResult): string | null {
  if (!(result.crawledAt instanceof Date) || Number.isNaN(result.crawledAt.getTime())) {
    return 'crawler returned a result whose crawledAt is not a valid Date'
  }
  if (typeof result.title !== 'string' || typeof result.markdown !== 'string') {
    return 'crawler returned a result whose title / markdown is not a string'
  }
  return null
}

/**
 * 富集一页。
 *
 * 🔴 富集契约上「永不抛」，但注入进来的实现不归我们管。让它把整个
 *    `activateReviewedPlan()` reject 掉，调用方就既拿不到审计、也没法按 status 判结局。
 */
async function enrichOne(
  url: string,
  result: CrawlResult,
  deps: ActivationDeps,
): Promise<{ record: AcceptedPageRecord | null; error: string }> {
  let enriched: EnrichedPage
  try {
    enriched = await deps.enrich({ url, title: result.title, markdown: result.markdown })
  } catch (err) {
    return { record: null, error: `enrichment threw: ${unexpectedText(err)}` }
  }
  if (!enriched.classified) {
    // 台账要给 WP05 当页面身份用，分类失败的页面不许以 `other` 蒙混进去。
    return { record: null, error: `classification failed: ${enriched.classificationError ?? 'unknown'}` }
  }
  return { record: toPageRecord(url, result, enriched), error: '' }
}

/** 把一页抓取结果 + 富集结果拼成台账记录。字段只用 `client_site_pages` 已有的列。 */
function toPageRecord(url: string, result: CrawlResult, enriched: EnrichedPage): AcceptedPageRecord {
  return {
    canonicalUrl: url,
    path: new URL(url).pathname,
    title: result.title,
    markdown: result.markdown,
    wordCount: enriched.wordCount,
    pageType: enriched.pageType,
    topics: enriched.topics,
    primaryKeyword: enriched.primaryKeyword,
    classificationConfidence: enriched.classificationConfidence,
    hasGeoBlock: enriched.hasGeoBlock,
    geoDetectionMethod: enriched.geoDetectionMethod,
    geoConfidence: enriched.geoConfidence,
    crawledAt: result.crawledAt.toISOString(),
  }
}
