/**
 * Rule-based prospect opportunity score — zero AI, runs on every prospect.
 *
 * Reference: ROADMAP.md Phase 35 (司马徽 outbound prospecting, Step 3).
 *
 * Philosophy (from the prospecting brief): opportunity = strong business ×
 * weak digital foundation. A thriving flooring store with 200 reviews and a
 * 2016-era untracked website is the ideal Digital Foundation customer; a
 * struggling business or an already-modern site is not.
 *
 * Only prospects scoring >= QUALIFICATION_THRESHOLD proceed to the paid AI
 * analysis step, which keeps AI spend per qualified lead under control.
 */

import type { TrackingSignals } from './tracking-detector'
import type { OnPageResult } from '@/lib/dataforseo/onpage'

export interface ProspectScoreInput {
  rating:        number | null
  review_count:  number | null
  has_phone:     boolean
  is_claimed:    boolean
  has_website:   boolean
  /** null when the site was unreachable or has no website. */
  https_ok:      boolean | null
  tracking:      TrackingSignals | null
  onpage:        OnPageResult | null
}

export interface ScoreSignal {
  signal: string
  points: number
  kind:   'strength' | 'weakness'
}

export interface ProspectScoreResult {
  /** 0–100. Business strength contributes up to 40, digital weakness up to 60. */
  score:     number
  qualified: boolean
  breakdown: ScoreSignal[]
}

export const QUALIFICATION_THRESHOLD = 55

const SLOW_LCP_MS = 4000
const THIN_CONTENT_WORDS = 200

export function calculateProspectScore(input: ProspectScoreInput): ProspectScoreResult {
  const breakdown: ScoreSignal[] = []
  const strength = (signal: string, points: number, hit: boolean) => {
    if (hit) breakdown.push({ signal, points, kind: 'strength' })
  }
  const weakness = (signal: string, points: number, hit: boolean) => {
    if (hit) breakdown.push({ signal, points, kind: 'weakness' })
  }

  // ── Business strength (established, trading, reachable) — max 40 ──────────
  strength('rating_4_plus',    8, (input.rating ?? 0) >= 4.0)
  strength('rating_4_5_plus',  4, (input.rating ?? 0) >= 4.5)
  strength('reviews_30_plus', 10, (input.review_count ?? 0) >= 30)
  strength('reviews_100_plus', 4, (input.review_count ?? 0) >= 100)
  strength('has_phone',        4, input.has_phone)
  strength('gbp_claimed',      4, input.is_claimed)
  strength('has_website',      6, input.has_website)

  // ── Digital weakness (upgrade opportunity) — max 60 ───────────────────────
  // Only meaningful when the site was actually audited.
  if (input.has_website) {
    const t = input.tracking
    weakness('no_https',        8, input.https_ok === false)
    // GA4 deployed inside a GTM container leaves no G- id in the HTML, so
    // only claim "no GA4" when there is no GTM either — a false claim here
    // ends up verbatim in the outreach email.
    weakness('no_ga4',         10, t !== null && !t.ga4 && !t.gtm)
    weakness('no_gtm',          4, t !== null && !t.gtm)
    weakness('no_meta_pixel',   8, t !== null && !t.meta_pixel)
    weakness('legacy_ua',       4, t?.legacy_ua === true)
    weakness('no_contact_form', 6, t !== null && !t.contact_form)

    const o = input.onpage
    weakness('missing_title',       3, o?.checks.no_title === true)
    weakness('missing_description', 3, o?.checks.no_description === true)
    weakness('missing_h1',          2, o?.checks.no_h1 === true)
    weakness('slow_lcp',            8, (o?.core_web_vitals?.lcp ?? 0) > SLOW_LCP_MS)
    weakness('thin_content',        4, o?.word_count !== null && o?.word_count !== undefined && o.word_count < THIN_CONTENT_WORDS)
  }

  const score = Math.min(100, breakdown.reduce((sum, s) => sum + s.points, 0))

  // No website = nothing to upgrade with the low-labour Foundation package;
  // route those to archive regardless of business strength.
  const qualified = input.has_website && score >= QUALIFICATION_THRESHOLD

  return { score, qualified, breakdown }
}
