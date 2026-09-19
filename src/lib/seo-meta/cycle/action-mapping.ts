/**
 * SEO Meta-Cycle v1 — prescription step (step 3).
 *
 * 子牙 finding #5: seo-agent/scorer.ts's `deriveActionType` returns a
 * 3-value enum (create_money_page/publish_support_content/refresh_existing_page)
 * that does not match this spec's 6-value action vocabulary
 * (title_rewrite/index_request/content_refresh/new_page/internal_link/skip).
 * This is a NEW mapping function, not a reuse of deriveActionType — the two
 * enums measure different things (that one plans NET-NEW content work; this
 * one plans META-CHANGE-CYCLE actions on candidates that mostly already have
 * a page) and conflating them would silently misroute e.g. a `gap` candidate
 * (no existing page) into `title_rewrite` (which requires one).
 */

import type { MetaCycleCandidate, MetaCyclePrescription } from './types'

/** Difficulty above this + a "big site" competitor front page = not worth the click-fight this cycle. */
const SKIP_DIFFICULTY_FLOOR = 70

/** Competitor domains whose SERP presence marks a keyword as skip-worthy at high difficulty (spec §4 step 3). */
const BIG_SITE_MARKERS = [
  'wikipedia.org',
  'tripadvisor.com',
  'booking.com',
  'expedia.com',
  'lonelyplanet.com',
  'facebook.com',
  'youtube.com',
  'amazon.com',
]

export interface PrescriptionInput {
  candidate: MetaCycleCandidate
  /** Top-3 SERP result domains for this candidate's keyword (step 2 enrichment). */
  top3CompetitorDomains: string[]
}

/**
 * Pure decision function — no I/O. Order matters (first match wins), same
 * discipline as the deriveActionType it replaces.
 */
export function deriveMetaCycleAction(input: PrescriptionInput): MetaCyclePrescription {
  const { candidate, top3CompetitorDomains } = input

  const hasBigSiteInTop3 = top3CompetitorDomains.some((domain) =>
    BIG_SITE_MARKERS.some((marker) => domain.toLowerCase().includes(marker)),
  )
  if ((candidate.keywordDifficulty ?? 0) > SKIP_DIFFICULTY_FLOOR && hasBigSiteInTop3) {
    return {
      candidate,
      actionType: 'skip',
      auto: false,
      reason: `difficulty ${candidate.keywordDifficulty} > ${SKIP_DIFFICULTY_FLOOR} and top-3 SERP includes an established site (${top3CompetitorDomains.join(', ')}) — not worth this cycle's slot`,
    }
  }

  // No existing page → nothing to rewrite. Content work, always manual
  // (客户数据红线: 对外内容须先 grounding 官网，需人过目).
  if (!candidate.pageUrl || !candidate.slug) {
    return {
      candidate,
      actionType: 'new_page',
      auto: false,
      reason: 'gap keyword with no existing page — needs a net-new page brief, routed to the manual board',
    }
  }

  // Page exists but Google hasn't indexed it — cheap, idempotent, no
  // content risk, safe to automate.
  if (candidate.discoveredNotIndexed) {
    return {
      candidate,
      actionType: 'index_request',
      auto: true,
      reason: 'page exists but is not indexed — requesting indexing has no content risk',
    }
  }

  // The bread-and-butter case: existing page ranking 4-20, title/desc has
  // click-through upside. Small, reversible, 14-day check-back covers it.
  if (candidate.position !== null && candidate.position >= 4 && candidate.position <= 20) {
    return {
      candidate,
      actionType: 'title_rewrite',
      auto: true,
      reason: `ranking #${candidate.position} with real impressions — title/description rewrite is reversible and has a Check-step safety net`,
    }
  }

  // Ranking but outside the reversible-rewrite sweet spot (e.g. position 1-3
  // where a rewrite risks losing an already-strong ranking, or >20 where the
  // page needs substance, not just a title tweak) — that's content work.
  if (candidate.position !== null && candidate.position > 20) {
    return {
      candidate,
      actionType: 'content_refresh',
      auto: false,
      reason: `ranking #${candidate.position} is beyond title-tweak range — needs substantive content work, routed to the manual board`,
    }
  }

  // Position 1-3 or unknown, has a page: safest default is an internal-link
  // play (protects the existing ranking) rather than touching the title.
  return {
    candidate,
    actionType: 'internal_link',
    auto: false,
    reason: candidate.position !== null
      ? `already ranking #${candidate.position} — touching the title risks the existing ranking; an internal-link boost is lower-risk and needs a human to pick the linking page`
      : 'no position data — defaulting to the lowest-risk manual action rather than guessing',
  }
}
