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
 *   422 action not supported or campaign has no daily_budget (for adjust_bid)
 *   424 META_SYSTEM_USER_TOKEN not configured
 *   502 Meta Graph API call failed
 *
 * Before/after are stored in flywheel_actions.payload for audit and undo.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import {
  getCampaignDetails,
  setCampaignStatus,
  setCampaignDailyBudget,
} from '@/lib/meta/client'
import { checkBudgetWithinSafeRange } from '@/lib/meta/guardrails'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'

const SUPPORTED_ACTION_TYPES = new Set([
  ADS_ACTION_TYPE.PAUSE_CAMPAIGN,
  ADS_ACTION_TYPE.ADJUST_BID,
  'ads.reactivate_campaign',   // undo of pause — not in vocab (undo path only)
])

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

  // ── Auth ─────────────────────────────────────────────────────────────────
  const access = await requirePaidClientAccess(clientId)
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

  const { action_type, campaign_id, params: actionParams = {} } = body

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

  // ── Token ─────────────────────────────────────────────────────────────────
  const accessToken = process.env.META_SYSTEM_USER_TOKEN
  if (!accessToken) {
    return NextResponse.json(
      { error: 'META_SYSTEM_USER_TOKEN is not configured. Add it to Render environment variables.' },
      { status: 424 },
    )
  }

  // ── Fetch before-state ────────────────────────────────────────────────────
  const beforeDetails = await getCampaignDetails(campaign_id, accessToken)
  if (!beforeDetails) {
    return NextResponse.json(
      { error: 'Failed to fetch campaign details from Meta. Check campaign ID and token.' },
      { status: 502 },
    )
  }

  const before = {
    status:       beforeDetails.status,
    name:         beforeDetails.name,
    daily_budget: beforeDetails.daily_budget ?? null,
  }

  // ── Execute action ────────────────────────────────────────────────────────
  let after: typeof before
  let metaSuccess = false

  if (action_type === ADS_ACTION_TYPE.PAUSE_CAMPAIGN) {
    metaSuccess = await setCampaignStatus(campaign_id, accessToken, 'PAUSED')
    after = { ...before, status: 'PAUSED' }
  } else if (action_type === 'ads.reactivate_campaign') {
    metaSuccess = await setCampaignStatus(campaign_id, accessToken, 'ACTIVE')
    after = { ...before, status: 'ACTIVE' }
  } else if (action_type === ADS_ACTION_TYPE.ADJUST_BID) {
    const newBudget = actionParams.new_daily_budget
    if (typeof newBudget !== 'number' || newBudget <= 0) {
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
    // Meta API expects budget in minor currency units (cents for USD/AUD)
    const budgetCents = Math.round(newBudget * 100)

    // ±20% hard safety limit — larger swings must go through Talk to Us (manual review)
    const currentCents = parseInt(beforeDetails.daily_budget, 10)
    const guard = checkBudgetWithinSafeRange(currentCents, budgetCents)
    if (!guard.ok) {
      return NextResponse.json(
        {
          error:
            `Budget change exceeds the ±20% safety limit. ` +
            `Current daily budget is $${(currentCents / 100).toFixed(2)}; ` +
            `allowed range is $${(guard.allowedMinCents / 100).toFixed(2)}–$${(guard.allowedMaxCents / 100).toFixed(2)}. ` +
            `Larger changes require manual review (Talk to Us).`,
          code: 'exceeds_safe_adjustment',
          current_daily_budget: currentCents,
          allowed_min: guard.allowedMinCents,
          allowed_max: guard.allowedMaxCents,
        },
        { status: 422 },
      )
    }

    metaSuccess = await setCampaignDailyBudget(campaign_id, accessToken, budgetCents)
    after = { ...before, daily_budget: String(budgetCents) }
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
