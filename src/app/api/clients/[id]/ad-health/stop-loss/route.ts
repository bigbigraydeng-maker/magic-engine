/**
 * Stop-loss on an ads-health card — the action that costs less money the moment
 * it is pressed.
 *
 *   GET  ?campaign_id=…  → preview: where the budget lives, today's daily spend,
 *                          what a 20% cut becomes, and whether a cut is possible
 *                          at all. Read-only; called when the PM opens the menu
 *                          so the confirm dialog can show real numbers.
 *   POST { campaign_id, action: 'cut' | 'pause' }  → 提交给执行内核。
 *
 * ── 2026-09-27（WP3.1b）：这条路径已收编进执行内核 ──────────────────────────
 * 以前这个 POST 自己 import Meta 写函数直接打 Meta，事后往 `flywheel_actions` 插
 * 一行当审计 —— 没有 `action_runs` 回执、没有幂等键、没有撤回处理函数、没有客户策略
 * 检查、没有自治信封检查。它是全仓「所有对外写只有一个入口」这条铁律上的一个洞。
 *
 * 现在它只做四件事：核归属 → 找该挂的增长目标 → 算出要动哪几个投放单位 →
 * 逐个提交 `action_run`。授权、信封、幂等、回读验证、撤回全部归内核与
 * `capabilities/ads/*`。本文件**一个 Meta 写函数都不 import**。
 *
 * 🔴 两处行为变化，PM 需要知道（PR 描述里也写了）：
 *   ① 「暂停」以前是暂停整个广告系列（一次 Meta 写）；现在是**逐个暂停该系列下在投的
 *      广告组**（每组一条 run）。花掉的钱同样归零，但每组各有改前快照与撤回路径 ——
 *      广告系列本身保持 ACTIVE。之所以这样：内核里注册的动作是 `ads.pause_unit`，
 *      契约是广告组级；广告系列级写入本轮没有对应 ActionKey，硬做就得再开一条绕过内核的路。
 *   ② 预算挂在**广告系列**上（CBO）时的「砍预算」本轮做不了，会 fail closed 并把人工
 *      任务的三件套（做什么 / 怎么做 / 去哪做）直接写在响应里，由页面原样显示。
 *      不假装能做，也不把活丢回去让人自己想办法。
 *
 * 200 → preview / 提交结果（见下面的类型）
 * 400 missing campaign_id or bad action
 * 403 campaign_id does not belong to this client's registered ad account (AD-SEC-1)
 * 409 提交前置条件不满足（没有在跑的增长目标 / CBO 砍预算 / 读不到广告组）
 * 424 no Meta token configured for this client
 * 502 campaign could not be read from Meta
 * 503 读不到该挂的增长目标（读失败 ≠ 没有目标，不许当成后者）
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { assertCampaignOwnedByClient, getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { resolveAndLogAdsExpectedMetric } from '@/lib/flywheel/ads-expected-metric'
import { listAdSetsInCampaign } from '@/lib/meta/adsets'
import type { AdSetSummary } from '@/lib/meta/adsets'
import type { CampaignDetails } from '@/lib/meta/client'
import {
  resolveBudgetLocation, summariseCut, planCut, STOP_LOSS_CUT_RATIO,
} from '@/lib/ads-strategy/stop-loss'
import {
  submitStopLossThroughKernel,
  type StopLossKernelAction,
  type StopLossSubmissionResult,
  type StopLossUnit,
} from '@/lib/ads-strategy/stop-loss-submission'
import { createAdsKernelDeps } from '@/lib/capabilities/ads-kernel-deps'
import { resolveAdsGoalOrFail } from '@/lib/ads-strategy/portfolio/goal-context'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface RouteParams { params: { id: string } }

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function normalizeAccountId(id: string): string {
  return id.startsWith('act_') ? id.slice(4) : id
}

/**
 * 信封事实是按 `ad_entity_snapshots.ad_account_id` 查的，而快照里存的是**登记在册**
 * 的那种写法（`client_meta_ad_accounts.ad_account_id` / `clients.meta_ad_account_id`
 * 原样）。Meta 回的 `campaign.account_id` 是裸数字 —— 直接拿它去提交，信封会读到空、
 * 一律判拒，变成一个「看着接好了其实永远失败」的按钮。所以这里把 Meta 那一侧只当
 * 匹配用，提交的是登记在册的那个字符串。
 */
