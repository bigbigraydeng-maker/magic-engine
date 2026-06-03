import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireSession } from '@/lib/auth/require-session'

interface GscPageRow {
  page?: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

interface Ga4PageRow {
  page: string
  pageviews: number
  sessions: number
}

interface PageHealthRow {
  page:            string
  gsc_clicks:      number | null
  gsc_impressions: number | null
  gsc_ctr:         number | null
  gsc_position:    number | null
  ga4_sessions:    number | null
  ga4_pageviews:   number | null
}

/**
 * GET /api/clients/[id]/seo-intelligence/page-health
 *
 * Returns per-page health metrics, merging the latest GSC top_pages
 * (clicks/impressions/ctr/position) with the latest GA4 top_pages
 * (sessions/pageviews). Pages appearing in either source are returned.
 *
 * Sort order: GSC clicks desc, then GA4 sessions desc.
 *
 * Response shape:
 * {
 *   pages:      PageHealthRow[]
 *   gsc_status: 'connected' | 'no_data' | 'not_connected'
 *   ga4_status: 'connected' | 'no_data' | 'not_connected'
 *   gsc_period: string | null
 *   ga4_period: string | null
 * }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status })
  }

  const { id: clientId } = await params

  const [gscInfo, ga4Info] = await Promise.all([
    fetchLatestGscPages(clientId),
    fetchLatestGa4Pages(clientId),
  ])

  // Merge by page path. GSC paths are full URLs; GA4 is path-only.
  // Normalise both to path-only for matching.
  const pageMap = new Map<string, PageHealthRow>()

  for (const p of gscInfo.pages) {
    const path = normalisePath(p.page ?? '')
    if (!path) continue
    pageMap.set(path, {
      page:            path,
      gsc_clicks:      p.clicks,
      gsc_impressions: p.impressions,
      gsc_ctr:         p.ctr,
      gsc_position:    p.position,
      ga4_sessions:    null,
      ga4_pageviews:   null,
    })
  }

  for (const p of ga4Info.pages) {
    const path = normalisePath(p.page)
    if (!path) continue
    const existing = pageMap.get(path)
    if (existing) {
      existing.ga4_sessions  = p.sessions
      existing.ga4_pageviews = p.pageviews
    } else {
      pageMap.set(path, {
        page:            path,
        gsc_clicks:      null,
        gsc_impressions: null,
        gsc_ctr:         null,
        gsc_position:    null,
        ga4_sessions:    p.sessions,
        ga4_pageviews:   p.pageviews,
      })
    }
  }

  const pages = Array.from(pageMap.values()).sort((a, b) => {
    const aClicks = a.gsc_clicks ?? 0
    const bClicks = b.gsc_clicks ?? 0
    if (aClicks !== bClicks) return bClicks - aClicks
    return (b.ga4_sessions ?? 0) - (a.ga4_sessions ?? 0)
  })

  return NextResponse.json(
    {
      pages,
      gsc_status: gscInfo.status,
      ga4_status: ga4Info.status,
      gsc_period: gscInfo.period,
      ga4_period: ga4Info.period,
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600',
      },
    },
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface SourceInfo<T> {
  pages: T[]
  status: 'connected' | 'no_data' | 'not_connected'
  period: string | null
}

async function fetchLatestGscPages(clientId: string): Promise<SourceInfo<GscPageRow>> {
  const empty: SourceInfo<GscPageRow> = { pages: [], status: 'not_connected', period: null }
  try {
    const { data, error } = await supabaseAdmin
      .from('gsc_performance_snapshots')
      .select('top_pages, period_start, period_end')
      .eq('client_id', clientId)
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return empty
    const pages = (data.top_pages ?? []) as GscPageRow[]
    return {
      pages,
      status: pages.length === 0 ? 'no_data' : 'connected',
      period: `${data.period_start} – ${data.period_end}`,
    }
  } catch {
    return empty
  }
}

async function fetchLatestGa4Pages(clientId: string): Promise<SourceInfo<Ga4PageRow>> {
  const empty: SourceInfo<Ga4PageRow> = { pages: [], status: 'not_connected', period: null }
  try {
    const { data, error } = await supabaseAdmin
      .from('ga4_traffic_snapshots')
      .select('top_pages, period_start, period_end')
      .eq('client_id', clientId)
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return empty
    const pages = (data.top_pages ?? []) as Ga4PageRow[]
    return {
      pages,
      status: pages.length === 0 ? 'no_data' : 'connected',
      period: `${data.period_start} – ${data.period_end}`,
    }
  } catch {
    return empty
  }
}

/**
 * Normalise a page URL or path to a path-only string for matching.
 * GSC returns full URLs; GA4 returns paths.
 *   "https://example.com/blog/foo"  → "/blog/foo"
 *   "/blog/foo?utm=x"                → "/blog/foo"
 *   "/blog/foo/"                     → "/blog/foo"
 */
function normalisePath(input: string): string {
  if (!input) return ''
  let path = input
  try {
    if (path.startsWith('http')) {
      path = new URL(path).pathname
    }
  } catch {
    // not a valid URL, keep as-is
  }
  // strip query string
  const qIdx = path.indexOf('?')
  if (qIdx >= 0) path = path.substring(0, qIdx)
  // strip trailing slash (except for root)
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  return path
}
