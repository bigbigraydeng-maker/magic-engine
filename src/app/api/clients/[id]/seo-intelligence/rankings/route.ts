import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireSession } from '@/lib/auth/require-session'
import { getRankedKeywords } from '@/lib/dataforseo/labs'
import { getLatestKeywordSnapshotForClient } from '@/lib/seo-intelligence/keyword-snapshots'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

const LOCATION_CODE_BY_DB: Record<string, number> = { au: 2036, nz: 2554 }

interface GscQueryRow {
  query?: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

/**
 * GET /api/clients/[id]/seo-intelligence/rankings
 *
 * Returns up to 200 organic-ranked keywords for the client's domain,
 * ordered by position ascending (rank 1 first).
 *
 * Each keyword is enriched with GSC data (impressions, clicks, CTR,
 * real position) when a gsc_performance_snapshots row exists for this client.
 *
 * Response shape:
 * {
 *   domain:     string
 *   keywords:   Array<LabsKeyword & { gsc_position, gsc_impressions, gsc_clicks, gsc_ctr }>
 *   gsc_status: 'connected' | 'no_data' | 'not_connected'
 *   gsc_period: string | null   // e.g. "2026-05-07 – 2026-06-03"
 * }
 *
 * Cache: 24 h (DataForSEO live call, expensive).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  const session = await requireSession()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status })
  }

  const { id: clientId } = params

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id, domain, semrush_db, brand_aliases')
    .eq('id', clientId)
    .single()

  if (clientError || !client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  if (!client.domain) {
    return NextResponse.json(
      { error: 'Client has no domain configured' },
      { status: 400 },
    )
  }

  const locationCode = LOCATION_CODE_BY_DB[client.semrush_db ?? 'au'] ?? LOCATION_CODE_BY_DB.au

  // PM-configured brand aliases drive Branded vs Non-Branded detection on the
  // client (multi-word brands like "cts tours" never match the single-word
  // domain root via token-equality). Same source as GSC brand-search volume.
  const brandAliases = Array.isArray(client.brand_aliases) && client.brand_aliases.length > 0
    ? client.brand_aliases
    : null

  // Fetch latest GSC snapshot (best-effort, does not block rankings)
  const gscData = await fetchLatestGscQueries(clientId)

  try {
    const keywords = await getRankedKeywords(client.domain, locationCode, 200)
    const enriched = mergeGscData(keywords, gscData.queryMap)

    return NextResponse.json(
      {
        domain: client.domain,
        keywords: enriched,
        brand_aliases: brandAliases,
        gsc_status: gscData.status,
        gsc_period: gscData.period,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
        },
      },
    )
  } catch {
    try {
      const snapshot = await getLatestKeywordSnapshotForClient({
        id: client.id,
        domain: client.domain,
        semrush_db: client.semrush_db,
      })
      const enriched = mergeGscData(snapshot.keywords, gscData.queryMap)
      return NextResponse.json(
        {
          domain: client.domain,
          keywords: enriched,
          brand_aliases: brandAliases,
          source: 'snapshot',
          snapshot_date: snapshot.snapshot_date,
          gsc_status: gscData.status,
          gsc_period: gscData.period,
          warning: snapshot.snapshot_date
            ? 'Live Keyword Intelligence is temporarily unavailable. Showing the latest saved weekly snapshot.'
            : 'Live Keyword Intelligence is temporarily unavailable and no saved weekly snapshot exists yet.',
        },
        {
          headers: {
            'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=300',
          },
        },
      )
    } catch {
      return NextResponse.json(
        { error: 'Keyword Intelligence is temporarily unavailable. Try again after the next saved snapshot.' },
        { status: 502 },
      )
    }
  }
}

// ─── GSC helpers ─────────────────────────────────────────────────────────────

interface GscQueryInfo {
  queryMap: Map<string, GscQueryRow>
  status: 'connected' | 'no_data' | 'not_connected'
  period: string | null
}

async function fetchLatestGscQueries(clientId: string): Promise<GscQueryInfo> {
  const empty: GscQueryInfo = { queryMap: new Map(), status: 'not_connected', period: null }

  try {
    const { data, error } = await supabaseAdmin
      .from('gsc_performance_snapshots')
      .select('top_queries, period_start, period_end')
      .eq('client_id', clientId)
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) return empty

    const queries = (data.top_queries ?? []) as GscQueryRow[]
    if (queries.length === 0) {
      return { queryMap: new Map(), status: 'no_data', period: `${data.period_start} – ${data.period_end}` }
    }

    const map = new Map<string, GscQueryRow>()
    for (const q of queries) {
      if (q.query) map.set(q.query.toLowerCase(), q)
    }

    return {
      queryMap: map,
      status: 'connected',
      period: `${data.period_start} – ${data.period_end}`,
    }
  } catch {
    return empty
  }
}

function mergeGscData<T extends { keyword: string }>(
  keywords: T[],
  gscMap: Map<string, GscQueryRow>,
): Array<T & { gsc_position: number | null; gsc_impressions: number | null; gsc_clicks: number | null; gsc_ctr: number | null }> {
  return keywords.map(kw => {
    const gsc = gscMap.get(kw.keyword.toLowerCase())
    return {
      ...kw,
      gsc_position:    gsc?.position    ?? null,
      gsc_impressions: gsc?.impressions ?? null,
      gsc_clicks:      gsc?.clicks      ?? null,
      gsc_ctr:         gsc?.ctr         ?? null,
    }
  })
}
