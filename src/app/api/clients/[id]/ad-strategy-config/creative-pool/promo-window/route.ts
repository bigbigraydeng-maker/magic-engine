/**
 * POST /api/clients/[id]/ad-strategy-config/creative-pool/promo-window
 * 设置一条素材的推广期（和别名）。promo_window_set_by 由服务端从会话派生，绝不接受客户端传入。
 * 只内部员工（guardGlobalAdmin 判据）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { loadAdStrategyConfig, type CreativePoolEntry } from '@/lib/ads-strategy/config'
import { parsePromoWindow, nzToday, type PromoWindow } from '@/lib/ads-strategy/promo-window'

export const dynamic = 'force-dynamic'

const MAX_ALIASES = 20

type ParsedBody =
  | { ok: true; ref: string; promoWindow: PromoWindow; aliasRefs: string[] | undefined }
  | { ok: false; status: number; error: string; alias?: string }

/** 只接受 `{ ref, promo_window, alias_refs? }` —— 任何 set_by / set_at / status 一律拒。 */
function parseBody(raw: unknown): ParsedBody {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, status: 400, error: 'body must be an object' }
  }
  const obj = raw as Record<string, unknown>
  const allowed = ['ref', 'promo_window', 'alias_refs']
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      return { ok: false, status: 400, error: 'only ref, promo_window, alias_refs are accepted' }
    }
  }

  const ref = obj.ref
  if (typeof ref !== 'string' || ref.length === 0) {
    return { ok: false, status: 400, error: 'ref must be a non-empty string' }
  }

  const promoWindow = parsePromoWindow(obj.promo_window)
  if (promoWindow === null) {
    return { ok: false, status: 400, error: 'invalid promo_window' }
  }

  let aliasRefs: string[] | undefined
  if ('alias_refs' in obj) {
    const rawAliases = obj.alias_refs
    if (!Array.isArray(rawAliases)) {
      return { ok: false, status: 400, error: 'alias_refs must be an array' }
    }
    const cleaned: string[] = []
    for (const a of rawAliases) {
      if (typeof a !== 'string' || a.length === 0) {
        return { ok: false, status: 400, error: 'alias_refs must be non-empty strings' }
      }
      if (!cleaned.includes(a)) cleaned.push(a)
    }
    if (cleaned.length > MAX_ALIASES) {
      return { ok: false, status: 400, error: `alias_refs must have at most ${MAX_ALIASES} entries` }
    }
    aliasRefs = cleaned
  }

  return { ok: true, ref, promoWindow, aliasRefs }
}

/** 两个推广期内容是否相同（用于决定是否刷新 changed_at）。 */
function samePromoWindow(a: PromoWindow | undefined, b: PromoWindow): boolean {
  if (a === undefined) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'evergreen' && b.kind === 'evergreen') return true
  if (a.kind === 'dated' && b.kind === 'dated') return a.start === b.start && a.end === b.end
  return false
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

  const setBy = admin.user.email
  if (typeof setBy !== 'string' || setBy.length === 0) {
    return NextResponse.json({ error: 'session has no email' }, { status: 500 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = parseBody(raw)
  if (!parsed.ok) {
    const body: Record<string, unknown> = { error: parsed.error }
    if (parsed.alias !== undefined) body.alias = parsed.alias
    return NextResponse.json(body, { status: parsed.status })
  }

  const today = nzToday(Date.now())
  if (parsed.promoWindow.kind === 'dated' && parsed.promoWindow.end < today) {
    return NextResponse.json({ error: 'promo_window_end_in_past' }, { status: 422 })
  }

  const config = await loadAdStrategyConfig(clientId)
  const entry = config.creative_pool.find(e => e.ref === parsed.ref)
  if (!entry) return NextResponse.json({ error: 'ref not in creative_pool' }, { status: 404 })

  // 别名冲突：不得等于池里另一条的 ref，也不得出现在另一条的 alias_refs 里。
  // 等于本条自己的 ref 忽略掉，不算错。
  let nextAliasRefs: string[] | undefined
  if (parsed.aliasRefs !== undefined) {
    const cleaned = parsed.aliasRefs.filter(a => a !== entry.ref)
    for (const alias of cleaned) {
      for (const other of config.creative_pool) {
        if (other.ref === entry.ref) continue
        const refHit = other.ref === alias
        const aliasHit = Array.isArray(other.alias_refs) && other.alias_refs.includes(alias)
        if (refHit || aliasHit) {
          return NextResponse.json({ error: 'alias_conflict', alias }, { status: 409 })
        }
      }
    }
    nextAliasRefs = cleaned
  }

  const nowIso = new Date().toISOString()
  const hadWindow = entry.promo_window !== undefined
  const windowChanged = !samePromoWindow(entry.promo_window, parsed.promoWindow)

  const nextPool: CreativePoolEntry[] = config.creative_pool.map(e => {
    if (e.ref !== parsed.ref) return e
    const next: CreativePoolEntry = {
      ...e,
      promo_window: parsed.promoWindow,
      promo_window_set_by: setBy,
    }
    if (!hadWindow) next.promo_window_set_at = nowIso
    if (windowChanged) next.promo_window_changed_at = nowIso
    if (nextAliasRefs !== undefined) {
      if (nextAliasRefs.length > 0) next.alias_refs = nextAliasRefs
      else delete next.alias_refs
    }
    return next
  })

  const { error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .upsert(
      { client_id: clientId, creative_pool: nextPool, updated_at: nowIso },
      { onConflict: 'client_id' },
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, config: await loadAdStrategyConfig(clientId) })
}
