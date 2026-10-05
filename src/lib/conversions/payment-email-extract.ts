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
/**
 * 任何旗标都不得进自动车道：
 *   amount_adjacent  金额不在确认句同一句里（邻句可能是总价/团费，魏征 2026-10-04 实测取错）
 *   currency_conflict 正文出现与所取币种不同的币种代码（"$500 … All prices in AUD"）
 */
export type ExtractFlag =
  | 'forwarded'
  | 'embedded_forward'
  | 'quoted_chain_removed'
  | 'evidence_not_verbatim'
  | 'mixed_with_chasing'
  | 'amount_adjacent'
  | 'currency_conflict'

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
      flags: ExtractFlag[]
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
const CN_KIND_NOUNS: ReadonlyArray<readonly [RegExp, PaymentKind]> = [
  [/定金|订金/, 'deposit'],
  [/尾款|余款/, 'balance'],
  [/全款|全额/, 'full'],
  [/款项|付款/, 'unknown'],
]

/** 中文名词在 evidence 里第一次出现的位置；没有则 -1。 */
function firstCnKindIndex(evidence: string): number {
  let best = -1
  for (const [re] of CN_KIND_NOUNS) {
    const m = re.exec(evidence)
    if (m && (best === -1 || m.index < best)) best = m.index
  }
  return best
}

/**
 * 中文名词里出现的**不同**类型（忽略 款项|付款）。
 * 多于一种 = 类型不可信，返回 null；恰好一种返回该类型；没有返回 undefined。
 */
function cnKindFromEvidence(evidence: string): PaymentKind | null | undefined {
  const kinds = new Set<PaymentKind>()
  for (const [re, kind] of CN_KIND_NOUNS) {
    if (kind !== 'unknown' && re.test(evidence)) kinds.add(kind)
  }
  if (kinds.size > 1) return null
  if (kinds.size === 1) return [...kinds][0]
  return undefined
}

