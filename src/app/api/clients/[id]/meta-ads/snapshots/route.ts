/**
 * GET /api/clients/[id]/meta-ads/snapshots?limit=12
 *
 * Returns the most recent Meta Ads snapshots for a client.
 * Used by the client data tab (P17.B.2) and monthly reports.
 *
 * Query params:
 *   limit  — max rows returned (default 12, max 36)
 *
 * Returns: { success, snapshots, latest, currency }
 * currency is the ad account's currency, else the client's country. Never a hardcoded dollar.
 *
 * Reference: ROADMAP.md P17.B.1
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { resolveClientAdCurrency } from '@/lib/ads/account-currency'
import { readObjectiveCosts } from '@/lib/ads/spend-figures'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
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
      'campaigns, raw_data, fetched_at, created_at',
    )
    .eq('client_id', clientId)
    .order('period_start', { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>
  const latestAccount = typeof rows[0]?.ad_account_id === 'string' ? rows[0].ad_account_id : null
  const currency = await resolveClientAdCurrency(clientId, latestAccount)
  const snapshots = rows.map(row => presentSnapshot(row, currency))

  return NextResponse.json({
    success:   true,
    currency,
    snapshots,
    latest:    snapshots[0] ?? null,
  })
}

function presentSnapshot(row: Record<string, unknown>, currency: string | null) {
  const costs = readObjectiveCosts(row.raw_data)
  const rest = { ...row }
  delete rest.raw_data
  return { ...rest, currency, ...costs }
}
