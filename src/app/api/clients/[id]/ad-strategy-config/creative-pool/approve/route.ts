/**
 * POST /api/clients/[id]/ad-strategy-config/creative-pool/approve
 * 素材池"批准"唯一入口。approved_by 由服务端从会话派生，绝不接受客户端传入（2026-08-04 事故规则）。
 * 只内部员工（guardGlobalAdmin 判据）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { loadAdStrategyConfigWithSource, type CreativePoolEntry } from '@/lib/ads-strategy/config'

export const dynamic = 'force-dynamic'

/** 只接受 `{ ref: string }` 且无其它键 —— 任何 approved_by / approved_at / status 一律拒。 */
function parseApproveBody(raw: unknown): { ok: true; ref: string } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'body must be an object' }
  }
  const keys = Object.keys(raw)
  if (keys.length !== 1 || keys[0] !== 'ref') {
    return { ok: false, error: 'only ref is accepted' }
  }
  const ref = 'ref' in raw ? raw.ref : undefined
  if (typeof ref !== 'string' || ref.length === 0) {
    return { ok: false, error: 'ref must be a non-empty string' }
  }
  return { ok: true, ref }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const admin = await requireGlobalAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })

  const approvedBy = admin.user.email
  if (typeof approvedBy !== 'string' || approvedBy.length === 0) {
    return NextResponse.json({ error: 'session has no email' }, { status: 500 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = parseApproveBody(raw)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // 🔴 读失败时拿到的是空素材池的默认值，照旧往下走会报「ref 不在池里」——其实是没读到。
  const loaded = await loadAdStrategyConfigWithSource(clientId)
  if (loaded.source === 'fallback') {
    return NextResponse.json({ error: '读不出这个客户当前的素材池，这次没有批准，请稍后再试' }, { status: 503 })
  }
  const config = loaded.config
  const entry = config.creative_pool.find(e => e.ref === parsed.ref)
  if (!entry) return NextResponse.json({ error: 'ref not in creative_pool' }, { status: 404 })

  if (entry.status === 'approved') {
    return NextResponse.json({ success: true, config, idempotent: true })
  }

  const nextPool: CreativePoolEntry[] = config.creative_pool.map(e =>
    e.ref === parsed.ref
      ? { ...e, status: 'approved', approved_by: approvedBy, approved_at: new Date().toISOString() }
      : e,
  )

  const { error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .upsert(
      { client_id: clientId, creative_pool: nextPool, updated_at: new Date().toISOString() },
      { onConflict: 'client_id' },
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const after = await loadAdStrategyConfigWithSource(clientId)
  if (after.source === 'fallback') {
    // 批准已经写库，只是回读失败：如实说「已批准」，不拿空素材池冒充结果。
    return NextResponse.json(
      { error: '已批准，但读不出批准后的素材池，请刷新页面确认', saved: true },
      { status: 503 },
    )
  }
  return NextResponse.json({ success: true, config: after.config })
}
