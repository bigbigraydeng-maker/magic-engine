/**
 * POST /api/clients/[id]/google-ads/execute
 *
 * P18.B — Execute a Google Ads action (pause/enable campaign, adjust budget,
 * add negative keyword).
 *
 * Body JSON:
 *   action_type         — 'ads.pause_campaign' | 'ads.adjust_bid' | 'ads.add_negative_keyword'
 *                         | 'google_ads.reactivate_campaign'
 *   campaign_id         — Google Ads campaign ID (numeric string, no dashes)
 *   google_ads_customer_id  — 10-digit account ID (no dashes), e.g. "1234567890"
 *   params?:
 *     new_daily_budget_micros?   — (adjust_bid) new daily budget in micro-units
 *     budget_resource_name?      — (adjust_bid) e.g. "customers/123/campaignBudgets/456"
 *     keyword_text?              — (add_negative_keyword) keyword string
 *     keyword_match_type?        — (add_negative_keyword) 'BROAD' | 'PHRASE' | 'EXACT'
 *     execution_item_id?         — link to flywheel execution item
 *
 * Responses:
 *   200 { success, actionId, campaignId, before, after }
 *   400 missing required fields
 *   422 unsupported action, budget out of safe range, missing budget resource
 *   424 Google Ads credentials not configured
 *   502 Google Ads API call failed
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import {
  loadGoogleAdsCreds,
  getCampaign,
  setCampaignStatus,
  setCampaignBudget,
  addCampaignNegativeKeyword,
} from '@/lib/google-ads/client'
import { checkBudgetWithinSafeRange, microsToDisplay } from '@/lib/google-ads/guardrails'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'

// P18.B supported action types
const SUPPORTED_ACTION_TYPES = new Set([
  ADS_ACTION_TYPE.PAUSE_CAMPAIGN,
  ADS_ACTION_TYPE.ADJUST_BID,
  ADS_ACTION_TYPE.ADD_NEGATIVE_KEYWORD,
  ADS_ACTION_TYPE.REACTIVATE_CAMPAIGN,
])

interface RouteParams {
  params: { id: string }
}

interface ExecuteBody {
  action_type:            string
  campaign_id:            string
  google_ads_customer_id: string
  params?: {
    new_daily_budget_micros?: number
    budget_resource_name?:    string
    keyword_text?:            string
    keyword_match_type?:      'BROAD' | 'PHRASE' | 'EXACT'
    execution_item_id?:       string
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

  const { action_type, campaign_id, google_ads_customer_id, params: actionParams = {} } = body

  if (!action_type || !campaign_id || !google_ads_customer_id) {
    return NextResponse.json(
      { error: 'action_type, campaign_id, and google_ads_customer_id are required' },
      { status: 400 },
    )
  }

  // Validate numeric format to prevent GAQL injection (GAQL does not support parameterised queries)
  if (!/^\d{1,15}$/.test(campaign_id)) {
    return NextResponse.json(
      { error: 'campaign_id must be a numeric string (1–15 digits)' },
      { status: 400 },
    )
  }
  if (!/^\d{1,15}$/.test(google_ads_customer_id)) {
    return NextResponse.json(
      { error: 'google_ads_customer_id must be a numeric string (1–15 digits)' },
      { status: 400 },
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!SUPPORTED_ACTION_TYPES.has(action_type as any)) {
    return NextResponse.json(
      {
        error: `Unsupported action_type: "${action_type}". Supported: ${Array.from(SUPPORTED_ACTION_TYPES).join(', ')}`,
      },
      { status: 422 },
    )
  }

  // TODO P18.D: Validate google_ads_customer_id against clients.google_ads_customer_id column
  // to prevent IDOR — currently trusts caller-supplied value (acceptable at P18.B skeleton stage).

  // ── Credentials ───────────────────────────────────────────────────────────
  const creds = loadGoogleAdsCreds(google_ads_customer_id)
  if (!creds) {
    return NextResponse.json(
      {
        error:
          'Google Ads credentials are not configured. ' +
          'Add GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, ' +
          'GOOGLE_ADS_CLIENT_SECRET, and GOOGLE_ADS_REFRESH_TOKEN to Render environment variables.',
      },
      { status: 424 },
    )
  }

  // ── Fetch before-state ────────────────────────────────────────────────────
  const campaign = await getCampaign(creds, campaign_id)
  if (!campaign) {
    return NextResponse.json(
      { error: 'Failed to fetch campaign from Google Ads. Check campaign ID and credentials.' },
      { status: 502 },
    )
  }

  const before = {
    status:         campaign.status,
    name:           campaign.name,
    budget_micros:  campaign.campaignBudget?.amountMicros ?? null,
  }

  // ── Execute action ────────────────────────────────────────────────────────
  let after: typeof before
  let apiSuccess = false

  if (action_type === ADS_ACTION_TYPE.PAUSE_CAMPAIGN) {
    apiSuccess = await setCampaignStatus(creds, campaign_id, 'PAUSED')
    after = { ...before, status: 'PAUSED' }

  } else if (action_type === ADS_ACTION_TYPE.REACTIVATE_CAMPAIGN) {
    apiSuccess = await setCampaignStatus(creds, campaign_id, 'ENABLED')
    after = { ...before, status: 'ENABLED' }

  } else if (action_type === ADS_ACTION_TYPE.ADJUST_BID) {
    const newMicros = actionParams.new_daily_budget_micros
    const budgetResourceName = actionParams.budget_resource_name

    if (typeof newMicros !== 'number' || newMicros <= 0) {
      return NextResponse.json(
        { error: 'params.new_daily_budget_micros (positive integer) is required for adjust_bid' },
        { status: 400 },
      )
    }
    if (!budgetResourceName) {
      return NextResponse.json(
        { error: 'params.budget_resource_name is required for adjust_bid (e.g. "customers/123/campaignBudgets/456")' },
        { status: 400 },
      )
    }
    if (!campaign.campaignBudget?.amountMicros) {
      return NextResponse.json(
        {
          error:
            'This campaign has no campaign-level budget (likely using ad group budgets). ' +
            'Adjust budget directly in Google Ads Manager.',
        },
        { status: 422 },
      )
    }

    const currentMicros = parseInt(campaign.campaignBudget.amountMicros, 10)
    const guard = checkBudgetWithinSafeRange(currentMicros, newMicros)

    if (!guard.ok) {
      return NextResponse.json(
        {
          error:
            `Budget change exceeds the ±20% safety limit. ` +
            `Current daily budget is ${microsToDisplay(currentMicros)}; ` +
            `allowed range is ${microsToDisplay(guard.allowedMinMicros)}–${microsToDisplay(guard.allowedMaxMicros)}. ` +
            `Larger changes require manual review (Talk to Us).`,
          code:             'exceeds_safe_adjustment',
          current_budget_micros: currentMicros,
          allowed_min_micros:    guard.allowedMinMicros,
          allowed_max_micros:    guard.allowedMaxMicros,
        },
        { status: 422 },
      )
    }

    apiSuccess = await setCampaignBudget(creds, budgetResourceName, newMicros)
    after = { ...before, budget_micros: String(Math.round(newMicros)) }

  } else if (action_type === ADS_ACTION_TYPE.ADD_NEGATIVE_KEYWORD) {
    const keywordText = actionParams.keyword_text
    if (!keywordText || typeof keywordText !== 'string' || keywordText.trim() === '') {
      return NextResponse.json(
        { error: 'params.keyword_text (non-empty string) is required for add_negative_keyword' },
        { status: 400 },
      )
    }

    const matchType = actionParams.keyword_match_type ?? 'BROAD'
    const resourceName = await addCampaignNegativeKeyword(
      creds,
      campaign_id,
      keywordText.trim(),
      matchType,
    )
    apiSuccess = resourceName !== null
    after = before  // campaign-level fields unchanged; negative keyword is recorded in payload

  } else {
    return NextResponse.json({ error: 'Unhandled action type' }, { status: 422 })
  }

  if (!apiSuccess) {
    return NextResponse.json(
      { error: 'Google Ads API call failed. The action was NOT executed. Check server logs.' },
      { status: 502 },
    )
  }

  // ── Write flywheel_actions record ─────────────────────────────────────────
  const { data: actionRow, error: dbError } = await supabaseAdmin
    .from('flywheel_actions')
    .insert({
      client_id:         clientId,
      execution_item_id: actionParams.execution_item_id ?? null,
      flywheel:          'ads',
      action_type,
      execution_mode:    'third_party',
      vendor:            'google_ads',
      payload: {
        campaign_id,
        google_ads_customer_id,
        before,
        after,
        keyword_text:       actionParams.keyword_text ?? null,
        keyword_match_type: actionParams.keyword_match_type ?? null,
      },
    })
    .select('id, executed_at')
    .single()

  if (dbError || !actionRow) {
    console.error('[google-ads/execute] DB insert error:', dbError?.message)
    return NextResponse.json(
      {
        success: true,
        warning: 'Action executed on Google Ads but audit record failed to save.',
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
