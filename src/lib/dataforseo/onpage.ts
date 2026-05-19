/**
 * DataForSEO OnPage API — Instant Pages technical SEO audit.
 *
 * Reference: ROADMAP.md P8.13.D.3
 *
 * Runs a fast, single-page technical audit against any URL — meta tags,
 * Core Web Vitals, broken images, missing alt text, canonical, etc.
 * Results feed DiscoveryReport.onpage_audit and surface issue highlights
 * directly into diagnosis.actions.quick_fix.
 *
 * Authentication: Basic Auth (DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD).
 *
 * Estimated cost: ~$0.003 per call.
 */

import { validateEnvVar } from '@/lib/validation-utils'

const DATAFORSEO_API_BASE = 'https://api.dataforseo.com/v3'

// ─── Return types ─────────────────────────────────────────────────────────────

export interface OnPageChecks {
  no_title:              boolean
  no_description:        boolean
  no_h1:                 boolean
  missing_alt_text:      boolean
  broken_links:          boolean
  redirect_chain:        boolean
  https:                 boolean
}

export interface OnPageResult {
  url:             string
  status_code:     number | null
  /** Page title — null if missing. */
  title:           string | null
  /** Meta description — null if missing. */
  description:     string | null
  /** Canonical URL — null if not specified. */
  canonical:       string | null
  /** H1 heading text — null if missing. */
  h1:              string | null
  /** Number of internal links on the page. */
  internal_links:  number | null
  /** Number of external links on the page. */
  external_links:  number | null
  /** Images missing alt text count. */
  images_no_alt:   number | null
  /** Total images count. */
  images_total:    number | null
  /** Word count (approximate). */
  word_count:      number | null
  /**
   * Core Web Vitals from Lighthouse (null when not available).
   * lcp: Largest Contentful Paint (ms), cls: Cumulative Layout Shift,
   * fid/tbt: Total Blocking Time (ms proxy).
   */
  core_web_vitals: {
    lcp: number | null
    cls: number | null
    tbt: number | null
  } | null
  /** Binary check flags derived from the audit. */
  checks:          OnPageChecks
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

function authHeader(): string {
  const login    = validateEnvVar('DATAFORSEO_LOGIN')
  const password = validateEnvVar('DATAFORSEO_PASSWORD')
  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run an instant on-page audit for one URL via DataForSEO.
 *
 * DataForSEO endpoint: /on_page/instant_pages
 *
 * @param url  Full https:// URL of the page to audit, e.g. "https://oztop.com.au/"
 * @returns    Audit result, or null if the URL was unreachable.
 */
export async function getOnPageInstant(url: string): Promise<OnPageResult | null> {
  const res = await fetch(
    `${DATAFORSEO_API_BASE}/on_page/instant_pages`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          url,
          enable_javascript:          false,
          load_resources:             false,
          enable_browser_rendering:   false,
          check_spell:                false,
        },
      ]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO OnPage error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      status_code?: number
      result?: Array<{
        items?: Array<{
          url?:          string | null
          status_code?:  number | null
          meta?: {
            title?:        string | null
            description?:  string | null
            canonical?:    string | null
            htags?: {
              h1?: string[] | null
            } | null
            internal_links_count?: number | null
            external_links_count?: number | null
            images_count?:          number | null
            images_without_alt?:    number | null
            words_count?:           number | null
          } | null
          page_timing?: {
            time_to_interactive?:     number | null
            largest_contentful_paint?: number | null
            cumulative_layout_shift?:  number | null
            total_blocking_time?:      number | null
          } | null
          checks?: {
            canonical?:              boolean | null
            is_https?:               boolean | null
            is_redirect?:            boolean | null
            no_content_encoding?:    boolean | null
            high_loading_time?:      boolean | null
          } | null
        }>
      }>
    }>
  }

  const item = json.tasks?.[0]?.result?.[0]?.items?.[0]
  if (!item) return null

  const meta    = item.meta    ?? {}
  const timing  = item.page_timing ?? {}
  const rawCheck = item.checks ?? {}
  const h1List  = meta.htags?.h1

  const checks: OnPageChecks = {
    no_title:         !meta.title,
    no_description:   !meta.description,
    no_h1:            !h1List || h1List.length === 0,
    missing_alt_text: (meta.images_without_alt ?? 0) > 0,
    broken_links:     false,
    redirect_chain:   rawCheck.is_redirect === true,
    https:            rawCheck.is_https === true,
  }

  return {
    url:            item.url ?? url,
    status_code:    item.status_code ?? null,
    title:          meta.title        ?? null,
    description:    meta.description  ?? null,
    canonical:      meta.canonical    ?? null,
    h1:             h1List?.[0]       ?? null,
    internal_links: meta.internal_links_count ?? null,
    external_links: meta.external_links_count ?? null,
    images_no_alt:  meta.images_without_alt   ?? null,
    images_total:   meta.images_count         ?? null,
    word_count:     meta.words_count          ?? null,
    core_web_vitals: (timing.largest_contentful_paint != null || timing.cumulative_layout_shift != null)
      ? {
          lcp: timing.largest_contentful_paint ?? null,
          cls: timing.cumulative_layout_shift  ?? null,
          tbt: timing.total_blocking_time      ?? null,
        }
      : null,
    checks,
  }
}
