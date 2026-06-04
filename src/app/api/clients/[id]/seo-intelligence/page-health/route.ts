import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireSession } from '@/lib/auth/require-session'
import { normalisePath } from '@/lib/seo-intelligence/page-trends/path-utils'
import {
  pickComparison,
  computeMetricDeltas,
  buildWindowLabel,
  type DeltaStatus,
} from '@/lib/seo-intelligence/page-trends/delta'

const TARGET_GAP_DAYS = 7
const HISTORY_LIMIT   = 10  // enough to find a 7-day-old snapshot

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

interface MetricDeltaWire {
  delta:    number | null
  deltaPct: number | null
}

interface PageHealthRow {
  page:              string
  gsc_clicks:        number | null
  gsc_impressions:   number | null
  gsc_ctr:           number | null
  gsc_position:      number | null
  ga4_sessions:      number | null
  ga4_pageviews:     number | null

  // Trend deltas vs the snapshot ~7 days old (see TARGET_GAP_DAYS).
  gsc_clicks_d:      MetricDeltaWire | null
  gsc_impressions_d: MetricDeltaWire | null
  // For position: positive delta = rank improvement (we invert raw delta).
  gsc_position_d:    MetricDeltaWire | null
  ga4_sessions_d:    MetricDeltaWire | null
}

