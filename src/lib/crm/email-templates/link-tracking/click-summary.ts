/**
 * What staff see about clicks: one short label per clicked link, human clicks only (design 2026-11-10 B2 §4.6).
 * Reads never break the page they sit on: a failed read returns `null` (the caller shows "—"), never throws.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyTourLink, type TourLinkRef } from '../facts/published-tours'
import type { RenderFacts } from '../facts/types'
import { effectiveFromSettings } from '../effective-config'
import { loadEmailSettings } from '../settings-store'
import { loadPublishedTourFacts } from '@/lib/tour-catalog/store-publish'
import type { LinkKind } from './tag-links-prod'

export interface ClickSummary {
  label: string
  kind: LinkKind
  firstClickedAt: string
}

const dayFormatter = new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** e.g. "目录", "Best of China（11 Mar 出发）", "全部团页面", "/contact". */
export function clickLabel(kind: LinkKind, tour: TourLinkRef | null, url: string): string {
  if (kind === 'catalogue') return '目录'
  if (kind === 'all_tours') return '全部团页面'
  if (kind === 'tour' && tour !== null) {
    if (tour.departOn === null) return tour.name
    const day = new Date(`${tour.departOn}T00:00:00Z`)
    return Number.isNaN(day.getTime()) ? tour.name : `${tour.name}（${dayFormatter.format(day)} 出发）`
  }
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).pathname
  } catch {
    return url.slice(0, 60)
  }
}

export interface TokenRead {
  token: string
  request_id: string
  url: string
  kind: LinkKind
  tour: TourLinkRef | null
}

/** Human clicks per send request id. `null` when it cannot be read (the table may not exist yet, or the read failed). */
export async function humanClicksByRequest(
  db: SupabaseClient,
  clientId: string,
  requestIds: readonly string[],
): Promise<Record<string, ClickSummary[]> | null> {
  if (requestIds.length === 0) return {}
  try {
    const tokens = await db.from('crm_email_link_tokens').select('token, request_id, url, kind, tour').eq('client_id', clientId).in('request_id', [...requestIds])
    if (tokens.error) throw new Error(tokens.error.message)
    const rows = (tokens.data as TokenRead[] | null) ?? []
    if (rows.length === 0) return {}
    const clicks = await db
      .from('crm_email_link_clicks')
      .select('token, occurred_at')
      .eq('client_id', clientId)
      .eq('counts_as_human', true)
      .in('token', rows.map((r) => r.token))
      .order('occurred_at', { ascending: true })
    if (clicks.error) throw new Error(clicks.error.message)
    const firstAt = new Map<string, string>()
    for (const c of (clicks.data as Array<{ token: string; occurred_at: string }> | null) ?? []) {
      if (!firstAt.has(c.token)) firstAt.set(c.token, c.occurred_at)
    }
    const out: Record<string, ClickSummary[]> = {}
    for (const row of rows) {
      const at = firstAt.get(row.token)
      if (at === undefined) continue
      ;(out[row.request_id] ??= []).push({ label: clickLabel(row.kind, row.tour, row.url), kind: row.kind, firstClickedAt: at })
    }
    return out
  } catch (err) {
    console.error('[link-tracking] 读点击记录失败（表格照常显示）:', err instanceof Error ? err.message : err)
    return null
  }
}

export interface PageLabelFacts {
  /** https URL with {destination}/{tier}/{slug}: the client's tour page address rule (published-tours provider). */
  urlPattern: string | null
  /** Hosts the client's site answers on (guardrails.allowedLinkHosts); the first is used to rebuild the address. */
  hosts: readonly string[]
  facts: RenderFacts | null
}

