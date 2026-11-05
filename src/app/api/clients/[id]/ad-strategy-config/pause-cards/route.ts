/**
 * Per-client on/off for pause cards.
 * Writes the existing policy row. It does not add a column.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { rejectAgentAdsBearer } from '@/lib/auth/agent-ads-guard'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { isUuid } from '@/lib/validation-utils'
import { readPauseCardSwitch, setPauseCardSwitch } from '@/lib/ads-pause-card/switch'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: '这个地址不对。' }, { status: 400 })
  const denied = await rejectAgentAdsBearer(_req, { clientId: id, action: 'write_meta' })
  if (denied) return denied
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const enabled = await readPauseCardSwitch(supabaseAdmin, id, new Date())
  if (enabled === 'unreadable') return NextResponse.json({ error: '开关读不到。' }, { status: 503 })
  return NextResponse.json({ enabled: enabled === 'on' })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: '这个地址不对。' }, { status: 400 })
  const denied = await rejectAgentAdsBearer(req, { clientId: id, action: 'write_meta' })
  if (denied) return denied
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const staff = await requireGlobalAdmin()
  if (!staff.ok) return NextResponse.json({ error: staff.error }, { status: staff.status })
  const body = await req.json().catch(() => null) as { enabled?: unknown } | null
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.enabled !== 'boolean' || Object.keys(body).length !== 1) {
    return NextResponse.json({ error: '请只写开或关。' }, { status: 400 })
  }
  const enabled = await setPauseCardSwitch(supabaseAdmin, id, body.enabled, staff.user.email ?? 'staff', new Date())
  if (enabled === 'unreadable') return NextResponse.json({ error: '开关没能记下。' }, { status: 503 })
  return NextResponse.json({ enabled: enabled === 'on' })
}
