/**
 * Read side of the pre-publish content guard (src/lib/content/content-guard.ts).
 *
 * The generator writes a receipt with contentGuardSnapshot() into
 * `generation_context_snapshot.content_guard`. This module is the only place
 * that interprets it, so the board API, the review UI and the bulk-approval
 * gates all read one flag with one meaning.
 *
 * Platform-shared: no client, industry or route semantics live here.
 *
 * Absent receipt = NOT flagged. Most rows predate the guard, and several
 * generators still never run it, so treating "no receipt" as a failure would
 * block every legacy post. Absent means "unknown, never checked"; only a
 * receipt that exists and says so blocks a bulk approval.
 * A receipt that exists but cannot be parsed IS flagged — fail closed.
 */

import { DEFAULT_CONTENT_GUARD_CONFIG } from '@/lib/content/content-guard-config'
import type { LanguageFinding } from '@/lib/content/content-guard'

/** Badge codes. UI copy lives in the UI; this stays language-neutral. */
export type GuardReason = 'mixed_language' | 'cliche_opener' | 'check_unavailable'

export interface GuardFlag {
  status: 'pass' | 'fail' | 'unavailable'
  /** True ⇒ a human must look before this goes out. */
  needsReview: boolean
  reasons: GuardReason[]
  languageFindings: LanguageFinding[]
  clicheProbability: number | null
  clicheThreshold: number
  judgeError: string | null
  checkedAt: string | null
}

/**
 * What the browser is allowed to see. `judgeError` is the raw error text from the
 * judging service — it names the vendor and is pure jargon, and the content-factory
 * board is a screen clients open. It stays server-side (logs, cron summaries,
 * receipts) and never rides out in an API response.
 */
export type PublicGuardFlag = Omit<GuardFlag, 'judgeError'>

export function toPublicGuardFlag(flag: GuardFlag | null): PublicGuardFlag | null {
  if (!flag) return null
  const { judgeError: _judgeError, ...safe } = flag
  return safe
}

export interface BlockedPost {
  id: string
  title: string | null
  reasons: GuardReason[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLanguageFinding(value: unknown): value is LanguageFinding {
  return isRecord(value) && typeof value.sentence === 'string' && typeof value.fragment === 'string'
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Probability and threshold are both fractions; a value outside 0–1 is corrupt, not merely absent. */
function fractionInRange(value: unknown): number | null {
  const n = finiteNumber(value)
  return n !== null && n >= 0 && n <= 1 ? n : null
}

/** A receipt we cannot read is still a receipt: somebody ran the guard, so review it. */
function unreadable(detail: string): GuardFlag {
  return {
    status: 'unavailable',
    needsReview: true,
    reasons: ['check_unavailable'],
    languageFindings: [],
    clicheProbability: null,
    clicheThreshold: DEFAULT_CONTENT_GUARD_CONFIG.clicheThreshold,
    judgeError: `guard receipt unreadable: ${detail}`,
    checkedAt: null,
  }
}

/** Returns null when the post carries no guard receipt at all (never checked). */
export function readGuardFlag(snapshot: unknown): GuardFlag | null {
  if (!isRecord(snapshot)) return null
  const raw = snapshot.content_guard
  if (raw === undefined || raw === null) return null
  if (!isRecord(raw)) return unreadable('not an object')

  const status = raw.status
  if (status !== 'pass' && status !== 'fail' && status !== 'unavailable') {
    return unreadable(`unknown status ${JSON.stringify(status)}`)
  }
  // A non-boolean here (a string 'true', a 0/1) would silently read as "no review
  // needed". Anything but a real boolean means we do not understand this receipt.
  if (raw.needs_human_review !== undefined && typeof raw.needs_human_review !== 'boolean') {
    return unreadable('needs_human_review is not a boolean')
  }

  // A present-but-malformed field means the writer's shape changed underneath us —
  // dropping it silently (empty array, null, default threshold) would read as
  // "checked, nothing found" instead of "cannot be trusted". Fail closed instead.
  let languageFindings: LanguageFinding[] = []
  if (raw.language_findings !== undefined) {
    if (!Array.isArray(raw.language_findings)) {
      return unreadable('language_findings is not an array')
    }
    if (!raw.language_findings.every(isLanguageFinding)) {
      return unreadable('language_findings contains an entry missing sentence/fragment')
    }
    languageFindings = raw.language_findings
  }

  let clicheProbability: number | null = null
  if (raw.cliche_probability !== undefined && raw.cliche_probability !== null) {
    const p = fractionInRange(raw.cliche_probability)
    if (p === null) return unreadable(`cliche_probability is not a number in 0–1: ${JSON.stringify(raw.cliche_probability)}`)
    clicheProbability = p
  }

  // Threshold travels with the receipt so an old post is judged by the threshold
  // that was in force when it was written, not by today's env value.
  let clicheThreshold = DEFAULT_CONTENT_GUARD_CONFIG.clicheThreshold
  if (raw.cliche_threshold !== undefined && raw.cliche_threshold !== null) {
    const t = fractionInRange(raw.cliche_threshold)
    if (t === null) return unreadable(`cliche_threshold is not a number in 0–1: ${JSON.stringify(raw.cliche_threshold)}`)
    clicheThreshold = t
  }

  const judgeError = typeof raw.judge_error === 'string' && raw.judge_error.trim() ? raw.judge_error : null

  const reasons: GuardReason[] = []
  if (languageFindings.length > 0) reasons.push('mixed_language')
  if (clicheProbability !== null && clicheProbability >= clicheThreshold) reasons.push('cliche_opener')
  if (judgeError !== null) reasons.push('check_unavailable')

  // reasons counts too: a receipt whose own summary says 'pass' while its detail
  // fields describe a failure is inconsistent, and the safe reading of an
  // inconsistent receipt is "a human looks". Today's writer is self-consistent;
  // this keeps a future writer's bug from becoming a silent green light.
  const needsReview = raw.needs_human_review === true || status !== 'pass' || reasons.length > 0
  // Never show an unexplained red flag: if the receipt says "review me" but
  // carries no readable reason, say so rather than inventing one.
  if (needsReview && reasons.length === 0) reasons.push('check_unavailable')

  return {
    status,
    needsReview,
    reasons,
    languageFindings,
    clicheProbability,
    clicheThreshold,
    judgeError,
    checkedAt: typeof raw.checked_at === 'string' ? raw.checked_at : null,
  }
}

/** Convenience for call sites that only need the yes/no. */
export function needsHumanReview(snapshot: unknown): boolean {
  return readGuardFlag(snapshot)?.needsReview === true
}

interface GuardableRow {
  id: string
  title?: string | null
  generation_context_snapshot?: unknown
}

/**
 * Split rows for a bulk approval: `allowed` may be flipped, `blocked` must not.
 * Bulk approval is a machine acting for a human who never read the copy — the
 * flag only survives if this path refuses. Single-post approval, where a human
 * is looking at the flag, stays allowed.
 */
export function splitByGuard<T extends GuardableRow>(rows: readonly T[]): { allowed: T[]; blocked: BlockedPost[] } {
  const allowed: T[] = []
  const blocked: BlockedPost[] = []
  for (const row of rows) {
    const flag = readGuardFlag(row.generation_context_snapshot)
    if (flag?.needsReview) blocked.push({ id: row.id, title: row.title ?? null, reasons: flag.reasons })
    else allowed.push(row)
  }
  return { allowed, blocked }
}
