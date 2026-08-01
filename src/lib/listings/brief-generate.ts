/**
 * 房子档案的生成链:房源页 → AI 做功课 → 结构化 draft。
 *
 * 链路(每一环缺了会怎样,写在各自的注释里):
 *   ① Jina Reader 读房源页 —— 房源页是**动态渲染**的,普通 fetch 拿回来是空壳;
 *      Jina 会渲染,所以能拿到完整正文(实测 Ray White 页面:地址 / 价格方式 /
 *      户型 / 完整营销描述 / 经手人 / 面积全在)。复用 lib/brief/jina.ts,
 *      不另写一套 —— 那一份已经被 7 个模块在用,重试和超时都调过。
 *   ② Claude + web_search —— 市场数据(中位价 / 同比 / 租金回报)必须来自当下的
 *      公开网页,而且 web_search 会把 citation 一起带回来,所以「这个数哪来的」
 *      是可核对的,不是模型嘴上说的。
 *   ③ brief-schema 硬校验 —— 非法枚举 / 没出处的数字一律拒收(见该文件头)。
 *
 * 生成出来的一律是 draft。没有人看过的东西不许直接生效。
 */

import { fetchUrlAsMarkdown } from '@/lib/brief/jina'
import { callClaudeWithWebSearch, parseJsonResponse, MODEL_SONNET } from '@/lib/anthropic/client'
import { getClientLocale } from '@/lib/locale/client-locale'
import { LISTING_BRIEF_SYSTEM_PROMPT, buildBriefUserMessage } from './brief-prompt'
import { normalizeAiDraft, type ListingBriefContent } from './brief-schema'
import { insertBriefDraft, type ListingBriefRow } from './brief-queries'
import { fetchListingAdReference } from './ad-benchmark-queries'
import type { AdReferenceBlock } from './ad-benchmarks'
import type { ListingRow } from './queries'

const MAX_OUTPUT_TOKENS = 6000
const MAX_WEB_SEARCHES = 6

export interface GenerateBriefInput {
  listing: ListingRow
  /** 房源页链接。可选,但没有它 AI 只能靠 ME 里已知的那几个字段。 */
  pageUrl?: string | null
}

export type GenerateBriefResult =
  | { ok: true; brief: ListingBriefRow; warnings: string[] }
  | { ok: false; status: 400 | 500 | 502; error: string; warnings: string[] }

/** 只放行 http(s) —— 别让人把 file:// 或内网地址塞进抓取器。 */
export function normalizeListingUrl(raw: unknown): { ok: true; url: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, url: null }
  if (typeof raw !== 'string') return { ok: false, error: '房源页链接必须是文本' }
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: true, url: null }
  if (trimmed.length > 1000) return { ok: false, error: '房源页链接太长' }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, error: '房源页链接不是一个合法的网址' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: '房源页链接只支持 http / https' }
  }
  return { ok: true, url: parsed.toString() }
}

/** 读房源页。读不到不算致命 —— 降级成「没有页面正文」继续跑,但会留下警告。 */
async function readListingPage(
  url: string | null,
  warnings: string[],
): Promise<string | null> {
  if (!url) return null
  try {
    const page = await fetchUrlAsMarkdown(url)
    if (!page.markdown.trim()) {
      warnings.push('房源页读回来是空的,这次没有页面正文可用。')
      return null
    }
    return page.markdown
  } catch (err) {
    warnings.push(`房源页没读到(${err instanceof Error ? err.message : String(err)}),这次只用系统里已有的信息。`)
    return null
  }
}

/**
 * 模型返回的 source 网址,能不能在这次真的看过的东西里找到出处。
 *
 * 对不上不代表一定是编的(模型可能引用了页面内部提到的链接),所以这里**只警告
 * 不拦截** —— 拦截会把正常情况也挡掉。但人在校正界面上应该看到这一行,
 * 因为「查不到出处的出处」正是最该人工核一眼的地方。
 */
function flagUntraceableSources(
  content: ListingBriefContent,
  seenUrls: Set<string>,
  warnings: string[],
): void {
  const suspicious: string[] = []
  for (const entry of content.sources) {
    if (entry.kind !== 'cited' || !entry.url) continue
    if (!seenUrls.has(entry.url) && !suspicious.includes(entry.url)) suspicious.push(entry.url)
  }
  if (suspicious.length > 0) {
    warnings.push(
      `有 ${suspicious.length} 条「有出处」的网址不在这次实际打开过的页面里,请人工核一眼:${suspicious.slice(0, 3).join(' , ')}`,
    )
  }
}

interface ModelAttempt {
  content: ListingBriefContent | null
  error: string | null
  inputTokens: number
  citations: string[]
}

