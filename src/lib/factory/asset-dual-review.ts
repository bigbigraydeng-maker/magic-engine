// Dual review for material-only work orders. A pass is recorded; it does not publish.

import { officialWebsiteUrl } from './topic-alignment'
import type { RemotionMusicClearance } from './remotion-music-options.mjs'

export const AI_DUAL_REVIEWER = 'ai-dual-review'
export const UNREADABLE = '读不到'
export const UNVERIFIED = '未核验'

const COPY_KEYS = [
  'text', 'title', 'label', 'value', 'sublabel', 'revealTitle', 'itemLabel',
  'stat', 'question', 'cta', 'contact', 'brandName',
] as const

export type PoolMark = 'entered' | 'pending' | 'not_entered' | 'blocked'

export interface FactClaim {
  text: string
  sourceUrl: string
  sourceQuote: string
}

export interface CheckResult {
  verdict: 'pass' | 'fail' | 'unreadable'
  reason: string
}

export interface DualReviewInput {
  assetOnly: boolean
  maliangStatus: unknown
  machineReviewed: unknown
  maliangReasons: unknown
  claims: FactClaim[]
  officialHosts: string[] | null
  pages: Readonly<Record<string, string | null>>
  music: RemotionMusicClearance
}

export interface DualReviewDecision {
  applicable: boolean
  passed: boolean
  maliang: CheckResult
  sudongpo: CheckResult
  music: RemotionMusicClearance
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function addClaim(claims: FactClaim[], seen: Set<string>, claim: FactClaim): void {
  const text = claim.text.trim()
  if (!text) return
  const key = `${claim.sourceUrl}\n${claim.sourceQuote}\n${text}`
  if (seen.has(key)) return
  seen.add(key)
  claims.push({ ...claim, text })
}

function sourceOf(obj: Record<string, unknown>, quoteKey = 'sourceQuote'): Pick<FactClaim, 'sourceUrl' | 'sourceQuote'> {
  const quote = obj[quoteKey]
  return {
    sourceUrl: typeof obj.sourceUrl === 'string' ? obj.sourceUrl : '',
    sourceQuote: typeof quote === 'string' ? quote : '',
  }
}

function addLines(obj: Record<string, unknown>, claims: FactClaim[], seen: Set<string>): void {
  if (!Array.isArray(obj.lines)) return
  for (const line of obj.lines) {
    if (typeof line === 'string') {
      addClaim(claims, seen, { text: line, ...sourceOf(obj) })
      continue
    }
    if (!isRecord(line)) continue
    const source = typeof line.sourceUrl === 'string' ? sourceOf(line) : sourceOf(obj)
    if (typeof line.text === 'string') addClaim(claims, seen, { text: line.text, ...source })
    if (typeof line.badge === 'string') addClaim(claims, seen, { text: line.badge, ...source })
  }
}

function addPrice(obj: Record<string, unknown>, claims: FactClaim[], seen: Set<string>): boolean {
  if (typeof obj.amount !== 'number' || typeof obj.fromLabel !== 'string') return false
  const parts = [obj.fromLabel, obj.currencyPrefix, obj.amount, obj.qualifier, obj.dateLine, obj.footnote]
  const text = parts.filter((part) => typeof part === 'string' || typeof part === 'number').join(' ')
  addClaim(claims, seen, { text, ...sourceOf(obj) })
  return true
}

function addObjectFacts(obj: Record<string, unknown>, claims: FactClaim[], seen: Set<string>): void {
  addLines(obj, claims, seen)
  const priced = addPrice(obj, claims, seen)
  if (typeof obj.line === 'string') addClaim(claims, seen, { text: obj.line, ...sourceOf(obj) })
  if (isRecord(obj.line) && typeof obj.line.text === 'string') addClaim(claims, seen, { text: obj.line.text, ...sourceOf(obj.line) })
  if (typeof obj.place === 'string') addClaim(claims, seen, { text: obj.place, ...sourceOf(obj, 'placeSourceQuote') })
  if (priced) return
  for (const key of COPY_KEYS) {
    if (typeof obj[key] === 'string') addClaim(claims, seen, { text: obj[key], ...sourceOf(obj) })
  }
}

function walkFacts(value: unknown, claims: FactClaim[], seen: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) walkFacts(item, claims, seen)
    return
  }
  if (!isRecord(value)) return
  addObjectFacts(value, claims, seen)
  for (const child of Object.values(value)) walkFacts(child, claims, seen)
}

/** On-screen facts. A fact with no source is kept so a missing citation cannot pass. */
export function collectFactClaims(brief: unknown): FactClaim[] {
  const remotion = isRecord(brief) ? brief.remotion : null
  const props = isRecord(remotion) ? remotion.props : null
  if (!props) return []
  const claims: FactClaim[] = []
  walkFacts(props, claims, new Set())
  return claims
}

