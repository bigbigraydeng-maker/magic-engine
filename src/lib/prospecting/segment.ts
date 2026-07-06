/**
 * Prospect segment derivation — maps rule-audit signals to a pitch angle.
 *
 * Reference: ROADMAP.md Phase 35 P35.5. Pure function, no AI.
 *
 * Segments decide the cold-email opening angle, not the product:
 *   core_target — strong business, broadly weak digital foundation
 *   blind_flyer — modern-ish site but no tracking (flying blind)
 *   social_gap  — decent site but no / dead social presence
 *   general     — none of the sharp patterns; use the generic angle
 */

import type { ScoreSignal } from './score'

export type ProspectSegment = 'core_target' | 'blind_flyer' | 'social_gap' | 'general'

const TRACKING_SIGNALS = new Set(['no_ga4', 'no_gtm', 'no_meta_pixel', 'legacy_ua'])
const SITE_QUALITY_SIGNALS = new Set([
  'no_https', 'missing_title', 'missing_description', 'missing_h1', 'slow_lcp', 'thin_content',
])

export function deriveSegment(input: {
  breakdown: ScoreSignal[]
  has_social_links: boolean
  /** posts in the last 30 days from the social scrape; null = not scraped. */
  social_posts_30d: number | null
}): ProspectSegment {
  const weaknesses = input.breakdown.filter(s => s.kind === 'weakness')
  const trackingGaps = weaknesses.filter(s => TRACKING_SIGNALS.has(s.signal)).length
  const siteGaps     = weaknesses.filter(s => SITE_QUALITY_SIGNALS.has(s.signal)).length

  // Broadly broken: site quality AND tracking both weak → lead with the full story.
  if (siteGaps >= 2 && trackingGaps >= 2) return 'core_target'

  // Site itself holds up but they can't see their numbers → lead with tracking.
  if (siteGaps <= 1 && trackingGaps >= 2) return 'blind_flyer'

  // Site + tracking pass but social is absent or dead → lead with content pack.
  const socialDead = !input.has_social_links || input.social_posts_30d === 0
  if (siteGaps <= 1 && trackingGaps <= 1 && socialDead) return 'social_gap'

  return 'general'
}
