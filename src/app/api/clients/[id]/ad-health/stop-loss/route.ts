/**
 * Stop-loss on an ads-health card — the action that costs less money the moment
 * it is pressed.
 *
 *   GET  ?campaign_id=…  → preview: where the budget lives, today's daily spend,
 *                          what a 20% cut becomes, and whether a cut is possible
 *                          at all. Read-only; called when the PM opens the menu
 *                          so the confirm dialog can show real numbers.
 *   POST { campaign_id, action: 'cut' | 'pause', request_id }  → a confirmation card. Nothing is written until that card is confirmed.
 *
 * Responses carry FACTS, not prose: all PM-facing wording lives in the page so
 * copy stays in one reviewable place.
 *
 * 200 → preview / outcome (see types below)
 * 400 missing campaign_id or bad action
 * 403 campaign_id does not belong to this client's registered ad account (AD-SEC-1)
 * 424 no Meta token configured for this client
 * 502 campaign could not be read from Meta
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { getCampaignDetails } from '@/lib/meta/client'
import { assertCampaignOwnedByClient } from '@/lib/meta/campaign-ownership'
import {
  listAdSetsInCampaign,
} from '@/lib/meta/adsets'
import {
  resolveBudgetLocation, summariseCut, planCut,
  STOP_LOSS_CUT_RATIO,
} from '@/lib/ads-strategy/stop-loss'
import { createKernel } from '@/lib/kernel'
import { requireStopLossAccess } from '@/lib/action-submission/stop-loss'
import { requestCampaignStatusCard } from '@/lib/action-submission/campaign-status-card'
import { CLIENT_BUDGET_FACT_FRESH_MS } from '@/lib/capabilities/ads/envelope-facts'
import { clickerFromAccess, issueMoneyBudget } from '@/lib/action-submission/money-card'
import { loadMoneyBudgetLive } from '@/lib/ads-budget-card/money-live'
import { resolveAccountTimezone, accountDayKey } from '@/lib/ads-strategy/account-timezone'
import { toActAccountId } from '@/lib/meta/ad-account-binding'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface RouteParams { params: { id: string } }

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

  // 归属校验（AD-SEC-1）：见 campaign-ownership.ts 顶部注释里的局限说明。
  const ownership = await assertCampaignOwnedByClient(campaignId, params.id, token)
  if (!ownership.ok) return NextResponse.json({ error: ownership.error }, { status: 403 })
  const campaign = ownership.campaign

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
  const access = await requireStopLossAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: { campaign_id?: string; action?: string; request_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { campaign_id: campaignId, action } = body
  const requestId = body.request_id
  if (!campaignId) return NextResponse.json({ error: 'campaign_id is required' }, { status: 400 })
  if (action !== 'cut' && action !== 'pause') {
    return NextResponse.json({ error: "action must be 'cut' or 'pause'" }, { status: 400 })
  }
  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return NextResponse.json({ error: 'request_id must be a UUID' }, { status: 400 })
  }

  const token = await resolveToken(clientId)
  if (!token) return NextResponse.json({ error: 'no_meta_token' }, { status: 424 })

  // 归属校验（AD-SEC-1）：执行前必须核对这条 campaign 真的属于这个客户登记的
  // 广告账户，不能只信请求体里的 campaign_id。局限见 campaign-ownership.ts。
  const ownership = await assertCampaignOwnedByClient(campaignId, clientId, token)
  if (!ownership.ok) return NextResponse.json({ error: ownership.error }, { status: 403 })

  let targets: Array<{ id: string; name: string; currentCents: number; afterCents?: number }>
  let kernelAction: 'pause_campaign' | 'cut_campaign' | 'cut_unit'
  if (action === 'pause') {
    kernelAction = 'pause_campaign'
    targets = [{ id: campaignId, name: ownership.campaign.name, currentCents: Number(ownership.campaign.daily_budget ?? 0) }]
  } else {
    const adsets = ownership.campaign.daily_budget ? null : await listAdSetsInCampaign(campaignId, token)
    if (!ownership.campaign.daily_budget && !adsets) {
      return NextResponse.json({ error: 'adsets_unreadable' }, { status: 503 })
    }
    const location = resolveBudgetLocation(ownership.campaign, adsets)
    const summary = summariseCut(location)
    if (!summary.cuttable || location.kind === 'none') {
      return NextResponse.json({ executed: false, not_cuttable: true, reason: location.kind === 'none' ? location.reason : 'below_minimum', current_daily: summary.currentDaily })
    }
    targets = location.targets.map(target => {
      const plan = planCut(target.currentCents)
      return { id: target.id, name: target.name, currentCents: target.currentCents, afterCents: plan.newCents ?? undefined }
    })
    kernelAction = location.kind === 'campaign' ? 'cut_campaign' : 'cut_unit'
  }

  // Growth actions must link a real active Goal; campaign budget decreases are
  // classified as maintenance by their registry contract and must not invent one.
  let goalId: string | undefined
  if (kernelAction !== 'cut_campaign') {
    const goalQuery = await supabaseAdmin.from('goals').select('id').eq('client_id', clientId)
      .eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (goalQuery.error) return NextResponse.json({ error: 'goal_unreadable', detail: goalQuery.error.message }, { status: 503 })
    const goal = goalQuery.data as { id: string } | null
    if (!goal) return NextResponse.json({ error: 'no_active_goal' }, { status: 409 })
    goalId = goal.id
  }

  const adAccountId = toActAccountId(ownership.campaign.account_id)
  if (!adAccountId) return NextResponse.json({ error: 'account_id_unreadable', wroteMeta: false }, { status: 503 })
  const timezone = await resolveAccountTimezone(adAccountId)
  if (!timezone) return NextResponse.json({ error: 'timezone_unreadable', wroteMeta: false }, { status: 503 })
  if (kernelAction === 'pause_campaign') {
    const asked = await requestCampaignStatusCard(supabaseAdmin, {
      clientId,
      access,
      kind: 'pause',
      campaignId,
      adAccountId,
      name: ownership.campaign.name,
      liveStatus: ownership.campaign.status,
      dailyBudget: ownership.campaign.daily_budget ?? null,
      objective: ownership.campaign.objective ?? null,
      executionItemId: null,
    })
    return NextResponse.json({ ...asked.body, action: 'pause_campaign', wroteMeta: false }, { status: asked.status })
  }
  const cycleDate = accountDayKey(timezone, new Date())
  const kernel = createKernel(supabaseAdmin)
  const cards = []
  for (const target of targets) {
    if (target.afterCents === undefined) {
      return NextResponse.json({ error: '降后的日预算算不出来，没有出卡。', wroteMeta: false }, { status: 409 })
    }
    const issued = await issueMoneyBudget({
      kernel,
      sb: supabaseAdmin,
      clientId,
      clicker: clickerFromAccess(access, clientId),
      source: 'stop_loss',
      level: kernelAction === 'cut_campaign' ? 'campaign' : 'adset',
      entityId: target.id,
      adAccountId,
      campaignId,
      scaleAdsetId: null,
      name: target.name,
      beforeCents: target.currentCents,
      afterCents: target.afterCents,
      snapshotAt: new Date().toISOString(),
      goalId: goalId ?? null,
      cycleDate,
      requestId,
      freshMs: CLIENT_BUDGET_FACT_FRESH_MS,
      readLive: () => loadMoneyBudgetLive(supabaseAdmin, clientId, {
        level: kernelAction === 'cut_campaign' ? 'campaign' : 'adset',
        entityId: target.id,
        adAccountId,
        name: target.name,
        beforeCents: target.currentCents,
        afterCents: target.afterCents ?? target.currentCents,
      }),
    })
    if (!issued.card) return NextResponse.json({ error: issued.reason, wroteMeta: false }, { status: 409 })
    cards.push(issued.card)
  }
  const currentDaily = targets.reduce((sum, target) => sum + target.currentCents, 0) / 100
  const newDaily = targets.reduce((sum, target) => sum + (target.afterCents ?? target.currentCents), 0) / 100
  return NextResponse.json({
    ok: false,
    executed: false,
    status: 'awaiting_confirmation',
    wroteMeta: false,
    action: kernelAction,
    cards,
    current_daily: currentDaily,
    new_daily: newDaily,
  }, { status: 202 })
}
