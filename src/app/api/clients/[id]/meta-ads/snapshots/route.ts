/**
 * GET /api/clients/[id]/meta-ads/snapshots?limit=12
 *
 * Returns the most recent Meta Ads snapshots for a client.
 * Used by the client data tab (P17.B.2) and monthly reports.
 *
 * Query params:
 *   limit  — max rows returned (default 12, max 36)
 *
 * Returns: { success, snapshots: [...], latest: snapshot | null }
 *
 * Reference: ROADMAP.md P17.B.1
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const rawLimit = req.nextUrl.searchParams.get('limit')
  const limit    = Math.min(parseInt(rawLimit ?? '12', 10) || 12, 36)

  const { data, error } = await supabaseAdmin
    .from('meta_ads_snapshots')
    .select(
      'id, ad_account_id, period_start, period_end, ' +
      'spend, impressions, clicks, conversions, roas, cpc, ctr, ' +
      'campaigns, fetched_at, created_at',
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
