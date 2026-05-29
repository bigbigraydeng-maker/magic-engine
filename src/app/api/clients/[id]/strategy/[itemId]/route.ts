/**
 * PATCH /api/clients/[id]/strategy/[itemId]
 *
 * Update the status of a single content_strategy_items row.
 *
 * Body:
 *   { status: 'pending' | 'approved' | 'in_progress' | 'done' | 'dismissed' }
 *
 * Currently used by:
 *   - 看板「忽略」按钮 (status='dismissed')  — P14.C.2
 *
 * Auth: dashboard-client-access guard (multi-tenant safety).
 *
 * Reference: ROADMAP.md P14.C.2
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import type { StrategyStatus } from '@/lib/strategy/types'

const VALID_STATUSES: StrategyStatus[] = [
  'pending',
  'approved',
  'in_progress',
  'done',
  'dismissed',
]

interface RouteContext {
  params: { id: string; itemId: string }
}

export async function PATCH(req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const { id: clientId, itemId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: { status?: unknown }
  try {
    body = (await req.json()) as { status?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const status = body.status
  if (typeof status !== 'string' || !VALID_STATUSES.includes(status as StrategyStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  // Scope update to (client_id, id) so a tenant cannot patch another tenant's row.
  const { data, error } = await supabaseAdmin
    .from('content_strategy_items')
    .update({ status })
    .eq('id', itemId)
    .eq('client_id', clientId)
    .select('id, status')
    .maybeSingle()

  if (error) {
    console.error('[strategy PATCH] update failed', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'Strategy item not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, id: data.id, status: data.status })
}
