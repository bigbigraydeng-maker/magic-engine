/**
 * /api/clients/[id]/meta-ads/boost-post
 *
 * Boost a published Facebook Page post via Meta Ads API.
 *
 *   POST → creates a Campaign > AdSet > Ad stack that promotes the given
 *          page post to an AU/NZ audience using the REACH objective.
 *          This is the "投流" step after a Reel has been published and
 *          FDE wants to amplify high-performing content.
 *
 * Body (required):
 *   post_id:              string  — Facebook page post ID (format: "pageId_postId" or standalone postId)
 *   page_id:              string  — Facebook Page ID
 *   daily_budget_aud:     number  — Daily budget in AUD dollars (e.g. 20 = AUD $20/day)
 *   duration_days:        number  — How many days to run the boost (1–30)
 *
 * Body (optional):
 *   campaign_name_suffix?: string — Override suffix for the campaign name
 *
 * Auth: requireDashboardClientAccess
 * Requires: META_SYSTEM_USER_TOKEN env + client.meta_ad_account_id configured
 */

import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { boostPagePost } from '@/lib/meta/client'

interface RouteContext {
  params: { id: string }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const clientId = params.id

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: {
    post_id?: string
    page_id?: string
    daily_budget_aud?: number
    duration_days?: number
  } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { post_id, page_id, daily_budget_aud, duration_days } = body

  if (!post_id || !page_id) {
    return NextResponse.json(
      { error: 'post_id and page_id are required' },
      { status: 400 },
    )
  }

  if (!daily_budget_aud || daily_budget_aud < 1) {
    return NextResponse.json(
      { error: 'daily_budget_aud must be ≥ 1 AUD' },
      { status: 400 },
    )
  }

  const days = Math.min(Math.max(duration_days ?? 7, 1), 30)

  // Fetch client's Meta ad account ID
  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('name, meta_ad_account_id')
    .eq('id', clientId)
    .single()

  if (clientErr || !client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  if (!client.meta_ad_account_id) {
    return NextResponse.json(
      {
        error: 'Meta ad account not configured for this client. Set meta_ad_account_id in client settings.',
      },
      { status: 422 },
    )
  }

  const accessToken = process.env.META_SYSTEM_USER_TOKEN
  if (!accessToken) {
    return NextResponse.json(
      { error: 'META_SYSTEM_USER_TOKEN not configured. Set it in Render environment variables.' },
      { status: 503 },
    )
  }

  // Convert AUD to cents (Meta uses minor currency units)
  const dailyBudgetCents = Math.round(daily_budget_aud * 100)

  const result = await boostPagePost(
    client.meta_ad_account_id,
    page_id,
    post_id,
    accessToken,
    dailyBudgetCents,
    days,
  )

  if (!result) {
    return NextResponse.json(
      { error: 'Failed to create boost campaign. Check Meta token permissions and ad account status.' },
      { status: 502 },
    )
  }

  return NextResponse.json({
    success: true,
    client_name: client.name,
    post_id,
    page_id,
    daily_budget_aud,
    duration_days: days,
    estimated_total_aud: daily_budget_aud * days,
    ...result,
  })
}