export function classifyPaymentKind(evidence: string): PaymentKind {
  const lower = evidence.toLowerCase()
  const noun = /\b(deposit|balance|payment|funds)\b/.exec(lower)
  const cnIndex = firstCnKindIndex(evidence)
  const cnKind = cnKindFromEvidence(evidence)
  // 中文名词出现在英文名词之前（或英文名词不存在）时，以中文为准。
  if (cnIndex !== -1 && (!noun || cnIndex < noun.index)) {
    // 多于一种中文类型 = 不可信；恰好一种才用。
    return cnKind ?? 'unknown'
  }
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

/** 数字后面紧跟 `.5` / `,00` 之类 = 不是规范的 1–2 位小数写法（如欧式 `$1.500,00`），宁可当歧义也不读成别的数。 */
const MALFORMED = 'malformed'

function isMalformedTail(text: string, end: number): boolean {
  // 数字被截断（如 `$1.500,00` 先吃到 `1.50`，后面还跟着 `0`）或后面还有 `.5` / `,00` 都不是规范写法。
  return /^\d|^[.,]\d/.test(text.slice(end, end + 2))
}

function amountsIn(text: string): AmountCandidate[] {
  const seen = new Map<string, AmountCandidate>()
  const first = new RegExp(AMOUNT_RES[0].source, 'gi')
  for (let m = first.exec(text); m; m = first.exec(text)) {
    if (isMalformedTail(text, m.index + m[0].length)) {
      seen.set(`${MALFORMED}|${m.index}`, { value: MALFORMED, currency: null })
      continue
    }
    const code = (m[1] ?? m[4] ?? null)?.toUpperCase() ?? null
    const prefixCode = /\b(NZ|AU|US)\$/i.exec(m[0])?.[1]?.toUpperCase()
    const currency = code ?? (prefixCode ? `${prefixCode}D` : null)
    const value = toDecimal(m[2], m[3])
    seen.set(`${value}|${currency ?? ''}`, { value, currency })
  }
  const second = new RegExp(AMOUNT_RES[1].source, 'gi')
  for (let m = second.exec(text); m; m = second.exec(text)) {
    if (isMalformedTail(text, m.index + m[0].length)) {
      seen.set(`${MALFORMED}|${m.index}`, { value: MALFORMED, currency: null })
      continue
    }
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
  const parts = flat.split(/(?<=[.!?])\s+|(?<=[。！？])/).filter((s) => s.length > 0)
  const needle = evidence.replace(/\s+/g, ' ').trim().toLowerCase()
  const idx = parts.findIndex((s) => s.toLowerCase().includes(needle))
  if (idx === -1) return { same: evidence, adjacent: [] }
  return {
    same: parts[idx],
    adjacent: [parts[idx - 1], parts[idx + 1]].filter((s): s is string => !!s),
  }
}

const OWED_WORDS =
  /\b(balance|due|remaining|outstanding|owing|owed|payable|instalment|installment|will\s+be\s+charged|total|price|priced|cost|costs|fee|fees|fare|fares|package|per\s+person|cancellation|refund)\b|尾款|余款|总价|全价|团费|费用|价格|余额|应付|待付|总额|合计|共计/i

function pickAmount(
  text: string,
  evidence: string,
  config: PaymentExtractConfig,
): { amount: { value: string; currency: string } | null; issue: AmountIssue | null; fromAdjacent: boolean } {
  const { same, adjacent } = sentencesAround(text, evidence)
  let pool = amountsIn(same)
  let fromAdjacent = false
  if (pool.length === 0) {
    const usable = adjacent.filter((s) => !OWED_WORDS.test(s))
    pool = usable.flatMap((s) => amountsIn(s))
    fromAdjacent = pool.length > 0
  }
  if (pool.length === 0) return { amount: null, issue: 'missing', fromAdjacent: false }
  if (pool.some((c) => c.value === MALFORMED)) return { amount: null, issue: 'ambiguous', fromAdjacent: false }
  if (pool.length > 1) return { amount: null, issue: 'ambiguous', fromAdjacent: false }
  const only = pool[0]
  const currency = only.currency ?? config.defaultCurrency?.toUpperCase() ?? null
  if (!currency) return { amount: null, issue: 'no_currency', fromAdjacent }
  if (minorUnitsFor(currency) == null) return { amount: null, issue: 'unsupported_currency', fromAdjacent }
  if (toMinorUnits(only.value, currency) == null) return { amount: null, issue: 'ambiguous', fromAdjacent }
  return { amount: { value: only.value, currency }, issue: null, fromAdjacent }
}

/** 全文出现的币种代码里，有没有跟所取币种不一样的（"$500 … All prices in AUD"）。 */
const CURRENCY_MENTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:NZD|NZ\$|new\s+zealand\s+dollars?|kiwi\s+dollars?)/i, 'NZD'],
  [/\b(?:AUD|AU\$|A\$|australian\s+dollars?|aussie\s+dollars?)/i, 'AUD'],
  [/\b(?:USD|US\$|american\s+dollars?|us\s+dollars?|u\.s\.\s+dollars?)/i, 'USD'],
  [/\b(?:CAD|CA\$|canadian\s+dollars?)/i, 'CAD'],
  [/\b(?:HKD|HK\$|hong\s+kong\s+dollars?)/i, 'HKD'],
  [/\b(?:SGD|S\$|singapore\s+dollars?)/i, 'SGD'],
  [/\b(?:CNY|RMB|yuan|renminbi)\b/i, 'CNY'],
  [/\b(?:GBP|pounds?\s+sterling|british\s+pounds?)\b|£/i, 'GBP'],
  [/\b(?:EUR|euros?)\b|€/i, 'EUR'],
  [/\b(?:JPY|yen)\b|¥/i, 'JPY'],
]

/** 全文提到的币种（代码 / 符号 / 英文币名）里，有没有跟所取币种不一样的。 */
export function hasConflictingCurrency(text: string, chosen: string): boolean {
  const want = chosen.toUpperCase()
  return CURRENCY_MENTIONS.some(([re, code]) => code !== want && re.test(text))
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

  const flags: ExtractFlag[] = []
  if (signal.kind === 'needs_review') {
    flags.push(signal.reason === 'forwarded' ? 'forwarded' : 'mixed_with_chasing')
  }
  if (stripped.hasEmbeddedForward) flags.push('embedded_forward')
  if (stripped.hadQuotedChain) flags.push('quoted_chain_removed')
  if (!evidenceIsVerbatim(signal.evidence, stripped.text)) flags.push('evidence_not_verbatim')

  const picked = pickAmount(stripped.text, signal.evidence, config)
  if (picked.fromAdjacent) flags.push('amount_adjacent')
  if (picked.amount && hasConflictingCurrency(stripped.text, picked.amount.currency)) flags.push('currency_conflict')
  const invoices = extractInvoiceNumbers(stripped.text, config.invoicePatterns)

  // 「received in full … This was the deposit」：确认句像全款、全文却说这是定金 → 类型不可信，降成 unknown（不进自动车道）。
  const rawKind = classifyPaymentKind(signal.evidence)
  const kind = rawKind === 'full' && /(?:\bdeposit\b|定金|订金)/i.test(stripped.text) ? 'unknown' : rawKind

  return {
    status: 'confirmed',
    kind,
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
