/**
 * /api/clients/[id]/platform/mailbox
 *
 * 客户自己的邮箱连了没有。
 *
 *   GET    → 这个客户已连接的邮箱（只回 microsoft_mail 这一种）
 *   DELETE → 断开某一条（?connectionId=）
 *
 * 跟 /platform/gbp 是同一形状（同一张连接表、同一套读写函数），差别只有一处：
 * `listConnections` 会把这个客户**所有**平台的连接都回出来，这里必须按
 * provider 过滤 —— 不过滤的话，设置页上的「邮箱」那一栏会把 Google 商家页
 * 的连接显示成一个邮箱，人照着它去点「断开」，断掉的是另一个平台。
 *
 * 断开时必须复核这条连接确实属于路由上的这个客户：连接 id 是请求里带进来的，
 * 不复核就等于谁拿到一个 id 谁就能断掉别人客户的邮箱。
 */

import { type NextRequest, NextResponse } from 'next/server'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'
import {
  listConnections,
  getConnectionById,
  revokeConnection,
} from '@/lib/platform-oauth/connection-store'
import { MICROSOFT_MAIL_PROVIDER } from '@/lib/microsoft/mail-oauth'

interface RouteContext {
  params: { id: string }
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const clientId = params.id

  const access = await requireOnboardingClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const all = await listConnections(clientId)
  return NextResponse.json({
    connections: all.filter((c) => c.provider === MICROSOFT_MAIL_PROVIDER),
  })
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const clientId = params.id
  const connectionId = req.nextUrl.searchParams.get('connectionId')

  const access = await requireOnboardingClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  if (!connectionId) {
    return NextResponse.json({ error: 'connectionId query param is required' }, { status: 400 })
  }

  const row = await getConnectionById(connectionId)
  // 不存在 / 不是这个客户的 / 不是邮箱连接 —— 一律当作没找到，不告诉调用方
  // 到底是哪一种（那等于帮人枚举别的客户有哪些连接）。
  if (!row || row.client_id !== clientId || row.provider !== MICROSOFT_MAIL_PROVIDER) {
    return NextResponse.json({ error: 'connection not found' }, { status: 404 })
  }

  await revokeConnection(connectionId)
  return NextResponse.json({ ok: true })
}
