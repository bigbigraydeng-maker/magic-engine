/**
 * Deterministic gate for the model-written call SUMMARY.
 *
 * Facts are already gated: every fact must carry a verbatim `quote` that is
 * checked against the transcript (see `verifyFacts` in analysis-schema.ts), so
 * a fact that survives is backed by something the customer/agent actually said.
 * The SUMMARY, by contrast, used to be stored completely unchecked — free prose
 * written by the model went straight into the customer record.
 *
 * Two real errors reached a customer record on 2026-10-25:
 *   1. The summary called the customer "Sergio Dyer"; his real name is
 *      "Sarju Dayal". The agent mis-said the name on the call, so the WRONG
 *      name is present in the transcript — a "does it appear in the transcript"
 *      check would NOT have caught this. Only a known-names allowlist does.
 *   2. The summary said 「首次去中国」(first time to China) while the customer
 *      actually said: "1st time. Yeah. I've never been... I've been to South
 *      China, but not Central China." A characterisation like that belongs in a
 *      checked FACT, never in free prose.
 *
 * This gate is deliberately conservative. A rejected summary is REPLACED by a
 * deterministic summary built from the already-verified facts (see
 * `fallbackSummaryFromFacts`), so a false rejection costs readability, never
 * truth. No model calls, no I/O — pure functions only.
 */

export const MAX_SUMMARY_CHARS = 200

export type SummaryRejection =
  | 'person_name'
  | 'unsupported_number'
  | 'customer_characterisation'
  | 'too_long'
  | 'empty'

export interface SummaryVerdict {
  ok: boolean
  summary: string
  rejected: SummaryRejection[]
}

/**
 * Two or more consecutive capitalised Latin words separated by single spaces.
 * Each word is an initial A–Z followed by one or more a–z, so all-caps tokens
 * ("CTS", "NZ") and single capitalised words ("Shanghai") never match.
 * Built once at module load; used with `.match()` (never `.test()` on a /g).
 */
const PERSON_NAME_RE = /\b[A-Z][a-z]+(?: [A-Z][a-z]+)+\b/g

export function namesInSummary(summary: string): string[] {
  const matches = summary.match(PERSON_NAME_RE) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of matches) {
    if (seen.has(m)) continue
    seen.add(m)
    out.push(m)
  }
  return out
}

/** Every run of 1+ ASCII digits, de-duplicated, in order. */
export function digitRunsIn(text: string): string[] {
  const matches = text.match(/\d+/g) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of matches) {
    if (seen.has(m)) continue
    seen.add(m)
    out.push(m)
  }
  return out
}

/**
 * Claims about the customer that must never appear in free prose because they
 * belong in a checked fact. All patterns are case-insensitive and NON-global so
 * `.test()` is safe (no lastIndex leak between calls).
 */
export const CHARACTERISATION_PATTERNS: readonly RegExp[] = [
  /首次/i,
  /第一次/i,
  /初次/i,
  /从未/i,
  /从来没/i,
  /没去过/i,
  /没有去过/i,
  /\bfirst[- ]time\b/i,
  // 口语和转写里常写成 "1st time"（2026-10-12、10-22 两通真实电话都是这个写法）。
  // 漏掉它会让「转写里有没有依据」这一步认不出来，把正确的摘要也拦掉。
  /\b1st[- ]time\b/i,
  /\bnever been\b/i,
  /\bfirst visit\b/i,
]

/** Lower-case and strip everything that is not a–z or 0–9. */
const normaliseName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * 客人自己说「我去过 / 来过」的说法。只要同一通电话里出现过，
 * 「首次 / 第一次」就算被他自己推翻了，不能写进摘要当定论。
 */
