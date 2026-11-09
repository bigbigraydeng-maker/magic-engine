/**
 * GET /api/auth/tiktok/callback?code=…&state=…
 *
 * TikTok 授权完回到这里。换令牌、存起来、跳回客户设置页。
 * 每条出口都跳回设置页并带一句人话 —— 在这里返回一段 JSON 报错,对点按钮的人就是死胡同。
 */

import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode, fetchDisplayName, TIKTOK_SCOPES, TIKTOK_STATE_COOKIE, verifyState } from '@/lib/tiktok-oauth/client'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { checkSocialAccountAvailable } from '@/lib/platform-oauth/connection-guard'
import { upsertConnection } from '@/lib/platform-oauth/connection-store'
import { PLATFORM_PROVIDERS } from '@/lib/platform-oauth/vocabulary'

type Outcome =
  | 'connected' | 'denied' | 'bad_state' | 'exchange_failed' | 'missing_scopes'
  | 'needs_team_check' | 'has_other_account' | 'save_failed'

// The partial unique index (one live connection per platform account) rejects a lost race with this text.
const isDuplicateAccount = (err: unknown): boolean =>
  (err as { code?: string } | null)?.code === '23505'
  || (err instanceof Error && /duplicate key value violates unique constraint/i.test(err.message))

function back(clientId: string | null, outcome: Outcome): NextResponse {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  const path = clientId ? `/dashboard/clients/${clientId}/settings` : '/dashboard'
  const response = NextResponse.redirect(`${appUrl}${path}?tab=connect&tiktok=${outcome}`)
  response.cookies.set(TIKTOK_STATE_COOKIE, '', {
    httpOnly: true, secure: new URL(appUrl).protocol === 'https:',
    sameSite: 'lax', path: '/api/auth/tiktok', maxAge: 0,
  })
  return response
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams

  const code = params.get('code')
  const state = params.get('state')
  if (!state || req.cookies.get(TIKTOK_STATE_COOKIE)?.value !== state) {
    return back(null, 'bad_state')
  }

  const verified = verifyState(state)
  if (!verified) return back(null, 'bad_state')
  const { clientId } = verified
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return back(null, 'bad_state')
  // Cancellation still belongs to this customer only after both checks pass.
  if (params.get('error')) return back(clientId, 'denied')
  if (!code) return back(clientId, 'bad_state')

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'}/api/auth/tiktok/callback`
  const tokens = await exchangeCode(code, redirectUri)
  if (!tokens) return back(clientId, 'exchange_failed')
  if (!tokens.openId || !TIKTOK_SCOPES.every(scope => tokens.scopes.includes(scope))) {
    return back(clientId, 'missing_scopes')
  }

  const displayName = await fetchDisplayName(tokens.accessToken)

  // 授权回来先问一句:这个账号是不是已经是别的客户的 / 这个客户是不是已经有另一个账号。
  // 提示语不带对方客户信息,避免把别的客户的存在泄露给当前页面。
  try {
    const verdict = await checkSocialAccountAvailable(clientId, PLATFORM_PROVIDERS.TIKTOK, tokens.openId)
    if (verdict === 'account_in_use') return back(clientId, 'needs_team_check')
    if (verdict === 'has_other_account') return back(clientId, 'has_other_account')
  } catch {
    return back(clientId, 'save_failed')
  }

  try {
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
      scopes: tokens.scopes,
    })
  } catch (err) {
    return back(clientId, isDuplicateAccount(err) ? 'needs_team_check' : 'save_failed')
  }

  return back(clientId, 'connected')
}