/**
 * GET /api/clients/[id]/seo-intelligence/page-health
 *
 * Returns per-page health metrics, merging the latest GSC top_pages
 * (clicks/impressions/ctr/position) with the latest GA4 top_pages
 * (sessions/pageviews). Each metric also carries a delta vs the snapshot
 * closest to (latest.synced_at - 7 days). See lib/seo-intelligence/page-trends.
 *
 * Sort order: GSC clicks desc, then GA4 sessions desc.
 *
 * Response shape:
 * {
 *   pages:              PageHealthRow[]
 *   dropped_off_paths:  string[]      // pages in previous snapshot, not in latest
 *   gsc_status:         'connected' | 'no_data' | 'not_connected'
 *   ga4_status:         'connected' | 'no_data' | 'not_connected'
 *   gsc_period:         string | null
 *   ga4_period:         string | null
 *   trend_status:       DeltaStatus   // 'ok' | 'insufficient' | 'no_data'
 *   trend_window_label: string | null // e.g. "7d" or "since 2026-05-26"
 *   trend_window_days:  number | null
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

  const [gscHistory, ga4History] = await Promise.all([
    fetchGscHistory(clientId),
    fetchGa4History(clientId),
  ])

  const gscLatest = gscHistory.snapshots[0] ?? null
  const ga4Latest = ga4History.snapshots[0] ?? null

  // ── Build merged page map from latest snapshots ──
  const pageMap = new Map<string, PageHealthRow>()

  if (gscLatest) {
    for (const p of gscLatest.pages) {
      const path = normalisePath(p.page ?? '')
      if (!path) continue
      pageMap.set(path, {
        page:              path,
        gsc_clicks:        p.clicks,
        gsc_impressions:   p.impressions,
        gsc_ctr:           p.ctr,
        gsc_position:      p.position,
        ga4_sessions:      null,
        ga4_pageviews:     null,
        gsc_clicks_d:      null,
        gsc_impressions_d: null,
        gsc_position_d:    null,
        ga4_sessions_d:    null,
      })
    }
  }

  if (ga4Latest) {
    for (const p of ga4Latest.pages) {
      const path = normalisePath(p.page)
      if (!path) continue
      const existing = pageMap.get(path)
      if (existing) {
        existing.ga4_sessions  = p.sessions
        existing.ga4_pageviews = p.pageviews
      } else {
        pageMap.set(path, {
          page:              path,
          gsc_clicks:        null,
          gsc_impressions:   null,
          gsc_ctr:           null,
          gsc_position:      null,
          ga4_sessions:      p.sessions,
          ga4_pageviews:     p.pageviews,
          gsc_clicks_d:      null,
          gsc_impressions_d: null,
          gsc_position_d:    null,
          ga4_sessions_d:    null,
        })
      }
    }
  }

  // ── Compute deltas: GSC clicks/impressions/position, GA4 sessions ──
  const gscCompare = pickComparison(gscHistory.snapshots, TARGET_GAP_DAYS)
  const ga4Compare = pickComparison(ga4History.snapshots, TARGET_GAP_DAYS)

  const droppedOff = new Set<string>()

  if (gscCompare.latest && gscCompare.previous) {
    const clicksDelta = computeMetricDeltas(
      gscCompare.latest.pages, gscCompare.previous.pages,
      p => p.page ?? '', p => p.clicks, normalisePath,
    )
    const impDelta = computeMetricDeltas(
      gscCompare.latest.pages, gscCompare.previous.pages,
      p => p.page ?? '', p => p.impressions, normalisePath,
    )
    const posDelta = computeMetricDeltas(
      gscCompare.latest.pages, gscCompare.previous.pages,
      p => p.page ?? '', p => p.position, normalisePath,
    )

    for (const [path, row] of Array.from(pageMap.entries())) {
      const c = clicksDelta.byPath.get(path)
      if (c) row.gsc_clicks_d      = { delta: c.delta, deltaPct: c.deltaPct }
      const i = impDelta.byPath.get(path)
      if (i) row.gsc_impressions_d = { delta: i.delta, deltaPct: i.deltaPct }
      const p = posDelta.byPath.get(path)
      if (p && p.delta !== null) {
        // Invert: lower position = better. Surface positive delta as improvement.
        row.gsc_position_d = {
          delta:    -p.delta,
          deltaPct: p.deltaPct !== null ? -p.deltaPct : null,
        }
      }
    }
    for (const p of Array.from(clicksDelta.droppedOffPaths)) droppedOff.add(p)
  }

  if (ga4Compare.latest && ga4Compare.previous) {
    const sessDelta = computeMetricDeltas(
      ga4Compare.latest.pages, ga4Compare.previous.pages,
      p => p.page, p => p.sessions, normalisePath,
    )
    for (const [path, row] of Array.from(pageMap.entries())) {
      const s = sessDelta.byPath.get(path)
      if (s) row.ga4_sessions_d = { delta: s.delta, deltaPct: s.deltaPct }
    }
    for (const p of Array.from(sessDelta.droppedOffPaths)) droppedOff.add(p)
  }

  // ── Determine trend status + window label ──
  // Prefer GSC for the label (richer dataset); fall back to GA4.
  const referenceCompare = gscCompare.previous ? gscCompare : ga4Compare
  let trendStatus: DeltaStatus
  let trendLabel: string | null = null
  let trendDays:  number | null = null

  if (!referenceCompare.latest) {
    trendStatus = 'no_data'
  } else if (!referenceCompare.previous) {
    trendStatus = 'insufficient'
  } else {
    trendStatus = 'ok'
    const w = buildWindowLabel(
      referenceCompare.latest.synced_at,
      referenceCompare.previous.synced_at,
      TARGET_GAP_DAYS,
    )
    trendLabel = w.label
    trendDays  = w.days
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
      dropped_off_paths:  Array.from(droppedOff),
      gsc_status:         gscHistory.status,
      ga4_status:         ga4History.status,
      gsc_period:         gscHistory.period,
      ga4_period:         ga4History.period,
      trend_status:       trendStatus,
      trend_window_label: trendLabel,
      trend_window_days:  trendDays,
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600',
      },
    },
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface HistoryInfo<T> {
  snapshots: Array<{ synced_at: string; pages: T[] }>
  status: 'connected' | 'no_data' | 'not_connected'
  period: string | null
}

async function fetchGscHistory(clientId: string): Promise<HistoryInfo<GscPageRow>> {
  const empty: HistoryInfo<GscPageRow> = { snapshots: [], status: 'not_connected', period: null }
  try {
    const { data, error } = await supabaseAdmin
      .from('gsc_performance_snapshots')
      .select('synced_at, top_pages, period_start, period_end')
      .eq('client_id', clientId)
      .order('synced_at', { ascending: false })
      .limit(HISTORY_LIMIT)
    if (error || !data || data.length === 0) return empty

    const snapshots = data.map(row => ({
      synced_at: row.synced_at as string,
      pages: (row.top_pages ?? []) as GscPageRow[],
    }))
    const latest = data[0]

    return {
      snapshots,
      status: snapshots[0].pages.length === 0 ? 'no_data' : 'connected',
      period: `${latest.period_start} – ${latest.period_end}`,
    }
  } catch {
    return empty
  }
}

async function fetchGa4History(clientId: string): Promise<HistoryInfo<Ga4PageRow>> {
  const empty: HistoryInfo<Ga4PageRow> = { snapshots: [], status: 'not_connected', period: null }
  try {
    const { data, error } = await supabaseAdmin
      .from('ga4_traffic_snapshots')
      .select('synced_at, top_pages, period_start, period_end')
      .eq('client_id', clientId)
      .order('synced_at', { ascending: false })
      .limit(HISTORY_LIMIT)
    if (error || !data || data.length === 0) return empty

    const snapshots = data.map(row => ({
      synced_at: row.synced_at as string,
      pages: (row.top_pages ?? []) as Ga4PageRow[],
    }))
    const latest = data[0]

    return {
      snapshots,
      status: snapshots[0].pages.length === 0 ? 'no_data' : 'connected',
      period: `${latest.period_start} – ${latest.period_end}`,
    }
  } catch {
    return empty
  }
}
