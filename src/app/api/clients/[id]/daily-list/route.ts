/**
 * GET  /api/clients/[id]/daily-list — Reels dated today..day after tomorrow that still need a person's approval.
 * POST /api/clients/[id]/daily-list — { approve: [{ work_order_id, fingerprint, publish_on }], exclude: [{ work_order_id, reason }], dry_run? }
 * Global admins only. The list is rebuilt on the server for every POST; nothing here publishes (the reel's day does,
 * via cloud-reel-scheduled-go-public). Design: docs/specs/2026-11-05-daily-list-card-design-v0.1.md §9.
 */
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { supabaseAdmin } from '@/lib/supabase'
import { isUuid } from '@/lib/validation-utils'
import { createProductionPromoteDeps } from '@/lib/factory/publish/promote/deps'
import { readWeekPackEnv, reelCardMode } from '@/lib/social/week-pack/switches'
import { buildDailyList } from '@/lib/social/daily-list/list'
import { decideDailyList, type ApproveRequest, type ExcludeRequest } from '@/lib/social/daily-list/decide'
import { createDailyListPorts } from '@/lib/social/daily-list/db'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }
const refused = (status: number, error: string) => NextResponse.json({ success: false, error }, { status })

function switchOn(): boolean {
  return reelCardMode(readWeekPackEnv()) === 'scheduled'
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function readApprove(v: unknown): ApproveRequest[] | null {
  if (!Array.isArray(v)) return null
  const out: ApproveRequest[] = []
  for (const x of v) {
    if (!isRecord(x) || typeof x.work_order_id !== 'string' || !isUuid(x.work_order_id)) return null
    if (typeof x.fingerprint !== 'string' || typeof x.publish_on !== 'string') return null
    out.push({ work_order_id: x.work_order_id, fingerprint: x.fingerprint, publish_on: x.publish_on })
  }
  return out
}

function readExclude(v: unknown): ExcludeRequest[] | null {
  if (!Array.isArray(v)) return null
  const out: ExcludeRequest[] = []
  for (const x of v) {
    if (!isRecord(x) || typeof x.work_order_id !== 'string' || !isUuid(x.work_order_id)) return null
    out.push({ work_order_id: x.work_order_id, reason: typeof x.reason === 'string' ? x.reason : '' })
  }
  return out
}

export async function GET(_req: Request, { params }: Ctx) {
  if (!isUuid(params.id)) return refused(400, '这个地址不对。')
  const admin = await requireGlobalAdmin()
  if (!admin.ok) return refused(admin.status, admin.error)
  try {
    const ports = createDailyListPorts(supabaseAdmin, createProductionPromoteDeps())
    const list = await buildDailyList(ports, { clientId: params.id, now: new Date(), switchOn: switchOn() })
    return NextResponse.json({ success: true, switch_on: switchOn(), ...list })
  } catch {
    return refused(500, '清单没读出来，不要当成没有要批的。')
  }
}

export async function POST(req: Request, { params }: Ctx) {
  if (!isUuid(params.id)) return refused(400, '这个地址不对。')
  const admin = await requireGlobalAdmin()
  if (!admin.ok) return refused(admin.status, admin.error)
  const email = admin.user.email ?? ''
  if (!email) return refused(403, '读不到你的登录邮箱。')
  let body: Record<string, unknown>
  try { body = (await req.json()) as Record<string, unknown> } catch { return refused(400, '请求格式不对。') }
  const approve = readApprove(body.approve ?? [])
  const exclude = readExclude(body.exclude ?? [])
  if (!approve || !exclude) return refused(400, '请求格式不对。')
  if (approve.length + exclude.length === 0) return refused(400, '没有要放行或剔除的条目。')
  if (approve.length > 0 && !switchOn()) return refused(409, '按日公开现在没打开，放行了到日也不会发。')
  try {
    const ports = createDailyListPorts(supabaseAdmin, createProductionPromoteDeps())
    const receipt = await decideDailyList(ports, {
      clientId: params.id, adminEmail: email, switchOn: switchOn(), approve, exclude,
      dryRun: body.dry_run === true, now: new Date(), requestId: randomUUID(),
    })
    return NextResponse.json({ success: true, receipt })
  } catch {
    return refused(500, '这次没做成，请刷新清单再试。已经放行的条目会在清单里消失。')
  }
}
