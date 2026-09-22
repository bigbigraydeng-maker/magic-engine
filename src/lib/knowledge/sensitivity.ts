/**
 * Client Knowledge Base — industry-neutral sensitivity classifier.
 *
 * Issue [#1643](https://github.com/bigbigraydeng-maker/magic-engine/issues/1643),
 * step 1/6 of the client knowledge base capability (design doc:
 * `~/.claude/plans/client-knowledge-base-capability.md` §9.5/§9.14 A, local file).
 *
 * ## Why this exists
 *
 * A knowledge entry (price / lead time / promise / policy fact an AI is allowed
 * to say to a real customer) must clear TWO gates before it can be used in a
 * customer-facing reply: ME approval, then **the customer's own confirmation**
 * — but only for entries sensitive enough to matter. This module answers the
 * first question in that chain: *which category is this entry, and does it
 * need the customer-confirmation gate at all?*
 *
 * ## The one rule that matters more than any keyword list
 *
 * **Direction of error is asymmetric.** Over-classifying a harmless entry as
 * sensitive costs one extra customer click. Under-classifying a real price/
 * promise as `general` means it goes live without the customer ever seeing
 * it — that is the exact accident this whole capability exists to prevent
 * (CTS "AI 报停售团" incident). So every ambiguous case in this file resolves
 * to the *more* sensitive outcome, never the cheaper one to build.
 *
 * ## The hard rule (language-independent, context-independent)
 *
 * After NFKC normalisation, ANY Arabic digit or Chinese numeral
 * (一二三四五六七八九十百千万两) appearing in the statement text OR the
 * structured value forces a non-`general` result — regardless of language,
 * regardless of what the number is next to. This is deliberately blunt: a
 * digit almost always means a price, a quantity, a date, or a deadline, and
 * guessing "this number looks harmless" is exactly the kind of context-
 * dependent judgement call this classifier is not allowed to make.
 *
 * On top of the digit rule, a bilingual keyword table catches sensitive
 * statements that don't happen to contain a digit at all (e.g. "we guarantee
 * on-time delivery", "支持退款").
 *
 * ## What this file does NOT touch
 *
 * `src/lib/social/comment-guardrails.ts` has its own travel-industry claim
 * detector (price/duration/itinerary/date/discount regexes) and its own
 * reply templates (`:71`, `:133-179`) for the CTS comment auto-reply flow.
 * That file stays exactly as it is — this module is the industry-neutral
 * replacement used by the *new* client knowledge base, not a refactor of it.
 *
 * ## What this file deliberately does NOT decide
 *
 * Whether a price mentioned in a real conversation is a one-off deal quote
 * ("138kg × NZD4 = NZD552" for one specific shipment) versus a generalisable
 * fact is a separate judgement — the mining pipeline's dedup/dedupe-vs-deal
 * step (design doc §3.2 step 4 / §9.7), not this classifier. This file only
 * answers "how sensitive is this statement", not "is this statement even a
 * reusable fact".
 */

export type Sensitivity = 'price' | 'timeline' | 'commitment' | 'policy' | 'general'

/** Every value `resolveSensitivity` will accept as already-valid. */
export const SENSITIVITY_LEVELS: readonly Sensitivity[] = [
  'price',
  'timeline',
  'commitment',
  'policy',
  'general',
]

