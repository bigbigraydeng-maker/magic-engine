/**
 * Reads the last 60 days of human clicks / site page views for one client and turns them into "who is reading our site
 * now" (last 7 days, `site-reading.ts`) plus each guest's latest click (`lastClickAt`). A failed read returns an empty
 * map: the staff list then simply has nobody in the "reading the brochure" group that day — it never breaks the page.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SiteReading } from '../../segments'
import type { TokenRead } from './click-summary'
import { loadPageLabelFacts } from './page-label-facts-prod'
import { CLICK_LOOKBACK_MS, attachLastClicks, summariseSiteReading, type ClickForReading } from './site-reading'

const MAX_ROWS = 5000

export async function loadSiteReading(db: SupabaseClient, clientId: string, now: Date): Promise<Map<string, SiteReading>> {
  try {
    const since = new Date(now.getTime() - CLICK_LOOKBACK_MS).toISOString()
    const clicks = await db
      .from('crm_email_link_clicks')
      .select('contact_id, token, path, occurred_at')
      .eq('client_id', clientId)
      .eq('counts_as_human', true)
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(MAX_ROWS)
    if (clicks.error) throw new Error(clicks.error.message)
    const rows = (clicks.data as ClickForReading[] | null) ?? []
    if (rows.length === 0) return new Map()
    const tokens = await db
      .from('crm_email_link_tokens')
      .select('token, request_id, url, kind, tour')
      .eq('client_id', clientId)
      .in('token', [...new Set(rows.map((r) => r.token))])
    if (tokens.error) throw new Error(tokens.error.message)
    const page = await loadPageLabelFacts(db, clientId, now).catch(() => ({ urlPattern: null, hosts: [], facts: null }))
    return attachLastClicks(summariseSiteReading(rows, (tokens.data as TokenRead[] | null) ?? [], page, now), rows, now)
  } catch (err) {
    console.error('[link-tracking] 读「谁在看官网」失败（名单照常显示，只是没有这一组）:', err instanceof Error ? err.message : err)
    return new Map()
  }
}
