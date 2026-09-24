/**
 * GET/PATCH /api/clients/[id]/ad-strategy-config
 *
 * Reads and updates a client's Ad Strategy Engine control settings (on/off,
 * digest recipients, daily budget cap, autonomy mode, creative pool). Backs the
 * Settings panel (P21.K.5). Config edits go through this route — never raw SQL —
 * per the FDE-config red-line. Creative-pool *approval* is NOT done here; it has
 * its own endpoint (/creative-pool/approve).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { loadAdStrategyConfig, parseCreativePool, type CreativePoolEntry } from '@/lib/ads-strategy/config'

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

  let body: {
    enabled?: unknown
    digest_recipients?: unknown
    daily_budget_cap_cents?: unknown
    autonomy_mode?: unknown
    creative_pool?: unknown
  }
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

  if (body.daily_budget_cap_cents !== undefined) {
    const v = body.daily_budget_cap_cents
    if (v !== null && !(Number.isInteger(v) && (v as number) > 0)) {
      return NextResponse.json({ error: 'daily_budget_cap_cents must be a positive integer or null' }, { status: 400 })
    }
    update.daily_budget_cap_cents = v
  }

  if (body.autonomy_mode !== undefined) {
    if (body.autonomy_mode !== 'observe' && body.autonomy_mode !== 'bounded_auto') {
      return NextResponse.json({ error: "autonomy_mode must be 'observe' or 'bounded_auto'" }, { status: 400 })
    }
    update.autonomy_mode = body.autonomy_mode
  }

  if (body.creative_pool !== undefined) {
    if (!Array.isArray(body.creative_pool)) {
      return NextResponse.json({ error: 'creative_pool must be an array' }, { status: 400 })
    }
    // 这条路由永远不能"批准"素材（spec 2026-09-24 §3 G1；2026-08-04 事故：PATCH 曾接受客户端 approved_by）。
    // 客户端若带 status:'approved' 或 approved_by / approved_at → 拒绝整个请求，不静默降级。
    const tainted = body.creative_pool.some(e =>
      typeof e === 'object' && e !== null &&
      (('status' in e && e.status === 'approved') || 'approved_by' in e || 'approved_at' in e))
    if (tainted) {
      return NextResponse.json({ error: 'creative_pool approval must go through /creative-pool/approve' }, { status: 400 })
    }
    const parsed = parseCreativePool(body.creative_pool)
    if (parsed.length !== body.creative_pool.length) {
      return NextResponse.json({ error: 'creative_pool has malformed entries (need kind, ref, status=candidate)' }, { status: 400 })
    }
    update.creative_pool = parsed.map((e): CreativePoolEntry => ({ kind: e.kind, ref: e.ref, status: 'candidate' }))
  }

  const { error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .upsert(update, { onConflict: 'client_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const config = await loadAdStrategyConfig(clientId)
  return NextResponse.json({ success: true, config })
}
