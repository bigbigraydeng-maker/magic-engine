/**
 * GET /api/clients/[id]/meta-ads/actions?limit=20
 *
 * P18.A.3: Returns flywheel_actions for this client's ads flywheel,
 * excluding the background META_SNAPSHOT entries.
 *
 * Used by the AdsAuditSection component to display action history + undo.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { resolveAutonomousBoardState, boardViewerFor } from '@/lib/flywheel/autonomous-action-board'

export const dynamic = 'force-dynamic'

interface ActionRow {
  id: string
  action_type: string
  vendor: string | null
  payload: Record<string, unknown> | null
  executed_at: string | null
  execution_item_id: string | null
}

/**
 * A reactivation that never reached Meta (authorized_pending) or failed there
 * (meta_failed) must not read as "reactivated" in the history list. Rewrite the
 * after-state back to the before-state and surface the real status so the UI
 * shows before → before.
 */
function showTruthfulReactivation(row: ActionRow): ActionRow {
  if (row.action_type !== 'ads.reactivate_campaign') return row
  const payload = row.payload
  if (!payload) return row
  const status = payload.status
  if (status !== 'authorized_pending' && status !== 'meta_failed') return row
  return {
    ...row,
    payload: { ...payload, after: payload.before, display_status: status },
  }
}

/** 历史面板只用这几项。其余（内部原因、诊断证据、归属核实、授权回执…）一律不出这个接口。 */
const PANEL_PAYLOAD_KEYS = ['campaign_id', 'before', 'after', 'display_status', 'status'] as const

function toPanelRow(row: ActionRow): ActionRow {
  const payload = row.payload
  if (!payload) return row
  const slim: Record<string, unknown> = {}
  for (const key of PANEL_PAYLOAD_KEYS) {
    if (key in payload) slim[key] = payload[key]
  }
  return { ...row, payload: slim }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const rawLimit = req.nextUrl.searchParams.get('limit')
  const limit    = Math.min(parseInt(rawLimit ?? '20', 10) || 20, 50)

  const { data, error } = await supabaseAdmin
    .from('flywheel_actions')
    .select('id, action_type, vendor, payload, executed_at, execution_item_id')
    .eq('client_id', clientId)
    .eq('flywheel', 'ads')
    .neq('action_type', 'ads.meta_snapshot')
    .order('executed_at', { ascending: false })
    .limit(limit)

  if (error) {
    // 原始报错只进日志 —— 不把库内部细节回给页面
    console.error('[meta-ads/actions] flywheel_actions read failed:', error.message)
    return NextResponse.json({ success: false, error: '读取操作历史失败，稍后刷新再试' }, { status: 500 })
  }

  // 客户成员不看没做成 / 演练 / 状态认不出的记录（跟执行看板同一张翻译表），任何人都拿不到内部字段。
  const viewer = boardViewerFor(access)
  const actions = ((data ?? []) as ActionRow[])
    .filter(row => resolveAutonomousBoardState(row.payload?.status, viewer) !== null)
    .map(showTruthfulReactivation)
    .map(toPanelRow)

  return NextResponse.json({ success: true, actions })
}
