/**
 * 成交回写相关后台接口的公共入口守卫（Issue #1397）。
 *
 * 为什么抽出来：不是为了少写几行。原本四个路由各自重复
 * 「登录 → 是不是 admin → 是不是**这个客户**的 admin → 取审计元信息」四段，
 * 而 2026-09-05 子牙和魏征各自独立发现：其中一个路由**漏了第三段** ——
 * 受限管理员能裁决任意客户的记录，包括触发一次真实重发。
 *
 * 重复四段里漏一段，是这类代码的必然结局。所以做成一个入口，漏不掉。
 */

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getUserPermissions } from '@/lib/auth/whitelist'

export type ConversionActor = {
  actor: string | null
  /** 只有 reviewed_by 邮箱不够：会话被劫也是同一个邮箱。 */
  ip: string | null
  ua: string | null
  requestId: string
}

export type GuardResult =
  | { ok: true; ctx: ConversionActor }
  | { ok: false; response: NextResponse }

/**
 * 校验调用方，并（当给出 clientId 时）确认他有权碰这个客户。
 *
 * `clientId` 传 null 表示"目标客户还没读出来"，调用方**必须**在读到之后
 * 再调一次 `assertClientScope`。
 */
export async function guardConversionRoute(
  request: Request,
  clientId: string | null,
): Promise<GuardResult> {
  const admin = await requireAdmin()
  if (!admin.ok) {
    return { ok: false, response: NextResponse.json({ error: admin.error }, { status: admin.status }) }
  }

  const actor = admin.user.email ?? null

  if (clientId) {
    const denied = assertClientScope(actor, clientId)
    if (denied) return { ok: false, response: denied }
  }

  const fwd = request.headers.get('x-forwarded-for') ?? ''
  return {
    ok: true,
    ctx: {
      actor,
      ip: fwd.split(',')[0]?.trim() || null,
      ua: request.headers.get('user-agent'),
      requestId: crypto.randomUUID(),
    },
  }
}

/**
 * 受限管理员（只该看到自己那一个客户的演示/试用账号）不许碰别的客户。
 * 返回 null 表示放行。
 */
export function assertClientScope(actor: string | null, clientId: string): NextResponse | null {
  const perms = getUserPermissions(actor ?? '')
  if (perms?.allowedClientId && perms.allowedClientId !== clientId) {
    return NextResponse.json({ error: '无权处理该客户的记录' }, { status: 403 })
  }
  return null
}
