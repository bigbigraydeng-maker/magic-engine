// POST /api/factory/winners/[id]/decision {decision:'approved'|'rejected'}
// 认 / 不认一条广告赢家（工厂照着出片的样板）。PM 或该客户工作区员工都能点（PM 2026-11-05 定）；
// 客户配置 winner_confirm_pm_only=true 时只认 Magic Lab 内部账号。不发布、不花钱、不改广告。

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { loadWinnerRow, recordWinnerDecision } from '@/lib/factory/winner-decision'
import { confirmIsPmOnly, PM_DECISIONS, type PmDecisionValue } from '@/lib/factory/winner-gate'

export const dynamic = 'force-dynamic'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseDecision(body: unknown): PmDecisionValue | null {
  if (typeof body !== 'object' || body === null) return null
  const d = (body as Record<string, unknown>).decision
  return typeof d === 'string' && (PM_DECISIONS as readonly string[]).includes(d) ? (d as PmDecisionValue) : null
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { id } = params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'id must be a uuid' }, { status: 400 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  const decision = parseDecision(body)
  if (!decision) return NextResponse.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 })

  const row = await loadWinnerRow(supabaseAdmin, id)
  if (!row.ok) return NextResponse.json({ error: row.error }, { status: row.status })
  const clientId = row.data.client_id

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error, reason: access.reason }, { status: access.status })

  const cfg = await supabaseAdmin.from('clients').select('factory_config').eq('id', clientId).maybeSingle()
  if (cfg.error) return NextResponse.json({ error: cfg.error.message }, { status: 500 })
  if (confirmIsPmOnly(cfg.data?.factory_config ?? null)) {
    const admin = await requireGlobalAdmin()
    if (!admin.ok) return NextResponse.json({ error: '这个客户目前只认 Magic Lab 内部账号点「认」' }, { status: 403 })
  }

  const by = access.user.email
  if (!by) return NextResponse.json({ error: '账号没有邮箱，记不下是谁点的' }, { status: 403 })

  const result = await recordWinnerDecision(supabaseAdmin, {
    winnerId: id,
    decision,
    by,
    role: access.role === 'admin' ? 'magic_lab' : 'client_staff',
    now: new Date(),
  })
  return result.ok
    ? NextResponse.json({ receipt: result.data })
    : NextResponse.json({ error: result.error }, { status: result.status })
}
