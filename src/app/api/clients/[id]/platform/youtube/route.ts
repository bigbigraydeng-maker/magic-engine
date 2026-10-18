/**
 * /api/clients/[id]/platform/youtube
 *
 *   GET    -> list YouTube publishing connections for this client
 *   DELETE -> revoke one (?connectionId=); provider and client are both checked
 *
 * Provider isolation matters: see platform/gbp/route.ts for the 2026-08-03 incident.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'
import {
  listConnections,
  getConnectionById,
  revokeConnection,
} from '@/lib/platform-oauth/connection-store'
import { PLATFORM_PROVIDERS } from '@/lib/platform-oauth/vocabulary'

const YT_PROVIDER = PLATFORM_PROVIDERS.GOOGLE_YOUTUBE

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
    connections: connections.filter((c) => c.provider === YT_PROVIDER),
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
  if (!row || row.client_id !== clientId || row.provider !== YT_PROVIDER) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }

  await revokeConnection(connectionId)
  return NextResponse.json({ success: true })
}
