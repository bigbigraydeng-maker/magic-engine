/**
 * Phase X.S3 — Email canonicalisation for bonus dedup + rate limiting.
 *
 * Two attacks this is intended to mitigate (H2/H3 in the Wei Zheng review):
 *   1. Gmail aliasing — a+1@gmail.com / a+2@gmail.com all deliver to
 *      a@gmail.com. A naive `lower(email)` check lets one person sign up
 *      arbitrarily many times and collect a 500-MTC bonus each round.
 *   2. Case + dot variants — A.B@Gmail.com vs ab@gmail.com.
 *
 * Gmail behaviour we replicate:
 *   - usernames are case-insensitive
 *   - dots in the local part are ignored
 *   - `+suffix` after the local part is stripped
 *   - googlemail.com is an alias for gmail.com
 *
 * For non-Gmail providers we conservatively only lowercase + trim — many
 * providers (notably FastMail, ProtonMail) treat +alias as a real per-message
 * label but the underlying inbox can vary, and stripping dots on, say,
 * outlook.com can collapse two distinct people. The cost of letting one
 * outlook person grab two bonuses is acceptable; the cost of merging two
 * different humans into one identity is not.
 *
 * This module is pure (no DB, no env reads) — call it everywhere the email
 * needs to act as a stable identity key (bonus ledger, scan rate limit).
 * For display + auth, keep the original.
 */

/** Domains whose local part is normalised aggressively (dots stripped, +alias removed). */
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

export interface NormalizedEmail {
  /** The canonical form used as a dedup key. Always lowercase. */
  normalized: string
  /** The lowercased original (no Gmail-specific transforms). Useful when joining tables. */
  lower: string
  /** Whether we applied any Gmail-specific transforms. */
  transformed: boolean
}

/**
 * Returns the canonical form of an email for dedup purposes.
 * Returns `null` for inputs that don't look like a usable email.
 *
 * Examples:
 *   normalizeEmail('A.B+promo@Gmail.com') → 'ab@gmail.com'
 *   normalizeEmail('user@googlemail.com') → 'user@gmail.com'
 *   normalizeEmail('Foo+x@Example.com')   → 'foo+x@example.com'  (non-gmail, only lower+trim)
 *   normalizeEmail('')                    → null
 */
export function normalizeEmail(raw: string | null | undefined): NormalizedEmail | null {
  if (!raw) return null
  const trimmed = String(raw).trim()
  if (!trimmed) return null

  const atIdx = trimmed.lastIndexOf('@')
  if (atIdx <= 0 || atIdx === trimmed.length - 1) {
    // No '@', empty local, or empty domain — not a valid email shape.
    return null
  }

  const localRaw  = trimmed.slice(0, atIdx)
  const domainRaw = trimmed.slice(atIdx + 1)

  const lowerLocal  = localRaw.toLowerCase()
  const lowerDomain = domainRaw.toLowerCase()
  const lower       = `${lowerLocal}@${lowerDomain}`

  // Apply Gmail-specific rules only for gmail / googlemail.
  if (GMAIL_DOMAINS.has(lowerDomain)) {
    // Strip +alias suffix from the local part.
    const plusIdx = lowerLocal.indexOf('+')
    const noAlias = plusIdx === -1 ? lowerLocal : lowerLocal.slice(0, plusIdx)
    // Strip dots — Gmail ignores them entirely.
    const noDots = noAlias.replace(/\./g, '')
    // Normalise googlemail.com → gmail.com so the two aliases collapse.
    const normalized = `${noDots}@gmail.com`
    return {
      normalized,
      lower,
      transformed: normalized !== lower,
    }
  }

  return { normalized: lower, lower, transformed: false }
}

/**
 * Convenience: returns just the canonical string, or '' for invalid input.
 * Most callers want this — they don't care about the `transformed` flag.
 */
export function canonicalEmail(raw: string | null | undefined): string {
  const r = normalizeEmail(raw)
  return r?.normalized ?? ''
}
