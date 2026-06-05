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

  return NextResponse.json({ success: true, actions: data ?? [] })
}
