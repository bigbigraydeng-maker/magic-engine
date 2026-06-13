/**
 * Sanitizer for `blog_posts.internal_links` writes.
 *
 * P12.R.B10 — the Internal Links Panel posts the full BlogInternalLink[] back
 * with `resolved` toggled. A tampered client could put arbitrary JSON in the
 * array (deeply nested objects, prototypes, oversized strings); the PATCH
 * route runs every row through this helper so the column only ever holds the
 * exact shape downstream code expects.
 *
 * Pure — no I/O — so it can be unit-tested in isolation.
 */
import type { BlogInternalLink } from '@/types/magic-engine'

const ANCHOR_MAX_CHARS = 200
const SLUG_MAX_CHARS   = 200

export function sanitizeInternalLinks(input: unknown): BlogInternalLink[] {
  if (!Array.isArray(input)) return []
  return input.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>
    return {
      anchor:      typeof row.anchor      === 'string' ? row.anchor.slice(0, ANCHOR_MAX_CHARS) : '',
      target_slug: typeof row.target_slug === 'string' ? row.target_slug.slice(0, SLUG_MAX_CHARS) : '',
      // STRICT boolean — avoid truthy coercion so `"true"` / `1` / `{ }` do not
      // sneak in as `true`.
      resolved:    row.resolved === true,
    }
  })
}
