/**
 * POST /api/clients/[id]/ad-strategy-config/creative-pool/promo-window
 * 设置一条素材的推广期（和别名）。promo_window_set_by 由服务端从会话派生，绝不接受客户端传入。
 * 只内部员工（guardGlobalAdmin 判据）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { loadAdStrategyConfig, loadConfigVersion, writeConfigCas, currentConfigVersion, type CreativePoolEntry } from '@/lib/ads-strategy/config'
import { parsePromoWindow, nzToday, type PromoWindow } from '@/lib/ads-strategy/promo-window'

export const dynamic = 'force-dynamic'

const MAX_ALIASES = 20
const MAX_PROMO_MONTHS = 12

/** YYYY-MM-DD 往后推 n 个月（日期超出当月天数时取当月最后一天）。纯日期运算，不涉及时区。 */
function addMonthsNz(day: string, months: number): string {
  const y = Number(day.slice(0, 4))
  const m = Number(day.slice(5, 7)) - 1 + months
  const d = Number(day.slice(8, 10))
  const lastDay = new Date(Date.UTC(y + Math.floor(m / 12), (m % 12) + 1, 0)).getUTCDate()
  const out = new Date(Date.UTC(y + Math.floor(m / 12), m % 12, Math.min(d, lastDay)))
  return out.toISOString().slice(0, 10)
}

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

/** 两组别名是否是同一集合（不看顺序）。 */
function sameAliasSet(a: readonly string[] | undefined, b: readonly string[]): boolean {
  const left = [...(a ?? [])].sort()
  const right = [...b].sort()
  return left.length === right.length && left.every((v, i) => v === right[i])
}

/**
 * 新的推广期是不是比原来「放宽」了（长期有效 / 结束日延后 / 开始日提前）。放宽 = 已批准的结论不再成立。
 * 首次声明（原来没有推广期）：
 *   - 声明 dated：只是补登记一个有限期，不算放宽，已批准的保持 approved；
 *   - 声明 evergreen：这是最宽的声明（无期限），等于把「已批准」的结论扩到无限期，
 *     必须重新过一遍批准（第二双眼睛），所以按放宽处理、降回候选。
 */
function widensWindow(prev: PromoWindow | undefined, next: PromoWindow): boolean {
  if (prev === undefined) return next.kind === 'evergreen'
  if (prev.kind === 'evergreen') return false
  if (next.kind === 'evergreen') return true
  return next.end > prev.end || next.start < prev.start
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
  // 自我声明没有第二道核对，所以给个上限：结束日不得晚于今天往后 12 个月（防止写成 9999-12-31 变相长期有效）。
  if (parsed.promoWindow.kind === 'dated' && parsed.promoWindow.end > addMonthsNz(today, MAX_PROMO_MONTHS)) {
    return NextResponse.json({ error: 'promo_window_end_too_far', message: `推广期结束日不能晚于今天往后 ${MAX_PROMO_MONTHS} 个月；真的长期有效请明确选择「长期有效」。` }, { status: 422 })
  }

  const loadedVersion = await loadConfigVersion(clientId)
  if (!loadedVersion.ok) return NextResponse.json({ error: loadedVersion.error }, { status: 503 })
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

  // 已批准的素材把推广期放宽了：原来的批准是按旧推广期给的，不再成立 → 降回候选，需要重新批准。
  // 别名变化也一样：别名决定「哪些广告受这条素材的推广期管」，已批准的素材增减别名都要重新过一遍批准（第二双眼睛）。
  const aliasesChanged = nextAliasRefs !== undefined && !sameAliasSet(entry.alias_refs, nextAliasRefs)
  const demote = entry.status === 'approved' && (widensWindow(entry.promo_window, parsed.promoWindow) || aliasesChanged)

  const nextPool: CreativePoolEntry[] = config.creative_pool.map(e => {
    if (e.ref !== parsed.ref) return e
    const next: CreativePoolEntry = {
      ...e,
      promo_window: parsed.promoWindow,
    }
    if (demote) {
      next.status = 'candidate'
      delete next.approved_by
      delete next.approved_at
    }
    if (!hadWindow) {
      next.promo_window_set_by = setBy
      next.promo_window_set_at = nowIso
    }
    if (windowChanged || aliasesChanged) next.promo_window_changed_at = nowIso
    if (nextAliasRefs !== undefined) {
      if (nextAliasRefs.length > 0) next.alias_refs = nextAliasRefs
      else delete next.alias_refs
    }
    return next
  })

  const written = await writeConfigCas(clientId, { creative_pool: nextPool }, loadedVersion.version)
  if (!written.ok) {
    if (written.kind === 'conflict') {
      return NextResponse.json({ error: 'creative_pool_changed_concurrently', message: '素材池刚被别处改过，请刷新后重试。' }, { status: 409 })
    }
    return NextResponse.json({ error: written.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, demoted_to_candidate: demote, config: await loadAdStrategyConfig(clientId), version: await currentConfigVersion(clientId) })
}
