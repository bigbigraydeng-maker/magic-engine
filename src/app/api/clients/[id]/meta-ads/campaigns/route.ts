/**
 * GET /api/clients/[id]/meta-ads/campaigns
 *
 * P18.A.1: Returns last-7-day campaign performance for the client's Meta ad account.
 * Campaigns are sorted by risk level (critical → warning → healthy).
 *
 * Requires: clients.meta_ad_account_id, META_SYSTEM_USER_TOKEN
 * Security: requireDashboardClientAccess
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { fetchCampaignInsights } from '@/lib/meta/campaign-list'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const clientId = params.id

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id')
    .eq('id', clientId)
    .single()

  if (clientErr || !client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const adAccountId = (client as { meta_ad_account_id?: string | null }).meta_ad_account_id
  if (!adAccountId) {
    return NextResponse.json(
      { error: 'Client has no meta_ad_account_id configured.' },
      { status: 422 },
    )
  }

  if (!process.env.META_SYSTEM_USER_TOKEN) {
    return NextResponse.json(
      { error: 'META_SYSTEM_USER_TOKEN is not configured.' },
      { status: 424 },
    )
  }

  const campaigns = await fetchCampaignInsights(adAccountId)

  return NextResponse.json({ campaigns, ad_account_id: adAccountId })
}
