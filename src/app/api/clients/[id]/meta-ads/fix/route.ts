/**
 * POST /api/clients/[id]/meta-ads/fix
 *
 * P18.A.2 + P18.A.3: Execute a safe ads mutation via Meta Graph API and
 * record the action in flywheel_actions with before/after audit payload.
 *
 * Supported actions:
 *   pause_campaign  — pause a campaign by ID
 *   pause_ad_set    — pause an ad set by ID
 *   adjust_bid      — adjust an ad set bid (±20% cap enforced)
 *
 * Body:
 *   action:       'pause_campaign' | 'pause_ad_set' | 'adjust_bid'
 *   entity_id:    Meta campaign_id or ad_set_id
 *   new_bid_cents?: number  (required for adjust_bid only)
 *   execution_item_id?: string
 *   expected_metric?: string
 *   expected_delta?:  number
 *
 * Response 201: { flywheel_action_id, before, after, capped? }
 * Security: requireDashboardClientAccess
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import {
  fetchCampaignState,
  fetchAdSetState,
  pauseEntity,
  adjustAdSetBid,
  buildAuditPayload,
} from '@/lib/meta/executor'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'

type FixAction = 'pause_campaign' | 'pause_ad_set' | 'adjust_bid'

interface FixBody {
  action: FixAction
  entity_id: string
  new_bid_cents?: number
  execution_item_id?: string
  expected_metric?: string
  expected_delta?: number
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const clientId = params.id

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  if (!process.env.META_SYSTEM_USER_TOKEN) {
    return NextResponse.json({ error: 'META_SYSTEM_USER_TOKEN not configured.' }, { status: 424 })
  }

  let body: FixBody
  try {
    body = await req.json() as FixBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { action, entity_id } = body
  if (!action || !entity_id) {
    return NextResponse.json({ error: 'action and entity_id are required' }, { status: 400 })
  }

  // ── Fetch before-state ────────────────────────────────────────────────────

  const isAdSet = action === 'pause_ad_set' || action === 'adjust_bid'
  const beforeState = isAdSet
    ? await fetchAdSetState(entity_id)
    : await fetchCampaignState(entity_id)

  if (!beforeState) {
    return NextResponse.json(
      { error: `Could not fetch current state for entity ${entity_id}. Check entity ID and token permissions.` },
      { status: 502 },
    )
  }

  // ── Execute mutation ──────────────────────────────────────────────────────

  let mutationOk = false
  let capped     = false
  let appliedBid: number | undefined

  if (action === 'pause_campaign' || action === 'pause_ad_set') {
    mutationOk = await pauseEntity(entity_id)
  } else if (action === 'adjust_bid') {
    if (body.new_bid_cents == null) {
      return NextResponse.json({ error: 'new_bid_cents is required for adjust_bid' }, { status: 400 })
    }
    const currentBid = beforeState.bid_amount_cents ?? 0
    if (currentBid === 0) {
      return NextResponse.json({ error: 'Ad set has no manual bid; cannot adjust.' }, { status: 422 })
    }
    const result = await adjustAdSetBid(entity_id, body.new_bid_cents, currentBid)
    mutationOk = result.success
    capped     = result.capped
    appliedBid = result.appliedBid
  }

  if (!mutationOk) {
    return NextResponse.json({ error: 'Meta Graph API call failed. Check server logs.' }, { status: 502 })
  }

  // ── Build after-state ─────────────────────────────────────────────────────

  const afterState = { ...beforeState }
  if (action === 'pause_campaign' || action === 'pause_ad_set') {
    afterState.status           = 'PAUSED'
    afterState.effective_status = 'PAUSED'
  } else if (action === 'adjust_bid' && appliedBid != null) {
    afterState.bid_amount_cents = appliedBid
  }

  const entityType = isAdSet ? 'ad_set' as const : 'campaign' as const
  const auditPayload = buildAuditPayload(entityType, entity_id, beforeState, afterState)

  // ── Map action to flywheel vocabulary ────────────────────────────────────

  const actionTypeMap: Record<FixAction, string> = {
    pause_campaign: ADS_ACTION_TYPE.PAUSE_CAMPAIGN,
    pause_ad_set:   ADS_ACTION_TYPE.PAUSE_AD_SET,
    adjust_bid:     ADS_ACTION_TYPE.ADJUST_BID,
  }

  // ── Write flywheel_action ─────────────────────────────────────────────────

  const { data: actionRow, error: insertErr } = await supabaseAdmin
    .from('flywheel_actions')
    .insert({
      client_id:          clientId,
      execution_item_id:  body.execution_item_id ?? null,
      flywheel:           'ads',
      action_type:        actionTypeMap[action],
      execution_mode:     'third_party',
      vendor:             'meta',
      payload:            auditPayload,
      expected_metric:    body.expected_metric   ?? null,
      expected_delta:     body.expected_delta    ?? null,
    })
    .select('id')
    .single()

  if (insertErr || !actionRow) {
    console.error('[meta-ads/fix] flywheel_actions insert error:', insertErr?.message)
    return NextResponse.json({ error: 'Action executed but audit log failed.' }, { status: 207 })
  }

  return NextResponse.json(
    {
      flywheel_action_id: actionRow.id,
      before:             auditPayload.before,
      after:              auditPayload.after,
      rollback_action:    auditPayload.rollback_action,
      ...(capped ? { capped: true, applied_bid_cents: appliedBid } : {}),
    },
    { status: 201 },
  )
}
