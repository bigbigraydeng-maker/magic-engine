/**
 * Which of Zhangqian's discovered seed keywords are genuinely new to a brief.
 *
 * Split out from the confirm route so the merge rule is testable on its own —
 * the part that can quietly hurt a client is not the UPDATE, it is deciding
 * what counts as "already there".
 */

import type { DiscoveredKeyword } from './types'

const normalise = (k: string) => k.trim().toLowerCase()

function clean(list: readonly string[]): string[] {
  return list.map(normalise).filter((k) => k.length > 0)
}

/**
 * Returns the discovered keywords that are not already in `existing`,
 * normalised and deduplicated, in discovery order.
 *
 * Only the keyword strings cross over. The volume / kd numbers riding along on
 * DiscoveredKeyword are the agent's own guesses — several payloads say so in
 * their own rationale text — and storing a guess where measured data is
 * expected is exactly what the client-data rule forbids.
 */
export function newSeedKeywords(
  discovered: readonly DiscoveredKeyword[] | null | undefined,
  existing: readonly string[] | null | undefined,
): string[] {
  const have = new Set(clean(existing ?? []))
  const out: string[] = []
  const seen = new Set<string>()

  for (const k of clean((discovered ?? []).map((d) => d?.keyword ?? ''))) {
    // Dedupe within the batch too: the agent can emit one keyword under two
    // types (e.g. both 'category' and 'local').
    if (have.has(k) || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }

  return out
}

/**
 * Whether a *repeat* confirm is allowed to write seed keywords into the brief.
 *
 * 🔴 The merge runs above the already-confirmed short-circuit so that a client
 *    whose brief did not exist at first confirm can still get its seeds. But the
 *    confirm button stays live on the discovery page forever, so without this
 *    gate any later click would re-add keywords an FDE had deliberately deleted
 *    — a silent undo of a human decision, which is the same failure as
 *    overwriting their spelling, just with content instead of casing.
 *
 * So a repeat confirm only writes when the brief is *newer* than the
 * confirmation: that is exactly the "brief was created afterwards, the seeds
 * never had anywhere to land" case, and nothing else.
 */
export function shouldBackfillSeeds(args: {
  /** null on a first confirm — nothing has been written yet, always proceed. */
  confirmedAt: string | null | undefined
  briefCreatedAt: string | null | undefined
}): boolean {
  if (!args.confirmedAt) return true
  // No timestamp to compare against ⇒ cannot prove this is a backfill ⇒ hands off.
  if (!args.briefCreatedAt) return false
  return new Date(args.briefCreatedAt).getTime() > new Date(args.confirmedAt).getTime()
}

/**
 * The full list to persist: everything already there, then the new arrivals.
 *
 * 🔴 Existing entries are returned **verbatim**. Normalising is for comparison
 *    only — lowercasing what is already stored would let confirming a discovery
 *    report silently rewrite keywords an FDE typed by hand, and those strings
 *    are read back into AI prompts and shown in the brief UI. Quietly editing a
 *    human-maintained field is the thing this whole merge is built to avoid.
 */
export function mergedSeedKeywords(
  discovered: readonly DiscoveredKeyword[] | null | undefined,
  existing: readonly string[] | null | undefined,
): string[] {
  const kept = (existing ?? []).filter((k) => k.trim().length > 0)
  return [...kept, ...newSeedKeywords(discovered, existing)]
}
