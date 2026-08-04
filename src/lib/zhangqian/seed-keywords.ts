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

/** The full list to persist: everything already there, then the new arrivals. */
export function mergedSeedKeywords(
  discovered: readonly DiscoveredKeyword[] | null | undefined,
  existing: readonly string[] | null | undefined,
): string[] {
  return [...clean(existing ?? []), ...newSeedKeywords(discovered, existing)]
}
