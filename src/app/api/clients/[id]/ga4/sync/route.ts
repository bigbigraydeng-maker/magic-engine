/**
 * POST /api/clients/[id]/ga4/sync
 *
 * Triggers a Google Analytics 4 data pullback for the client.
 * Fetches the last 28 days of traffic data (sessions, users, pageviews,
 * top pages, top sources) and stores a snapshot in ga4_traffic_snapshots.
 *
 * Requirements:
 *   - client must have ga4 connector in 'connected' state (property_id in config)
 *   - client must have a valid google_oauth_token with analytics.readonly scope
 *
 * Body: { period_days?: number }  (default 28, max 90)
 *
 * Returns: { success, snapshot_id, property_id, period_start, period_end,
 *             total_sessions, total_users, total_pageviews }
 *
 * Security: session cookie via requireOnboardingClientAccess (own client only)
 * Reference: ROADMAP.md P17.A.2
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'
import { fetchGa4Snapshot, Ga4ApiError, type Ga4SiteSnapshot } from '@/lib/ga4/client'

export const dynamic = 'force-dynamic'

const MAX_PERIOD_DAYS = 90

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireOnboardingClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let periodDays = 28
  try {
    const body = await req.json() as { period_days?: unknown }
    if (typeof body.period_days === 'number' && body.period_days > 0) {
      periodDays = Math.min(Math.round(body.period_days), MAX_PERIOD_DAYS)
    }
  } catch {
    // default stays 28
  }

  // Resolve property_id from connector config
  const { data: connector, error: connErr } = await supabaseAdmin
    .from('client_connectors')
    .select('status, config')
    .eq('client_id', clientId)
    .eq('anchor', 'ga4')
    .maybeSingle()

  if (connErr) {
    return NextResponse.json({ success: false, error: connErr.message }, { status: 500 })
  }

  if (!connector || connector.status !== 'connected') {
    return NextResponse.json(
      { success: false, error: 'GA4 connector not connected. Complete OAuth + property ID setup first.' },
      { status: 422 },
    )
  }

  const propertyId = (connector.config as Record<string, unknown> | null)?.property_id
  if (typeof propertyId !== 'string' || !propertyId) {
    return NextResponse.json(
      { success: false, error: 'GA4 connector is missing property_id. Update connector config.' },
      { status: 422 },
    )
  }

  let snapshot: Ga4SiteSnapshot | null
  try {
    snapshot = await fetchGa4Snapshot(propertyId, clientId, periodDays)
  } catch (err) {
    if (err instanceof Ga4ApiError) {
      const httpStatus = err.httpStatus === 401 || err.googleStatus === 'UNAUTHENTICATED' ? 401 : 400
      return NextResponse.json(
        { success: false, error: err.message, code: err.googleStatus },
        { status: httpStatus },
      )
    }
    throw err
  }

  if (!snapshot) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch data from Google Analytics 4. Check OAuth token and property_id.' },
      { status: 502 },
    )
  }

  // Upsert into ga4_traffic_snapshots (idempotent by period)
  const { data: inserted, error: upsertErr } = await supabaseAdmin
    .from('ga4_traffic_snapshots')
    .upsert(
      {
        client_id:            clientId,
        property_id:          snapshot.property_id,
        period_start:         snapshot.period_start,
        period_end:           snapshot.period_end,
        total_sessions:       snapshot.total_sessions,
        total_users:          snapshot.total_users,
        total_new_users:      snapshot.total_new_users,
        total_pageviews:      snapshot.total_pageviews,
        avg_session_duration: snapshot.avg_session_duration,
        bounce_rate:          snapshot.bounce_rate,
        top_pages:            snapshot.top_pages,
        top_sources:          snapshot.top_sources,
        synced_at:            snapshot.synced_at,
      },
      { onConflict: 'client_id,period_start,period_end' },
    )
    .select('id')
    .single()

  if (upsertErr) {
    return NextResponse.json({ success: false, error: upsertErr.message }, { status: 500 })
  }

  return NextResponse.json({
    success:          true,
    snapshot_id:      (inserted as { id: string }).id,
    property_id:      snapshot.property_id,
    period_start:     snapshot.period_start,
    period_end:       snapshot.period_end,
    total_sessions:   snapshot.total_sessions,
    total_users:      snapshot.total_users,
    total_pageviews:  snapshot.total_pageviews,
    avg_session_duration: snapshot.avg_session_duration,
    bounce_rate:      snapshot.bounce_rate,
    page_count:       snapshot.top_pages.length,
    source_count:     snapshot.top_sources.length,
  })
}
