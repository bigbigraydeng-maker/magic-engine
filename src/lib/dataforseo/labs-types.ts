/**
 * DataForSEO Labs API — shared types, constants, and helpers.
 *
 * Split out of labs.ts (2026-09-23). labs.ts remains the barrel.
 */

import { validateEnvVar } from '@/lib/validation-utils'

export const DATAFORSEO_API_BASE = 'https://api.dataforseo.com/v3'

// AU=2036, NZ=2554  (matches client.ts LOCATION_CODE_BY_DB)
export const DEFAULT_LOCATION_CODE = 2036
export const DEFAULT_LANGUAGE_CODE = 'en'

/** A task-level API failure returned inside an otherwise-successful HTTP 200. */
export class DataForSeoTaskError extends Error {
  constructor(
    public readonly errorCode: number | undefined,
    message: string,
  ) {
    super(message)
    this.name = 'DataForSeoTaskError'
  }
}

// ─── Return types ─────────────────────────────────────────────────────────────

export interface LabsKeyword {
  keyword: string
  /** Monthly search volume (Google, location-specific). null = no data */
  search_volume: number | null
  /** Keyword difficulty 0–100 (higher = harder to rank). null = no data */
  keyword_difficulty: number | null
  /** Cost-per-click in USD. null = no data */
  cpc: number | null
  /** Competition density 0–1 (paid search competition). null = no data */
  competition: number | null
  /** Search intent — derived from CPC when not provided by API.
   *  'informational' | 'navigational' | 'commercial' | 'transactional' */
  intent: string
  /** Organic rank position when returned by ranked-keywords endpoints */
  position?: number | null
  /** Competitor domain this gap keyword was found from (gap analysis only) */
  from_competitor?: string | null
}

export interface DomainTrendPoint {
  /** 'YYYY-MM' format */
  month: string
  organic_traffic: number
}

export interface LabsCompetitor {
  /** Competitor domain, no protocol/trailing slash */
  domain: string
  /** Average organic position across intersecting keywords */
  avg_position: number | null
  /** Number of shared keywords with the target */
  intersections: number
  /** Estimated monthly organic traffic (ETV) */
  monthly_traffic: number | null
  /** Number of organic ranking keywords */
  keyword_count: number | null
}

export interface BulkTrafficResult {
  domain: string
  /** Estimated monthly organic traffic (ETV). null = no data */
  monthly_traffic: number | null
}

export interface DomainMetrics {
  organic_keywords: number
  organic_traffic:  number
  /** Approximated from DataForSEO backlink rank (0–100). */
  authority_score:  number
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

export function authHeader(): string {
  const login    = validateEnvVar('DATAFORSEO_LOGIN')
  const password = validateEnvVar('DATAFORSEO_PASSWORD')
  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Derive search intent from CPC as a proxy when the API doesn't return intent.
 * CPC proxy: high CPC → commercial/transactional, low → informational.
 */
export function deriveIntent(cpc: number | null): string {
  if (cpc === null || cpc === 0) return 'informational'
  if (cpc < 1)  return 'informational'
  if (cpc < 3)  return 'commercial'
  return 'transactional'
}

export function normalizeDataForSeoIntent(intent: string | null | undefined, cpc: number | null): string {
  if (intent === 'informational' || intent === 'commercial' || intent === 'transactional' || intent === 'navigational') {
    return intent
  }

  return deriveIntent(cpc)
}

export function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/**
 * Throw when a DataForSEO task reports a non-success status_code inside an
 * otherwise-successful HTTP 200 response (e.g. 40210 balance exhausted).
 * A missing task or missing status_code is treated as OK so existing mocks
 * that omit the field keep working.
 */
export function assertTaskOk(
  task: { status_code?: number; status_message?: string } | undefined,
  endpoint: string,
): void {
  if (task && typeof task.status_code === 'number' && task.status_code !== 20000) {
    throw new DataForSeoTaskError(
      task.status_code,
      `DataForSEO ${endpoint} task error ${task.status_code}: ${task.status_message ?? 'unknown'}`,
    )
  }
}
