/**
 * GET/PATCH /api/clients/[id]/ad-strategy-config
 *
 * Reads and updates a client's Ad Strategy Engine control settings (on/off,
 * digest recipients). Backs the Settings panel (P21.K.5). Config edits go
 * through this route — never raw SQL — per the FDE-config red-line.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { loadAdStrategyConfig } from '@/lib/ads-strategy/config'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const config = await loadAdStrategyConfig(clientId)
  return NextResponse.json({ success: true, config })
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  // 改这两项只许内部员工（全局 admin）。2026-09-14 子牙复审 PR #1662 查出：
  // enabled=false 会让每日广告体检、摘要、广告快照 cron 全部跳过这个客户；
  // digest_recipients 决定内部摘要发给谁。客户成员能改 = 自己关掉自己的预警、
  // 把内部摘要改发到任意邮箱。与 #1649 / #1658 同一个坑；客户成员仍可 GET 查看。
  // 虽然只动单个客户，但属于内部控制项，所以用全局守卫（受限演示管理员也拒）。
  const staffGuard = await guardGlobalAdmin()
  if (staffGuard) return staffGuard

  let body: { enabled?: unknown; digest_recipients?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const update: Record<string, unknown> = { client_id: clientId, updated_at: new Date().toISOString() }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
    }
    update.enabled = body.enabled
  }

  if (body.digest_recipients !== undefined) {
    if (!Array.isArray(body.digest_recipients) || body.digest_recipients.some(e => typeof e !== 'string')) {
      return NextResponse.json({ error: 'digest_recipients must be an array of strings' }, { status: 400 })
    }
    const emails = (body.digest_recipients as string[]).map(e => e.trim()).filter(Boolean)
    const bad = emails.find(e => !EMAIL_RE.test(e))
    if (bad) return NextResponse.json({ error: `Invalid email: ${bad}` }, { status: 400 })
    update.digest_recipients = emails
  }

  const { error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .upsert(update, { onConflict: 'client_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const config = await loadAdStrategyConfig(clientId)
  return NextResponse.json({ success: true, config })
}