async function resolveRegisteredAccountId(
  clientId: string,
  campaign: CampaignDetails,
): Promise<{ id: string } | { error: string }> {
  const { ids, error } = await getRegisteredAccountIds(clientId)
  if (error) return { error }
  const metaAccount = campaign.account_id ? normalizeAccountId(campaign.account_id) : null
  if (!metaAccount) return { error: 'Meta 没有返回这条广告所属的账户信息，无法提交。' }
  const hit = ids.find(id => normalizeAccountId(id) === metaAccount)
  return hit ? { id: hit } : { error: '这条广告所属的账户不在这个客户登记的账户里，已拒绝执行。' }
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
    // 🔴 预算挂在广告系列上（CBO）时本轮砍不了 —— 内核里没有广告系列级的 ActionKey。
    //    预览就要如实说砍不了，不能让 PM 点下去才发现。
    cuttable: summary.cuttable && location.kind !== 'campaign',
    cut_blocked_reason: location.kind === 'campaign' ? 'campaign_level_budget' : null,
    // Pausing never depends on where the budget lives, so it is always offered
    // for a campaign that is currently delivering.
    pausable: campaign.status === 'ACTIVE',
  })
}

/** 「暂停」要动的单位 = 这个广告系列下**在投**的广告组（CBO 下它们没有自己的预算，也照样暂停）。 */
function pauseUnitsOf(adSets: readonly AdSetSummary[]): StopLossUnit[] {
  return adSets
    .filter(a => a.status === 'ACTIVE')
    .map(a => ({
      adsetId: a.id,
      name: a.name,
      currentCents: a.daily_budget ? Number.parseInt(a.daily_budget, 10) || 0 : 0,
      afterCents: null,
    }))
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

  // 归属校验（AD-SEC-1）：提交前必须核对这条 campaign 真的属于这个客户登记的
  // 广告账户，不能只信请求体里的 campaign_id。局限见 campaign-ownership.ts。
  const ownership = await assertCampaignOwnedByClient(campaignId, clientId, token)
  if (!ownership.ok) return NextResponse.json({ error: ownership.error }, { status: 403 })
  const campaign = ownership.campaign

  const account = await resolveRegisteredAccountId(clientId, campaign)
  if ('error' in account) return NextResponse.json({ error: account.error }, { status: 403 })

  // 这两个动作只允许 purpose='growth'，所以没有在跑的增长目标就不能提交（spec §6 第 5 条）。
  const goal = await resolveAdsGoalOrFail(supabaseAdmin, clientId)
  if ('unreadable' in goal) {
    return NextResponse.json({
      error: 'goal_unreadable',
      human: `读不到这个客户的增长目标，没有提交任何改动（${goal.unreadable}）。这不等于「没有目标」，请重试或排查。`,
    }, { status: 503 })
  }
  if ('none' in goal) {
    return NextResponse.json({
      error: 'no_active_goal',
      // 铁律 3 下半：做不了也不许烂尾 —— 三件套直接给出来，页面原样显示。
      what: '这个客户现在没有「在跑的增长目标」，系统按规矩不能自动动它的广告预算。',
      how: '先给这个客户建一个在跑的增长目标（或把已有目标重新设为进行中），然后再按一次止损。',
      href: `/dashboard/clients/${clientId}/goals`,
    }, { status: 409 })
  }

  const unitsOrError = await resolveUnits(action, campaignId, campaign, token)
  if ('error' in unitsOrError) {
    return NextResponse.json(unitsOrError.error, { status: unitsOrError.status })
  }

  const result = await submitStopLossThroughKernel(createAdsKernelDeps(supabaseAdmin), {
    clientId,
    adAccountId: account.id,
    cycleDate: todayIso(),
    goalId: goal.goal.id,
    action,
    units: unitsOrError.units,
    pressedBy: access.user.email ?? null,
    campaignId,
  })

  await projectSucceededRuns(clientId, campaignId, campaign, result)

  return NextResponse.json({
    submitted: true,
    action: result.action,
    goal_id: goal.goal.id,
    units: result.units,
    // 一眼能看懂的汇总：真做掉了几个 / 还等人点头几个 / 被拒几个。
    executed: result.units.filter(u => u.kind === 'succeeded').length,
    awaiting_approval: result.units.filter(u => u.kind === 'pending_approval').length,
    refused: result.units.filter(u => u.kind === 'denied' || u.kind === 'dead_letter').length,
  })
}