export const BEEN_THERE_PATTERNS: readonly RegExp[] = [
  /\bi(?:'| ha)?ve been\b/i,
  /\bwe(?:'| ha)?ve been\b/i,
  /\bi went\b/i,
  /\bbeen there\b/i,
  /去过/,
  /到过/,
  /来过/,
]

export function verifySummary(input: {
  summary: string
  transcript: string
  /**
   * 已经过原话核验的事实（值 + 原话）。数字要么在转写里逐字出现，要么在这些文本里出现才算有依据。
   *
   * 为什么要这一层：转写里是口语数字（"It's for March 20 27th"），摘要写成
   * 「2027年3月20日」——日期本身有原话依据、是条已核实事实，只是写法不同。
   * 只跟转写比字面会把它当成瞎编（2026-10-25 真实误判）。
   */
  supportingTexts?: readonly string[]
  knownNames: readonly string[]
}): SummaryVerdict {
  const summary = input.summary.trim()
  const rejected: SummaryRejection[] = []

  if (summary.length === 0) rejected.push('empty')
  if (summary.length > MAX_SUMMARY_CHARS) rejected.push('too_long')

  // 用「包含」而不是「相等」来比对：抽名字时会把句首大写词一起吞进来
  // （'Called Sarju Dayal' / 'Later Sergio Dyer'），而真实的三词人名
  // （Mary Jane Watson）又必须整条抽出来，两者形状一样、分不开。
  // 所以只要抽到的这一串里**含有**客人已知的名字，就算对得上；
  // 完全对不上的（Sergio Dyer vs Sarju Dayal）才判为写错了人名。
  const known = input.knownNames.map(normaliseName).filter((n) => n.length > 0)
  const hasUnknownName = namesInSummary(summary).some((n) => {
    const got = normaliseName(n)
    return !known.some((k) => got.includes(k))
  })
  if (hasUnknownName) rejected.push('person_name')

  const haystack = [input.transcript, ...(input.supportingTexts ?? [])].join(' ')
  const hasUnsupportedNumber = digitRunsIn(summary).some((d) => !haystack.includes(d))
  if (hasUnsupportedNumber) rejected.push('unsupported_number')

  // 「首次去中国」这类对客人的判断性描述：两个条件都满足才放行 ——
  // ① 转写里真有这个说法；② 客人没有在同一通电话里自己推翻它。
  //
  // 为什么要第二条（2026-10-25 两条真实通话逼出来的）：
  //   · 10-12 那通，客人原话 "It's 1st time for the family to go to China" —— 摘要写「第一次去中国」是对的，不该拦；
  //   · 10-22 那通，客人说 "1st time. Yeah. I've never been... I've been to South China, but not Central China"
  //     —— 他去过华南，摘要写「首次去中国」是错的。两通转写里都有 "1st time"，
  //     所以只看「转写里有没有这句」区分不开，必须再看他有没有自己说「我去过」。
  // 判错的代价只是摘要变成干巴巴的事实清单，不会写错事实，所以宁可严一点。
  const hasCharacterisation = CHARACTERISATION_PATTERNS.some((re) => re.test(summary))
  if (hasCharacterisation) {
    const t = input.transcript
    const supported = CHARACTERISATION_PATTERNS.some((re) => re.test(t))
    const contested = BEEN_THERE_PATTERNS.some((re) => re.test(t))
    if (!supported || contested) rejected.push('customer_characterisation')
  }


  return { ok: rejected.length === 0, summary, rejected }
}

/**
 * Deterministic Chinese replacement used when the model's summary is rejected.
 * Built only from already-verified facts, so it cannot introduce new claims.
 * Truncated by code unit to exactly MAX_SUMMARY_CHARS (cut, no ellipsis).
 */
export function fallbackSummaryFromFacts(
  facts: ReadonlyArray<{ key: string; value: string }>,
): string {
  if (facts.length === 0) return '这通电话没有抽到可核实的信息。'
  const body = '这通电话抽到的可核实信息：' + facts.map((f) => f.value).join('；') + '。'
  return body.length > MAX_SUMMARY_CHARS ? body.slice(0, MAX_SUMMARY_CHARS) : body
}
