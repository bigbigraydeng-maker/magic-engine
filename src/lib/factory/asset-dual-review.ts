// Dual review for material-only work orders. A pass is recorded; it does not publish.

import { officialWebsiteUrl } from './topic-alignment'
import type { RemotionMusicClearance } from './remotion-music-options.mjs'

export const AI_DUAL_REVIEWER = 'ai-dual-review'
export const UNREADABLE = '读不到'

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

function claimText(obj: Record<string, unknown>): string {
  if (typeof obj.text === 'string') return obj.text
  if (typeof obj.line === 'string') return obj.line
  return typeof obj.sourceQuote === 'string' ? obj.sourceQuote : ''
}

function addClaim(claims: FactClaim[], seen: Set<string>, claim: FactClaim): void {
  const key = `${claim.sourceUrl}\n${claim.sourceQuote}\n${claim.text}`
  if (seen.has(key)) return
  seen.add(key)
  claims.push(claim)
}

function pushClaim(obj: Record<string, unknown>, claims: FactClaim[], seen: Set<string>): void {
  if (typeof obj.sourceUrl !== 'string') return
  if (typeof obj.sourceQuote === 'string') {
    addClaim(claims, seen, { text: claimText(obj), sourceUrl: obj.sourceUrl, sourceQuote: obj.sourceQuote })
  }
  if (typeof obj.place === 'string' && typeof obj.placeSourceQuote === 'string') {
    addClaim(claims, seen, { text: obj.place, sourceUrl: obj.sourceUrl, sourceQuote: obj.placeSourceQuote })
  }
}

function walkClaims(value: unknown, claims: FactClaim[], seen: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) walkClaims(item, claims, seen)
    return
  }
  if (!isRecord(value)) return
  pushClaim(value, claims, seen)
  for (const child of Object.values(value)) walkClaims(child, claims, seen)
}

/** On-screen lines that name a source URL and a source quote. */
export function collectFactClaims(brief: unknown): FactClaim[] {
  const remotion = isRecord(brief) ? brief.remotion : null
  const props = isRecord(remotion) ? remotion.props : null
  if (!props) return []
  const claims: FactClaim[] = []
  walkClaims(props, claims, new Set())
  return claims
}

export function quoteOnPage(quote: string, page: string): boolean {
  const needle = normalize(quote)
  return needle.length > 0 && normalize(page).includes(needle)
}

function lineBackedByQuote(line: string, quote: string): boolean {
  const haystack = normalize(quote)
  const text = normalize(line)
  if (!text) return haystack.length > 0
  if (haystack.includes(text)) return true
  const tokens = text.split(' ').filter((word) => word.length >= 4)
  if (tokens.length === 0) return haystack.includes(text)
  const needed = Math.ceil(tokens.length / 2)
  let found = 0
  for (const token of tokens) if (haystack.includes(token)) found += 1
  return found >= needed
}

function judgeClaim(claim: FactClaim, hosts: string[], pages: Readonly<Record<string, string | null>>): CheckResult {
  if (!claim.sourceQuote.trim() || !claim.sourceUrl.trim()) return { verdict: 'fail', reason: '出处是空的' }
  if (!officialWebsiteUrl(claim.sourceUrl, hosts)) return { verdict: 'fail', reason: '出处不是这个客户的官网' }
  const page = pages[claim.sourceUrl]
  if (typeof page !== 'string') return { verdict: 'unreadable', reason: UNREADABLE }
  if (!quoteOnPage(claim.sourceQuote, page)) return { verdict: 'fail', reason: '官网原文对不上' }
  if (!lineBackedByQuote(claim.text, claim.sourceQuote)) return { verdict: 'fail', reason: '画面上的话和出处对不上' }
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