type UnitsResolution =
  | { units: StopLossUnit[] }
  | { error: Record<string, unknown>; status: number }

/** 算出这次要动哪几个投放单位。任何一步读不出来都 fail closed，不猜。 */
async function resolveUnits(
  action: StopLossKernelAction,
  campaignId: string,
  campaign: CampaignDetails,
  token: string,
): Promise<UnitsResolution> {
  const adSets = await listAdSetsInCampaign(campaignId, token)
  if (adSets === null) {
    return {
      status: 409,
      error: {
        error: 'adsets_unreadable',
        human: '读不到这个广告系列下的广告组，什么都没做 —— 读不到跟「没有广告组」不是一回事，不能当成后者。',
      },
    }
  }

  if (action === 'pause') {
    const units = pauseUnitsOf(adSets)
    if (units.length === 0) {
      return {
        status: 409,
        error: {
          error: 'nothing_active',
          human: '这个广告系列下现在没有在投的广告组，没有需要暂停的东西。',
        },
      }
    }
    return { units }
  }

  const location = resolveBudgetLocation(campaign, adSets)
  if (location.kind === 'campaign') {
    return {
      status: 409,
      error: {
        error: 'campaign_level_budget',
        // 铁律 3 下半：真做不了就把人工三件套说到对方不用问第二遍。
        what: '这个广告系列的预算挂在系列本身（Meta 的「广告系列预算优化」），' +
          '系统这一轮只能改广告组级的预算，所以没有替你砍。钱还在按原来的速度花。',
        how: `到 Meta 广告管理工具里打开这个广告系列（${campaign.name}），把「广告系列每日预算」` +
          `从现在的金额往下调（建议先降 ${Math.round(STOP_LOSS_CUT_RATIO * 100)}%）；` +
          '或者改按「暂停」，暂停是现在就能替你做掉的。',
        href: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(normalizeAccountId(campaign.account_id ?? ''))}&selected_campaign_ids=${encodeURIComponent(campaignId)}`,
      },
    }
  }

  const summary = summariseCut(location)
  if (location.kind === 'none' || !summary.cuttable) {
    return {
      status: 409,
      error: {
        error: 'not_cuttable',
        reason: location.kind === 'none' ? location.reason : 'below_minimum',
        current_daily: summary.currentDaily,
        human: '这个广告系列现在砍不了预算（要么没有每日预算，要么再砍就低到 Meta 会拒绝）。' +
          '在这里有意义的动作是「暂停」。',
      },
    }
  }

  return {
    units: location.targets.map(t => ({
      adsetId: t.id,
      name: t.name,
      currentCents: t.currentCents,
      afterCents: planCut(t.currentCents).newCents,
    })),
  }
}

/**
 * `flywheel_actions` 投影 —— **只投影真的做掉了的 run**。
 *
 * 🔴 权威回执现在是 `action_runs`，这张表只是给飞轮/归因看的投影。所以：
 *    · `pending_approval` 不投影（还没发生的事不能记成发生了）
 *    · `denied` / `dead_letter` 不投影
 *    投影失败不影响结果 —— Meta 那边该发生的已经发生了，这只是记一笔。
 */
async function projectSucceededRuns(
  clientId: string,
  campaignId: string,
  campaign: CampaignDetails,
  result: StopLossSubmissionResult,
): Promise<void> {
  const done = result.units.filter(u => u.kind === 'succeeded')
  if (done.length === 0) return

  await supabaseAdmin
    .from('flywheel_actions')
    .insert(done.map(u => ({
      client_id: clientId,
      flywheel: 'ads',
      action_type: result.action === 'pause' ? 'ads.pause_campaign' : 'ads.adjust_bid',
      execution_mode: 'third_party',
      vendor: 'meta',
      expected_metric: resolveAndLogAdsExpectedMetric(
        { objective: campaign.objective },
        'ad-health/stop-loss',
      ),
      payload: {
        campaign_id: campaignId,
        adset_id: u.adsetId,
        source: 'ads_health_stop_loss',
        // 🔴 权威回执在 action_runs；这里留 run id 是为了能对上，不是替代它。
        action_run_id: u.runId,
      },
    })))
    .then(() => {}, err => console.error('[ad-health/stop-loss] flywheel 投影写入失败:', err))
}
