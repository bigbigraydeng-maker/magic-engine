/**
 * GET /api/clients/[id]/tiktok-ads/campaigns
 *
 * P18.C.1: List TikTok Ads campaigns for a client.
 *
 * Query params:
 *   tiktok_advertiser_id   — TikTok advertiser account ID (overrides env TIKTOK_ADS_ADVERTISER_ID)
 *   limit                  — max campaigns to return (default 20, max 100)
 *
 * Responses:
 *   200  { campaigns: TikTokCampaign[] }
 *   400  missing tiktok_advertiser_id when env var not set
 *   401  not authenticated
 *   424  TIKTOK_ADS_ACCESS_TOKEN not configured
 *   502  TikTok Marketing API call failed
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { listCampaigns, loadTikTokAdsCreds } from '@/lib/tiktok-ads/client'

interface RouteParams {
  params: { id: string }
}

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const clientId = params.id

  // ── Auth ─────────────────────────────────────────────────────────────────
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // ── Params ────────────────────────────────────────────────────────────────
  const url = new URL(req.url)
  const advertiserId = url.searchParams.get('tiktok_advertiser_id') ?? undefined
  const limitParam   = url.searchParams.get('limit')
  const limit        = Math.min(parseInt(limitParam ?? '20', 10) || 20, 100)

  // ── Credentials ───────────────────────────────────────────────────────────
  const creds = loadTikTokAdsCreds(advertiserId)
  if (!creds) {
    const missing: string[] = []
    if (!process.env.TIKTOK_ADS_ACCESS_TOKEN) missing.push('TIKTOK_ADS_ACCESS_TOKEN')
    if (!advertiserId && !process.env.TIKTOK_ADS_ADVERTISER_ID) {
      missing.push('tiktok_advertiser_id (query param) or TIKTOK_ADS_ADVERTISER_ID (env)')
    }
    return NextResponse.json(
      { error: `TikTok Ads not configured. Missing: ${missing.join(', ')}` },
      { status: 424 },
    )
  }

  // ── Fetch campaigns ───────────────────────────────────────────────────────
  try {
    const campaigns = await listCampaigns(creds, limit)
    return NextResponse.json({ campaigns })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `TikTok Marketing API call failed: ${message}` },
      { status: 502 },
    )
  }
}
