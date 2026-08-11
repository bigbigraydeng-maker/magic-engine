/**
 * Stable digests for idempotency keys and output fingerprints.
 *
 * Keys must be reproducible across processes and across re-runs of the same
 * workflow, so object key order is normalised before hashing — otherwise the same
 * turn would produce two different idempotency keys and get executed twice.
 */

import { createHash } from 'node:crypto'
import type { Actor } from './schema'

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)

  return `{${entries.join(',')}}`
}

export function digest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex')
}

/**
 * The idempotency key for one agent turn.
 *
 * Deliberately includes the input digest: if the Issue gained new comments the
 * turn is genuinely different work and should run. If nothing changed, a re-run
 * of the workflow recomputes the same key, finds it in the ledger, and skips.
 */
export function turnIdempotencyKey(args: {
  runId: string
  round: number
  actor: Actor
  inputDigest: string
}): string {
  return digest([args.runId, args.round, args.actor, args.inputDigest]).slice(0, 32)
}

/**
 * Sequence-derived identifiers.
 *
 * Deterministic on purpose: derived from what the ledger already contains rather
 * than from a clock or a random source, so a re-read of the same ledger produces
 * the same ids and the tests can assert on them.
 */
export function nextSequencedId(prefix: string, existing: number): string {
  return `${prefix}-${existing + 1}`
}
