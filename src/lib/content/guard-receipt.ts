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

  const languageFindings = Array.isArray(raw.language_findings)
    ? raw.language_findings.filter(isLanguageFinding)
    : []
  const clicheProbability = finiteNumber(raw.cliche_probability)
  // Threshold travels with the receipt so an old post is judged by the threshold
  // that was in force when it was written, not by today's env value.
  const clicheThreshold = finiteNumber(raw.cliche_threshold) ?? DEFAULT_CONTENT_GUARD_CONFIG.clicheThreshold
  const judgeError = typeof raw.judge_error === 'string' && raw.judge_error.trim() ? raw.judge_error : null

  const reasons: GuardReason[] = []
  if (languageFindings.length > 0) reasons.push('mixed_language')
  if (clicheProbability !== null && clicheProbability >= clicheThreshold) reasons.push('cliche_opener')
  if (judgeError !== null) reasons.push('check_unavailable')

  const needsReview = raw.needs_human_review === true || status !== 'pass'
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
