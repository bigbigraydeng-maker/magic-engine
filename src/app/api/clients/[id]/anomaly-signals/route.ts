/**
 * GET  /api/clients/[id]/anomaly-signals?limit=20
 * PATCH /api/clients/[id]/anomaly-signals
 *
 * GET:  Returns recent anomaly signals for a client (non-dismissed, sorted newest first).
 *       Used by AnomalySignalPanel in the execution kanban.
 *
 * PATCH: Bulk-update signal status (e.g. dismiss all).
 *        Body: { ids: string[], status: 'dismissed' | 'processed' }
 *
 * Security: requirePaidClientAccess (session-based)
 * Reference: ROADMAP.md Phase 22.D
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

export const dynamic = 'force-dynamic'

// ─── GET ──────────────────────────────────────────────────────────────────────

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
    .from('anomaly_signals')
    .select(
      'id, client_id, flywheel, metric_key, rule_id, severity, ' +
      'current_value, reference_value, delta_pct, description, status, created_at',
    )
    .eq('client_id', clientId)
    .neq('status', 'dismissed')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, signals: data ?? [] })
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const body = await req.json() as { ids?: unknown; status?: unknown }

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 })
  }

  const allowedStatuses = ['dismissed', 'processed'] as const
  type AllowedStatus = typeof allowedStatuses[number]
  const newStatus = body.status as AllowedStatus

  if (!allowedStatuses.includes(newStatus)) {
    return NextResponse.json(
      { error: 'status must be "dismissed" or "processed"' },
      { status: 400 },
    )
  }

  const ids = body.ids as string[]

  const { error } = await supabaseAdmin
    .from('anomaly_signals')
    .update({ status: newStatus })
    .in('id', ids)
    .eq('client_id', clientId)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
