/**
 * Stop-loss on an ads-health card — the action that costs less money the moment
 * it is pressed.
 *
 *   GET  ?campaign_id=…  → preview: where the budget lives, today's daily spend,
 *                          what a 20% cut becomes, and whether a cut is possible
 *                          at all. Read-only; called when the PM opens the menu
 *                          so the confirm dialog can show real numbers.
 *   POST { campaign_id, action: 'cut' | 'pause' }  → execute.
 *
 * Responses carry FACTS, not prose: all PM-facing wording lives in the page so
 * copy stays in one reviewable place.
 *
 * 200 → preview / outcome (see types below)
 * 400 missing campaign_id or bad action
 * 424 no Meta token configured for this client
 * 502 campaign could not be read from Meta
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { getCampaignDetails, setCampaignStatus, setCampaignDailyBudget } from '@/lib/meta/client'
import {
  listAdSetsInCampaign, setAdSetDailyBudget, getAdSetStatus, setAdSetStatus,
} from '@/lib/meta/adsets'
import {
  executeStopLoss, resolveBudgetLocation, summariseCut,
  STOP_LOSS_CUT_RATIO, type StopLossDeps,
} from '@/lib/ads-strategy/stop-loss'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface RouteParams { params: { id: string } }

/** Bind the Meta helpers to one client's token. */
function metaDeps(token: string): StopLossDeps {
  return {
    getCampaign:        id => getCampaignDetails(id, token),
    setCampaignStatus:  (id, s) => setCampaignStatus(id, token, s),
    setCampaignBudget:  (id, c) => setCampaignDailyBudget(id, token, c),
    listAdSets:         id => listAdSetsInCampaign(id, token),
    setAdSetBudget:     (id, c) => setAdSetDailyBudget(id, token, c),
    getAdSet:           id => getAdSetStatus(id, token),
    setAdSetStatus:     (id, s) => setAdSetStatus(id, token, s),
  }
}

async function resolveToken(clientId: string): Promise<string | null> {
  return getMetaTokenForClient(clientId)
}

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const campaignId = req.nextUrl.searchParams.get('campaign_id')
  if (!campaignId) return NextResponse.json({ error: 'campaign_id is required' }, { status: 400 })

  const token = await resolveToken(params.id)
  if (!token) return NextResponse.json({ error: 'no_meta_token' }, { status: 424 })

  const campaign = await getCampaignDetails(campaignId, token)
  if (!campaign) return NextResponse.json({ error: 'campaign_unreadable' }, { status: 502 })

  // Only look up ad sets when the campaign itself carries no budget — saves a
  // Meta round-trip on the common CBO case.
  const needsAdSets = !campaign.daily_budget
  const location = resolveBudgetLocation(
    campaign,
    needsAdSets ? await listAdSetsInCampaign(campaignId, token) : null,
  )
  const summary = summariseCut(location)

  return NextResponse.json({
    campaign_name: campaign.name,
    campaign_status: campaign.status,
    where: location.kind,
    reason: location.kind === 'none' ? location.reason : null,
    entity_count: location.kind === 'none' ? 0 : location.targets.length,
    current_daily: summary.currentDaily,
    planned_daily: summary.plannedDaily,
    cut_ratio: STOP_LOSS_CUT_RATIO,
    cuttable: summary.cuttable,
    // Pausing never depends on where the budget lives, so it is always offered
    // for a campaign that is currently delivering.
    pausable: campaign.status === 'ACTIVE',
  })
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: { campaign_id?: string; action?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { campaign_id: campaignId, action } = body
  if (!campaignId) return NextResponse.json({ error: 'campaign_id is required' }, { status: 400 })
  if (action !== 'cut' && action !== 'pause') {
    return NextResponse.json({ error: "action must be 'cut' or 'pause'" }, { status: 400 })
  }

  const token = await resolveToken(clientId)
  if (!token) return NextResponse.json({ error: 'no_meta_token' }, { status: 424 })

  const outcome = await executeStopLoss(campaignId, action, metaDeps(token))
  if (outcome === null) {
    return NextResponse.json({ error: 'campaign_unreadable' }, { status: 502 })
  }

  // A cut that cannot be made is a real answer, not an error — the page turns it
  // into "pausing is the meaningful action here", never "go do it yourself".
  if ('notCuttable' in outcome) {
    return NextResponse.json({
      executed: false,
      not_cuttable: true,
      reason: outcome.location.kind === 'none' ? outcome.location.reason : 'below_minimum',
      current_daily: outcome.currentDaily,
    })
  }

  await recordAudit(clientId, campaignId, outcome)

  return NextResponse.json({
    executed: true,
    action: outcome.action,
    ok: outcome.ok,
    where: outcome.where,
    current_daily: outcome.currentDaily,
    new_daily: outcome.newDaily,
    touched: outcome.touched,
    warnings: outcome.touched.map(t => t.warning).filter(Boolean),
  })
}

/** Audit trail. Best-effort: the Meta change already happened either way. */
async function recordAudit(
  clientId: string,
  campaignId: string,
  outcome: Awaited<ReturnType<typeof executeStopLoss>>,
): Promise<void> {
  if (!outcome || 'notCuttable' in outcome) return
  await supabaseAdmin
    .from('flywheel_actions')
    .insert({
      client_id: clientId,
      flywheel: 'ads',
      action_type: outcome.action === 'pause' ? 'ads.pause_campaign' : 'ads.adjust_bid',
      execution_mode: 'third_party',
      vendor: 'meta',
      payload: {
        campaign_id: campaignId,
        source: 'ads_health_stop_loss',
        where: outcome.where,
        current_daily: outcome.currentDaily,
        new_daily: outcome.newDaily,
        touched: outcome.touched,
      },
    })
    .then(() => {}, err => console.error('[ad-health/stop-loss] audit insert failed:', err))
}
