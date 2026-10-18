/**
 * Stop-loss on an ads-health card — the action that costs less money the moment
 * it is pressed.
 *
 *   GET  ?campaign_id=…  → preview: where the budget lives, today's daily spend,
 *                          what a 20% cut becomes, and whether a cut is possible
 *                          at all. Read-only; called when the PM opens the menu
 *                          so the confirm dialog can show real numbers.
 *   POST { campaign_id, action: 'cut' | 'pause', request_id }  → execute.
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
import { submitStopLossThroughKernel, requireStopLossAccess } from '@/lib/action-submission/stop-loss'
import { resolveAccountTimezone, accountDayKey } from '@/lib/ads-strategy/account-timezone'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface RouteParams { params: { id: string } }

async function resolveToken(clientId: string): Promise<string | null> {
  return getMetaTokenForClient(clientId)
}

/**
 * Meta 返回的 campaign.account_id 是纯数字；库里和内核都用 act_ 形式。
 *
 * 生产 503 `timezone_unreadable` 的根因：`resolveAccountTimezone` 按
 * `ad_entity_snapshots.ad_account_id = <传入值>` 查，库里存的是 `act_…`，
 * 纯数字永远查不到；内核信封事实也拿 `input.ad_account_id` 去匹配
 * `client_meta_ad_accounts.ad_account_id`（同样是 `act_` 形式）。
 *
 * 规范化只放在这一个入口，下游一律假定拿到的是 `act_` 形式。
 * 形状不认识就返回 null，由调用方 fail-closed —— 绝不回落成空串：
 * 空串会带着一个「看起来像账户号」的值继续往下走，把「读不到」伪装成
 * 「读到了但没数据」，错误被吞进 503 之外的路径里。
 */
function toActAccountId(raw: string | null | undefined): string | null {
  if (!raw) return null
  const compact = raw.replace(/\s+/g, '')
  if (/^act_[1-9]\d{9,24}$/.test(compact)) return compact
  if (/^[1-9]\d{9,24}$/.test(compact)) return `act_${compact}`
  return null
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
  if (!adAccountId) return NextResponse.json({ error: 'account_id_unreadable' }, { status: 503 })
  const timezone = await resolveAccountTimezone(adAccountId)
  if (!timezone) return NextResponse.json({ error: 'timezone_unreadable' }, { status: 503 })
  const submitted = await submitStopLossThroughKernel(createKernel(supabaseAdmin), {
    clientId, access, goalId, campaignId, adAccountId, requestId,
    cycleDate: accountDayKey(timezone, new Date()), action: kernelAction, targets,
  })
  const kinds = submitted.runs.map(run => run.kind)
  const executed = kinds.length > 0 && kinds.every(kind => kind === 'succeeded' || kind === 'idempotent_hit')
  const succeededCount = kinds.filter(kind => kind === 'succeeded' || kind === 'idempotent_hit').length
  const pendingCount = kinds.filter(kind => kind === 'pending_approval').length
  const inProgressCount = kinds.filter(kind => kind === 'in_progress').length
  const refusedCount = kinds.length - succeededCount - pendingCount - inProgressCount
  const warnings = submitted.runs.flatMap(run => run.warnings ?? [])
  const awaitingApproval = pendingCount > 0 && succeededCount === 0 && refusedCount === 0 && inProgressCount === 0
  const status = executed ? 'executed' : awaitingApproval ? 'awaiting_approval'
    : inProgressCount > 0 && succeededCount === 0 && pendingCount === 0 && refusedCount === 0 ? 'in_progress'
      : succeededCount === 0 && pendingCount === 0 && inProgressCount === 0 ? 'refused' : 'partial'
  const currentDaily = targets.reduce((sum, target) => sum + target.currentCents, 0) / 100
  const newDaily = kernelAction === 'pause_campaign'
    ? 0
    : targets.reduce((sum, target) => sum + (target.afterCents ?? target.currentCents), 0) / 100
  return NextResponse.json({
    ok: executed || awaitingApproval,
    executed,
    status,
    action: kernelAction,
    runs: submitted.runs,
    succeeded_count: succeededCount,
    pending_count: pendingCount,
    refused_count: refusedCount,
    in_progress_count: inProgressCount,
    warnings,
    current_daily: currentDaily,
    new_daily: newDaily,
    reason: submitted.runs.find(run => run.humanReason)?.humanReason ?? null,
  })
}
