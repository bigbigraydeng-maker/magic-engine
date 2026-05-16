/**
 * 张骞 SERP 覆盖率护栏 — 确定性兜底，避免 LLM 跳过 fetch_serp_results。
 *
 * 即使 prompts.ts 已经把 fetch_serp_results 标为"必跑"，LLM 在长上下文 + 紧预算下
 * 仍可能跳过这个工具（cyhbnz.com 11 次 tool call 0 次 SERP 就是实例）。
 *
 * 这里实现 ensureSerpCoverage：落库前若 report.serp_results 为空，
 * 自动从 seed_keywords / ai_tracker_questions 挑 1-2 个类目/本地词，
 * 直接调 apify google-search-scraper 补跑，写回 report。
 *
 * 选词策略：
 *   1. 优先 seed_keywords 里非 brand 类（category/local/long_tail/intent）的前 N 个
 *   2. 不够再回退到 ai_tracker_questions 里 category='category' 或 'local' 的问句
 *
 * 选词不挑 brand 类是因为：搜品牌词自己永远第一名，对诊断毫无价值。
 */

import type {
  DiscoveryReport,
  DiscoveredKeyword,
  DiscoveredAiQuestion,
  DiscoveredSerpResult,
} from './types'
import { scrapeGoogleSerp } from '../apify/google-search-scraper'

// ─── Constants ───────────────────────────────────────────────────────────────

const TARGET_SERP_QUERIES = 2
const PER_QUERY_TIMEOUT_MS = 60_000

// ─── 选词逻辑 ────────────────────────────────────────────────────────────────

/**
 * Heuristic: a keyword is "brand-y" if its category is 'brand' OR if it contains
 * a token that looks like the brand name (very long words, all-caps abbrev, etc).
 * We can't always trust the category field, so we also filter out anything that
 * matches the domain stem.
 */
function isBrandKeyword(kw: DiscoveredKeyword, domainStem: string): boolean {
  // 注意：DiscoveredKeyword 用 `type` 字段（不是 category），KeywordType 含 'brand'。
  if (kw.type === 'brand') return true
  const text = kw.keyword.toLowerCase()
  return domainStem.length >= 3 && text.includes(domainStem)
}

function domainStem(domain: string): string {
  // cyhbnz.com → cyhbnz
  return domain.split('.')[0]?.toLowerCase() ?? ''
}

/**
 * Pick up to `n` non-brand category/local queries from seed_keywords first,
 * then fall back to ai_tracker_questions of category 'category' or 'local'.
 * Returns deduped queries with their country code.
 */
export function pickFallbackQueries(
  report: DiscoveryReport,
  n: number = TARGET_SERP_QUERIES,
): Array<{ query: string; country: 'au' | 'nz' }> {
  const stem = domainStem(report.domain)
  const country: 'au' | 'nz' =
    report.business.location.country === 'NZ' ? 'nz' : 'au'

  const picks: string[] = []
  const seen = new Set<string>()

  const add = (q: string) => {
    const key = q.trim().toLowerCase()
    if (!key || seen.has(key) || picks.length >= n) return
    seen.add(key)
    picks.push(q.trim())
  }

  // 1. seed_keywords — 非 brand
  for (const kw of report.seed_keywords) {
    if (picks.length >= n) break
    if (!isBrandKeyword(kw, stem)) add(kw.keyword)
  }

  // 2. ai_tracker_questions — 仅 category / local
  if (picks.length < n) {
    for (const q of report.ai_tracker_questions) {
      if (picks.length >= n) break
      if (q.category === 'category' || q.category === 'local') add(q.question)
    }
  }

  return picks.map(query => ({ query, country }))
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export interface SerpCoverageResult {
  applied: boolean
  queriesAdded: number
  apifyCallsAdded: number
  estimatedExtraCostUsd: number
  errors: string[]
}

const SERP_COST_PER_CALL = 0.005  // 与 prompt 描述对齐

/**
 * 落库前的护栏。若 report.serp_results 为空（或不存在），自动挑 1-2 个非品牌词
 * 调 apify 补跑，把结果塞回 report.serp_results。
 *
 * 永远不抛错——任何 apify 失败都被吞下，记录在 errors 数组里供日志查看。
 * 这是"尽量帮"的兜底，不能因为它失败把整个张骞 run 弄崩。
 */
export async function ensureSerpCoverage(
  report: DiscoveryReport,
): Promise<{ report: DiscoveryReport; result: SerpCoverageResult }> {
  const existing = report.serp_results ?? []
  if (existing.length > 0) {
    return {
      report,
      result: {
        applied: false,
        queriesAdded: 0,
        apifyCallsAdded: 0,
        estimatedExtraCostUsd: 0,
        errors: [],
      },
    }
  }

  const queries = pickFallbackQueries(report)
  if (queries.length === 0) {
    return {
      report,
      result: {
        applied: false,
        queriesAdded: 0,
        apifyCallsAdded: 0,
        estimatedExtraCostUsd: 0,
        errors: ['no fallback queries available — seed_keywords + ai_tracker_questions empty or all brand'],
      },
    }
  }

  const newResults: DiscoveredSerpResult[] = []
  const errors: string[] = []

  for (const { query, country } of queries) {
    try {
      const scraped = await withTimeout(scrapeGoogleSerp(query, country), PER_QUERY_TIMEOUT_MS)
      newResults.push(scraped)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`SERP fallback "${query}" (${country}) failed: ${msg}`)
    }
  }

  const clampedReport: DiscoveryReport = {
    ...report,
    serp_results: newResults,
  }

  return {
    report: clampedReport,
    result: {
      applied: newResults.length > 0,
      queriesAdded: newResults.length,
      apifyCallsAdded: queries.length,  // 不管成败都算花了 apify quota
      estimatedExtraCostUsd: Number((queries.length * SERP_COST_PER_CALL).toFixed(4)),
      errors,
    },
  }
}

// ─── Internal ────────────────────────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ])
}
