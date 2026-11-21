/**
 * Owner (global admin) confirms agent-drafted ads decisions.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { supabaseAdmin } from '@/lib/supabase'
import { patchDecisionOnRow, readAdsDecisionV1 } from '@/lib/ads/decision-log/persist'

type Params = { params: { id: string; actionId: string } }

export async function POST(_req: NextRequest, { params }: Params) {
  const paid = await requirePaidClientAccess(params.id)
  if (!paid.ok) {
    return NextResponse.json({ success: false, error: paid.error }, { status: paid.status })
  }
  const admin = await requireGlobalAdmin()
  if (!admin.ok) {
    return NextResponse.json(
      { success: false, error: '只有负责人可以确认 agent 起草的广告决策。' },
      { status: 403 },
    )
  }
  const { data, error } = await supabaseAdmin
    .from('flywheel_actions')
    .select('id, payload')
    .eq('client_id', params.id)
    .eq('id', params.actionId)
    .maybeSingle()
  if (error || !data) {
    return NextResponse.json({ success: false, error: '找不到这条决策。' }, { status: 404 })
  }
  const payload = record(data.payload)
  const decision = readAdsDecisionV1(payload)
  if (!decision || decision.status !== 'pending_confirm') {
    return NextResponse.json({ success: false, error: '这条决策不在待确认状态。' }, { status: 400 })
  }
  const email = (admin.user.email ?? 'owner').trim()
  const next = {
    ...decision,
    status: 'active' as const,
    decided_by: { kind: 'human' as const, label: email },
    decided_at: new Date().toISOString(),
  }
  const ok = await patchDecisionOnRow(supabaseAdmin, {
    clientId: params.id,
    actionId: params.actionId,
    decision: next,
    currentPayload: payload,
  })
  if (!ok) {
    return NextResponse.json({ success: false, error: '确认没能写下。' }, { status: 500 })
  }
  return NextResponse.json({ success: true, status: 'active' })
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
