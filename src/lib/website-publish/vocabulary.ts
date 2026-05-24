/**
 * Website Publish — shared constants and types for the `website_publish_jobs` table.
 *
 * Imported from both server-side connector code (P14.A.4 Shopify, P14.A.5 WordPress)
 * and the Blog Studio publish UI (P14.A.6). Kept free of side effects and external
 * imports so it is safe in browser bundles.
 */

import { createHash } from 'node:crypto'

// ─── Source type (what is being pushed) ──────────────────────────────────────

export const WEBSITE_PUBLISH_SOURCE = {
  BLOG_POST:   'blog_post',
  CAMPAIGN_LP: 'campaign_lp',
} as const

export type WebsitePublishSource =
  (typeof WEBSITE_PUBLISH_SOURCE)[keyof typeof WEBSITE_PUBLISH_SOURCE]

// ─── Job status (state machine) ──────────────────────────────────────────────
//
// Transitions enforced by the connector layer (not by the DB beyond the CHECK):
//
//   draft ──► published        (FDE confirms preview, connector publishes)
//   draft ──► failed           (connector error during publish)
//   published ──► rolled_back  (explicit unpublish / rollback)
//
// `failed` is terminal for the row; retries create a new row with a new
// idempotency_key (or reuse the existing one to short-circuit).

export const WEBSITE_PUBLISH_STATUS = {
  DRAFT:       'draft',
  PUBLISHED:   'published',
  FAILED:      'failed',
  ROLLED_BACK: 'rolled_back',
} as const

export type WebsitePublishStatus =
  (typeof WEBSITE_PUBLISH_STATUS)[keyof typeof WEBSITE_PUBLISH_STATUS]

/** Statuses from which `target` is a legal next state. */
const ALLOWED_TRANSITIONS: Record<WebsitePublishStatus, WebsitePublishStatus[]> = {
  draft:       ['published', 'failed'],
  published:   ['rolled_back'],
  failed:      [],
  rolled_back: [],
}

export function canTransition(
  from: WebsitePublishStatus,
  to:   WebsitePublishStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

// ─── Idempotency helpers ─────────────────────────────────────────────────────

/**
 * Canonical SHA-256 of a JSON-serialisable payload. Object keys are sorted
 * so logically-equal payloads always hash to the same value.
 */
export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}

/**
 * Default idempotency key shape: `{source_type}:{source_id}:{payload_hash}`.
 * UNIQUE per connection in the DB, so the same content pushed twice short-circuits.
 */
export function buildIdempotencyKey(input: {
  sourceType: WebsitePublishSource
  sourceId:   string
  hash:       string
}): string {
  return `${input.sourceType}:${input.sourceId}:${input.hash}`
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

// ─── Row shape (mirrors the SQL table) ───────────────────────────────────────

export interface WebsitePublishJobRow {
  id:                string
  client_id:         string
  connection_id:     string
  source_type:       WebsitePublishSource
  source_id:         string
  platform_post_id:  string | null
  target_url:        string | null
  content_snapshot:  Record<string, unknown>
  payload_hash:      string
  status:            WebsitePublishStatus
  idempotency_key:   string
  retry_count:       number
  error_message:     string | null
  published_at:      string | null
  created_at:        string
  updated_at:        string
}
