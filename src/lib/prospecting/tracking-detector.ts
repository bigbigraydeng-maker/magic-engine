/**
 * Tracking & conversion signal detector — zero-AI, zero-cost HTML analysis.
 *
 * Reference: ROADMAP.md Phase 35 (司马徽 outbound prospecting, Step 2).
 *
 * Pure regex checks over a homepage HTML string. Missing tracking is the
 * strongest "weak digital foundation" signal in the prospect score, and it
 * maps 1:1 to the Digital Foundation package deliverable (GA4/GTM/Pixel/
 * Clarity install), so the audit doubles as the outreach talking point.
 */

export interface TrackingSignals {
  ga4:          boolean
  gtm:          boolean
  meta_pixel:   boolean
  clarity:      boolean
  /** Legacy Universal Analytics id present — signals an outdated 2016-era setup. */
  legacy_ua:    boolean
  contact_form: boolean
  /** Publicly listed emails found on the page (mailto + plain text). */
  emails:       string[]
  /** First Facebook page / Instagram profile linked from the page. */
  facebook_url:  string | null
  instagram_url: string | null
}

const PATTERNS: Array<{ key: keyof Pick<TrackingSignals, 'ga4' | 'gtm' | 'meta_pixel' | 'clarity' | 'legacy_ua' | 'contact_form'>; regex: RegExp }> = [
  { key: 'ga4',        regex: /gtag\/js\?id=G-|gtag\(\s*['"]config['"]\s*,\s*['"]G-/i },
  // Case-sensitive: container ids are always upper-case "GTM-…"; /i would
  // false-positive on class names like class="gtm-track".
  { key: 'gtm',        regex: /googletagmanager\.com\/gtm\.js|['"]GTM-[A-Z0-9]{4,}['"]/ },
  { key: 'meta_pixel', regex: /connect\.facebook\.net\/[^'"]*fbevents\.js|fbq\(\s*['"]init['"]/i },
  { key: 'clarity',    regex: /clarity\.ms\/tag|['"]clarity['"]\s*,\s*window/i },
  { key: 'legacy_ua',  regex: /['"]UA-\d{4,}-\d+['"]/ },
  // A form containing an email/tel input (without crossing a </form>
  // boundary — a search form followed by a footer newsletter input must not
  // match), or contact/enquiry/quote in the form tag's attributes.
  { key: 'contact_form', regex: /<form[^>]*(?:contact|enquir|inquir|quote)[^>]*>|<form(?:(?!<\/form)[\s\S]){0,2000}?type=["'](?:email|tel)["']/i },
]

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
// Asset filenames and tracking-domain noise that match the email regex shape.
const EMAIL_JUNK = /\.(png|jpe?g|gif|svg|webp|css|js)$|@(sentry|example)\./i

// Excludes non-profile paths AND path-only prefixes (profile.php / pages/…)
// whose identity lives past the first segment — a truncated capture there
// would send Apify to the wrong page.
const FACEBOOK_REGEX  = /https?:\/\/(?:www\.)?facebook\.com\/(?!sharer|share|plugins|dialog|tr\b|login|policies|profile\.php|pages\b|groups\b|events\b|watch\b|privacy|help\b|hashtag)[A-Za-z0-9_.\-]+\/?/i
const INSTAGRAM_REGEX = /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel\/|explore|accounts)[A-Za-z0-9_.\-]+\/?/i

export function detectTrackingSignals(html: string): TrackingSignals {
  const signals = Object.fromEntries(
    PATTERNS.map(({ key, regex }) => [key, regex.test(html)]),
  ) as Pick<TrackingSignals, 'ga4' | 'gtm' | 'meta_pixel' | 'clarity' | 'legacy_ua' | 'contact_form'>

  const emails = Array.from(new Set(
    (html.match(EMAIL_REGEX) ?? [])
      .map(e => e.toLowerCase())
      .filter(e => !EMAIL_JUNK.test(e)),
  )).slice(0, 5)

  return {
    ...signals,
    emails,
    facebook_url:  html.match(FACEBOOK_REGEX)?.[0] ?? null,
    instagram_url: html.match(INSTAGRAM_REGEX)?.[0] ?? null,
  }
}
