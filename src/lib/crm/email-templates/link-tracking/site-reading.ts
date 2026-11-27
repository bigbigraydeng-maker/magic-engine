/**
 * "Is this guest reading our site right now?" — from the guest's own clicks on our mail links and the later page views
 * the client's site reports for the same device (brochure design 2026-11-17 §4, slice 4).
 *
 * Only human clicks count (`counts_as_human`); a scanner opening every link in a mail reads nothing. Pure: the reader
 * that fetches the rows is `site-reading-prod.ts`.
 */

import { classifyTourLink } from '../facts/published-tours'
import type { PageLabelFacts, TokenRead } from './click-summary'
import type { SiteReading } from '../../segments'

/** How far back a visit still means "reading now". */
export const SITE_READING_WINDOW_MS = 7 * 86_400_000
/**
 * How far back the loader reads clicks for "he opened what we sent" (`SiteReading.lastClickAt`). Covers the longest
 * industry click window (tourism, 60 days); the staff-list rule applies its own window on top.
 */
export const CLICK_LOOKBACK_MS = 60 * 86_400_000
/** Two brochure visits at least this far apart = the guest came back to it, not one session refreshing the page. */
export const RETURN_GAP_MS = 8 * 3_600_000
/** The client site's online brochure page (same address the timeline label uses, click-summary `pageViewLabel`). */
const BROCHURE_PATH = '/brochure'

export interface ClickForReading {
  contact_id: string
  token: string
  path: string | null
  occurred_at: string
}

function pathOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).pathname
  } catch {
    return url
  }
}

function tourOfPath(path: string, page: PageLabelFacts): string | null {
  const host = page.hosts[0] ?? null
  if (host === null) return null
  const hit = classifyTourLink(`https://${host}${path}`, page.facts)
  return hit?.kind === 'tour' ? hit.tour.name : null
}

/** Per contact: which tours they opened and how many separate times they came to the brochure, inside the window. */
export function summariseSiteReading(
  clicks: readonly ClickForReading[],
  tokens: readonly TokenRead[],
  page: PageLabelFacts,
  now: Date,
): Map<string, SiteReading> {
  const byToken = new Map(tokens.map((t) => [t.token, t]))
  const since = now.getTime() - SITE_READING_WINDOW_MS
  const acc = new Map<string, { tours: Set<string>; brochureAt: number[]; lastAt: number }>()
  for (const c of clicks) {
    const at = Date.parse(c.occurred_at)
    if (Number.isNaN(at) || at < since || at > now.getTime()) continue
    const token = byToken.get(c.token)
    if (token === undefined) continue
    const ownPage = c.path === null || c.path.split('?')[0] === pathOf(token.url)
    const path = ownPage ? pathOf(token.url) : c.path!.split('?')[0]
    const tour = ownPage && token.kind === 'tour' && token.tour !== null ? token.tour.name : tourOfPath(path, page)
    const entry = acc.get(c.contact_id) ?? { tours: new Set<string>(), brochureAt: [], lastAt: 0 }
    if (tour !== null) entry.tours.add(tour)
    if (path === BROCHURE_PATH) entry.brochureAt.push(at)
    entry.lastAt = Math.max(entry.lastAt, at)
    acc.set(c.contact_id, entry)
  }
  const out = new Map<string, SiteReading>()
  for (const [contactId, e] of acc) {
    out.set(contactId, { tours: [...e.tours], brochureVisits: countVisits(e.brochureAt), lastAt: new Date(e.lastAt).toISOString() })
  }
  return out
}

/** Visits separated by at least RETURN_GAP_MS; a burst of page loads in one sitting is one visit. */
export function countVisits(times: readonly number[]): number {
  const sorted = [...times].sort((a, b) => a - b)
  let visits = 0
  let lastVisitStart = -Infinity
  for (const t of sorted) {
    if (t - lastVisitStart >= RETURN_GAP_MS) {
      visits++
      lastVisitStart = t
    }
  }
  return visits
}

/**
 * Adds each guest's latest human click / page view on our mail links (inside CLICK_LOOKBACK_MS) to the reading map as
 * `lastClickAt`. A guest with only older clicks gets an entry with no tours and no brochure visits, so the
 * "reading the brochure" group is untouched while the staff list still knows he opened what we sent.
 */
export function attachLastClicks(
  reading: ReadonlyMap<string, SiteReading>,
  clicks: readonly ClickForReading[],
  now: Date,
): Map<string, SiteReading> {
  const since = now.getTime() - CLICK_LOOKBACK_MS
  const latest = new Map<string, number>()
  for (const c of clicks) {
    const at = Date.parse(c.occurred_at)
    if (Number.isNaN(at) || at < since || at > now.getTime()) continue
    latest.set(c.contact_id, Math.max(latest.get(c.contact_id) ?? 0, at))
  }
  const out = new Map(reading)
  for (const [contactId, at] of latest) {
    const iso = new Date(at).toISOString()
    const base = out.get(contactId) ?? { tours: [], brochureVisits: 0, lastAt: iso }
    out.set(contactId, { ...base, lastClickAt: iso })
  }
  return out
}
