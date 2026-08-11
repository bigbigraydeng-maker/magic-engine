/**
 * GET /api/auth/tiktok/connect?client_id=<uuid>
 *
 * 开始 TikTok 授权。跟 Meta 那条流程一模一样的形状:签名 state 带客户 id,跳去 TikTok。
 * 授权完 TikTok 回到 /api/auth/tiktok/callback。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { buildAuthUrl, buildState } from '@/lib/tiktok-oauth/client'

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const clientId = req.nextUrl.searchParams.get('client_id')
  if (!clientId) {
    return NextResponse.json({ error: 'client_id is required' }, { status: 400 })
  }

  // 谁都能打开这个地址的话,就等于谁都能把自己的 TikTok 挂到别人的客户上
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const redirectUri = `${appUrl()}/api/auth/tiktok/callback`
    return NextResponse.redirect(buildAuthUrl(buildState(clientId), redirectUri))
  } catch (err) {
    // 应用凭证没配 —— 说清缺哪个,别甩 500
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    )
  }
}
