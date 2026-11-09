/**
 * Client Knowledge Base — content fingerprint (Issue #1644 §"内容指纹").
 *
 * Answers one question: "has the substance of this knowledge entry changed
 * since someone last looked at it?" It is the mechanism `getClientKnowledge`
 * uses to tell whether a customer's confirmation still applies to what is
 * *currently* stored — a fact can be edited (price corrected, expiry
 * extended) after the customer confirmed the old wording, and the fingerprint
 * is what stops that edited row from silently keeping its old "confirmed"
 * status.
 *
 * 🔴 Reuses `canonicalHashOfInput` from `src/lib/kernel/canonical-hash.ts`
 * rather than re-implementing fixed-key-order JSON serialisation — that
 * function already solves exactly this problem (stable SHA-256 over a
 * sorted-key JSON encoding) for the execution kernel's input-pinning
 * mechanism, and the "content changed?" question here is the same shape of
 * problem. Do not hand-roll a second canonicalisation routine.
 */

import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import type { Sensitivity } from './sensitivity'
import type { Visibility } from './types'

/**
 * The exact set of fields the issue names as fingerprint inputs: "正文
 * (statement) + 结构化值(structuredValue) + 范围(scope) + 有效期(validFrom/
 * validUntil) + visibility + sensitivity". Anything not in this list
 * (id, timestamps of approval/confirmation, evidence refs, source_kind, …)
 * is deliberately excluded — those describe the *workflow* around the fact,
 * not its substance, and must not cause a spurious "content changed".
 */
export interface FingerprintInput {
  statement: string
  structuredValue: unknown
  scope: Record<string, unknown>
  validFrom: string
  validUntil: string | null
  visibility: Visibility
  sensitivity: Sensitivity
}

/**
 * Compute the content fingerprint for one knowledge entry.
 *
 * Pure function — no I/O, no clock reads — so every mutation test in
 * `read.test.ts` can call it directly to build "what would the customer
 * have had to confirm" fixtures without touching a database.
 */
export function computeContentFingerprint(entry: FingerprintInput): string {
  return canonicalHashOfInput({
    statement: entry.statement,
    structuredValue: entry.structuredValue ?? null,
    scope: entry.scope ?? {},
    validFrom: entry.validFrom,
    validUntil: entry.validUntil ?? null,
    visibility: entry.visibility,
    sensitivity: entry.sensitivity,
  })
}
