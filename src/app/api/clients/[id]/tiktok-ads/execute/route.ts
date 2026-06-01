/**
 * POST /api/clients/[id]/tiktok-ads/execute
 *
 * P18.C.2+3: Execute a TikTok Ads action (pause, reactivate, adjust budget).
 *
 * Body JSON:
 *   action_type             — 'ads.pause_campaign' | 'ads.adjust_bid' | 'ads.reactivate_campaign'
 *   campaign_id             — TikTok campaign ID string
 *   tiktok_advertiser_id    — TikTok advertiser account ID (overrides env)
 *   params?                 — extra params:
 *     new_daily_budget        (adjust_bid only) — new daily budget in whole currency units (AUD/NZD)
 *     execution_item_id       — optional link to flywheel execution item
 *
 * Responses:
 *   200  { success, actionId, campaignId, before, after }
 *   400  missing required fields
 *   422  unsupported action_type / budget out of ±20% safe range
 *   424  TIKTOK_ADS_ACCESS_TOKEN not configured
 *   502  TikTok Marketing API call failed
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import {
  getCampaign,
  setCampaignStatus,
  setCampaignBudget,
  loadTikTokAdsCreds,
} from '@/lib/tiktok-ads/client'
import { checkBudgetWithinSafeRange } from '@/lib/tiktok-ads/guardrails'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'

const SUPPORTED_ACTION_TYPES = new Set([
  ADS_ACTION_TYPE.PAUSE_CAMPAIGN,
  ADS_ACTION_TYPE.ADJUST_BID,
  ADS_ACTION_TYPE.REACTIVATE_CAMPAIGN,
])

interface RouteParams {
  params: { id: string }
}

interface ExecuteBody {
  action_type:           string
  campaign_id:           string
  tiktok_advertiser_id?: string
  params?: {
    new_daily_budget?:   number
    execution_item_id?:  string
  }
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const clientId = params.id

  // ── Auth ─────────────────────────────────────────────────────────────────
  const access = await requireDashboardClientAccess(clientId)
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

  const { action_type, campaign_id, tiktok_advertiser_id, params: actionParams = {} } = body

  if (!action_type || !campaign_id) {
    return NextResponse.json(
      { error: 'action_type and campaign_id are required' },
      { status: 400 },
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!SUPPORTED_ACTION_TYPES.has(action_type as any)) {
    return NextResponse.json(
      {
        error: `Unsupported action_type: "${action_type}". ` +
               `Supported: ${Array.from(SUPPORTED_ACTION_TYPES).join(', ')}`,
      },
      { status: 422 },
    )
  }

  // TODO P18.D: Validate tiktok_advertiser_id against clients.tiktok_ad_account_id
  // to prevent IDOR — currently trusts caller-supplied value (acceptable at P18.C skeleton stage).

  // ── Credentials ───────────────────────────────────────────────────────────
  const creds = loadTikTokAdsCreds(tiktok_advertiser_id)
  if (!creds) {
    const missing: string[] = []
    if (!process.env.TIKTOK_ADS_ACCESS_TOKEN) missing.push('TIKTOK_ADS_ACCESS_TOKEN')
    if (!tiktok_advertiser_id && !process.env.TIKTOK_ADS_ADVERTISER_ID) {
      missing.push('tiktok_advertiser_id (body) or TIKTOK_ADS_ADVERTISER_ID (env)')
    }
    return NextResponse.json(
      { error: `TikTok Ads not configured. Missing: ${missing.join(', ')}` },
      { status: 424 },
    )
  }

  // ── Fetch before-state ────────────────────────────────────────────────────
  let beforeDetails: Awaited<ReturnType<typeof getCampaign>>
  try {
    beforeDetails = await getCampaign(creds, campaign_id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `TikTok API error: ${msg}` }, { status: 502 })
  }
  if (!beforeDetails) {
    return NextResponse.json(
      { error: 'Failed to fetch campaign details from TikTok. Check campaign_id and access token.' },
      { status: 502 },
    )
  }

  const before = {
    campaign_id:   beforeDetails.campaign_id,
    campaign_name: beforeDetails.campaign_name,
    status:        beforeDetails.status,
    budget:        beforeDetails.budget,
    budget_mode:   beforeDetails.budget_mode,
  }

  // ── Execute action ────────────────────────────────────────────────────────
  let after: typeof before
  let actionSuccess: boolean

  try {
    if (action_type === ADS_ACTION_TYPE.PAUSE_CAMPAIGN) {
      actionSuccess = await setCampaignStatus(creds, campaign_id, 'DISABLE')
      after = { ...before, status: 'DISABLE' }

    } else if (action_type === ADS_ACTION_TYPE.REACTIVATE_CAMPAIGN) {
      actionSuccess = await setCampaignStatus(creds, campaign_id, 'ENABLE')
      after = { ...before, status: 'ENABLE' }

    } else if (action_type === ADS_ACTION_TYPE.ADJUST_BID) {
      const newBudget = actionParams.new_daily_budget
      if (!newBudget || newBudget <= 0) {
        return NextResponse.json(
          { error: 'params.new_daily_budget is required and must be positive for ads.adjust_bid' },
          { status: 400 },
        )
      }

      if (before.budget_mode === 'BUDGET_MODE_INFINITE') {
        return NextResponse.json(
          { error: 'Cannot adjust budget: campaign uses BUDGET_MODE_INFINITE (no daily budget)' },
          { status: 422 },
        )
      }

      // Safety guardrail: ±20% limit
      const guardrail = checkBudgetWithinSafeRange(before.budget, newBudget)
      if (!guardrail.ok) {
        return NextResponse.json(
          { error: guardrail.reason, minBudget: guardrail.minBudget, maxBudget: guardrail.maxBudget },
          { status: 422 },
        )
      }

      actionSuccess = await setCampaignBudget(creds, campaign_id, newBudget)
      after = { ...before, budget: newBudget }

    } else {
      // Should never reach here — SUPPORTED_ACTION_TYPES guard above
      return NextResponse.json({ error: 'Internal: unhandled action_type' }, { status: 500 })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `TikTok API error: ${msg}` }, { status: 502 })
  }

  if (!actionSuccess) {
    return NextResponse.json(
      { error: 'TikTok Marketing API returned an error for this operation. Check campaign status and permissions.' },
      { status: 502 },
    )
  }

  // ── Record in flywheel_actions ────────────────────────────────────────────
  const { data: actionRow, error: insertErr } = await supabaseAdmin
    .from('flywheel_actions')
    .insert({
      client_id:         clientId,
      execution_item_id: actionParams.execution_item_id ?? null,
      flywheel:          'ads',
      action_type,
      execution_mode:    'third_party',
      vendor:            'tiktok_ads',
      payload:           { before, after, advertiser_id: creds.advertiserId },
    })
    .select('id')
    .single()

  if (insertErr) {
    // Non-fatal: the action succeeded, only the audit log failed
    console.error('[tiktok-ads/execute] flywheel_actions insert error:', insertErr.message)
  }

  return NextResponse.json({
    success:    true,
    actionId:   actionRow?.id ?? null,
    campaignId: campaign_id,
    before,
    after,
  })
}
