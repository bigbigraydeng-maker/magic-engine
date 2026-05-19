/**
 * DataForSEO Domain Analytics API — technology stack + domain WHOIS.
 *
 * Reference: ROADMAP.md P8.13.B.1
 *
 * Two new intelligence dimensions for 张骞 Discovery:
 *   - getDomainTechnologies: CMS / ecommerce / analytics stack, contact info
 *   - getDomainWhois:        domain age, expiry, registrar, traffic estimates
 *
 * Both functions return null on "domain not found" — non-fatal for 张骞.
 * Combined cost: ~$0.11 per client (Whois $0.10 + Technologies $0.01).
 *
 * Authentication: Basic Auth (DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD).
 */

import { validateEnvVar } from '@/lib/validation-utils'

const DATAFORSEO_API_BASE = 'https://api.dataforseo.com/v3'

// ─── Return types ─────────────────────────────────────────────────────────────

export interface DomainTechnologies {
  /** Detected CMS, e.g. "WordPress", "Shopify", "Wix". null if not detected. */
  cms:              string | null
  /** Detected ecommerce platform, e.g. "WooCommerce", "Magento". null if none. */
  ecommerce:        string | null
  /** Analytics tools detected, e.g. ["Google Analytics 4", "Google Tag Manager"] */
  analytics:        string[]
  /** CRM / email marketing tools, e.g. ["Mailchimp", "HubSpot"] */
  crm_marketing:    string[]
  /** Live chat tool detected, e.g. "Intercom", "Tidio". null if none. */
  chat:             string | null
  /** DataForSEO domain rank (≈ domain authority proxy) */
  domain_rank:      number | null
  /** Phone numbers extracted from the website */
  phone_numbers:    string[]
  /** Email addresses extracted from the website */
  emails:           string[]
  /** Social profile URLs detected on the site (Facebook, Instagram, LinkedIn, …) */
  social_graph_urls: string[]
}

export interface DomainWhois {
  /** ISO date string of domain registration. null if not available. */
  registered_at:          string | null
  /** ISO date string of domain expiry. null if not available. */
  expires_at:             string | null
  /** Registrar name, e.g. "GoDaddy.com, LLC" */
  registrar:              string | null
  /** Domain age in fractional years (calculated from registered_at). */
  domain_age_years:       number | null
  /** Number of referring domains (backlink source count) */
  referring_domains:      number | null
  /** Total backlinks count */
  backlinks:              number | null
  /** Estimated organic traffic value (DataForSEO ETV metric) */
  organic_etv:            number | null
  /** Number of keywords ranking in Google top-10 */
  organic_keywords_top10: number | null
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

function authHeader(): string {
  const login    = validateEnvVar('DATAFORSEO_LOGIN')
  const password = validateEnvVar('DATAFORSEO_PASSWORD')
  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect the technology stack used by a domain.
 *
 * DataForSEO endpoint: /domain_analytics/technologies/domain_technologies/live
 *
 * @param domain  Target domain, e.g. "oztop.com.au"
 * @returns       Parsed technology stack, or null if domain not found.
 */
export async function getDomainTechnologies(domain: string): Promise<DomainTechnologies | null> {
  const res = await fetch(
    `${DATAFORSEO_API_BASE}/domain_analytics/technologies/domain_technologies/live`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([{ target: domain }]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO domain technologies error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      status_code?: number
      result?: Array<{
        target?:       string
        domain_rank?:  number | null
        meta?: {
          phone_numbers?:    string[]
          emails?:           string[]
          social_graph_urls?: string[]
        }
        technologies?: Array<{
          name?:       string
          categories?: string[]
          tag?:        string
        }>
      }>
    }>
  }

  const taskResult = json.tasks?.[0]?.result?.[0]
  if (!taskResult) return null

  const techs = taskResult.technologies ?? []

  // Normalise technology categories to our named buckets
  const cms         = pickFirst(techs, ['cms', 'content-management'])
  const ecommerce   = pickFirst(techs, ['ecommerce', 'e-commerce', 'online-store'])
  const analytics   = pickAll(techs, ['analytics', 'tag-manager', 'web-analytics'])
  const crm_marketing = pickAll(techs, ['crm', 'marketing', 'email-marketing', 'marketing-automation'])
  const chat        = pickFirst(techs, ['live-chat', 'chat', 'customer-support'])

  return {
    cms,
    ecommerce,
    analytics,
    crm_marketing,
    chat,
    domain_rank:       taskResult.domain_rank ?? null,
    phone_numbers:     taskResult.meta?.phone_numbers ?? [],
    emails:            taskResult.meta?.emails ?? [],
    social_graph_urls: taskResult.meta?.social_graph_urls ?? [],
  }
}

/**
 * Fetch WHOIS domain registration data.
 *
 * DataForSEO endpoint: /domain_analytics/whois/overview/live
 *
 * @param domain  Target domain, e.g. "oztop.com.au"
 * @returns       WHOIS data, or null if domain not found.
 */
export async function getDomainWhois(domain: string): Promise<DomainWhois | null> {
  const res = await fetch(
    `${DATAFORSEO_API_BASE}/domain_analytics/whois/overview/live`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([{ target: domain }]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO WHOIS error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      result?: Array<{
        domain?:           string
        creation_date?:    string | null
        expiration_date?:  string | null
        registrar?:        { name?: string } | null
        backlinks_info?: {
          backlinks?:         number | null
          referring_domains?: number | null
        }
        metrics?: {
          organic?: {
            etv?:   number | null
            count?: number | null
            pos_1_3?: number | null
            pos_4_10?: number | null
          }
        }
      }>
    }>
  }

  const r = json.tasks?.[0]?.result?.[0]
  if (!r) return null

  const registeredAt  = r.creation_date   ?? null
  const domainAgeYears = registeredAt
    ? Number(((Date.now() - Date.parse(registeredAt)) / (365.25 * 24 * 60 * 60 * 1000)).toFixed(1))
    : null

  // organic_keywords_top10 = keywords ranking in positions 1-10
  const top10 =
    (r.metrics?.organic?.pos_1_3 ?? 0) +
    (r.metrics?.organic?.pos_4_10 ?? 0) || null

  return {
    registered_at:          registeredAt,
    expires_at:             r.expiration_date ?? null,
    registrar:              r.registrar?.name ?? null,
    domain_age_years:       domainAgeYears,
    referring_domains:      r.backlinks_info?.referring_domains ?? null,
    backlinks:              r.backlinks_info?.backlinks ?? null,
    organic_etv:            r.metrics?.organic?.etv ?? null,
    organic_keywords_top10: top10,
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface TechItem {
  name?: string
  categories?: string[]
  tag?: string
}

function matchesCategory(item: TechItem, categories: string[]): boolean {
  const cats = [
    ...(item.categories ?? []),
    ...(item.tag ? [item.tag] : []),
  ].map(c => c.toLowerCase())
  return categories.some(c => cats.some(cat => cat.includes(c)))
}

function pickFirst(techs: TechItem[], categories: string[]): string | null {
  const found = techs.find(t => matchesCategory(t, categories))
  return found?.name ?? null
}

function pickAll(techs: TechItem[], categories: string[]): string[] {
  return techs
    .filter(t => matchesCategory(t, categories))
    .map(t => t.name ?? '')
    .filter(Boolean)
}
