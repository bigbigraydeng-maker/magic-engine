/**
 * Give each tracked link in a plain-text mail body a click token (`me=<12 chars>`). Pure: no I/O, no clock.
 * Design: docs/specs/2026-11-10-crm-email-click-tracking-b2-design-v0.md §4.2.
 *
 * Rules:
 *  - only links whose host is in `hosts` (case-insensitive, trailing dot ignored), http(s) or bare `www.`;
 *  - an existing `me` parameter is dropped first (an old link copied from the timeline must not count for the old mail);
 *  - the token goes before any `#fragment`; nothing else in the link or around it changes;
 *  - one token per distinct link in a mail;
 *  - afterwards the result is checked with the SAME link finder the send gates use: every link must be the original
 *    plus `me=` and nothing else, in the same number. Any difference → the original body is returned untouched.
 */

import { extractLinks } from '../gates/content-gates'
import { normalizeForLinks } from '../gates/normalize'

export const TOKEN_PARAM = 'me'
export const TOKEN_RE = /^[A-Za-z0-9]{12}$/

// A link as it is written in plain text: scheme or "www.", then URL characters. Trailing sentence punctuation is
// trimmed below the same way the link finder trims it.
const RAW_LINK_RE = /(?:https?:\/\/|www\.)[A-Za-z0-9\-._~:/?#@!$&*+,;=%[\]]+/gi
const TRAILING_PUNCT_RE = /[.,;:!?)]+$/

export interface TaggedLink {
  token: string
  /** The link as it was in the body, without any old `me` parameter. */
  url: string
}

export type TagResult =
  | { ok: true; body: string; links: TaggedLink[] }
  | { ok: false; body: string; reason: 'mismatch' }

function hostOf(link: string): string | null {
  const full = /^https?:\/\//i.test(link) ? link : `https://${link}`
  try {
    return new URL(full).hostname.toLowerCase().replace(/\.+$/, '')
  } catch {
    return null
  }
}

/** The link without any `me=` parameter; everything else kept as written. */
export function stripToken(link: string): string {
  const hashAt = link.indexOf('#')
  const beforeHash = hashAt < 0 ? link : link.slice(0, hashAt)
  const hash = hashAt < 0 ? '' : link.slice(hashAt)
  const qAt = beforeHash.indexOf('?')
  if (qAt < 0) return link
  const base = beforeHash.slice(0, qAt)
  const kept = beforeHash
    .slice(qAt + 1)
    .split('&')
    .filter((part) => part !== '' && part.split('=')[0].toLowerCase() !== TOKEN_PARAM)
  return `${base}${kept.length > 0 ? `?${kept.join('&')}` : ''}${hash}`
}

function withToken(link: string, token: string): string {
  const hashAt = link.indexOf('#')
  const beforeHash = hashAt < 0 ? link : link.slice(0, hashAt)
  const hash = hashAt < 0 ? '' : link.slice(hashAt)
  return `${beforeHash}${beforeHash.includes('?') ? '&' : '?'}${TOKEN_PARAM}=${token}${hash}`
}

function linksOf(text: string): string[] {
  return extractLinks(normalizeForLinks(text)).map((l) => stripToken(l))
}

export function tagBody(body: string, hosts: readonly string[], newToken: () => string): TagResult {
  const tracked = new Set(hosts.map((h) => h.toLowerCase().replace(/\.+$/, '')))
  const tokens = new Map<string, string>()
  const out = body.replace(RAW_LINK_RE, (match) => {
    const link = match.replace(TRAILING_PUNCT_RE, '')
    const tail = match.slice(link.length)
    const host = hostOf(link)
    if (host === null || !tracked.has(host)) return match
    const clean = stripToken(link)
    let token = tokens.get(clean)
    if (token === undefined) {
      token = newToken()
      if (!TOKEN_RE.test(token)) throw new Error('bad token')
      tokens.set(clean, token)
    }
    return withToken(clean, token) + tail
  })
  if (tokens.size === 0) return { ok: true, body, links: [] }
  const before = linksOf(body)
  const after = linksOf(out)
  const same = before.length === after.length && before.every((l, i) => l === after[i])
  const everyTokenLands = [...tokens.values()].every((t) => out.includes(`${TOKEN_PARAM}=${t}`))
  if (!same || !everyTokenLands) return { ok: false, body, reason: 'mismatch' }
  return { ok: true, body: out, links: [...tokens].map(([url, token]) => ({ token, url })) }
}
