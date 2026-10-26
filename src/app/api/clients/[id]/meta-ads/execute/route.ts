/**
 * POST /api/clients/[id]/meta-ads/execute
 *
 * P18.A.1: Execute a real Meta Ads action (pause campaign, adjust budget).
 *
 * Body JSON:
 *   action_type       — 'ads.pause_campaign' | 'ads.adjust_bid' | 'ads.reactivate_campaign'
 *   campaign_id       — Meta campaign ID string (no "act_" prefix)
 *   params?           — extra params by action type:
 *     new_daily_budget  (adjust_bid only) — new daily budget in whole currency units (AUD/USD)
 *     execution_item_id — optional link to flywheel execution item
 *
 * Responses:
 *   200 { success, actionId, campaignId, before, after }
 *   400 missing required fields
 *   403 campaign_id does not belong to this client's registered ad account (AD-SEC-1)
 *   403 ads.reactivate_campaign by anyone other than the global admin (PM) — code activation_requires_pm
 *   422 action not supported, campaign has no daily_budget (for adjust_bid), or reactivate of an ME Messenger draft campaign
 *   424 META_SYSTEM_USER_TOKEN not configured
 *   502 Meta Graph API call failed
 *   503 reactivate receipt could not be written — Meta NOT called
 *
 * Before/after are stored in flywheel_actions.payload for audit and undo.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdsCampaignBudgetAccess, queueAdsCampaignBudgetDecrease } from '@/lib/action-submission/ads-campaign-budget'
import { createKernel } from '@/lib/kernel'
import { inngest } from '@/lib/inngest/client'
import { ADS_CAMPAIGN_BUDGET_DECREASE_REQUESTED } from '@/lib/inngest/ads-events'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { setCampaignStatus } from '@/lib/meta/client'
import { assertCampaignOwnedByClient } from '@/lib/meta/campaign-ownership'
import { toActAccountId } from '@/lib/meta/ad-account-binding'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { resolveAndLogAdsExpectedMetric } from '@/lib/flywheel/ads-expected-metric'
import { nzToday } from '@/lib/pm-todo/ledger-items'
import {
  checkMessengerDraftCampaign,
  MESSENGER_REACTIVATE_BLOCKED_MESSAGE,
  MESSENGER_LOOKUP_FAILED_MESSAGE,
} from '@/lib/ads-strategy/messenger-draft-campaign-guard'
import { requireSpendActivationAuthority, buildSpendActivationReceipt, type SpendActivationAuthority } from '@/lib/ads/spend-activation'
import { rejectAgentAdsMetaExecute } from '@/lib/auth/agent-ads-guard'

const SUPPORTED_ACTION_TYPES = new Set([
  ADS_ACTION_TYPE.PAUSE_CAMPAIGN,
  ADS_ACTION_TYPE.ADJUST_BID,
  'ads.reactivate_campaign',   // undo of pause — not in vocab (undo path only)
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteParams {
  params: { id: string }
}

interface ExecuteBody {
  action_type: string
  campaign_id: string
  params?: {
    new_daily_budget?: number
    execution_item_id?: string
  }
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const clientId = params.id
  const denied = await rejectAgentAdsMetaExecute(req, clientId)
  if (denied) return denied

  // ── Auth ─────────────────────────────────────────────────────────────────
  const access = await requireAdsCampaignBudgetAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: ExecuteBody
  try {
    body = await req.json() as ExecuteBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { action_type, campaign_id } = body
  const actionParams = body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {}

  if (!action_type || !campaign_id) {
    return NextResponse.json(
      { error: 'action_type and campaign_id are required' },
      { status: 400 },
    )
  }

  if (!SUPPORTED_ACTION_TYPES.has(action_type)) {
    return NextResponse.json(
      { error: `Unsupported action_type: "${action_type}". Supported: ${Array.from(SUPPORTED_ACTION_TYPES).join(', ')}` },
      { status: 422 },
    )
  }

  // execution_item_id 来自请求体，会原样写进回执：必须是 UUID 字符串，别的一律 400。
  if (
    actionParams.execution_item_id !== undefined &&
    (typeof actionParams.execution_item_id !== 'string' || !UUID_RE.test(actionParams.execution_item_id))
  ) {
    return NextResponse.json({ error: 'params.execution_item_id must be a UUID string' }, { status: 400 })
  }

  // ── 重开 = 重新花钱：只有 PM（全局管理员，ADMIN_EMAILS 精确名单）能做 ─────────
  // 付费客户账号照样能暂停；重开必须是 PM。任何校验失败都拒绝（fail-closed）。
  let activationAuthority: SpendActivationAuthority | null = null
  if (action_type === 'ads.reactivate_campaign') {
    const authority = await requireSpendActivationAuthority()
    if (!authority.ok) {
      return NextResponse.json({ error: authority.error, code: authority.code }, { status: authority.status })
    }
    activationAuthority = authority
  }

  // ── Token ─────────────────────────────────────────────────────────────────
  // Per-client token first (META_SYSTEM_USER_TOKEN_<DOMAIN>, the path the daily
  // pull and winner-sync already run on in production), falling back to the
  // global env inside getMetaTokenForClient. The old global-only read 424'd on
  // installs where only per-client tokens exist.
  const accessToken = await getMetaTokenForClient(clientId)
  if (!accessToken) {
    return NextResponse.json(
      { error: 'No Meta token configured for this client (META_SYSTEM_USER_TOKEN_<DOMAIN> or META_SYSTEM_USER_TOKEN).' },
      { status: 424 },
    )
  }

  // ── 归属校验（AD-SEC-1）：campaign_id 来自请求体，必须核对它真的属于这个
  // 客户登记的广告账户，不能只信 URL 里的客户身份。局限见 campaign-ownership.ts
  // 顶部注释——同账户共用的客户之间挡不住，那部分需要账户拆分，不是这里能解的。
  const ownership = await assertCampaignOwnedByClient(campaign_id, clientId, accessToken)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: 403 })
  }
  const beforeDetails = ownership.campaign

  // ── ME 私信广告草案不许经「恢复」直接开启 ─────────────────────────────────
  // 私信广告的开启必须走审批流程；这个入口没有授权/预算检查。判据是账本里有没有
  // 这个系列的私信草案记录（不按客户过滤：Meta 系列编号全局唯一，共用广告账户时
  // 别家客户的人也够得着这个系列）。放在归属校验之后，免得借它探测别家的系列编号。
  // 查不出来也拒绝（fail-closed）——只有明确「没有」才放行。
  if (action_type === 'ads.reactivate_campaign') {
    const draftCheck = await checkMessengerDraftCampaign(supabaseAdmin, String(campaign_id))
    if (draftCheck === 'is_messenger_draft') {
      return NextResponse.json(
        { error: MESSENGER_REACTIVATE_BLOCKED_MESSAGE, code: 'messenger_reactivate_blocked' },
        { status: 422 },
      )
    }
    if (draftCheck !== 'not_messenger_draft') {
      return NextResponse.json(
        { error: MESSENGER_LOOKUP_FAILED_MESSAGE, code: 'messenger_draft_lookup_failed' },
        { status: 422 },
      )
    }
  }

  const before = {
    status:       beforeDetails.status,
    name:         beforeDetails.name,
    daily_budget: beforeDetails.daily_budget ?? null,
  }

  // Resolve the outcome metric from the campaign's own objective BEFORE
  // touching Meta, so a resolver problem can never leave an executed change
  // without an audit row. A sales campaign is graded on ROAS, a Messenger
  // campaign on cost per conversation — the old code promised nothing at all,
  // which is why every action here produced zero outcomes.
  const expectedMetric = action_type === ADS_ACTION_TYPE.ADJUST_BID
    ? null
    : resolveAndLogAdsExpectedMetric({ objective: beforeDetails.objective }, 'meta-ads/execute')

  // ── Execute action ────────────────────────────────────────────────────────
  let after: typeof before
  let metaSuccess = false

  if (action_type === ADS_ACTION_TYPE.PAUSE_CAMPAIGN) {
    metaSuccess = await setCampaignStatus(campaign_id, accessToken, 'PAUSED')
    after = { ...before, status: 'PAUSED' }
  } else if (action_type === 'ads.reactivate_campaign') {
    return reactivateWithReceipt({
      clientId,
      campaignId: String(campaign_id),
      accessToken,
      before,
      expectedMetric,
      executionItemId: actionParams.execution_item_id ?? null,
      authority: activationAuthority,
    })
  } else if (action_type === ADS_ACTION_TYPE.ADJUST_BID) {
    const newBudget = actionParams.new_daily_budget
    if (typeof newBudget !== 'number' || !Number.isFinite(newBudget) || newBudget <= 0) {
      return NextResponse.json(
        { error: 'params.new_daily_budget (positive number in whole currency units) is required for adjust_bid' },
        { status: 400 },
      )
    }
    if (!beforeDetails.daily_budget) {
      return NextResponse.json(
        { error: 'This campaign has no campaign-level daily budget (likely using ad set budgets). Adjust budget directly in Meta Ads Manager.' },
        { status: 422 },
      )
    }
    // Kernel and Meta use the account's minor currency unit (two decimals for AU/NZ accounts).
    const budgetCents = Math.round(newBudget * 100)
    if (!Number.isSafeInteger(budgetCents)) {
      return NextResponse.json({ error: 'params.new_daily_budget is outside the supported range' }, { status: 400 })
    }

    const currentCents = Number(beforeDetails.daily_budget)
    if (!Number.isSafeInteger(currentCents) || currentCents <= 0) {
      return NextResponse.json(
        { error: 'Meta returned an invalid campaign budget; the change was not submitted.' },
        { status: 422 },
      )
    }
    if (budgetCents > currentCents) {
      return NextResponse.json(
        { error: '这个入口目前只支持降低广告系列日预算；上调预算暂不开放。', code: 'campaign_budget_increase_not_supported' },
        { status: 422 },
      )
    }
    if (actionParams.execution_item_id !== undefined && typeof actionParams.execution_item_id !== 'string') {
      return NextResponse.json({ error: 'params.execution_item_id must be a string' }, { status: 400 })
    }

    // Meta 返回纯数字账户号，内核和库都用 act_ 形式（2026-10-19 止损路由 503 同根缺陷）。
    const adAccountId = toActAccountId(beforeDetails.account_id)
    if (!adAccountId) return NextResponse.json({ error: 'account_id_unreadable' }, { status: 503 })
    const submitted = await queueAdsCampaignBudgetDecrease(createKernel(supabaseAdmin), {
      clientId,
      access,
      cycleDate: nzToday(new Date()),
      adAccountId,
      campaignId: campaign_id,
      afterCents: budgetCents,
      executionItemId: actionParams.execution_item_id ?? null,
    })
    try {
      await inngest.send({
        name: ADS_CAMPAIGN_BUDGET_DECREASE_REQUESTED,
        data: { client_id: clientId, action_run_id: submitted.run.id },
      })
    } catch (error) {
      console.error('[meta-ads/execute] Inngest dispatch failed:', error)
      return NextResponse.json({
        error: '预算操作已登记，但暂时无法排入执行队列；请重试。',
        actionRunId: submitted.run.id,
        kind: 'queue_failed',
      }, { status: 503 })
    }
    return NextResponse.json({
      success: true,
      status: 'queued',
      actionRunId: submitted.run.id,
      campaignId: campaign_id,
      before,
      after: { ...before, daily_budget: String(budgetCents) },
    }, { status: 202 })
  } else {
    return NextResponse.json({ error: 'Unhandled action type' }, { status: 422 })
  }

  if (!metaSuccess) {
    return NextResponse.json(
      { error: 'Meta Graph API call failed. The action was NOT executed. Check server logs.' },
      { status: 502 },
    )
  }

  // ── Write flywheel_actions record ─────────────────────────────────────────
  const { data: actionRow, error: dbError } = await supabaseAdmin
    .from('flywheel_actions')
    .insert({
      client_id:        clientId,
      execution_item_id: actionParams.execution_item_id ?? null,
      flywheel:         'ads',
      action_type,
      execution_mode:   'third_party',
      vendor:           'meta',
      payload: {
        campaign_id,
        before,
        after,
      },
      expected_metric: expectedMetric,
    })
    .select('id, executed_at')
    .single()

  if (dbError || !actionRow) {
    console.error('[meta-ads/execute] DB insert error:', dbError?.message)
    // Action WAS executed on Meta — return partial success so UI can show it
    return NextResponse.json(
      {
        success: true,
        warning: 'Action executed on Meta but audit record failed to save.',
        campaignId: campaign_id,
        before,
        after,
      },
      { status: 200 },
    )
  }

  return NextResponse.json({
    success:    true,
    actionId:   (actionRow as { id: string }).id,
    campaignId: campaign_id,
    before,
    after,
  })
}

/** Poll the Kernel receipt; authorization is scoped to the same client as the run. */
export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const clientId = params.id
  const access = await requireAdsCampaignBudgetAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const actionRunId = req.nextUrl.searchParams.get('runId')
  if (!actionRunId || !/^[0-9a-f-]{36}$/i.test(actionRunId)) {
    return NextResponse.json({ error: 'runId is required' }, { status: 400 })
  }
  const { data: run, error } = await supabaseAdmin.from('action_runs')
    .select('id, client_id, action_key, status, last_error')
    .eq('id', actionRunId).eq('client_id', clientId).maybeSingle()
  if (error) return NextResponse.json({ error: 'Could not read the action status.' }, { status: 503 })
  if (!run || run.action_key !== 'ads.cut_campaign_budget') {
    return NextResponse.json({ error: 'Action run not found.' }, { status: 404 })
  }
  const { data: receipt, error: receiptError } = await supabaseAdmin.from('flywheel_actions')
    .select('id, payload')
    .eq('client_id', clientId).eq('payload->>action_run_id', actionRunId).maybeSingle()
  if (receiptError) return NextResponse.json({ error: 'Could not read the action receipt.' }, { status: 503 })
  return NextResponse.json({
    status: (receipt?.payload as { status?: string } | null)?.status === 'workflow_failed'
      ? 'workflow_failed'
      : run.status,
    humanReason: run.last_error,
    receipt: receipt ?? null,
  })
}

