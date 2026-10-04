/**
 * 人工解除广告熔断 —— 写 `ads_circuit_events` 的 `kind = 'release'` 行的**唯一**入口。
 *
 * 契约见设计稿 `2026-09-25-ads-impact-wp3-design-v1.md` v2.5 §6.4。
 *
 * ── 为什么只有这一个入口，而且只在路由层 ──────────────────────────────
 * 熔断是派生态（`circuit-state.ts`）：`sticky` 的 trip **只能靠一行 release 解除**，
 * 时间过期对它无效。所以「谁能写 release」＝「谁能解除熔断」＝「谁能让自治重新动手」。
 *
 * 所以 `src/lib/**` 里**刻意没有**任何写 release 的函数（架构测试盯着这条）：
 * 一旦库层有了这个能力，任何 cron / worker / 别的路由都能 import 它自动解除，
 * 而「必须人解」这件事就只剩个说法。非 sticky 的 24h 过期是纯读取时计算，
 * 不需要任何写入者，所以库层不需要这个能力。
 *
 * ── 身份从哪来 ──────────────────────────────────────────────────
 * `actor` 从 `requireGlobalAdmin()` 返回的 session email 取，**绝不从 body 读**：
 * body 里给 actor 等于让调用方自报身份，那这条账就没有意义。
 *
 * 🔴 **email 取不到 → 直接拒，不许 `?? ''` 兜底。**
 *    `User.email` 可空（`require-admin.ts:27` / `:84` 自己就写着 `session.user.email ?? ''`），
 *    顺手兜底会写出 `actor = 'human:'` —— 一条**没有身份的「人解除过」**的账。
 *    数据库那条 CHECK（`^human:[^@[:space:]]+@[^@[:space:]]+`）也会拒它，
 *    但两层各咬一次：这一层拒得早、错误信息说得清；那一层管住绕过这个路由的写入。
 *
 * ── 为什么只调 requireGlobalAdmin，不再叠一个 guardGlobalAdmin ────────
 * `guardGlobalAdmin()` 的实现就是 `requireGlobalAdmin()` 再把失败包成 `NextResponse`
 * （`require-admin.ts:65-71`），判据完全相同。两个都调 = 查会话两遍。
 * 而本路由要拿 email，必须用 `requireGlobalAdmin`。架构测试按 v2.5 认这两个名字之一。
 *
 * ── 为什么要「全局」admin，不是普通 admin ────────────────────────────
 * 解除熔断影响的是这个客户之后所有自动动作放不放行。受限管理员
 * （`DEMO_ADMINS`，带 `allowedClientId`）虽然 `role === 'admin'`，但不该碰这个开关。
 * 判据同 `facebook-page` 那条 PATCH（AD-SEC-4）。
 *
 * v1 单 PM，「翻自治开关」和「解 sticky 熔断」同一个人可接受（v2.5 §6.4 写明）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { CIRCUIT_NON_STICKY_TTL_MS } from '@/lib/ads-strategy/circuit-state'
import { KILL_REASON_PREFIX } from '@/lib/ads-strategy/activation-kill'
import {
  APPROVER_ENV_NAME,
  isApproverEmail,
  parseApproverList,
} from '@/lib/ads-strategy/activation-approver'

/** 跟数据库那条 CHECK 同一个判据，早一层拒掉，错误信息给人看。 */
const ACTOR_EMAIL_SHAPE = /^[^@\s]+@[^@\s]+$/

interface ReleaseBody {
  readonly clientId?: unknown
  readonly adAccountId?: unknown
  readonly note?: unknown
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const admin = await requireGlobalAdmin()
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  // 🔴 见文件头：取不到身份就不写账，不兜底成空串。
  const email = (admin.user.email ?? '').toLowerCase().trim()
  if (!ACTOR_EMAIL_SHAPE.test(email)) {
    return NextResponse.json(
      { error: '拿不到你的登录邮箱，无法记录「谁解除的」—— 请重新登录后再试' },
      { status: 403 },
    )
  }
  const actor = `human:${email}`

