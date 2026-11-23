/**
 * Single sanitiser for post-auth `next` / redirect paths.
 *
 * The old per-route check `startsWith('/') && !startsWith('//')` let
 * `/\evil.com` through: browsers normalise `\` to `/` in special-scheme URLs,
 * so `window.location.href = '/\\evil.com'` lands on `//evil.com` — an
 * off-site redirect. Tabs/newlines are stripped by the URL parser the same
 * way (`/\t/evil.com` → `//evil.com`).
 *
 * Accepted: a same-origin absolute path — exactly one leading `/`, no `\`,
 * no control characters. The same rules are applied again after one round
 * of percent-decoding, so `/%5Cevil.com` and `/%2F/evil.com` are rejected
 * too. Malformed percent-encoding is rejected rather than guessed at.
 *
 * `.` / `..` path segments are rejected as well: `/dashboard/../x` would slip
 * past a caller's `startsWith('/dashboard/')` check, and `/..//evil.com`
 * collapses to a `//`-prefixed path once the browser resolves it.
 *
 * Pure function with no server imports — safe in client components.
 */

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

function passesRawRules(value: string, decodedPass = false): boolean {
  if (!value.startsWith('/')) return false
  if (value.startsWith('//')) return false
  if (value.includes('\\')) return false
  if (CONTROL_CHARS.test(value)) return false
  // After decoding, an encoded `?`/`#` is no longer a real delimiter, so scan
  // every segment of the whole string (`/a/%23/%2e%2e/x` must not hide `..`).
  const pathPart = decodedPass ? value : value.split(/[?#]/, 1)[0]
  if (pathPart.split('/').some(segment => segment === '.' || segment === '..')) return false
  return true
}

export function isSafeInternalPath(value: unknown): value is string {
  if (typeof value !== 'string' || !passesRawRules(value)) return false
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return false
  }
  return passesRawRules(decoded, true)
}

export function safeInternalPath(value: unknown, fallback: string): string {
  return isSafeInternalPath(value) ? value : fallback
}
