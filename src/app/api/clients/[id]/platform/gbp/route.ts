/**
 * /api/clients/[id]/platform/gbp
 *
 * Manage a client's Google Business Profile OAuth connections.
 *
 *   GET    → list active GBP connections for this client
 *   DELETE → revoke a specific connection (?connectionId=)
 *
 * Auth: requireOnboardingClientAccess — session cookie.
 * Tenant isolation on DELETE: verifies the connection's client_id matches
 * the route's [id] param before revoking.
 *
 * Phase 24.A.6
 */

import { type NextRequest, NextResponse } from 'next/server'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'
import {
  listConnections,
  getConnectionById,
  revokeConnection,
} from '@/lib/platform-oauth/connection-store'
import { PLATFORM_PROVIDERS } from '@/lib/platform-oauth/vocabulary'

/**
 * 这条路由只管 Google 商家页。
 *
 * ## 2026-08-03：漏了这个过滤，面板显示的是别人的连接
 *
 * `listConnections(clientId)` 返回这个客户**所有平台**的连接（邮箱、Google Ads、
 * 商家页……），按创建时间倒序。这里原先直接把整个列表交给前端，而 GbpPanel 取的是
 * `connections.find(c => c.status === 'active')` —— **第一条 active 的，不管什么平台**。
 *
 * 结果：CTS 连上公司邮箱之后，商家页那一块显示成「✓ 已连接 info@ctstours.co.nz」，
 * 而它下面一行还老老实实写着「还没连上 Google 商家页」。同一块区域自相矛盾。
 *
 * 显示错只是表象，**真正危险的是 DELETE**：面板上那颗红色「断开连接」按钮传的是
 * 它当时显示的那条连接的 id，而 DELETE 原先只校验 `client_id`，不校验 provider ——
 * 点一下商家页的「断开连接」，断掉的是**刚连好的邮箱**。
 *
 * 邮箱和 Google Ads 那两条路由都过滤了 provider，只有这条漏了。
 */
const GBP_PROVIDER = PLATFORM_PROVIDERS.GOOGLE_GBP

interface RouteContext {
  params: { id: string }
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: RouteContext) {
  const clientId = params.id

  const access = await requireOnboardingClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const connections = await listConnections(clientId)
  return NextResponse.json({
    connections: connections.filter((c) => c.provider === GBP_PROVIDER),
  })
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const clientId     = params.id
  const connectionId = req.nextUrl.searchParams.get('connectionId')

  if (!connectionId) {
    return NextResponse.json(
      { error: 'connectionId query param is required' },
      { status: 400 },
    )
  }

  const access = await requireOnboardingClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // Tenant isolation + provider isolation.
  //
  // provider 这一条**不是可有可无的严谨**：少了它，商家页面板上那颗「断开连接」
  // 就能断掉这个客户的**邮箱**连接（面板本来就在错误地显示邮箱，见文件头）。
  // 三种情况一律回 404，不告诉调用方是哪一种 —— 区分开等于帮人枚举别的连接。
  const row = await getConnectionById(connectionId)
  if (!row || row.client_id !== clientId || row.provider !== GBP_PROVIDER) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }

  await revokeConnection(connectionId)
  return NextResponse.json({ success: true })
}
