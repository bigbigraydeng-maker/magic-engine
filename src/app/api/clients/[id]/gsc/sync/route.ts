/**
 * POST /api/clients/[id]/gsc/sync
 *
 * Triggers a Google Search Console data pullback for the client.
 * Fetches the last 28 days of search analytics (queries + pages) and stores
 * a snapshot in gsc_performance_snapshots.
 *
 * Requirements:
 *   - client must have gsc connector in 'connected' state (site_url in config)
 *   - client must have a valid google_oauth_token (or shared service account)
 *
 * Body: { period_days?: number }  (default 28, max 90)
 *
 * Returns: { success, snapshot_id, site_url, period_start, period_end,
 *             total_clicks, total_impressions }
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P17.A.1
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import { fetchGscSnapshot } from '@/lib/gsc/client'

export const dynamic = 'force-dynamic'

const MAX_PERIOD_DAYS = 90

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const { id: clientId } = params

  // Parse optional body
  let periodDays = 28
  try {
    const body = await req.json() as { period_days?: unknown }
    if (typeof body.period_days === 'number' && body.period_days > 0) {
      periodDays = Math.min(Math.round(body.period_days), MAX_PERIOD_DAYS)
    }
  } catch {
    // default stays 28
  }

  // Resolve site_url from connector config
  const { data: connector, error: connErr } = await supabaseAdmin
    .from('client_connectors')
    .select('status, config')
    .eq('client_id', clientId)
    .eq('anchor', 'gsc')
    .maybeSingle()

  if (connErr) {
    return NextResponse.json({ success: false, error: connErr.message }, { status: 500 })
  }

  if (!connector || connector.status !== 'connected') {
    return NextResponse.json(
      { success: false, error: 'GSC connector not connected. Complete OAuth + site URL setup first.' },
      { status: 422 },
    )
  }

  const siteUrl = (connector.config as Record<string, unknown> | null)?.site_url
  if (typeof siteUrl !== 'string' || !siteUrl) {
    return NextResponse.json(
      { success: false, error: 'GSC connector is missing site_url. Update connector config.' },
      { status: 422 },
    )
  }

  // Fetch snapshot from GSC API
  const snapshot = await fetchGscSnapshot(siteUrl, clientId, periodDays)

  if (!snapshot) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch data from Google Search Console. Check OAuth token and site_url.' },
      { status: 502 },
    )
  }

  // Upsert into gsc_performance_snapshots (idempotent by period)
  const { data: inserted, error: upsertErr } = await supabaseAdmin
    .from('gsc_performance_snapshots')
    .upsert(
      {
        client_id:         clientId,
        site_url:          snapshot.site_url,
        period_start:      snapshot.period_start,
        period_end:        snapshot.period_end,
        total_clicks:      snapshot.total_clicks,
        total_impressions: snapshot.total_impressions,
        avg_ctr:           snapshot.avg_ctr,
        avg_position:      snapshot.avg_position,
        top_queries:       snapshot.top_queries,
        top_pages:         snapshot.top_pages,
        synced_at:         snapshot.synced_at,
      },
      { onConflict: 'client_id,period_start,period_end' },
    )
    .select('id')
    .single()

  if (upsertErr) {
    return NextResponse.json({ success: false, error: upsertErr.message }, { status: 500 })
  }

  return NextResponse.json({
    success:           true,
    snapshot_id:       (inserted as { id: string }).id,
    site_url:          snapshot.site_url,
    period_start:      snapshot.period_start,
    period_end:        snapshot.period_end,
    total_clicks:      snapshot.total_clicks,
    total_impressions: snapshot.total_impressions,
    avg_ctr:           snapshot.avg_ctr,
    avg_position:      snapshot.avg_position,
    query_count:       snapshot.top_queries.length,
    page_count:        snapshot.top_pages.length,
  })
}
