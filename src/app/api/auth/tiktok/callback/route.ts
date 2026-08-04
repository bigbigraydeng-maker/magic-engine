/**
 * GET /api/auth/tiktok/callback?code=…&state=…
 *
 * TikTok 授权完回到这里。换令牌、存起来、跳回客户设置页。
 * 每条出口都跳回设置页并带一句人话 —— 在这里返回一段 JSON 报错,对点按钮的人就是死胡同。
 */

import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode, fetchDisplayName, TIKTOK_SCOPES, verifyState } from '@/lib/tiktok-oauth/client'
import { upsertConnection } from '@/lib/platform-oauth/connection-store'
import { PLATFORM_PROVIDERS } from '@/lib/platform-oauth/vocabulary'

type Outcome = 'connected' | 'denied' | 'bad_state' | 'exchange_failed'

function back(clientId: string | null, outcome: Outcome): NextResponse {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  const path = clientId ? `/dashboard/clients/${clientId}/settings` : '/dashboard'
  return NextResponse.redirect(`${appUrl}${path}?tiktok=${outcome}`)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams

  if (params.get('error')) return back(null, 'denied')

  const code = params.get('code')
  const state = params.get('state')
  if (!code || !state) return back(null, 'bad_state')

  const verified = verifyState(state)
  if (!verified) return back(null, 'bad_state')
  const { clientId } = verified

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'}/api/auth/tiktok/callback`
  const tokens = await exchangeCode(code, redirectUri)
  if (!tokens) return back(clientId, 'exchange_failed')

  const displayName = await fetchDisplayName(tokens.accessToken)

  await upsertConnection({
    clientId,
    provider: PLATFORM_PROVIDERS.TIKTOK,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    // 存**真实**有效期(TikTok 给的是 24 小时上下)。写成一年就等于把「该刷新了」这件事藏起来。
    tokenExpiry: new Date(Date.now() + tokens.expiresIn * 1000),
    accountId: tokens.openId,
    displayName: displayName || tokens.openId,
    // 存实际拿到的授权范围,不是我们请求的那份 —— 用户可能只勾了一部分
    scopes: tokens.scopes.length > 0 ? tokens.scopes : [...TIKTOK_SCOPES],
  })

  return back(clientId, 'connected')
}