/** "在官网看了 Best of China" for a tour page, "在官网看了全部团" for the list, else "在官网看了 /path". Pure. */
export function pageViewLabel(path: string, page: PageLabelFacts): string {
  const host = page.hosts[0] ?? (page.urlPattern ? safeHost(page.urlPattern) : null)
  if (host !== null) {
    const hit = classifyTourLink(`https://${host}${path}`, page.facts)
    if (hit?.kind === 'tour') return `在官网看了 ${hit.tour.name}`
    if (hit?.kind === 'all_tours') return '在官网看了全部团'
  }
  return `在官网看了 ${path.split('?')[0]}`
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

function pathOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).pathname
  } catch {
    return url
  }
}

export interface ClickForTimeline {
  token: string
  path: string | null
  occurred_at: string
}

/**
 * One timeline line per (link, page) — the first human visit of each. A visit to the mail link's own page keeps the
 * link's label ("目录", a tour name); any other page is a later page view on the client's site (the site recognised
 * the guest by the cookie set on that first click) and is labelled by the page. Pure.
 */
export function timelineClicks(clicks: readonly ClickForTimeline[], tokens: readonly TokenRead[], page: PageLabelFacts): Array<{ at: string; label: string }> {
  const byToken = new Map(tokens.map((t) => [t.token, t]))
  const seen = new Set<string>()
  const out: Array<{ at: string; label: string }> = []
  for (const c of clicks) {
    const token = byToken.get(c.token)
    if (token === undefined) continue
    const ownPage = c.path === null || c.path.split('?')[0] === pathOf(token.url)
    const key = ownPage ? `${c.token}|link` : `${c.token}|${c.path}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ at: c.occurred_at, label: ownPage ? clickLabel(token.kind, token.tour, token.url) : pageViewLabel(c.path ?? '', page) })
  }
  return out
}

async function loadPageLabelFacts(db: SupabaseClient, clientId: string, now: Date): Promise<PageLabelFacts> {
  const none: PageLabelFacts = { urlPattern: null, hosts: [], facts: null }
  const settings = await loadEmailSettings(db, clientId)
  if (settings.kind !== 'ok') return none
  const config = effectiveFromSettings(settings.settings, settings.version)
  const provider = config.providers.publishedTours ?? null
  const read = await loadPublishedTourFacts(db, clientId, now.toISOString().slice(0, 10))
  return {
    urlPattern: provider?.urlPattern ?? null,
    hosts: config.guardrails.allowedLinkHosts,
    facts: { tours: read.published ? read.tours : [], picks: [], settings: provider, linkHosts: config.guardrails.allowedLinkHosts },
  }
}

/** The guest's human clicks and later site page views, for the timeline. Empty when they cannot be read. */
export async function humanClicksForContact(db: SupabaseClient, clientId: string, contactId: string): Promise<Array<{ at: string; label: string }>> {
  try {
    const clicks = await db
      .from('crm_email_link_clicks')
      .select('token, path, occurred_at')
      .eq('client_id', clientId)
      .eq('contact_id', contactId)
      .eq('counts_as_human', true)
      .order('occurred_at', { ascending: true })
      .limit(200)
    if (clicks.error) throw new Error(clicks.error.message)
    const rows = (clicks.data as ClickForTimeline[] | null) ?? []
    if (rows.length === 0) return []
    const tokens = await db.from('crm_email_link_tokens').select('token, request_id, url, kind, tour').eq('client_id', clientId).in('token', [...new Set(rows.map((r) => r.token))])
    if (tokens.error) throw new Error(tokens.error.message)
    const tokenRows = (tokens.data as TokenRead[] | null) ?? []
    // Labelling a page needs the tour catalogue; if it cannot be read the line still shows, with the bare path.
    const page = rows.some((r) => r.path !== null)
      ? await loadPageLabelFacts(db, clientId, new Date()).catch(() => ({ urlPattern: null, hosts: [], facts: null }))
      : { urlPattern: null, hosts: [], facts: null }
    return timelineClicks(rows, tokenRows, page)
  } catch (err) {
    console.error('[link-tracking] 读这位客人的点击失败（往来记录照常显示）:', err instanceof Error ? err.message : err)
    return []
  }
}
