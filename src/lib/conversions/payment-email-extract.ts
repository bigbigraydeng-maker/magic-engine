/**
 * 从「我们发出去的付款确认邮件」全文里，提取成交需要的事实：类型、金额、发票号、证据句。
 *
 * 纯函数：不碰网络、不碰数据库。判断「这封信是不是我们确认收款」完全复用
 * `mailchimp/paid-signal` 的 `readPaidSignal`（条件句 / 否定 / 疑问 / 催款 / 转发过滤全在那里，
 * 这里不另起一套）。本文件只做它之后的事：
 *
 *   1. 先剥掉引用链 / 内嵌转发 —— 全文比 255 字摘要多出来的最大风险就是引用里的旧金额、旧确认句；
 *   2. 在命中的确认句**同一句**里取金额；同句没有才看相邻句，且相邻句带 balance/due 等字样就不取；
 *   3. 金额候选不止一个 = `ambiguous`，不选 —— 选错一个就是把错误金额发给 Meta，撤不回；
 *   4. 绝不估算：找不到就是找不到（`missing`），不按价目表补，不按定金比例推。
 *
 * 币种默认值、发票号格式都是客户/行业配置，由调用方传进来（平台化红线 2）。
 */

import { isForwardedSubject, readPaidSignal, evidenceIsVerbatim } from '@/lib/mailchimp/paid-signal'
import { minorUnitsFor, toMinorUnits } from './money'

export type PaymentKind = 'deposit' | 'full' | 'balance' | 'unknown'
export type AmountIssue = 'missing' | 'ambiguous' | 'no_currency' | 'unsupported_currency'

export interface PaymentExtractConfig {
  /** 正文只写 `$` 没写币种时用的默认币种（客户配置，如 NZD）。null = 没配就不猜。 */
  defaultCurrency: string | null
  /** 发票号格式（客户配置）。不传用通用格式。每个正则第 1 捕获组是发票号。 */
  invoicePatterns?: readonly RegExp[]
}

export interface PaymentExtractInput {
  subject: string | null
  /** 完整正文（纯文本）。 */
  body: string
}

export type PaymentExtraction =
  | { status: 'not_confirmed' }
  | {
      status: 'confirmed'
      kind: PaymentKind
      /** 主单位金额的十进制字符串（如 "500.00"），不是浮点。 */
      amount: { value: string; currency: string } | null
      amountIssue: AmountIssue | null
      invoiceNo: string | null
      invoiceAmbiguous: boolean
      /** 逐字确认句（只在内存里用，不写库、不写审计）。 */
      evidence: string
      /** 触发降级的原因：任何一项存在都不得进自动车道。 */
      flags: Array<'forwarded' | 'embedded_forward' | 'quoted_chain_removed' | 'evidence_not_verbatim' | 'mixed_with_chasing'>
    }

// ── 1. 剥引用链 ─────────────────────────────────────────────────────────────

const FORWARD_MARKERS: readonly RegExp[] = [
  /^\s*-{2,}\s*forwarded message\s*-{2,}/im,
  /^\s*begin forwarded message:?/im,
]

const QUOTE_START_MARKERS: readonly RegExp[] = [
  /^\s*-{2,}\s*original message\s*-{2,}/im,
  /^\s*_{5,}\s*$/m,
  /^\s*on\s.{5,200}\swrote:\s*$/im,
  /^\s*from:\s.+\r?\n\s*(?:sent|date):/im,
  ...FORWARD_MARKERS,
]

export function stripQuotedChain(body: string): {
  text: string
  hadQuotedChain: boolean
  hasEmbeddedForward: boolean
} {
  const hasEmbeddedForward = FORWARD_MARKERS.some((re) => re.test(body))
  let cut = body.length
  for (const re of QUOTE_START_MARKERS) {
    const m = re.exec(body)
    if (m && m.index < cut) cut = m.index
  }
  const head = body.slice(0, cut)
  const lines = head.split(/\r?\n/)
  const kept = lines.filter((l) => !/^\s*>/.test(l))
  const hadQuotedChain = cut < body.length || kept.length !== lines.length
  return { text: kept.join('\n'), hadQuotedChain, hasEmbeddedForward }
}

