/**
 * SEO Meta-Cycle v1 — prescription step (step 3).
 *
 * PM 2026-09-20 精简拍板: only two outcomes now (title_rewrite / skip) — the
 * other four (index_request/content_refresh/new_page/internal_link) are cut,
 * see types.ts's MetaCycleActionType comment. The skip check runs on
 * difficulty alone (from keyword_snapshots — see enrichment.ts) BEFORE any
 * SERP call, because SERP is now only fetched for the final selected
 * candidates (§ enrichment.ts) — spending an API call to help decide
 * whether to skip would defeat the point of that cap.
 *
 * 子牙 finding #5 (still applies): this is a NEW mapping function, not a
 * reuse of seo-agent/scorer.ts's `deriveActionType` — that one plans
 * NET-NEW content work; this one only ever considers existing pages.
 */

import type { MetaCycleCandidate, MetaCyclePrescription } from './types'

/** Above this difficulty, a title tweak alone isn't going to move a competitive keyword — not worth this run's slot. */
export const SKIP_DIFFICULTY_FLOOR = 70

/**
 * Pure decision function — no I/O, no SERP dependency (moved out per the
 * simplification above; step 4 fetches competitor titles fresh for
 * whichever candidates survive this decision).
 */
export function deriveMetaCycleAction(candidate: MetaCycleCandidate): MetaCyclePrescription {
  if ((candidate.keywordDifficulty ?? 0) > SKIP_DIFFICULTY_FLOOR) {
    return {
      candidate,
      actionType: 'skip',
      auto: false,
      reason: `difficulty ${candidate.keywordDifficulty} > ${SKIP_DIFFICULTY_FLOOR} — not worth this cycle's slot`,
    }
  }

  return {
    candidate,
    actionType: 'title_rewrite',
    auto: true,
    reason: candidate.position !== null
      ? `ranking #${candidate.position} with real impressions — title/description rewrite is reversible`
      : 'patrol-discovered opportunity — title/description rewrite is reversible',
  }
}
