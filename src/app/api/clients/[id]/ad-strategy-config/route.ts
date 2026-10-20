/**
 * GET/PATCH /api/clients/[id]/ad-strategy-config
 *
 * Reads and updates a client's Ad Strategy Engine control settings (on/off,
 * digest recipients, daily budget cap, autonomy mode, creative pool). Backs the
 * Settings panel (P21.K.5). Config edits go through this route — never raw SQL —
 * per the FDE-config red-line. Creative-pool *approval* is NOT done here; it has
 * its own endpoint (/creative-pool/approve).
 *
 * autonomy_mode / daily_budget_cap_cents changes also emit the Inngest wake-up
 * events (WP3.1a); the Kernel policy table is never written here.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import {
  loadAdStrategyConfig, loadAdStrategyConfigWithSource, loadConfigVersion, parseCreativePool, writeConfigCas,
  type ConfigVersion, type CreativePoolEntry,
} from '@/lib/ads-strategy/config'
import { notifyAutonomyModeChanged } from '@/lib/ads-strategy/autonomy/notify'

export const dynamic = 'force-dynamic'

/** 推广期相关的素材池键：只许 /creative-pool/promo-window 写。 */
const PROMO_ENTRY_KEYS = ['promo_window', 'alias_refs', 'promo_window_set_by', 'promo_window_set_at', 'promo_window_changed_at']

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
  // 换成 requireGlobalAdmin：同一判据，多带回 user.email 记 autonomy_mode_updated_by（spec 2026-09-25 §4.9）。
  const staff = await requireGlobalAdmin()
  if (!staff.ok) return NextResponse.json({ error: staff.error }, { status: staff.status })
  const actorEmail = staff.user.email ?? null

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
  const updatedAt = String(update.updated_at)
  // 🔴 读不出改之前的设置时，不拿默认值（observe）当「改之前」：那样把自动模式改回 observe
  //    会被判成「没变」、不发收紧事件（魏征复审）。也不拒绝保存：设置表持续读不出时，
  //    收紧（调低上限 / 改回 observe）正是最需要能存进去的操作（卫青复审）。
  //    before = null 表示「不知道改之前是什么」，下面一律按「变了」发叫醒铃。
  // 改素材池是整数组读改写：先读版本、再读内容，写的时候带版本比较（并发保存会得到 409，不会互相覆盖）。
  let poolVersion: ConfigVersion | null = null
  if (body.creative_pool !== undefined) {
    const v = await loadConfigVersion(clientId)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 503 })
    poolVersion = v.version
  }
  const loadedBefore = await loadAdStrategyConfigWithSource(clientId)
  const before = loadedBefore.source === 'fallback' ? null : loadedBefore.config

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
    update.autonomy_mode_updated_by = actorEmail
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
    // 推广期、别名及其时间戳只能走 /creative-pool/promo-window（它记录是谁、什么时候设的）。
    // 这条通用路由既不接受客户端带这些键，也不能在重写素材池时把已有的抹掉。
    const promoTainted = body.creative_pool.some(e =>
      typeof e === 'object' && e !== null && PROMO_ENTRY_KEYS.some(k => k in e))
    if (promoTainted) {
      return NextResponse.json({ error: 'promo_window / alias_refs must go through /creative-pool/promo-window' }, { status: 400 })
    }
    const parsed = parseCreativePool(body.creative_pool)
    if (parsed.length !== body.creative_pool.length) {
      return NextResponse.json({ error: 'creative_pool has malformed entries (need kind, ref, status=candidate)' }, { status: 400 })
    }
    // 读不出现有素材池就没法保住已有的推广期 —— 拒绝重写素材池，其它设置照常能存。
    if (before === null) {
      return NextResponse.json({ error: 'creative_pool_existing_unreadable' }, { status: 503 })
    }
    // 新加的素材 id 不得恰好是别的素材已登记的别名（否则同一个视频会同时属于两条素材）。
    const aliasOwner = parsed.find(e =>
      !before.creative_pool.some(x => x.ref === e.ref) &&
      before.creative_pool.some(x => x.alias_refs?.includes(e.ref)))
    if (aliasOwner) {
      return NextResponse.json({ error: 'ref_conflicts_with_existing_alias', ref: aliasOwner.ref }, { status: 400 })
    }
    update.creative_pool = parsed.map((e): CreativePoolEntry => {
      const existing = before.creative_pool.find(x => x.ref === e.ref)
      // 已存在的素材保持原有批准状态（界面保存素材池时会把旧条目一起提交，不能因此把已批准的全降回候选）；
      // 新加的素材一律是候选。这里只是「保留服务端已有的」，客户端带 approved 仍然在上面被拒。
      const next: CreativePoolEntry = { kind: e.kind, ref: e.ref, status: existing?.status ?? 'candidate' }
      if (existing?.approved_by !== undefined) next.approved_by = existing.approved_by
      if (existing?.approved_at !== undefined) next.approved_at = existing.approved_at
      if (existing?.promo_window !== undefined) next.promo_window = existing.promo_window
      if (existing?.alias_refs !== undefined) next.alias_refs = existing.alias_refs
      if (existing?.promo_window_set_by !== undefined) next.promo_window_set_by = existing.promo_window_set_by
      if (existing?.promo_window_set_at !== undefined) next.promo_window_set_at = existing.promo_window_set_at
      if (existing?.promo_window_changed_at !== undefined) next.promo_window_changed_at = existing.promo_window_changed_at
      return next
    })
  }

  if (poolVersion !== null) {
    const written = await writeConfigCas(clientId, update, poolVersion)
    if (!written.ok) {
      if (written.kind === 'conflict') {
        return NextResponse.json({ error: 'creative_pool_changed_concurrently', message: '设置刚被别处改过，请刷新后重试。' }, { status: 409 })
      }
      return NextResponse.json({ error: written.message }, { status: 500 })
    }
  } else {
    const { error } = await supabaseAdmin
      .from('ad_strategy_configs')
      .upsert(update, { onConflict: 'client_id' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 意向真的变了才发叫醒铃（spec §4.4）；发送失败不影响保存，每日 reconcile 会追上。
  const envelopeChanged =
    (update.autonomy_mode !== undefined && (before === null || update.autonomy_mode !== before.autonomy_mode)) ||
    (update.daily_budget_cap_cents !== undefined &&
      (before === null || update.daily_budget_cap_cents !== before.daily_budget_cap_cents))
  const syncEvents = envelopeChanged
    ? await notifyAutonomyModeChanged(clientId, updatedAt, { relaxed: true })
    : { sent: false, events: 0 }

  const config = await loadAdStrategyConfig(clientId)
  return NextResponse.json({ success: true, config, sync_events: syncEvents })
}
