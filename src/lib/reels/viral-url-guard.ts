/**
 * Viral reference source-URL guard.
 *
 * `viral_reference_library.source_url` is handed to yt-dlp / Gemini by the analyzer, so it is
 * untrusted input. This guard is the single place that decides whether a URL may be fetched:
 *   - syntax: http(s) only, bounded length, no whitespace / quotes / shell metacharacters,
 *     no embedded credentials, only default ports;
 *   - target: no localhost / internal names, no private, loopback or link-local addresses
 *     (IP literals are checked directly, hostnames after DNS resolution via safe-fetch).
 * The analyzer additionally passes the URL to yt-dlp as an argv element (never via a shell).
 *
 * Residual risk: yt-dlp re-resolves DNS itself, so a rebinding attacker could still flip the answer
 * between this check and the download. Closing that needs a pinned-address egress, out of scope here.
 */

import { isIP } from 'net'
import { classifyAddress, resolveValidatedAddress } from '@/lib/net/safe-fetch'

export const MAX_VIRAL_URL_LENGTH = 2048

/**
 * Whitespace, control chars, quotes, backtick, `$`, backslash and other shell metacharacters.
 * `&` is deliberately allowed: it is a normal query-string separator (all Xiaohongshu share links
 * carry it) and is inert because the url is passed as an argv element, never through a shell.
 */
const FORBIDDEN_CHARS = /[\s\u0000-\u001f\u007f"'`$\\|;<>(){}^*!]/

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home', '.corp']

export type ViralUrlCheck = { ok: true; url: string } | { ok: false; reason: string }

export function validateViralSourceUrl(raw: unknown): ViralUrlCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'url must be a string' }
  if (raw.length === 0 || raw.length > MAX_VIRAL_URL_LENGTH) return { ok: false, reason: 'url length invalid' }
  if (FORBIDDEN_CHARS.test(raw)) return { ok: false, reason: 'url contains forbidden characters' }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, reason: 'url is not parseable' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'only http/https urls are allowed' }
  }
  if (parsed.username || parsed.password) return { ok: false, reason: 'url must not embed credentials' }
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    return { ok: false, reason: 'non-default ports are not allowed' }
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase()
  if (!host) return { ok: false, reason: 'url has no host' }
  if (host === 'localhost' || BLOCKED_HOST_SUFFIXES.some(s => host.endsWith(s))) {
    return { ok: false, reason: 'internal hostnames are not allowed' }
  }
  if (isIP(host) !== 0 && classifyAddress(host).blocked) {
    return { ok: false, reason: 'non-public ip addresses are not allowed' }
  }
  // Single-label hosts (no dot, not an IP) only resolve on internal resolvers.
  if (isIP(host) === 0 && !host.includes('.')) return { ok: false, reason: 'internal hostnames are not allowed' }

  // The normalised href is what we pass on; re-check it so URL normalisation cannot reintroduce anything.
  if (FORBIDDEN_CHARS.test(parsed.href)) return { ok: false, reason: 'url contains forbidden characters' }
  return { ok: true, url: parsed.href }
}

/** Syntax check plus DNS check (every resolved address must be public). Throws on any failure. */
export async function assertSafeViralSourceUrl(raw: unknown): Promise<string> {
  const check = validateViralSourceUrl(raw)
  if (!check.ok) throw new Error(`Unsafe viral source url: ${check.reason}`)
  const host = new URL(check.url).hostname.replace(/^\[|\]$/g, '')
  try {
    await resolveValidatedAddress(host)
  } catch {
    throw new Error('Unsafe viral source url: host does not resolve to a public address')
  }
  return check.url
}
