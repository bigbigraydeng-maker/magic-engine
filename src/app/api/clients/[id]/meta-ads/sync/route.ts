/**
 * POST /api/clients/[id]/meta-ads/sync
 *
 * P12.B.2: Fetch Meta Ads account-level insights for the client and write
 * a new row to meta_ads_snapshots. Called manually or by the weekly cron.
 *
 * Required env:  META_SYSTEM_USER_TOKEN
 * Required DB:   clients.meta_ad_account_id must be set for the client
 *
 * Body (JSON, all optional):
 *   since  — ISO date string, default: 30 days ago  e.g. "2026-04-01"
 *   until  — ISO date string, default: today         e.g. "2026-04-30"
 *
 * Response 200: { snapshotId, adAccountId, periodStart, periodEnd, metrics }
 * Response 422: client has no meta_ad_account_id
 * Response 424: META_SYSTEM_USER_TOKEN not configured
 * Response 502: Meta Graph API call failed
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAdAccountInsights } from '@/lib/meta/client'

interface RouteParams {
  params: { id: string }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const clientId = params.id

  // ── 1. Resolve date range ─────────────────────────────────────────────────
  let body: { since?: string; until?: string; production_package_id?: string } = {}
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
  const { production_package_id: productionPackageId } = body

  // ── 2. Look up client's Meta ad account ID ────────────────────────────────
  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id')
    .eq('id', clientId)
    .single()

  if (clientError || !client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const adAccountId = (client as { meta_ad_account_id?: string | null }).meta_ad_account_id
  if (!adAccountId) {
    return NextResponse.json(
      { error: 'Client has no meta_ad_account_id configured. Set it in the clients table.' },
      { status: 422 },
    )
  }

  // ── 3. Check for system user token ────────────────────────────────────────
  const accessToken = process.env.META_SYSTEM_USER_TOKEN
  if (!accessToken) {
    return NextResponse.json(
      { error: 'META_SYSTEM_USER_TOKEN is not configured.' },
      { status: 424 },
    )
  }

  // ── 4. Fetch insights from Meta Graph API ─────────────────────────────────
  const insights = await getAdAccountInsights(adAccountId, accessToken, since, until)
  if (!insights) {
    return NextResponse.json(
      { error: 'Meta Graph API call failed. Check server logs for details.' },
      { status: 502 },
    )
  }

  // ── 5. Write snapshot to DB ───────────────────────────────────────────────
  const { data: snapshot, error: insertError } = await supabaseAdmin
    .from('meta_ads_snapshots')
    .insert({
      client_id: clientId,
      ad_account_id: adAccountId,
      period_start: since,
      period_end: until,
      spend: insights.spend,
      impressions: insights.impressions,
      clicks: insights.clicks,
      conversions: insights.conversions,
      roas: insights.roas,
      cpc: insights.cpc,
      ctr: insights.ctr,
      raw_data: insights,
    })
    .select('id')
    .single()

  if (insertError || !snapshot) {
    console.error('[meta-ads/sync] insert error:', insertError?.message)
    return NextResponse.json({ error: 'Failed to save snapshot.' }, { status: 500 })
  }

  // Link to production package if provided (non-blocking, P13.D)
  if (productionPackageId && snapshot.id) {
    supabaseAdmin
      .from('meta_ads_snapshots')
      .update({ production_package_id: productionPackageId })
      .eq('id', snapshot.id)
      .then(({ error: upErr }) => {
        if (upErr) console.error('[meta-ads/sync] production_package_id link failed:', upErr)
      })
  }

  return NextResponse.json({
    snapshotId: snapshot.id,
    adAccountId,
    periodStart: since,
    periodEnd: until,
    metrics: insights,
  })
}
