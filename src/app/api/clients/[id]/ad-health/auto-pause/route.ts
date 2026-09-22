/**
 * Ads D3 自动暂停——待批准列表。
 *
 * GET → 这个客户当前等人点头的暂停建议（`flywheel_actions` 里
 * `action_type='ads.auto_pause_on_d3'` 且 `payload.status='awaiting_approval'`
 * 的行）。批准/驳回走同目录下 `[runId]/decision/route.ts`。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

export const dynamic = 'force-dynamic'

interface RouteParams { params: { id: string } }

export interface PendingAutoPauseItem {
  flywheelActionId: string
  actionRunId: string | null
  authorizationDecisionId: string | null
  adsetId: string | null
  adsetName: string | null
  adAccountId: string | null
  diagnosisTitle: string | null
  insightDate: string | null
  createdAt: string
}

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data, error } = await supabaseAdmin
    .from('flywheel_actions')
    .select('id, created_at, payload')
    .eq('client_id', params.id)
    .eq('flywheel', 'ads')
    .eq('action_type', 'ads.auto_pause_on_d3')
    .eq('payload->>status', 'awaiting_approval')
    .order('created_at', { ascending: true })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const items: PendingAutoPauseItem[] = ((data ?? []) as Array<{
    id: string
    created_at: string
    payload: Record<string, unknown> | null
  }>).map((row) => {
    const p = row.payload ?? {}
    return {
      flywheelActionId: row.id,
      actionRunId: (p.action_run_id as string | undefined) ?? null,
      authorizationDecisionId: (p.authorization_decision_id as string | undefined) ?? null,
      adsetId: (p.adset_id as string | undefined) ?? null,
      adsetName: (p.adset_name as string | undefined) ?? null,
      adAccountId: (p.ad_account_id as string | undefined) ?? null,
      diagnosisTitle: (p.diagnosis_title as string | undefined) ?? null,
      insightDate: (p.insight_date as string | undefined) ?? null,
      createdAt: row.created_at,
    }
  })

  return NextResponse.json({ items })
}
