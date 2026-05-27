/**
 * POST /api/clients/[id]/meta-ads/rollback
 *
 * P18.A.3: Rollback a previously executed Meta Ads fix operation.
 * Reads the before-state from flywheel_actions.payload and restores it.
 *
 * Body: { flywheel_action_id: string }
 * Response 200: { restored, entity_id, action_type }
 * Security: requireDashboardClientAccess
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { restoreActive, adjustAdSetBid } from '@/lib/meta/executor'
import type { AuditPayload } from '@/lib/meta/executor'

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

  let body: { flywheel_action_id: string }
  try {
    body = await req.json() as { flywheel_action_id: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.flywheel_action_id) {
    return NextResponse.json({ error: 'flywheel_action_id is required' }, { status: 400 })
  }

  // ── Fetch the original action ─────────────────────────────────────────────

  const { data: actionRow, error: fetchErr } = await supabaseAdmin
    .from('flywheel_actions')
    .select('id, client_id, action_type, payload')
    .eq('id', body.flywheel_action_id)
    .eq('client_id', clientId)
    .eq('flywheel', 'ads')
    .single()

  if (fetchErr || !actionRow) {
    return NextResponse.json({ error: 'Action not found for this client' }, { status: 404 })
  }

  const auditPayload = actionRow.payload as AuditPayload | null
  if (!auditPayload?.rollback_action || auditPayload.rollback_action === 'none') {
    return NextResponse.json({ error: 'This action has no rollback available.' }, { status: 422 })
  }

  const { entity_id, before, rollback_action } = auditPayload

  // ── Execute rollback ──────────────────────────────────────────────────────

  let success = false

  if (rollback_action === 'restore_active') {
    success = await restoreActive(entity_id)
  } else if (rollback_action === 'restore_bid' && before.bid_amount_cents != null) {
    const currentBid = before.bid_amount_cents
    const result = await adjustAdSetBid(entity_id, currentBid, currentBid)
    success = result.success
  }

  if (!success) {
    return NextResponse.json({ error: 'Meta Graph API rollback call failed.' }, { status: 502 })
  }

  // ── Record rollback action in flywheel_actions ────────────────────────────

  await supabaseAdmin.from('flywheel_actions').insert({
    client_id:     clientId,
    flywheel:      'ads',
    action_type:   `${actionRow.action_type}.rollback`,
    execution_mode: 'third_party',
    vendor:        'meta',
    payload:       { rollback_of: body.flywheel_action_id, restored_state: before },
  }).then(({ error }) => {
    if (error) console.error('[meta-ads/rollback] insert error:', error.message)
  })

  return NextResponse.json({ restored: true, entity_id, rollback_action })
}