interface ReactivateInput {
  readonly clientId: string
  readonly campaignId: string
  readonly accessToken: string
  readonly before: { status: string | undefined; name: string | undefined; daily_budget: string | null }
  readonly expectedMetric: ReturnType<typeof resolveAndLogAdsExpectedMetric> | null
  readonly executionItemId: string | null
  readonly authority: SpendActivationAuthority | null
}

/**
 * Receipt first, Meta second: the PM authorisation is written to flywheel_actions
 * before the campaign is switched ON. No receipt → no Meta call.
 */
async function reactivateWithReceipt(input: ReactivateInput): Promise<NextResponse> {
  if (!input.authority) {
    return NextResponse.json({ error: '缺少 PM 授权，未重开。', code: 'activation_requires_pm' }, { status: 403 })
  }
  const receipt = buildSpendActivationReceipt({
    authority: input.authority,
    entry: 'meta-ads/execute',
    clientId: input.clientId,
    campaignId: input.campaignId,
  })
  const after = { ...input.before, status: 'ACTIVE' }
  const basePayload = { campaign_id: input.campaignId, before: input.before, after, authorization: receipt }
  const { data: row, error: insertError } = await supabaseAdmin
    .from('flywheel_actions')
    .insert({
      client_id: input.clientId,
      execution_item_id: input.executionItemId,
      flywheel: 'ads',
      action_type: 'ads.reactivate_campaign',
      execution_mode: 'third_party',
      vendor: 'meta',
      payload: { ...basePayload, status: 'authorized_pending' },
      expected_metric: null,
    })
    .select('id')
    .single()
  if (insertError || !row) {
    console.error('[meta-ads/execute] reactivate receipt insert failed:', insertError?.message)
    return NextResponse.json(
      { error: '重开回执写不进去，已拒绝，Meta 没有被调用。', code: 'activation_receipt_failed' },
      { status: 503 },
    )
  }
  const actionId = (row as { id: string }).id
  const metaSuccess = await setCampaignStatus(input.campaignId, input.accessToken, 'ACTIVE')
  const { error: updateError } = await supabaseAdmin
    .from('flywheel_actions')
    .update(metaSuccess
      ? { payload: { ...basePayload, status: 'executed' }, expected_metric: input.expectedMetric }
      : { payload: { ...basePayload, status: 'meta_failed' } })
    .eq('id', actionId)
  if (updateError) console.error('[meta-ads/execute] reactivate receipt update failed:', updateError.message)
  if (!metaSuccess) {
    return NextResponse.json(
      { error: 'Meta Graph API call failed. The action was NOT executed. Check server logs.', actionId },
      { status: 502 },
    )
  }
  return NextResponse.json({
    success: true,
    actionId,
    campaignId: input.campaignId,
    before: input.before,
    after,
    ...(updateError ? { warning: 'Campaign reactivated; receipt still shows authorized_pending.' } : {}),
  })
}
