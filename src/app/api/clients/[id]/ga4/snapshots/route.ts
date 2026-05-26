/**
 * GET /api/clients/[id]/ga4/snapshots?limit=12
 *
 * Returns the most recent GA4 traffic snapshots for a client.
 * Used by monthly reports, the flywheel attribution view, and client portal.
 *
 * Query params:
 *   limit  — max rows returned (default 12, max 36)
 *
 * Returns: { success, snapshots: [...], latest: snapshot | null }
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P17.A.2
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const { id: clientId } = params

  const rawLimit = req.nextUrl.searchParams.get('limit')
  const limit    = Math.min(parseInt(rawLimit ?? '12', 10) || 12, 36)

  const { data, error } = await supabaseAdmin
    .from('ga4_traffic_snapshots')
    .select(
      'id, property_id, period_start, period_end, ' +
      'total_sessions, total_users, total_new_users, total_pageviews, ' +
      'avg_session_duration, bounce_rate, ' +
      'top_pages, top_sources, synced_at, created_at',
    )
    .eq('client_id', clientId)
    .order('period_start', { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    success:   true,
    snapshots: data ?? [],
    latest:    (data ?? [])[0] ?? null,
  })
}
