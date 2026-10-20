/**
 * POST /api/clients/[id]/ad-strategy-config/creative-pool/approve
 * 素材池"批准"唯一入口。approved_by 由服务端从会话派生，绝不接受客户端传入（2026-08-04 事故规则）。
 * 只内部员工（guardGlobalAdmin 判据）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { loadAdStrategyConfig, loadConfigVersion, writeConfigCas, currentConfigVersion, type CreativePoolEntry } from '@/lib/ads-strategy/config'
import { promoVerdict, nzToday } from '@/lib/ads-strategy/promo-window'

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

  // 先读版本再读内容：整数组读改写，写的时候带版本比较，防并发保存互相覆盖。
  const loadedVersion = await loadConfigVersion(clientId)
  if (!loadedVersion.ok) return NextResponse.json({ error: loadedVersion.error }, { status: 503 })
  const config = await loadAdStrategyConfig(clientId)
  const entry = config.creative_pool.find(e => e.ref === parsed.ref)
  if (!entry) return NextResponse.json({ error: 'ref not in creative_pool' }, { status: 404 })

  if (entry.status === 'approved') {
    return NextResponse.json({ success: true, config, idempotent: true, version: await currentConfigVersion(clientId) })
  }

  const verdict = promoVerdict(entry.promo_window, nzToday(Date.now()))
  if (verdict === 'undeclared') {
    return NextResponse.json({ error: 'promo_window_undeclared', message: '这条素材还没有声明推广期，不能批准：请先声明起止日期，或明确声明长期有效。' }, { status: 422 })
  }
  if (verdict === 'expired') {
    return NextResponse.json({ error: 'promo_window_expired', message: '这条素材的推广期已经过了，不能批准入池。' }, { status: 422 })
  }

  const nextPool: CreativePoolEntry[] = config.creative_pool.map(e =>
    e.ref === parsed.ref
      ? { ...e, status: 'approved', approved_by: approvedBy, approved_at: new Date().toISOString() }
      : e,
  )

  const written = await writeConfigCas(clientId, { creative_pool: nextPool }, loadedVersion.version)
  if (!written.ok) {
    if (written.kind === 'conflict') {
      return NextResponse.json({ error: 'creative_pool_changed_concurrently', message: '素材池刚被别处改过，请刷新后重试。' }, { status: 409 })
    }
    return NextResponse.json({ error: written.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, config: await loadAdStrategyConfig(clientId), version: await currentConfigVersion(clientId) })
}
