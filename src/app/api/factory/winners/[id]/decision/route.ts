// POST /api/factory/winners/[id]/decision {decision:'approved'|'rejected'}
// 认 / 不认一条广告赢家（工厂照着出片的样板）。PM 或该客户自己的员工能点（PM 2026-11-05 定）；
// 受限管理员 / 演示账号不能点。客户配置 winner_confirm_pm_only=true 时只认 Magic Lab 内部账号。
// 员工改不了 Magic Lab 定下的决定。不发布、不花钱、不改广告。

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { loadWinnerRow, recordWinnerDecision } from '@/lib/factory/winner-decision'
import { loadPmOnly, loadStaffEmails, PM_DECISIONS, type ConfirmerRole, type PmDecisionValue } from '@/lib/factory/winner-gate'

export const dynamic = 'force-dynamic'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseDecision(body: unknown): PmDecisionValue | null {
  if (typeof body !== 'object' || body === null) return null
  const d = (body as Record<string, unknown>).decision
  return typeof d === 'string' && (PM_DECISIONS as readonly string[]).includes(d) ? (d as PmDecisionValue) : null
}

type Confirmer = { ok: true; email: string; role: ConfirmerRole } | { ok: false; status: number; error: string }

/** 判定点认的人是谁：全局管理员 = magic_lab；该客户自己的员工 = client_staff；其余一律拒。 */
async function resolveConfirmer(clientId: string, pmOnly: boolean): Promise<Confirmer> {
  const admin = await requireGlobalAdmin()
  if (admin.ok) {
    const email = admin.user.email
    return email ? { ok: true, email, role: 'magic_lab' } : { ok: false, status: 403, error: '账号没有邮箱，记不下是谁点的' }
  }
  if (pmOnly) return { ok: false, status: 403, error: '这个客户目前只认 Magic Lab 内部账号点「认」' }
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return { ok: false, status: access.status, error: access.error }
  if (access.role === 'admin') return { ok: false, status: 403, error: '受限管理员 / 演示账号不能认赢家' }
  const email = (access.user.email ?? '').toLowerCase().trim()
  const staff = await loadStaffEmails(supabaseAdmin, clientId)
  if (!email || !staff.has(email)) return { ok: false, status: 403, error: '只有这个客户自己的员工能点「认」' }
  return { ok: true, email, role: 'client_staff' }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'id must be a uuid' }, { status: 400 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  const decision = parseDecision(body)
  if (!decision) return NextResponse.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 })

  const row = await loadWinnerRow(supabaseAdmin, params.id)
  if (!row.ok) return NextResponse.json({ error: row.error }, { status: row.status })
  const clientId = row.data.client_id

  let who: Confirmer
  try {
    const { pmOnly } = await loadPmOnly(supabaseAdmin, clientId)
    who = await resolveConfirmer(clientId, pmOnly)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status })

  const result = await recordWinnerDecision(supabaseAdmin, {
    winnerId: params.id,
    decision,
    by: who.email,
    role: who.role,
    now: new Date(),
  })
  return result.ok
    ? NextResponse.json({ receipt: result.data })
    : NextResponse.json({ error: result.error }, { status: result.status })
}
