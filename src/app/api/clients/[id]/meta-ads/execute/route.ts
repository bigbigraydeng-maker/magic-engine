/**
 * POST /api/clients/[id]/meta-ads/execute
 *
 * Pause or resume a campaign by asking for a confirmation card.
 * ads.adjust_bid is closed: a daily budget change only happens from a confirmation card.
 *
 * Body JSON:
 *   action_type       — 'ads.pause_campaign' | 'ads.reactivate_campaign'
 *   campaign_id       — Meta campaign ID string (no "act_" prefix)
 *   params?           — extra params by action type:
 *     execution_item_id — optional link to flywheel execution item
 *
 * Responses:
 *   202 pause / resume asks for a confirmation card and does not write Meta
 *   400 missing required fields
 *   403 campaign_id does not belong to this client's registered ad account (AD-SEC-1)
 *   422 action not supported, direct budget change, or reactivate of an ME Messenger draft campaign
 *   424 META_SYSTEM_USER_TOKEN not configured
 *
 * Before/after are stored in flywheel_actions.payload for audit and undo.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdsCampaignBudgetAccess } from '@/lib/action-submission/ads-campaign-budget'
import { requestCampaignStatusCard } from '@/lib/action-submission/campaign-status-card'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { assertCampaignOwnedByClient } from '@/lib/meta/campaign-ownership'
import { toActAccountId } from '@/lib/meta/ad-account-binding'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import {
  checkMessengerDraftCampaign,
  MESSENGER_REACTIVATE_BLOCKED_MESSAGE,
  MESSENGER_LOOKUP_FAILED_MESSAGE,
} from '@/lib/ads-strategy/messenger-draft-campaign-guard'
import { rejectAgentAdsMetaExecute } from '@/lib/auth/agent-ads-guard'
import { publicError } from '@/lib/confirmation-card/http'

const SUPPORTED_ACTION_TYPES = new Set([
  ADS_ACTION_TYPE.PAUSE_CAMPAIGN,
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

  // Closed before token, ownership, and queue. A budget change only starts from a confirmation card.
  if (action_type === ADS_ACTION_TYPE.ADJUST_BID) {
    return NextResponse.json(
      {
        error: '直接改日预算已关闭。改广告预算只能走确认卡。',
        code: 'direct_budget_change_closed',
      },
      { status: 422 },
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

  // Pause and resume only ask for a card here. The spend approver is checked
  // when someone confirms a resume, not when a paid client asks.

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

  if (action_type === ADS_ACTION_TYPE.PAUSE_CAMPAIGN || action_type === 'ads.reactivate_campaign') {
    const adAccountId = toActAccountId(beforeDetails.account_id)
    if (!adAccountId) return NextResponse.json({ error: 'account_id_unreadable' }, { status: 503 })
    try {
      const asked = await requestCampaignStatusCard(supabaseAdmin, {
        clientId,
        access,
        kind: action_type === ADS_ACTION_TYPE.PAUSE_CAMPAIGN ? 'pause' : 'resume',
        campaignId: String(campaign_id),
        adAccountId,
        name: before.name ?? '',
        liveStatus: before.status ?? '',
        dailyBudget: before.daily_budget,
        objective: beforeDetails.objective ?? null,
        executionItemId: actionParams.execution_item_id ?? null,
      })
      return NextResponse.json(asked.body, { status: asked.status })
    } catch (error) {
      const mapped = publicError(error)
      return NextResponse.json({ error: mapped.message }, { status: mapped.status })
    }
  }

  return NextResponse.json({ error: 'Unhandled action type' }, { status: 422 })
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

