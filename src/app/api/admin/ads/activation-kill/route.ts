/**
 * 广告「紧急开关」路由 —— 一键停掉某客户「开启私信广告」通道的入口。
 *
 * 做法：给该客户**每个注册账户**各写一行 sticky trip（reason 以
 * `manual_emergency_stop` 开头）。开启广告前读：客户任一注册账户熔断中，
 * 就拒绝开启（见 `activation-kill.ts`）。
 *
 * 🔴 只挡**新的开启**，并冻结这些账户上 ME 的自动动作；**不会停已经在投的广告**。
 * 🔴 身份从 `requireGlobalAdmin()` 的 session email 取，绝不从 body 读。
 * 🔴 读不到账户清单就整个请求失败，不写任何行（fail-closed）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { readCircuitState } from '@/lib/ads-strategy/circuit-state'
import { buildKillTripRows, readActivationKillState } from '@/lib/ads-strategy/activation-kill'

export const dynamic = 'force-dynamic'

/** 跟数据库那条 CHECK 同一个判据，早一层拒掉，错误信息给人看。 */
const ACTOR_EMAIL_SHAPE = /^[^@\s]+@[^@\s]+$/

const NOTE =
  '只挡新的开启，并冻结这些账户上 ME 的自动动作；不会停已经在投的广告（要停在投的走现有暂停动作）。解除请用熔断解除入口。'

interface KillBody {
  readonly clientId?: unknown
  readonly reason?: unknown
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** 鉴权 + 取操作人邮箱。失败时返回一个可直接返回的响应。 */
async function authorize(): Promise<
  { ok: true; email: string } | { ok: false; response: NextResponse }
> {
  const admin = await requireGlobalAdmin()
  if (!admin.ok) {
    return { ok: false, response: NextResponse.json({ error: admin.error }, { status: admin.status }) }
  }
  const email = (admin.user.email ?? '').toLowerCase().trim()
  if (!ACTOR_EMAIL_SHAPE.test(email)) {
    const error = '拿不到你的登录邮箱，无法记录是谁按的紧急开关 —— 请重新登录后再试'
    return { ok: false, response: NextResponse.json({ error }, { status: 403 }) }
  }
  return { ok: true, email }
}

/** 解析并校验 POST body。 */
function parseBody(
  body: KillBody,
): { ok: true; clientId: string; reason: string } | { ok: false; response: NextResponse } {
  const clientId = readNonEmptyString(body?.clientId)
  if (!clientId) {
    return { ok: false, response: NextResponse.json({ error: '缺少 clientId' }, { status: 400 }) }
  }
  if (typeof body?.reason !== 'string') {
    return { ok: false, response: NextResponse.json({ error: '缺少 reason' }, { status: 400 }) }
  }
  return { ok: true, clientId, reason: body.reason }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authorize()
  if (!auth.ok) return auth.response

  let body: KillBody
  try {
    body = (await req.json()) as KillBody
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const parsed = parseBody(body)
  if (!parsed.ok) return parsed.response

  const reg = await getRegisteredAccountIds(parsed.clientId)
  if (typeof reg.error === 'string' && reg.error !== '') {
    return NextResponse.json({ error: reg.error }, { status: 502 })
  }
  const accountIds = (reg.ids ?? []).filter((id) => id.trim() !== '')
  if (accountIds.length === 0) {
    const error = '这个客户没有登记广告账户，无法设置紧急开关'
    return NextResponse.json({ error }, { status: 409 })
  }

  const built = buildKillTripRows({
    clientId: parsed.clientId,
    accountIds,
    reason: parsed.reason,
    actorEmail: auth.email,
    at: new Date(),
  })
  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('ads_circuit_events')
    .insert(built.rows)
    .select('id')

  if (error) {
    return NextResponse.json({ error: `写紧急开关失败：${error.message}` }, { status: 500 })
  }

  return NextResponse.json({
    engaged: true,
    accounts: built.rows.map((r) => r.ad_account_id),
    tripIds: (data ?? []).map((r) => r.id),
    actor: `human:${auth.email}`,
    note: NOTE,
  })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authorize()
  if (!auth.ok) return auth.response

  const clientId = readNonEmptyString(req.nextUrl.searchParams.get('clientId'))
  if (!clientId) {
    return NextResponse.json({ error: '缺少 clientId' }, { status: 400 })
  }

  const state = await readActivationKillState(
    {
      listAccounts: (id) => getRegisteredAccountIds(id),
      readCircuit: (id, acct) => readCircuitState(supabaseAdmin, id, acct),
    },
    clientId,
  )
  return NextResponse.json(state)
}
