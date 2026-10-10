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
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, actions: (data ?? []).map(showTruthfulReactivation) })
}