// ── 2. 类型 ────────────────────────────────────────────────────────────────

/**
 * 看确认句里**第一个**出现的名词：deposit / balance / payment / funds。
 * 不看整句 —— 「Your deposit has been received, balance due 30 days prior」整句同时有两个词，
 * 但被确认收到的是 deposit。
 */
export function classifyPaymentKind(evidence: string): PaymentKind {
  const lower = evidence.toLowerCase()
  const noun = /\b(deposit|balance|payment|funds)\b/.exec(lower)
  if (!noun) return 'unknown'
  if (noun[1] === 'deposit') return 'deposit'
  if (noun[1] === 'balance') return 'balance'
  if (/\bfinal\s+payment\b|\bremaining\s+payment\b/.test(lower)) return 'balance'
  if (/\bin\s+full\b|\bfull\s+payment\b|\bpaid\s+in\s+full\b/.test(lower)) return 'full'
  return 'unknown'
}

// ── 3. 金额 ────────────────────────────────────────────────────────────────

const NUMBER = '(\\d{1,3}(?:,\\d{3})+|\\d+)(\\.\\d{1,2})?'
const CODE = '(NZD|AUD|USD)'
const AMOUNT_RES: readonly RegExp[] = [
  new RegExp(`(?:${CODE}\\s*)?(?:NZ|AU|US)?\\$\\s*${NUMBER}(?:\\s*${CODE})?`, 'gi'),
  new RegExp(`\\b${CODE}\\s*${NUMBER}`, 'gi'),
]

interface AmountCandidate {
  value: string
  currency: string | null
}

function toDecimal(intPart: string, frac: string | undefined): string {
  const whole = intPart.replace(/,/g, '')
  const f = (frac ?? '').replace('.', '')
  return `${whole}.${(f + '00').slice(0, 2)}`
}

function amountsIn(text: string): AmountCandidate[] {
  const seen = new Map<string, AmountCandidate>()
  const first = new RegExp(AMOUNT_RES[0].source, 'gi')
  for (let m = first.exec(text); m; m = first.exec(text)) {
    const code = (m[1] ?? m[4] ?? null)?.toUpperCase() ?? null
    const prefixCode = /\b(NZ|AU|US)\$/i.exec(m[0])?.[1]?.toUpperCase()
    const currency = code ?? (prefixCode ? `${prefixCode}D` : null)
    const value = toDecimal(m[2], m[3])
    seen.set(`${value}|${currency ?? ''}`, { value, currency })
  }
  const second = new RegExp(AMOUNT_RES[1].source, 'gi')
  for (let m = second.exec(text); m; m = second.exec(text)) {
    const value = toDecimal(m[2], m[3])
    const currency = m[1].toUpperCase()
    seen.set(`${value}|${currency}`, { value, currency })
  }
  return mergeBareDollar([...seen.values()])
}

/** 同一个数字一次带币种、一次只写 `$`，是同一笔，不算两个候选。 */
function mergeBareDollar(list: AmountCandidate[]): AmountCandidate[] {
  const withCode = new Set(list.filter((c) => c.currency).map((c) => c.value))
  return list.filter((c) => c.currency || !withCode.has(c.value))
}

/** 把文本切成句子，返回命中点所在句及其前后句。 */
function sentencesAround(text: string, evidence: string): { same: string; adjacent: string[] } {
  const flat = text.replace(/\s+/g, ' ')
  const parts = flat.split(/(?<=[.!?])\s+/)
  const needle = evidence.replace(/\s+/g, ' ').trim().toLowerCase()
  const idx = parts.findIndex((s) => s.toLowerCase().includes(needle))
  if (idx === -1) return { same: evidence, adjacent: [] }
  return {
    same: parts[idx],
    adjacent: [parts[idx - 1], parts[idx + 1]].filter((s): s is string => !!s),
  }
}

const OWED_WORDS = /\b(balance|due|remaining|outstanding|owing|owed|payable|instalment|installment|will\s+be\s+charged)\b/i