  let body: ReleaseBody
  try {
    body = (await req.json()) as ReleaseBody
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const clientId = readNonEmptyString(body?.clientId)
  const adAccountId = readNonEmptyString(body?.adAccountId)
  if (!clientId || !adAccountId) {
    return NextResponse.json({ error: '缺少 clientId 或 adAccountId' }, { status: 400 })
  }
  const note = readNonEmptyString(body?.note)

  const now = new Date()
  const cutoff = new Date(now.getTime() - CIRCUIT_NON_STICKY_TTL_MS).toISOString()

  // ① 取这个账户**还可能算熔断**的 trip：sticky 的（时间对它无效）+ 24h 内的。
  //
  // 🔴 判据跟 `readCircuitState` 保持一致，是为了让「看板说熔断中」和
  //    「这里解除了什么」指的是同一批行。两边判据一旦分家，就会出现
  //    「解除成功但看板还说熔断中」这种谁也说不清的状态。
  const { data: trips, error: tripError } = await supabaseAdmin
    .from('ads_circuit_events')
    .select('id, reason, sticky, created_at')
    .eq('client_id', clientId)
    .eq('ad_account_id', adAccountId)
    .eq('kind', 'trip')
    .or(`sticky.eq.true,created_at.gt.${cutoff}`)
    .order('created_at', { ascending: false })

  if (tripError) {
    return NextResponse.json({ error: `查熔断记录失败：${tripError.message}` }, { status: 500 })
  }

  const candidates = (trips ?? []) as Array<{
    id: string
    reason: string
    sticky: boolean
    created_at: string
  }>
  if (candidates.length === 0) {
    return NextResponse.json({ released: 0, message: '这个账户当前没有需要解除的熔断' })
  }

  // ② 已经被解除过的排掉。重复解除不是错误，但不该再写一行账。
  const { data: releases, error: releaseError } = await supabaseAdmin
    .from('ads_circuit_events')
    .select('trip_event_id')
    .eq('client_id', clientId)
    .eq('ad_account_id', adAccountId)
    .eq('kind', 'release')
    .in('trip_event_id', candidates.map((row) => row.id))

  if (releaseError) {
    return NextResponse.json({ error: `查解除记录失败：${releaseError.message}` }, { status: 500 })
  }

  const alreadyReleased = new Set(
    ((releases ?? []) as Array<{ trip_event_id: string | null }>)
      .map((row) => row.trip_event_id)
      .filter((id): id is string => id !== null),
  )
  const open = candidates.filter((row) => !alreadyReleased.has(row.id))
  if (open.length === 0) {
    return NextResponse.json({ released: 0, message: '这个账户当前没有需要解除的熔断' })
  }

  // 紧急开关打开的熔断：名单配了就只有授权人能解；名单没配时退回原行为（任何全局管理员），
  // 避免"开关解不掉 → 该账户自动动作永久被冻结"的死锁（名单没配时开启通道本来也开不了）。
  const manualTrips = open.filter((trip) => trip.reason.startsWith(KILL_REASON_PREFIX))
  if (manualTrips.length > 0) {
    const listConfigured = parseApproverList(process.env[APPROVER_ENV_NAME]).length > 0
    if (listConfigured && !isApproverEmail(email)) {
      return NextResponse.json(
        { error: '这是紧急开关打开的熔断，只有授权人能解除。你的账号不在授权人名单里' },
        { status: 403 },
      )
    }
  }

  // ③ **每条未解 trip 各写一行 release**，不是写一行「全解了」。
  //
  // 🔴 为什么不能一行顶多条：`trip_event_id` 是 1:1 指回那条 trip 的，而派生态判据
  //    （`circuit-state.ts` ②）是逐条 trip 问「它被 release 过吗」。写一行只会解掉
  //    它指向的那一条，剩下的仍然未解 —— 于是接口回「已解除」、看板仍说「熔断中」。
  //    同秒并发触发的多条 trip 是独立的事件，解除也必须逐条落账。
  const rows = open.map((trip) => ({
    client_id: clientId,
    ad_account_id: adAccountId,
    kind: 'release' as const,
    trip_event_id: trip.id,
    reason: note ?? `人工解除（原因：${trip.reason}）`,
    // release 行本身不带 sticky 语义，固定 false（sticky 说的是那条 trip 的性质）
    sticky: false,
    evidence: { released_trip_reason: trip.reason, released_trip_sticky: trip.sticky },
    actor,
  }))

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('ads_circuit_events')
    .insert(rows)
    .select('id')

  if (insertError) {
    return NextResponse.json({ error: `写解除记录失败：${insertError.message}` }, { status: 500 })
  }

  return NextResponse.json({
    released: inserted?.length ?? 0,
    releasedTripIds: open.map((row) => row.id),
    actor,
  })
}
