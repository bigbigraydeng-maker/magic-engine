/**
 * GET /api/auth/microsoft/mail/callback?code=...&state=...
 *
 * 客户在 Microsoft 那边点完「同意」之后跳回这里。拿授权码换令牌、问清楚刚才
 * 登录的到底是哪个邮箱、存进 platform_oauth_connections，然后把人带回设置页。
 *
 * 这个页面是给**客户老板 / 他的 IT 同事**看的，不是给开发看的：所有结果都以
 * 一句人话带回设置页（`?mail=ok&addr=…` / `?mail=error&why=…`），页面上直接
 * 显示连上的是哪个邮箱地址 —— 连错邮箱是这条管道最贵的错误（会把别的部门
 * 甚至老板私人的邮件抓进客户的 CRM），必须让人当场看见。
 *
 * 安全：state 只带随机数出门，clientId 留在 httpOnly cookie 里。两样都对上
 * 才继续 —— 否则别人可以拿一个自己的授权码，把他的邮箱挂到你的客户名下。
 */

import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { upsertConnection } from '@/lib/platform-oauth/connection-store'
import {
  exchangeCodeForTokens,
  fetchMailboxAddress,
  MICROSOFT_MAIL_PROVIDER,
  MICROSOFT_MAIL_SCOPES,
  MICROSOFT_STATE_COOKIE,
} from '@/lib/microsoft/mail-oauth'

/** 带着一句人话回设置页。不把技术细节甩到浏览器地址栏之外的任何地方。 */
function back(clientId: string | null, params: Record<string, string>): NextResponse {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.magicengine.com.au'
  const path = clientId ? `/dashboard/clients/${clientId}/settings` : '/dashboard'
  const url = new URL(`${base.replace(/\/$/, '')}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = NextResponse.redirect(url.toString())
  // 用完即焚 —— 随机数留着只会变成一把可以被重放的钥匙。
  res.headers.set('Set-Cookie', `${MICROSOFT_STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`)
  return res
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  // 客户在 Microsoft 页面上点了「取消」，或者管理员拒绝了 —— 不是故障，
  // 照实说一句，别让人以为系统坏了。
  const denied = url.searchParams.get('error')

  const cookie = req.cookies.get(MICROSOFT_STATE_COOKIE)?.value ?? ''
  const [nonce, clientId] = cookie.split(':')
  const knownClient = clientId || null

  // 管理员走 adminconsent 端点回来时带的是这个，**没有授权码**（见 mail-oauth
  // 里为什么必须分两步）。这一步不存任何东西 —— 门开了，还得 info@ 自己进。
  const adminConsent = url.searchParams.get('admin_consent')

  if (denied) {
    return back(knownClient, { mail: 'error', why: '在 Microsoft 那边取消了授权' })
  }
  if (adminConsent) {
    return back(
      knownClient,
      adminConsent.toLowerCase() === 'true'
        ? { mail: 'admin_ok' }
        : { mail: 'error', why: '管理员没有批准这个应用' },
    )
  }
  if (!nonce || !clientId || !state || state !== nonce) {
    // 对不上就当没发生。不解释哪里对不上 —— 那等于告诉试探的人下一步怎么试。
    return back(knownClient, { mail: 'error', why: '授权链接已过期，请重新点一次' })
  }
  if (!code) {
    return back(knownClient, { mail: 'error', why: '没有收到授权码，请重新点一次' })
  }

  // cookie 能被伪造，所以权限要重新验一遍：cookie 只用来记住「是哪个客户」，
  // 不用来证明「你有权管他」。
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return back(null, { mail: 'error', why: '你没有这个客户的管理权限' })
  }

  const exchanged = await exchangeCodeForTokens(code)
  if (!exchanged.ok) {
    return back(clientId, { mail: 'error', why: exchanged.error })
  }

  const address = await fetchMailboxAddress(exchanged.tokens.access_token)
  if (!address) {
    // 问不出地址就不存。存了等于让人对着一个不知道是谁的邮箱点「开始同步」。
    return back(clientId, { mail: 'error', why: '连上了，但读不到邮箱地址，请重试一次' })
  }

  try {
    await upsertConnection({
      clientId,
      provider: MICROSOFT_MAIL_PROVIDER,
      accessToken: exchanged.tokens.access_token,
      refreshToken: exchanged.tokens.refresh_token,
      tokenExpiry: new Date(Date.now() + exchanged.tokens.expires_in * 1000),
      // 邮箱地址就是这条连接的身份 —— 同一个客户连了第二个邮箱是新增一条，
      // 不是把第一个覆盖掉。
      accountId: address,
      displayName: address,
      scopes: [...MICROSOFT_MAIL_SCOPES],
    })
  } catch (err) {
    return back(clientId, {
      mail: 'error',
      why: err instanceof Error ? err.message : '保存授权失败',
    })
  }

  return back(clientId, { mail: 'ok', addr: address })
}
