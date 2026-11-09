/**
 * GET  /api/clients/[id]/week-pack/reel-grants — Reels approved on a week card that are not public yet (or need a decision).
 * POST /api/clients/[id]/week-pack/reel-grants — { action: 'revoke', work_order_id } or
 *      { action: 'authorize', work_order_id, preview_token } (re-authorise after a fresh preview).
 * Global admins only. Nothing here publishes; publishing happens on the reel's day (cloud-reel-scheduled-go-public).
 */
import { NextResponse } from 'next/server'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { supabaseAdmin } from '@/lib/supabase'
import { isUuid } from '@/lib/validation-utils'
import { createProductionPromoteDeps } from '@/lib/factory/publish/promote/deps'
import { listOpenGrants, revokeGrant } from '@/lib/factory/publish/promote/scheduled-grants-admin'
import { authorizeScheduledReel } from '@/lib/factory/publish/promote/scheduled-authorize'
import { readWeekPackEnv, reelCardMode } from '@/lib/social/week-pack/switches'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }
const refused = (status: number, error: string) => NextResponse.json({ success: false, error }, { status })

export async function GET(_req: Request, { params }: Ctx) {
  if (!isUuid(params.id)) return refused(400, '这个地址不对。')
  const admin = await requireGlobalAdmin()
  if (!admin.ok) return refused(admin.status, admin.error)
  try {
    return NextResponse.json({ success: true, grants: await listOpenGrants(supabaseAdmin, params.id) })
  } catch {
    return refused(500, '授权列表没读出来，不要当成没有。')
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
  const orderId = typeof body.work_order_id === 'string' && isUuid(body.work_order_id) ? body.work_order_id : ''
  if (!orderId) return refused(400, '缺少工单。')
  const deps = createProductionPromoteDeps()
  const order = await deps.store.loadOrder(orderId)
  if (!order || order.client_id !== params.id) return refused(404, '这条不属于这位客户。')
  if (body.action === 'revoke') {
    const r = await revokeGrant(deps, { orderId, clientId: params.id, by: email })
    return r.ok ? NextResponse.json({ success: true }) : refused(r.status, r.error)
  }
  if (body.action === 'authorize' && typeof body.preview_token === 'string') {
    // Switch off = nothing would run on the day; refuse rather than show "approved, waiting".
    if (reelCardMode(readWeekPackEnv()) !== 'scheduled') return refused(409, '按日公开现在没打开，授权了也不会到日发出去。')
    const r = await authorizeScheduledReel(deps, { orderId, adminEmail: email, previewToken: body.preview_token, source: 'reauthorize' })
    return r.ok ? NextResponse.json({ success: true, publish_on: r.publishOn }) : refused(r.status, r.error)
  }
  return refused(400, '不认识的操作。')
}
