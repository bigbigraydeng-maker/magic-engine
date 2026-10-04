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
  markdown_content: string | null
}

export function countMarkdownLinks(markdown: string | null): number {
  if (!markdown) return 0
  return (markdown.match(/\]\(https?:\/\/[^)\s]+\)|\]\(\/[^)\s]*\)/g) ?? []).length
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

const ANTIBOT_MARKERS = ['robot challenge screen', 'robot-suspicion', 'just a moment...']

function looksBlocked(p: CrawledPage): boolean {
  const md = (p.markdown_content ?? '').toLowerCase()
  return ANTIBOT_MARKERS.some(m => md.includes(m))
}

export function verifyPlanItem(
  item: OpenPlanItem,
  ctx: { blogs: BlogRow[]; pages: CrawledPage[]; config: SeoLoopConfig },
): VerifyDecision {
  const steps = item.steps_json
  const verify = asRecord(steps.verify)
  const created = Date.parse(item.created_at)

  if (verify.type === 'blog_published') {
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
    const page = ctx.pages.find(p => slug !== '' && p.url.toLowerCase().includes(`/${slug}`))
    if (!page || page.crawled_at === null || Date.parse(page.crawled_at) < publishedAt) {
      return { outcome: 'not_measured', reason: '文章已发布，但站点抓取还没覆盖到它，待下次抓取' }
    }
    if (page.status_code === 200 && page.crawl_status === 'crawled' && !looksBlocked(page)) {
      return { outcome: 'pass', reason: `文章已发布且线上网址可访问（抓取 ${page.crawled_at.slice(0, 10)}）` }
    }
    return { outcome: 'not_measured', reason: `文章已发布，但抓取结果异常（状态码 ${page.status_code ?? '未知'}）` }
  }

  if (verify.type === 'page_strengthened') {
    const url = typeof steps.url === 'string' ? canonicalUrl(steps.url) : null
    if (!url) return { outcome: 'not_measured', reason: '清单项没有页面网址，无法核对' }
    const page = ctx.pages.find(p => canonicalUrl(p.url) === url)
    if (!page) return { outcome: 'not_measured', reason: '站点抓取里没有这个页面' }
    if (page.crawl_status !== 'crawled' || looksBlocked(page)) {
      return { outcome: 'not_measured', reason: '该页最近一次抓取失败或被拦截' }
    }
    if (page.crawled_at === null || Date.parse(page.crawled_at) <= created) {
      return { outcome: 'not_measured', reason: '清单创建后站点还没有重新抓取过这个页面' }
    }
    const baseline = asRecord(steps.baseline)
    const baseWords = typeof baseline.word_count === 'number' ? baseline.word_count : null
    const baseLinks = typeof baseline.link_count === 'number' ? baseline.link_count : null
    const wordGain = baseWords !== null && page.word_count !== null ? page.word_count - baseWords : null
    const linkGain = baseLinks !== null ? countMarkdownLinks(page.markdown_content) - baseLinks : null
    if (wordGain === null && linkGain === null) {
      return { outcome: 'not_measured', reason: '没有创建当天的字数/内链基线，无法比较' }
    }
    if (
      (wordGain !== null && wordGain >= ctx.config.strengthenMinWordGain) ||
      (linkGain !== null && linkGain >= ctx.config.strengthenMinLinkGain)
    ) {
      return {
        outcome: 'pass',
        reason: `页面有实质改动：字数 ${wordGain === null ? '—' : (wordGain >= 0 ? '+' : '') + wordGain}、内链 ${linkGain === null ? '—' : (linkGain >= 0 ? '+' : '') + linkGain}（抓取 ${page.crawled_at.slice(0, 10)}）`,
      }
    }
    return { outcome: 'pending', reason: '页面已重新抓取，但字数和内链都没有明显增加' }
  }

  return { outcome: 'not_measured', reason: '未知的核对类型' }
}
