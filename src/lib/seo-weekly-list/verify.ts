/**
 * Verification of open list items — pure decisions, no I/O.
 *
 * Four outcomes, never mixed (docs v0.2 §三):
 *   pass          the artifact is really there
 *   pending       nothing observed yet (not a failure, not a pass)
 *   not_measured  we could not check (no crawl after the item, page blocked …)
 * "Expired / abandoned" is decided by age in the runner, not here.
 *
 * strengthen_page uses a PROXY (the page gained words or links since the item was
 * created). It proves the page really changed, nothing about traffic.
 *
 * page_changed accepts EITHER signal: a live auto title/description edit logged in
 * seo_meta_log, or the same word-count proxy used by page_strengthened.
 */

import { canonicalUrl } from '@/lib/url/canonical-url'
import type { SeoLoopConfig } from './config'

export type VerifyOutcome = 'pass' | 'pending' | 'not_measured'
export interface VerifyDecision {
  outcome: VerifyOutcome
  reason: string
}

export interface OpenPlanItem {
  id: string
  created_at: string
  steps_json: Record<string, unknown>
}

export interface BlogRow {
  primary_keyword: string | null
  status: string | null
  slug: string | null
  published_at: string | null
}

export interface CrawledPage {
  url: string
  status_code: number | null
  crawl_status: string | null
  crawled_at: string | null
  word_count: number | null
}

export interface MetaLogRow {
  page_url: string | null
  optimised_at: string | null
  reverted_at: string | null
  pr_url: string | null
  applied_channel: string | null
}