function pickAmount(
  text: string,
  evidence: string,
  config: PaymentExtractConfig,
): { amount: { value: string; currency: string } | null; issue: AmountIssue | null } {
  const { same, adjacent } = sentencesAround(text, evidence)
  let pool = amountsIn(same)
  if (pool.length === 0) {
    const usable = adjacent.filter((s) => !OWED_WORDS.test(s))
    const fromAdjacent = usable.flatMap((s) => amountsIn(s))
    pool = fromAdjacent
  }
  if (pool.length === 0) return { amount: null, issue: 'missing' }
  if (pool.length > 1) return { amount: null, issue: 'ambiguous' }
  const only = pool[0]
  const currency = only.currency ?? config.defaultCurrency?.toUpperCase() ?? null
  if (!currency) return { amount: null, issue: 'no_currency' }
  if (minorUnitsFor(currency) == null) return { amount: null, issue: 'unsupported_currency' }
  if (toMinorUnits(only.value, currency) == null) return { amount: null, issue: 'ambiguous' }
  return { amount: { value: only.value, currency }, issue: null }
}

// ── 4. 发票号 ──────────────────────────────────────────────────────────────

const DEFAULT_INVOICE_PATTERNS: readonly RegExp[] = [
  /\binvoice\s*(?:no\.?|number|#|ref(?:erence)?)\s*[:#]?\s*([A-Za-z]{0,5}[-\s]?\d{3,10})\b/gi,
  /\binvoice\s+([A-Za-z]{1,5}[-]?\d{3,10})\b/gi,
  /\b(INV[-\s]?\d{3,10})\b/gi,
]

function isYearLike(token: string): boolean {
  return /^(?:19|20)\d{2}$/.test(token)
}

export function extractInvoiceNumbers(text: string, patterns: readonly RegExp[] = DEFAULT_INVOICE_PATTERNS): string[] {
  const found = new Set<string>()
  for (const base of patterns) {
    const re = new RegExp(base.source, base.flags.includes('g') ? base.flags : `${base.flags}g`)
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const norm = (m[1] ?? '').toUpperCase().replace(/[\s-]+/g, '')
      if (norm && !isYearLike(norm)) found.add(norm)
    }
  }
  return [...found]
}

// ── 入口 ───────────────────────────────────────────────────────────────────

export function extractPaymentFromEmail(
  input: PaymentExtractInput,
  config: PaymentExtractConfig,
): PaymentExtraction {
  const stripped = stripQuotedChain(input.body ?? '')
  const signal = readPaidSignal({
    text: stripped.text,
    direction: 'outbound',
    isForward: isForwardedSubject(input.subject),
  })

  // `needs_review` 里「转发 / 混有催款」也是命中过确认句的，但不得进自动车道：
  // 这里统一当 confirmed + flag 返回，由调用方按 flags 决定车道。
  if (signal.kind !== 'confirmed' && !(signal.kind === 'needs_review' && isConfirmedButDowngraded(signal.reason))) {
    return { status: 'not_confirmed' }
  }

  const flags: Array<'forwarded' | 'embedded_forward' | 'quoted_chain_removed' | 'evidence_not_verbatim' | 'mixed_with_chasing'> = []
  if (signal.kind === 'needs_review') {
    flags.push(signal.reason === 'forwarded' ? 'forwarded' : 'mixed_with_chasing')
  }
  if (stripped.hasEmbeddedForward) flags.push('embedded_forward')
  if (stripped.hadQuotedChain) flags.push('quoted_chain_removed')
  if (!evidenceIsVerbatim(signal.evidence, stripped.text)) flags.push('evidence_not_verbatim')

  const picked = pickAmount(stripped.text, signal.evidence, config)
  const invoices = extractInvoiceNumbers(stripped.text, config.invoicePatterns)

  return {
    status: 'confirmed',
    kind: classifyPaymentKind(signal.evidence),
    amount: picked.amount,
    amountIssue: picked.issue,
    invoiceNo: invoices.length === 1 ? invoices[0] : null,
    invoiceAmbiguous: invoices.length > 1,
    evidence: signal.evidence,
    flags,
  }
}

function isConfirmedButDowngraded(reason: string): boolean {
  return reason === 'forwarded' || reason === 'mixed_with_chasing'
}
