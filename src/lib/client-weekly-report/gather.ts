/**
 * Client weekly browsing summary — data gathering (read-only).
 *
 * Reads the already-connected GSC / GA4 connectors and the leads table for one
 * client. Writes nothing. Every source fails independently into `null` so the
 * report can say "not read" instead of inventing a zero.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { querySearchAnalyticsRows, withGscAccess } from '@/lib/gsc/client'
import { fetchGa4Snapshot } from '@/lib/ga4/client'
import type { WeeklyReportInput } from './build'

/** Google finalises Search Analytics a few days late; end the window this many days back. */
const GSC_LAG_DAYS = 3
const WINDOW_DAYS = 7
const GSC_QUERY_ROWS = 250
const GSC_PAGE_ROWS = 50

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime())
  out.setUTCDate(out.getUTCDate() + n)
  return out
}

export interface ReportWindows {
  window: { start: string; end: string }
  previousWindow: { start: string; end: string }
}

/** Two adjacent 7-day windows ending `GSC_LAG_DAYS` before `now`. */
export function computeWindows(now: Date): ReportWindows {
  const end = addDays(now, -GSC_LAG_DAYS)
  const start = addDays(end, -(WINDOW_DAYS - 1))
  const prevEnd = addDays(start, -1)
  const prevStart = addDays(prevEnd, -(WINDOW_DAYS - 1))
  return {
    window: { start: isoDay(start), end: isoDay(end) },
    previousWindow: { start: isoDay(prevStart), end: isoDay(prevEnd) },
  }
}

interface ConnectorRow {
  anchor: string
  config: Record<string, unknown> | null
}

async function loadConnectors(clientId: string): Promise<{ siteUrl: string | null; propertyId: string | null }> {
  const { data } = await supabaseAdmin
    .from('client_connectors')
    .select('anchor, config')
    .eq('client_id', clientId)
    .eq('status', 'connected')
    .in('anchor', ['gsc', 'ga4'])
  const rows = (data ?? []) as ConnectorRow[]
  const siteUrl = rows.find((r) => r.anchor === 'gsc')?.config?.site_url
  const propertyId = rows.find((r) => r.anchor === 'ga4')?.config?.property_id
  return {
    siteUrl: typeof siteUrl === 'string' && siteUrl ? siteUrl : null,
    propertyId: typeof propertyId === 'string' && propertyId ? propertyId : null,
  }
}

async function gatherGsc(clientId: string, siteUrl: string, w: ReportWindows): Promise<WeeklyReportInput['gsc']> {
  try {
    const result = await withGscAccess(clientId, async (token) => {
      const totals = async (win: { start: string; end: string }) => {
        const rows = await querySearchAnalyticsRows(token, siteUrl, {
          startDate: win.start,
          endDate: win.end,
          dimensions: [],
          rowLimit: 1,
        })
        const r = rows[0]
        return { clicks: r?.clicks ?? 0, impressions: r?.impressions ?? 0, position: r?.position ?? 0 }
      }
      const [current, previous, queries, pages] = await Promise.all([
        totals(w.window),
        totals(w.previousWindow),
        querySearchAnalyticsRows(token, siteUrl, {
          startDate: w.window.start,
          endDate: w.window.end,
          dimensions: ['query'],
          rowLimit: GSC_QUERY_ROWS,
        }),
        querySearchAnalyticsRows(token, siteUrl, {
          startDate: w.window.start,
          endDate: w.window.end,
          dimensions: ['page'],
          rowLimit: GSC_PAGE_ROWS,
        }),
      ])
      return {
        current,
        previous,
        queries: queries.map((r) => ({ query: r.keys[0] ?? '', clicks: r.clicks, impressions: r.impressions, position: r.position })),
        pages: pages.map((r) => ({ page: r.keys[0] ?? '', clicks: r.clicks, impressions: r.impressions, position: r.position })),
      }
    })
    return result ?? null
  } catch (err) {
    console.warn('[client-weekly-report] GSC read failed:', err instanceof Error ? err.message : err)
    return null
  }
}

async function gatherGa4(clientId: string, propertyId: string): Promise<WeeklyReportInput['ga4']> {
  try {
    const snap = await fetchGa4Snapshot(propertyId, clientId, WINDOW_DAYS)
    if (!snap) return null
    return {
      periodStart: snap.period_start,
      periodEnd: snap.period_end,
      totalPageviews: snap.total_pageviews,
      totalSessions: snap.total_sessions,
      totalUsers: snap.total_users,
      pages: snap.top_pages.map((p) => ({ page: p.page, pageviews: p.pageviews })),
    }
  } catch (err) {
    console.warn('[client-weekly-report] GA4 read failed:', err instanceof Error ? err.message : err)
    return null
  }
}

async function countLeads(clientId: string, w: ReportWindows): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('created_at', `${w.window.start}T00:00:00Z`)
    .lt('created_at', `${isoDay(addDays(new Date(`${w.window.end}T00:00:00Z`), 1))}T00:00:00Z`)
  if (error || count === null) return null
  return count
}

export interface GatherOptions {
  now?: Date
  /** Operator-supplied content for the free-text sections. */
  siteUpdates?: string[]
  nextSteps?: string[]
}

export async function gatherWeeklyReportInput(
  clientId: string,
  opts: GatherOptions = {},
): Promise<WeeklyReportInput | null> {
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('name, brand_aliases')
    .eq('id', clientId)
    .maybeSingle()
  if (!client) return null

  const windows = computeWindows(opts.now ?? new Date())
  const { siteUrl, propertyId } = await loadConnectors(clientId)

  const [gsc, ga4, leadsInWindow] = await Promise.all([
    siteUrl ? gatherGsc(clientId, siteUrl, windows) : Promise.resolve(null),
    propertyId ? gatherGa4(clientId, propertyId) : Promise.resolve(null),
    countLeads(clientId, windows),
  ])

  return {
    clientLabel: String(client.name ?? ''),
    ...windows,
    gsc,
    ga4,
    leadsInWindow,
    brandTerms: Array.isArray(client.brand_aliases) ? (client.brand_aliases as string[]) : [],
    siteUpdates: opts.siteUpdates ?? [],
    nextSteps: opts.nextSteps ?? [],
  }
}