export interface VerifyContext {
  blogs: BlogRow[]
  pages: CrawledPage[]
  config: SeoLoopConfig
  metaLog?: MetaLogRow[]
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

/** An anti-bot challenge page crawls "fine" (HTTP 200) with ~60 words; a real article has hundreds. */
const REAL_PAGE_MIN_WORDS = 150

function looksBlocked(p: CrawledPage): boolean {
  return p.word_count === null || p.word_count < REAL_PAGE_MIN_WORDS
}

/** True when the page's last path segment is exactly the slug (never a prefix like /seo-tips for "seo"). */
function pageIsSlug(url: string, slug: string): boolean {
  const canon = canonicalUrl(url)
  if (!canon || slug === '') return false
  const segs = canon.slice(canon.indexOf('/')).split('/').filter(Boolean)
  return (segs[segs.length - 1] ?? '').toLowerCase() === slug
}

function verifyBlogPublished(item: OpenPlanItem, ctx: VerifyContext): VerifyDecision {
  const steps = item.steps_json
  const created = Date.parse(item.created_at)
  const kw = typeof steps.keyword === 'string' ? steps.keyword.trim().toLowerCase() : ''
  if (!kw) return { outcome: 'not_measured', reason: '清单项没有关键词，无法核对文章' }
  const post = ctx.blogs.find(
    b =>
      (b.primary_keyword ?? '').trim().toLowerCase() === kw &&
      b.status === 'published' &&
      b.published_at !== null &&
      Date.parse(b.published_at) >= created,
  )
  if (!post) return { outcome: 'pending', reason: '还没有该关键词的已发布文章' }
  const slug = (post.slug ?? '').toLowerCase()
  const publishedAt = Date.parse(post.published_at as string)
  const page = ctx.pages.find(p => pageIsSlug(p.url, slug))
  if (!page || page.crawled_at === null || Date.parse(page.crawled_at) < publishedAt) {
    return { outcome: 'not_measured', reason: '文章已发布，但站点抓取还没覆盖到它，待下次抓取' }
  }
  if (page.status_code === 200 && page.crawl_status === 'crawled' && !looksBlocked(page)) {
    return { outcome: 'pass', reason: `文章已发布且线上网址可访问（抓取 ${page.crawled_at.slice(0, 10)}）` }
  }
  return { outcome: 'not_measured', reason: `文章已发布，但抓取结果异常（状态码 ${page.status_code ?? '未知'}，字数 ${page.word_count ?? '未知'}）` }
}

function verifyPageStrengthened(item: OpenPlanItem, ctx: VerifyContext): VerifyDecision {
  const steps = item.steps_json
  const created = Date.parse(item.created_at)
  const url = typeof steps.url === 'string' ? canonicalUrl(steps.url) : null
  if (!url) return { outcome: 'not_measured', reason: '清单项没有页面网址，无法核对' }
  const page = ctx.pages.find(p => canonicalUrl(p.url) === url)
  if (!page) return { outcome: 'not_measured', reason: '站点抓取里没有这个页面' }
  if (page.crawl_status !== 'crawled' || looksBlocked(page)) {
    return { outcome: 'not_measured', reason: '该页最近一次抓取失败或疑似被拦截（字数异常少）' }
  }
  const baseline = asRecord(steps.baseline)
  // The page must have been crawled AFTER both the item and the baseline crawl, else
  // a change made before the item existed would read as this item's work.
  const baseCrawl = typeof baseline.crawled_at === 'string' ? Date.parse(baseline.crawled_at) : null
  const floor = Math.max(created, baseCrawl ?? 0)
  if (page.crawled_at === null || Date.parse(page.crawled_at) <= floor) {
    return { outcome: 'not_measured', reason: '清单创建后站点还没有重新抓取过这个页面' }
  }
  const baseWords = typeof baseline.word_count === 'number' ? baseline.word_count : null
  if (baseWords === null || page.word_count === null || baseCrawl === null) {
    return { outcome: 'not_measured', reason: '没有创建当天的字数基线（或基线没有抓取时间），无法比较' }
  }
  const wordGain = page.word_count - baseWords
  if (wordGain >= ctx.config.strengthenMinWordGain) {
    return { outcome: 'pass', reason: `页面正文实质变长：字数 +${wordGain}（抓取 ${page.crawled_at.slice(0, 10)}）` }
  }
  return { outcome: 'pending', reason: `页面已重新抓取，但字数只变化 ${wordGain >= 0 ? '+' : ''}${wordGain}，未达 ${ctx.config.strengthenMinWordGain}` }
}

/** Latest live PR-channel auto edit for this url applied at/after the item was created, or null. */
function latestLiveMetaEdit(url: string, created: number, metaLog: MetaLogRow[]): MetaLogRow | null {
  let best: MetaLogRow | null = null
  let bestAt = -Infinity
  for (const row of metaLog) {
    if (row.applied_channel !== 'pr' || row.reverted_at !== null) continue
    if (row.page_url === null || row.optimised_at === null) continue
    if (canonicalUrl(row.page_url) !== url) continue
    const at = Date.parse(row.optimised_at)
    if (Number.isNaN(at) || at < created) continue
    if (at > bestAt) {
      bestAt = at
      best = row
    }
  }
  return best
}

/** True when a PR-channel edit for this url was applied after creation and later reverted. */
function hasRevertedMetaEdit(url: string, created: number, metaLog: MetaLogRow[]): boolean {
  return metaLog.some(row => {
    if (row.applied_channel !== 'pr' || row.reverted_at === null) return false
    if (row.page_url === null || row.optimised_at === null) return false
    if (canonicalUrl(row.page_url) !== url) return false
    const at = Date.parse(row.optimised_at)
    return !Number.isNaN(at) && at >= created
  })
}

function verifyPageChanged(item: OpenPlanItem, ctx: VerifyContext): VerifyDecision {
  const steps = item.steps_json
  const created = Date.parse(item.created_at)
  const url = typeof steps.url === 'string' ? canonicalUrl(steps.url) : null
  if (!url) return { outcome: 'not_measured', reason: '清单项没有页面网址，无法核对' }
  const metaLog = ctx.metaLog ?? []
  const live = latestLiveMetaEdit(url, created, metaLog)
  if (live && live.optimised_at !== null) {
    const pr = live.pr_url ? `，${live.pr_url}` : ''
    return {
      outcome: 'pass',
      reason: `系统已自动改了这页的标题/描述并核实上线（${live.optimised_at.slice(0, 10)}${pr}）；这条只证明"改了"，效果以后续排名验收为准`,
    }
  }
  const fallback = verifyPageStrengthened(item, ctx)
  if (fallback.outcome !== 'pass' && hasRevertedMetaEdit(url, created, metaLog)) {
    return { ...fallback, reason: `${fallback.reason}（系统改的标题已被撤回）` }
  }
  return fallback
}

export function verifyPlanItem(item: OpenPlanItem, ctx: VerifyContext): VerifyDecision {
  const verify = asRecord(item.steps_json.verify)
  if (verify.type === 'blog_published') return verifyBlogPublished(item, ctx)
  if (verify.type === 'page_strengthened') return verifyPageStrengthened(item, ctx)
  if (verify.type === 'page_changed') return verifyPageChanged(item, ctx)
  return { outcome: 'not_measured', reason: '未知的核对类型' }
}
