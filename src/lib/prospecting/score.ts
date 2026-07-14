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

// Lowered 55 → 45 (P35.12 supply-unblock, PM 2026-07-14): at 55 a business
// needed near-total digital dysfunction to qualify, but "has a real email /
// contact form / HTTPS" (i.e. reachable enough to email) systematically costs
// the three biggest weakness signals (no_contact_form 14 + no_enquiry_path 8 +
// no_https 10 = 32), capping healthy-but-under-marketed businesses at ~40–54.
// That anti-selected exactly the contactable prospects the $19.90/$990 offer is
// for. 45 admits the "good business, just not marketing itself" band; the email
// gate on analyze/draft still keeps AI spend to reachable prospects.
export const QUALIFICATION_THRESHOLD = 45

// A no-website business can't be site-audited, but a real, contactable local
// business is a prime target for the one-time $99 one-page-site deal. The bar
// is deliberately low: our customer is the SMALL business (few reviews, weak
// online), NOT the industry leader — a handful of reviews just proves it's a
// real, trading shop rather than a dead listing.
export const NO_WEBSITE_MIN_REVIEWS = 3

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

  // ── Business strength — "real, trading, reachable", NOT "big". Our target
  //    is the small local business that needs us; industry leaders (hundreds
  //    of reviews) have their own teams and don't buy a rescue package, so
  //    review count earns only a small "it's a real, active shop" signal and
  //    no size bonus beyond that.
  strength('rating_4_plus',   8, (input.rating ?? 0) >= 4.0)
  strength('rating_4_5_plus', 4, (input.rating ?? 0) >= 4.5)
  strength('reviews_5_plus',  6, (input.review_count ?? 0) >= 5)
  strength('has_phone',       4, input.has_phone)
  strength('gbp_claimed',     4, input.is_claimed)
  strength('has_website',     6, input.has_website)

  // ── Digital weakness (lead-leak opportunity) — weighted toward the leaks
  //    that cost enquiries, not just missing analytics. Only meaningful when
  //    the site was actually audited.
  if (input.has_website) {
    const t = input.tracking
    // ③ Getting in touch — the sharpest lead leak: no way to enquire.
    weakness('no_contact_form', 14, t !== null && !t.contact_form)
    weakness('no_enquiry_path',  8, t !== null && !t.contact_form && t.emails.length === 0)
    // ② First impression — insecure site scares visitors off before they act.
    weakness('no_https',        10, input.https_ok === false)
    // ⑤ Bringing leads in — no ad pixel = can't run/measure the lead ads.
    weakness('no_meta_pixel',   10, t !== null && !t.meta_pixel)
    // Measurement gaps still count, but less than an actual leak.
    // GA4 inside a GTM container leaves no G- id, so only claim "no GA4"
    // when there is no GTM either — a false claim ends up in the email.
    weakness('no_ga4',           4, t !== null && !t.ga4 && !t.gtm)
    weakness('no_gtm',           2, t !== null && !t.gtm)
    weakness('legacy_ua',        3, t?.legacy_ua === true)
    // ① Getting found — SEO basics + speed.
    const o = input.onpage
    weakness('missing_title',       4, o?.checks.no_title === true)
    weakness('missing_description', 3, o?.checks.no_description === true)
    weakness('missing_h1',          2, o?.checks.no_h1 === true)
    weakness('slow_lcp',            8, (o?.core_web_vitals?.lcp ?? 0) > SLOW_LCP_MS)
    weakness('thin_content',        5, o?.word_count !== null && o?.word_count !== undefined && o.word_count < THIN_CONTENT_WORDS)
  }

  const score = Math.min(100, breakdown.reduce((sum, s) => sum + s.points, 0))

  // Two qualification paths:
  //  - has a website → score must clear the threshold (established business ×
  //    leaking site).
  //  - no website → can't be site-audited, but an established business (real
  //    reviews) is the ideal target for the one-time $99 one-page-site deal.
  const qualified = input.has_website
    ? score >= QUALIFICATION_THRESHOLD
    : input.has_phone && (input.review_count ?? 0) >= NO_WEBSITE_MIN_REVIEWS

  return { score, qualified, breakdown }
}
