/**
 * GET /api/auth/microsoft/mail/start?clientId={meClientId}
 *
 * 开始连接客户自己的邮箱。把浏览器送到 Microsoft 的登录页，登录的人用
 * **他自己收 info@ 的那个账号**同意一次，我们就能把发进来的邮件接回 CRM。
 *
 * 跟 Google GBP 那条流程刻意保持同一形状（一次性随机数进 httpOnly cookie、
 * 只有随机数进 state、clientId 留在服务端），差别只在两个 Microsoft 特有的点：
 *
 *  · `prompt=consent` —— 强制每次都回传刷新令牌。少了它，第二次连接会拿到
 *    一个没有刷新能力的令牌，一小时后同步安静地停掉。
 *  · scope 里必须带 `offline_access`，且要跟刷新时传的那一串**完全一致**
 *    （见 lib/microsoft/mail-oauth.ts 里的说明）。
 *
 * Responses:
 *   302  → Microsoft 登录页
 *   400  缺 clientId
 *   401 / 403  没有这个客户的管理权限
 *   500  没配 MICROSOFT_CLIENT_ID
 */

import { type NextRequest, NextResponse } from 'next/server'
import * as nodeCrypto from 'crypto' // 命名空间导入 —— 测试里要 vi.mock 拦截
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import {
  MICROSOFT_ADMIN_CONSENT_URL,
  MICROSOFT_AUTH_URL,
  MICROSOFT_MAIL_SCOPES,
  MICROSOFT_STATE_COOKIE,
  microsoftRedirectUri,
} from '@/lib/microsoft/mail-oauth'

/** 随机数只活 10 分钟 —— 够一个人登录一次，不够别人捡去用。 */
export const STATE_TTL_SECS = 600

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ error: 'clientId query param is required' }, { status: 400 })
  }

  // 谁能连一个客户的邮箱，跟谁能管这个客户是同一件事 —— 复用同一道门。
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const msClientId = process.env.MICROSOFT_CLIENT_ID
  if (!msClientId) {
    return NextResponse.json({ error: 'MICROSOFT_CLIENT_ID is not configured' }, { status: 500 })
  }

  // cookie 里放 "随机数:clientId"，回调时两样都要对上 —— 只有随机数出门。
  const nonce = nodeCrypto.randomBytes(16).toString('hex')
  const cookieVal = `${nonce}:${clientId}`

  // `?admin=1` = 这家公司的 Microsoft 365 管理员来替全公司批准一次。
  //
  // 有些企业租户关掉了「员工可以自己给第三方应用授权」，这时 info@ 自己点会
  // 撞上「需要管理员批准」。管理员走这条链接批一次，info@ 再按原来的按钮就通了。
  // 这条路**不换令牌、不存任何东西** —— 它只是开门，进门的还得是 info@ 本人
  // （否则会把管理员自己的邮箱存成客户的收信箱）。
  const adminConsent = req.nextUrl.searchParams.get('admin') === '1'

  const authUrl = new URL(adminConsent ? MICROSOFT_ADMIN_CONSENT_URL : MICROSOFT_AUTH_URL)
  authUrl.searchParams.set('client_id', msClientId)
  authUrl.searchParams.set('redirect_uri', microsoftRedirectUri())
  authUrl.searchParams.set('state', nonce)

  // 两条路**都要**带 scope。
  //
  // 2026-08-03 踩到：管理员那条路原先没带，于是批下去的是应用注册里静态配置的
  // 权限（我们一个都没配，全走动态）—— 等于批了个空集合。管理员点完、页面也
  // 跳回来了，`info@` 再去连照样撞墙。v2.0 的 adminconsent 端点把 `scope`
  // 列为**必填**，不是可选。
  authUrl.searchParams.set('scope', MICROSOFT_MAIL_SCOPES.join(' '))

  if (!adminConsent) {
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('response_mode', 'query')
    // 每次都要刷新令牌 —— 没有它，一小时后同步会安静地停掉。
    authUrl.searchParams.set('prompt', 'consent')

    // 想连哪个邮箱，说给 Microsoft 听。
    //
    // 2026-08-02 CTS 踩到：浏览器里已经登着一个 Microsoft 账号时，Microsoft
    // **不会问**你要用哪个 —— 直接拿当前这个走完全程。结果连上的是管理员自己的
    // `bdm@`，而他想连的是 `info@`。连错邮箱是这条管道最贵的错误（会把别人的
    // 私人邮件抓进客户的 CRM），不能靠人在登录页上自己反应过来。
    //
    // 这只是个「提示」不是「限制」：真正连上的是哪个，仍然由回调那边去问
    // Microsoft 要（fetchMailboxAddress），并显示在设置页上让人当面核对。
    const hint = req.nextUrl.searchParams.get('loginHint')?.trim()
    if (hint) authUrl.searchParams.set('login_hint', hint)
  }

  const res = NextResponse.redirect(authUrl.toString())
  // SameSite 必须是 Lax 不能是 Strict：从 Microsoft 跳回来是跨站的 GET，
  // Strict 会让 cookie 不被带上，回调侧看起来就像有人在伪造请求。
  res.headers.set(
    'Set-Cookie',
    `${MICROSOFT_STATE_COOKIE}=${cookieVal}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${STATE_TTL_SECS}`,
  )
  return res
}
