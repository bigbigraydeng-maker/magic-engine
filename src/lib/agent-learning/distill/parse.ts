/**
 * 蒸馏输出解析（纯函数）：只接受受约束的 JSON schema，多余字段一律丢弃。
 * 来源卡（专家/链接/日期/领域）只从调用方传入的 ctx 取，模型输出永远改不了它，
 * 也不可能产出 `state` 或 `adopted`。
 */

import type { DistilledRule, ExpertDomain, Result } from '@/lib/agent-learning/contracts'
import { guardRuleText, looksLikeInjection, URL_RE } from '@/lib/agent-learning/distill/guard'

/** 每条内容最多保留的规则条数（宁缺毋滥，0 条合法） */
export const MAX_RULES_PER_ITEM = 5

/** 原文引用的最大字符数（≤2 行） */
export const MAX_QUOTE_CHARS = 280

/** 单条规则句的最大字符数（超出不截断，直接丢弃该条） */
export const MAX_RULE_CHARS = 300

/** 解析上下文：来源卡的可信字段全部来自这里，不来自模型输出 */
export interface ParseContext {
  expert: string
  url: string
  publishedAt: string
  domain: ExpertDomain
}

/** 被丢弃的一条规则及原因，供回执计数与日志使用（只放序号与原因，不放正文） */
export interface DroppedRule {
  index: number
  reason:
    | 'injection_suspected'
    | 'contains_url'
    | 'contains_author_number'
    | 'bad_shape'
    | 'quote_too_long'
    | 'rule_too_long'
}

/** 单条规则的丢弃原因 */
type DroppedReason = DroppedRule['reason']

/** 单条规则的解析结果：要么是成型的规则，要么是丢弃原因 */
type OneRuleOutcome = { ok: true; value: DistilledRule } | { ok: false; reason: DroppedReason }

/** 普通对象判定：排除 null、数组与原始值，避免把任意 JSON 当对象读 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 行数统计：按 \n 切（兼容 \r\n），用于"引用不超过 2 行" */
function countLines(text: string): number {
  return text.split(/\r?\n/).length
}

/**
 * 非规则正文（rationale / quote / authorClaims.text）的守护：先查注入，再查链接。
 * 数字不在拦截范围内——作者给的数字正是要保留在 quote / authorClaims 里的东西。
 * `URL_RE` 没有 `g` 标志，`.test` 无状态，可安全重复调用。
 */
function untrustedTextReason(text: string): 'injection_suspected' | 'contains_url' | null {
  if (looksLikeInjection(text)) return 'injection_suspected'
  if (URL_RE.test(text)) return 'contains_url'
  return null
}

/** 解析 authorClaims：缺省视为空数组；给了但不合法整条丢弃（不做部分保留） */
function parseAuthorClaims(
  value: unknown,
): { ok: true; value: Array<{ text: string; kind: 'number' | 'result' }> } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: [] }
  if (!Array.isArray(value)) return { ok: false }

  const entries: unknown[] = value
  const claims: Array<{ text: string; kind: 'number' | 'result' }> = []

  for (const entry of entries) {
    if (!isPlainObject(entry)) return { ok: false }
    const claimText = entry.text
    const claimKind = entry.kind
    if (typeof claimText !== 'string' || claimText.trim() === '') return { ok: false }
    if (claimKind !== 'number' && claimKind !== 'result') return { ok: false }
    claims.push({ text: claimText.trim(), kind: claimKind })
  }

  return { ok: true, value: claims }
}

/**
 * 逐条检查 authorClaims 的文本；返回第一条命中的原因，全部干净则 null。
 */
function claimsReason(claims: Array<{ text: string }>): 'injection_suspected' | 'contains_url' | null {
  for (const claim of claims) {
    const reason = untrustedTextReason(claim.text)
    if (reason) return reason
  }
  return null
}

/**
 * 解析单条规则：形状 → 规则句长度 → 引用长度 → 规则句守护 → rationale → quote → authorClaims。
 * 顺序固定，保证同一输入永远得到同一个原因；任何一步不过都只丢这一条。
 */
function parseOneRule(rawRule: unknown, ctx: ParseContext): OneRuleOutcome {
  if (!isPlainObject(rawRule)) return { ok: false, reason: 'bad_shape' }

  const rawRuleText = rawRule.rule
  const rawRationale = rawRule.rationale
  const rawQuote = rawRule.quote

  if (typeof rawRuleText !== 'string' || rawRuleText.trim() === '') {
    return { ok: false, reason: 'bad_shape' }
  }
  if (typeof rawRationale !== 'string') return { ok: false, reason: 'bad_shape' }
  if (typeof rawQuote !== 'string') return { ok: false, reason: 'bad_shape' }

  const claims = parseAuthorClaims(rawRule.authorClaims)
  if (!claims.ok) return { ok: false, reason: 'bad_shape' }

  const ruleText = rawRuleText.trim()
  const rationale = rawRationale.trim()
  const quote = rawQuote.trim()

  if (ruleText.length > MAX_RULE_CHARS) return { ok: false, reason: 'rule_too_long' }
  if (quote === '' || countLines(quote) > 2 || quote.length > MAX_QUOTE_CHARS) {
    return { ok: false, reason: 'quote_too_long' }
  }

  const verdict = guardRuleText(ruleText)
  if (!verdict.ok) return { ok: false, reason: verdict.reason }

  const rationaleReason = untrustedTextReason(rationale)
  if (rationaleReason) return { ok: false, reason: rationaleReason }

  const quoteReason = untrustedTextReason(quote)
  if (quoteReason) return { ok: false, reason: quoteReason }

  const claimsReasonResult = claimsReason(claims.value)
  if (claimsReasonResult) return { ok: false, reason: claimsReasonResult }

  return {
    ok: true,
    value: {
      rule: ruleText,
      rationale,
      sourceCard: {
        expert: ctx.expert,
        url: ctx.url,
        publishedAt: ctx.publishedAt,
        domain: ctx.domain,
        quote,
        videoTimestampSec: null,
      },
      authorClaims: claims.value,
    },
  }
}

/**
 * 解析模型原始输出：JSON 不合法或顶层形状不对 → 整体失败；
 * 单条不合法 → 只丢这一条并进 dropped。返回的规则只含白名单字段。
 */
export function parseDistillOutput(
  raw: string,
  ctx: ParseContext,
): Result<{ rules: DistilledRule[]; dropped: DroppedRule[] }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'distill_output_not_json', code: 'validation' }
  }

  if (!isPlainObject(parsed) || !Array.isArray(parsed.rules)) {
    return { ok: false, error: 'distill_output_bad_shape', code: 'validation' }
  }

  const rawRules: unknown[] = parsed.rules
  if (rawRules.length > MAX_RULES_PER_ITEM) {
    return { ok: false, error: 'distill_output_too_many_rules', code: 'validation' }
  }

  const rules: DistilledRule[] = []
  const dropped: DroppedRule[] = []

  rawRules.forEach((rawRule, index) => {
    const outcome = parseOneRule(rawRule, ctx)
    if (outcome.ok) rules.push(outcome.value)
    else dropped.push({ index, reason: outcome.reason })
  })

  return { ok: true, value: { rules, dropped } }
}
