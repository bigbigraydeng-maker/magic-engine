/**
 * Given a list of files touched by a chinatravel push, decide which
 * front-end paths need to be revalidated in Next.js Full Route Cache
 * and purged in Cloudflare's edge cache.
 *
 * Deliberately conservative: if we don't recognise a data path we
 * don't over-scope. `hasSiteChange` returns false when nothing looks
 * like it would change what a public page renders — the caller then
 * skips the whole refresh pipeline.
 *
 * We do NOT try to introspect which specific tour or blog slug changed
 * inside those bundled data files (they're all one big `.ts` module).
 * MVP behaviour: mark every published tour URL and every blog URL as
 * potentially stale, and let the verify step confirm each one.
 */

export interface SiteRefreshPlan {
  readonly hasSiteChange: boolean
  readonly tourDataChanged: boolean
  readonly blogDataChanged: boolean
  readonly reasons: readonly string[]
}

const TOURS_DATA_RE = /^src\/lib\/data\/tours\.ts$/
const BLOG_DATA_RE = /^src\/lib\/data\/blogs.*\.ts$/
const CAMPAIGNS_RE = /^src\/lib\/campaigns\//
const APP_ROUTES_RE = /^src\/app\/(tours|blog|china-tours|campaigns)\//
const SCHEMA_RE = /^src\/lib\/(schema-tour|seo-metadata|site-media)\.ts$/

export function planSiteRefresh(changedFiles: readonly string[]): SiteRefreshPlan {
  const reasons: string[] = []
  let tourDataChanged = false
  let blogDataChanged = false

  for (const f of changedFiles) {
    if (TOURS_DATA_RE.test(f)) {
      tourDataChanged = true
      reasons.push(`tour-data:${f}`)
    } else if (BLOG_DATA_RE.test(f)) {
      blogDataChanged = true
      reasons.push(`blog-data:${f}`)
    } else if (CAMPAIGNS_RE.test(f)) {
      tourDataChanged = true
      reasons.push(`campaign:${f}`)
    } else if (SCHEMA_RE.test(f)) {
      tourDataChanged = true
      blogDataChanged = true
      reasons.push(`schema:${f}`)
    } else if (APP_ROUTES_RE.test(f)) {
      tourDataChanged = true
      blogDataChanged = true
      reasons.push(`app-route:${f}`)
    }
  }

  return {
    hasSiteChange: tourDataChanged || blogDataChanged,
    tourDataChanged,
    blogDataChanged,
    reasons,
  }
}

/**
 * The published tour URLs on ctstours.co.nz. Kept as an explicit list
 * so the refresh pipeline stays deterministic (build never sees the
 * chinatravel repo). Add a new row when a new tour lands on the site.
 */
export const CTS_TOUR_PATHS: readonly string[] = [
  '/tours/china/discovery/essentials',
  '/tours/china/discovery/beijing-xian',
  '/tours/china/discovery/shanghai-surroundings',
  '/tours/china/discovery/golden-china',
  '/tours/china/discovery/tale-of-two-cities',
  '/tours/china/signature/imperial-heritage',
  '/tours/china/signature/silk-road',
] as const

/** Blog hub + high-value long-tail blog URLs whose Full Route Cache we */
/** actively refresh. Kept short on purpose — deep long-tail is handled */
/** by the next scheduled Render build.                                  */
export const CTS_BLOG_PATHS: readonly string[] = [
  '/blog/beijing-xian-itinerary-10-days',
  '/blog/shanghai-suzhou-hangzhou-itinerary',
  '/blog/holidays-to-china-from-new-zealand',
  '/blog/china-tour-packages-including-airfare-from-nz',
] as const

/** Convert a SiteRefreshPlan into the concrete list of paths to hit. */
export function pathsFromPlan(plan: SiteRefreshPlan): readonly string[] {
  const out: string[] = []
  if (plan.tourDataChanged) out.push(...CTS_TOUR_PATHS)
  if (plan.blogDataChanged) out.push(...CTS_BLOG_PATHS)
  return Array.from(new Set(out))
}
