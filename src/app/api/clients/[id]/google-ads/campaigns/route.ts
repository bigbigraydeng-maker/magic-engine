/**
 * GET /api/clients/[id]/google-ads/campaigns
 *
 * P18.B.1 — List Google Ads campaigns for a client account.
 * Used by the execution board to populate the campaign picker before executing a Fix.
 *
 * Query params:
 *   google_ads_customer_id  — 10-digit account ID (no dashes) e.g. "1234567890"
 *   limit?                  — max campaigns to return (default 20, max 100)
 *
 * Responses:
 *   200 { campaigns: GoogleAdsCampaign[] }
 *   400 missing google_ads_customer_id
 *   424 Google Ads credentials not configured
 *   502 Google Ads API error
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { loadGoogleAdsCreds, listCampaigns } from '@/lib/google-ads/client'

interface RouteParams {
  params: { id: string }
}

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const clientId = params.id

  // ── Auth ─────────────────────────────────────────────────────────────────
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // ── Query params ──────────────────────────────────────────────────────────
  const url = new URL(req.url)
  const customerId = url.searchParams.get('google_ads_customer_id')
  if (!customerId || !/^\d{1,15}$/.test(customerId)) {
    return NextResponse.json(
      { error: 'google_ads_customer_id must be a numeric string (1–15 digits)' },
      { status: 400 },
    )
  }

  const limitParam = url.searchParams.get('limit')
  const limit = Math.min(parseInt(limitParam ?? '20', 10) || 20, 100)

  // ── Credentials ───────────────────────────────────────────────────────────
  const creds = loadGoogleAdsCreds(customerId)
  if (!creds) {
    return NextResponse.json(
      {
        error:
          'Google Ads credentials are not configured. ' +
          'Add GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, ' +
          'GOOGLE_ADS_CLIENT_SECRET, and GOOGLE_ADS_REFRESH_TOKEN to Render environment variables.',
      },
      { status: 424 },
    )
  }

  // ── Fetch campaigns ───────────────────────────────────────────────────────
  let campaigns
  try {
    campaigns = await listCampaigns(creds, limit)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[google-ads/campaigns] listCampaigns error:', message)
    return NextResponse.json(
      { error: `Google Ads API error: ${message}` },
      { status: 502 },
    )
  }

  return NextResponse.json({ campaigns })
}
