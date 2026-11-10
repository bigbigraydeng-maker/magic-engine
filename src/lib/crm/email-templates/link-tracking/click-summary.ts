/**
 * What staff see about clicks: one short label per clicked link, human clicks only (design 2026-11-10 B2 §4.6).
 * Reads never break the page they sit on: a failed read returns `null` (the caller shows "—"), never throws.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TourLinkRef } from '../facts/published-tours'
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

interface TokenRead {
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

/** The guest's human clicks, one per link (its first click), for the timeline. Empty when they cannot be read. */
export async function humanClicksForContact(db: SupabaseClient, clientId: string, contactId: string): Promise<Array<{ at: string; label: string }>> {
  try {
    const clicks = await db
      .from('crm_email_link_clicks')
      .select('token, occurred_at')
      .eq('client_id', clientId)
      .eq('contact_id', contactId)
      .eq('counts_as_human', true)
      .order('occurred_at', { ascending: true })
      .limit(200)
    if (clicks.error) throw new Error(clicks.error.message)
    const firstAt = new Map<string, string>()
    for (const c of (clicks.data as Array<{ token: string; occurred_at: string }> | null) ?? []) {
      if (!firstAt.has(c.token)) firstAt.set(c.token, c.occurred_at)
    }
    if (firstAt.size === 0) return []
    const tokens = await db.from('crm_email_link_tokens').select('token, request_id, url, kind, tour').eq('client_id', clientId).in('token', [...firstAt.keys()])
    if (tokens.error) throw new Error(tokens.error.message)
    return ((tokens.data as TokenRead[] | null) ?? []).map((t) => ({ at: firstAt.get(t.token) ?? '', label: clickLabel(t.kind, t.tour, t.url) })).filter((c) => c.at !== '')
  } catch (err) {
    console.error('[link-tracking] 读这位客人的点击失败（往来记录照常显示）:', err instanceof Error ? err.message : err)
    return []
  }
}