/** Fold full-width digits/punctuation to ASCII and lower-case for keyword matching. */
function normalise(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

/** `JSON.stringify` that never throws — a structured value is scanned the same way as prose. */
function stringifyStructuredValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build one alternation regex from Chinese substrings (no `\b` needed) + English fragments (already word-bounded where it matters). */
function buildTermRegex(zh: readonly string[], enFragments: readonly string[]): RegExp {
  const parts = [...zh.map(escapeRegExp), ...enFragments]
  return new RegExp(parts.join('|'))
}

// ── Category keyword tables (中英文各自独立维护，按 issue #1643 举例的词表为最小集，可在后续 issue 里扩充) ──

const POLICY_RE = buildTermRegex(
  ['退款', '退货', '换货', '退改', '保险', '合规', '政策', '条款'],
  ['refund', 'return\\s*polic(?:y|ies)', 'compliance', '\\bpolicy\\b', '\\bterms\\b', '\\binsurance\\b']
)

const COMMITMENT_RE = buildTermRegex(
  ['保证', '承诺', '担保', '保证金'],
  ['\\bguarantee[ds]?\\b', '\\bpromise[ds]?\\b', 'warrant(?:y|ies)', 'commit(?:ment)?']
)

const TIMELINE_RE = buildTermRegex(
  ['时效', '截单', '截止', '期限', '有效期', '工作日'],
  [
    '\\bdeadline\\b',
    'lead\\s*time',
    'cut[-\\s]?off',
    '\\bturnaround\\b',
    'business\\s*days?',
    'valid\\s*until',
    'expir(?:e[ds]?|y|ation)',
  ]
)

const PRICE_RE = buildTermRegex(
  ['价格', '报价', '费用', '收费', '价钱', '折扣', '免费', '包邮', '包运费', '包税'],
  ['\\bprice[ds]?\\b', '\\bcost[s]?\\b', '\\bfee[s]?\\b', '\\bdiscount\\b', '\\bquote[ds]?\\b', '\\bincluded\\b', 'free\\s*shipping']
)

/**
 * Checked ONLY after every keyword table above has already missed — this is
 * what keeps a bare "12/24" from defaulting to `price` (the generic digit
 * fallback below) while still refusing to call it `general`: a lone
 * `digit(s)/digit(s)` shape with no other signal reads as a date/cutoff, so
 * it resolves to `timeline`, not the digit-rule's `price` fallback.
 */
const DATE_SHAPE_RE = /\b\d{1,2}[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?\b/

/** Arabic digits (post-NFKC, full-width folded) OR Chinese numerals. See file header — this is the one rule that cannot be softened. */
const CJK_NUMERALS = '一二三四五六七八九十百千万两'
const HAS_NUMBER_RE = new RegExp(`[0-9${CJK_NUMERALS}]`)

function hasAnyNumber(text: string): boolean {
  return HAS_NUMBER_RE.test(text)
}

/**
 * Classify a knowledge entry candidate's sensitivity from its statement text
 * and (optional) structured value.
 *
 * Resolution order (first hit wins; each step is strictly more specific than
 * the fallback below it — never loosen this order without re-reading the
 * file header on why "unsure → more sensitive" is not negotiable):
 *   1. Category keyword tables (policy → commitment → timeline → price).
 *   2. A bare date-shaped digit pattern with no keyword hit → `timeline`.
 *   3. Any remaining digit or Chinese numeral, anywhere → `price` (the most
 *      sensitive category — "commits to a number" is the closest guess when
 *      we truly cannot tell what the number means).
 *   4. Nothing matched at all → `general`.
 */
export function detectSensitivity(statement: string, structuredValue?: unknown): Sensitivity {
  const combined = normalise(`${statement ?? ''} ${stringifyStructuredValue(structuredValue)}`)

  if (POLICY_RE.test(combined)) return 'policy'
  if (COMMITMENT_RE.test(combined)) return 'commitment'
  if (TIMELINE_RE.test(combined)) return 'timeline'
  if (PRICE_RE.test(combined)) return 'price'
  if (DATE_SHAPE_RE.test(combined)) return 'timeline'
  if (hasAnyNumber(combined)) return 'price'
  return 'general'
}

/**
 * Resolve a *stored or AI-suggested* sensitivity value that may be missing
 * or not one of the five known levels (a legacy row, a model that invented
 * its own label, a blank column) to a safe value.
 *
 * Design doc §9.5: "`sensitivity` 必填无默认值；缺失或未知值 → 按 price 处理" —
 * missing/unrecognised is NOT the same question as "did the classifier find
 * a signal" (that's `detectSensitivity` above); this is "can we trust what's
 * already on the row enough to skip the customer-confirmation gate for it".
 * The answer to "we don't know" must stay `price`, never `general` — `general`
 * is the one level that skips customer confirmation entirely (design doc
 * §7.2), so defaulting an unknown value to it would silently waive the gate
 * this whole capability exists to enforce.
 */
export function resolveSensitivity(value: string | null | undefined): Sensitivity {
  if (value && (SENSITIVITY_LEVELS as readonly string[]).includes(value)) {
    return value as Sensitivity
  }
  return 'price'
}