export function quoteOnPage(quote: string, page: string): boolean {
  const needle = normalize(quote)
  return needle.length > 0 && normalize(page).includes(needle)
}

function factTokens(value: string): string[] {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean)
}

function tokensInOrder(line: string[], quote: string[]): boolean {
  if (line.length === 0 || line.length > quote.length) return false
  for (let i = 0; i <= quote.length - line.length; i += 1) {
    let same = true
    for (let j = 0; j < line.length; j += 1) {
      if (quote[i + j] !== line[j]) same = false
    }
    if (same) return true
  }
  return false
}

function digitsSupported(line: string, quote: string): boolean {
  const nums = line.match(/\d+/g) ?? []
  return nums.every((num) => new RegExp(`(?:^|\\D)${num}(?:\\D|$)`).test(quote))
}

/** The on-screen words, in order, must occur in the quote. A partial overlap is not support. */
function quoteFullySupports(line: string, quote: string): boolean {
  const lineTokens = factTokens(line)
  const quoteTokens = factTokens(quote)
  if (tokensInOrder(lineTokens, quoteTokens)) return true
  if (!/[\u3400-\u9fff]/.test(line)) return false
  return quoteTokens.join('').includes(lineTokens.join('')) && digitsSupported(line, quote)
}

function judgeClaim(claim: FactClaim, hosts: string[], pages: Readonly<Record<string, string | null>>): CheckResult {
  if (!claim.sourceQuote.trim() || !claim.sourceUrl.trim()) return { verdict: 'unreadable', reason: UNVERIFIED }
  if (!officialWebsiteUrl(claim.sourceUrl, hosts)) return { verdict: 'fail', reason: '出处不是这个客户的官网' }
  const page = pages[claim.sourceUrl]
  if (typeof page !== 'string') return { verdict: 'unreadable', reason: UNREADABLE }
  if (!quoteOnPage(claim.sourceQuote, page)) return { verdict: 'fail', reason: '官网原文对不上' }
  if (!quoteFullySupports(claim.text, claim.sourceQuote)) return { verdict: 'unreadable', reason: UNVERIFIED }
  return { verdict: 'pass', reason: '官网对得上' }
}

export function judgeSudongpo(
  claims: FactClaim[],
  hosts: string[] | null,
  pages: Readonly<Record<string, string | null>>,
): CheckResult {
  if (hosts === null || hosts.length === 0 || claims.length === 0) return { verdict: 'unreadable', reason: UNREADABLE }
  for (const claim of claims) {
    const one = judgeClaim(claim, hosts, pages)
    if (one.verdict !== 'pass') return one
  }
  return { verdict: 'pass', reason: '官网对得上' }
}

export function judgeMaliang(status: unknown, machineReviewed: unknown, reasons: unknown): CheckResult {
  if (status == null || status === 'unverifiable') return { verdict: 'unreadable', reason: UNREADABLE }
  if (status === 'fail') {
    const text = Array.isArray(reasons) ? reasons.filter((item): item is string => typeof item === 'string').join('；') : ''
    return { verdict: 'fail', reason: (text || '马良没过').slice(0, 300) }
  }
  if (status === 'pass' && machineReviewed === true) return { verdict: 'pass', reason: '马良过了' }
  return { verdict: 'unreadable', reason: UNREADABLE }
}

export function decideAssetDualReview(input: DualReviewInput): DualReviewDecision {
  const maliang = judgeMaliang(input.maliangStatus, input.machineReviewed, input.maliangReasons)
  const sudongpo = judgeSudongpo(input.claims, input.officialHosts, input.pages)
  const passed = input.assetOnly
    && maliang.verdict === 'pass'
    && sudongpo.verdict === 'pass'
    && input.music.verdict === 'pass'
  return { applicable: input.assetOnly, passed, maliang, sudongpo, music: input.music }
}

export function withDualReview(
  existing: unknown,
  decision: DualReviewDecision,
  at: string,
  pool: PoolMark,
): Record<string, unknown> {
  const base = isRecord(existing) ? { ...existing } : {}
  const accepted = decision.passed && (pool === 'entered' || pool === 'pending')
  return {
    ...base,
    ...(accepted ? { asset_accepted_by: AI_DUAL_REVIEWER, asset_accepted_at: at } : {}),
    dual_review: {
      passed: accepted,
      reviewer: AI_DUAL_REVIEWER,
      checked_at: at,
      pool,
      maliang: decision.maliang,
      sudongpo: decision.sudongpo,
      music: {
        verdict: decision.music.verdict,
        reason: decision.music.reason,
        track_id: decision.music.track_id,
        clean_until_sec: decision.music.clean_until_sec,
      },
    },
  }
}
