/**
 * POST /api/clients/[id]/magento/sync
 *
 * Pull Magento store metrics for the given date range and write a new row
 * to magento_snapshots. Called manually from the connector settings UI or
 * by a cron job.
 *
 * Connector config (stored in client_connectors.config for anchor='magento'):
 *   { store_url: string, access_token: string }
 *
 * Body (JSON, all optional):
 *   since  — ISO date string, default: 30 days ago  e.g. "2026-05-01"
 *   until  — ISO date string, default: today         e.g. "2026-05-31"
 *
 * Response 200: { snapshotId, storeUrl, periodStart, periodEnd, metrics }
 * Response 422: connector not connected or missing config
 * Response 502: Magento API call failed
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { getMagentoOrdersSummary, getMagentoTopProducts } from '@/lib/magento/client'

interface RouteParams {
  params: { id: string }
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const clientId = params.id

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json(
      { success: false, error: access.error, reason: access.reason },
      { status: access.status },
    )
  }

  // ── 1. Resolve date range ─────────────────────────────────────────────────
  let body: { since?: string; until?: string } = {}
  try {
    body = await req.json()
  } catch {
    // body is optional — default to last 30 days
  }

  const today = new Date()
  const thirtyDaysAgo = new Date(today)
  thirtyDaysAgo.setDate(today.getDate() - 30)

  const since = body.since ?? thirtyDaysAgo.toISOString().slice(0, 10)
  const until = body.until ?? today.toISOString().slice(0, 10)

  // ── 2. Read connector config ──────────────────────────────────────────────
  const { data: connector, error: connError } = await supabaseAdmin
    .from('client_connectors')
    .select('config, status')
    .eq('client_id', clientId)
    .eq('anchor', 'magento')
    .maybeSingle()

  if (connError || !connector || connector.status !== 'connected') {
    return NextResponse.json(
      { error: 'Magento connector is not connected. Configure it in the connector settings first.' },
      { status: 422 },
    )
  }

  const config = connector.config as { store_url?: string; access_token?: string } | null
  const storeUrl = config?.store_url
  const accessToken = config?.access_token

  if (!storeUrl || !accessToken) {
    return NextResponse.json(
      { error: 'Magento connector is missing store_url or access_token in its config.' },
      { status: 422 },
    )
  }

  // ── 3. Fetch data from Magento in parallel ────────────────────────────────
  const [ordersSummary, topProducts] = await Promise.all([
    getMagentoOrdersSummary(storeUrl, accessToken, since, until),
    getMagentoTopProducts(storeUrl, accessToken, since, until),
  ])

  if (!ordersSummary) {
    return NextResponse.json(
      { error: 'Magento API call failed. Check that the store URL and access token are correct.' },
      { status: 502 },
    )
  }

  // ── 4. Write snapshot to DB ───────────────────────────────────────────────
  const { data: snapshot, error: insertError } = await supabaseAdmin
    .from('magento_snapshots')
    .insert({
      client_id: clientId,
      store_url: storeUrl,
      period_start: since,
      period_end: until,
      total_orders: ordersSummary.total_orders,
      total_revenue: ordersSummary.total_revenue,
      aov: ordersSummary.average_order_value,
      top_products: topProducts.length > 0 ? topProducts : null,
      raw_data: { orders: ordersSummary },
    })
    .select('id')
    .single()

  if (insertError || !snapshot) {
    console.error('[magento/sync] insert error:', insertError?.message)
    return NextResponse.json({ error: 'Failed to save snapshot.' }, { status: 500 })
  }

  return NextResponse.json({
    snapshotId: (snapshot as { id: string }).id,
    storeUrl,
    periodStart: since,
    periodEnd: until,
    metrics: ordersSummary,
    topProducts,
  })
}