/** 调一次模型 + 解析 + 硬校验。失败时把原因带回去,给重试用。 */
async function attemptDraft(params: {
  systemPrompt: string
  userMessage: string
  country: 'AU' | 'NZ'
}): Promise<ModelAttempt> {
  const res = await callClaudeWithWebSearch({
    systemPrompt: params.systemPrompt,
    userMessage: params.userMessage,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxWebSearches: MAX_WEB_SEARCHES,
    country: params.country,
  })
  const tokens = res.input_tokens + res.output_tokens
  const citations = res.citations.map(c => c.url)

  let raw: unknown
  try {
    raw = parseJsonResponse<unknown>(res.text)
  } catch {
    return { content: null, error: 'AI 没有返回可解析的 JSON', inputTokens: tokens, citations }
  }

  const normalized = normalizeAiDraft(raw)
  if (!normalized.ok) {
    return { content: null, error: normalized.error, inputTokens: tokens, citations }
  }
  return { content: normalized.value, error: null, inputTokens: tokens, citations }
}

/**
 * 跑一次完整生成。
 *
 * 校验失败会**带着原因重试一次**:提示词已经把可选值写死了,模型偶尔还是会吐一个
 * 看着挺合理的新词。整份拒绝是对的(见 brief-schema 文件头),但直接把一次
 * 30–90 秒、要花钱的调用判死刑太浪费 —— 把错误原文丢回去,第二次基本都能改对。
 * 两次都不行才认输,并且把原因原样交给人看,不静默塞一份残缺档案进库。
 */
export async function generateListingBrief(input: GenerateBriefInput): Promise<GenerateBriefResult> {
  const warnings: string[] = []
  const { listing } = input

  const pageMarkdown = await readListingPage(input.pageUrl ?? null, warnings)

  let country: 'AU' | 'NZ' = 'NZ'
  let city: string | null = listing.city
  try {
    const locale = await getClientLocale(listing.client_id)
    country = locale.country
    city = listing.suburb || listing.city || locale.city
  } catch (err) {
    warnings.push(`没读到这个客户的市场设置,按新西兰处理(${err instanceof Error ? err.message : String(err)})。`)
  }

  // 我们自己投过什么。**参考材料**:提示词里连同「不许据此改排序」的禁令一起给,
  // 落库时挂在 ad_reference 单独一栏(见 ad-benchmarks.ts 纪律 ①)。
  // 取不到就是没有 —— 绝不因此中断生成。
  const adRef = await fetchListingAdReference(listing)
  if (adRef.warning) warnings.push(adRef.warning)
  const adReference: AdReferenceBlock | null = adRef.reference

  const userMessage = buildBriefUserMessage({
    listing,
    pageMarkdown,
    pageUrl: input.pageUrl ?? null,
    country,
    city,
    adReference,
  })

  let attempt: ModelAttempt
  try {
    attempt = await attemptDraft({ systemPrompt: LISTING_BRIEF_SYSTEM_PROMPT, userMessage, country })
    if (!attempt.content) {
      console.error('[listings/brief-generate] draft rejected, retrying', {
        listingId: listing.id,
        reason: attempt.error,
      })
      const retryMessage = `${userMessage}\n\n## Your previous answer was rejected\n\nReason: ${attempt.error}\n\nFix exactly that and return the JSON object again. Remember: only the listed enum values, and every number needs a source.`
      const retried = await attemptDraft({ systemPrompt: LISTING_BRIEF_SYSTEM_PROMPT, userMessage: retryMessage, country })
      attempt = { ...retried, inputTokens: attempt.inputTokens + retried.inputTokens }
    }
  } catch (err) {
    console.error('[listings/brief-generate] model call failed', { listingId: listing.id, err })
    return {
      ok: false,
      status: 502,
      error: `AI 调用失败: ${err instanceof Error ? err.message : String(err)}`,
      warnings,
    }
  }

  if (!attempt.content) {
    console.error('[listings/brief-generate] draft rejected twice', {
      listingId: listing.id,
      reason: attempt.error,
    })
    return { ok: false, status: 502, error: `AI 两次都没按要求返回:${attempt.error}`, warnings }
  }

  const seenUrls = new Set<string>(attempt.citations)
  if (input.pageUrl) seenUrls.add(input.pageUrl)
  flagUntraceableSources(attempt.content, seenUrls, warnings)

  const saved = await insertBriefDraft({
    listingId: listing.id,
    content: attempt.content,
    modelUsed: MODEL_SONNET,
    inputTokens: attempt.inputTokens,
    adReference,
  })
  if (!saved.ok) return { ok: false, status: 500, error: saved.error, warnings }

  return { ok: true, brief: saved.value, warnings }
}
