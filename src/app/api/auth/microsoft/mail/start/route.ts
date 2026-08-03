/**
 * GET /api/auth/microsoft/mail/start?clientId={meClientId}
 *
 * 开始连接客户自己的邮箱。把浏览器送到 Microsoft 的登录页，登录的人用
 * **他自己收 info@ 的那个账号**同意一次，我们就能把发进来的邮件接回 CRM。
 *
 * 跟 Google GBP 那条流程刻意保持同一形状（一次性随机数进 httpOnly cookie、
 * 只有随机数进 state、clientId 留在服务端），差别只在两个 Microsoft 特有的点：
 *
 *  · `prompt=select_account` —— 强制弹账号选择页，**绝不能写成 `consent`**
 *    （那会绕过管理员已经批过的租户级授权，见下面那一大段）。
 *  · scope 里必须带 `offline_access`，且要跟刷新时传的那一串**完全一致**
 *    （见 lib/microsoft/mail-oauth.ts 里的说明）。刷新令牌是它给的，
 *    不是 `prompt` 给的。
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
    /**
     * `select_account`，**绝不能是 `consent`**。
     *
     * ## 2026-08-03：`prompt=consent` 把管理员的批准整个绕过去了
     *
     * 那天 CTS 的管理员成功批准了全公司（页面显示「✓ 管理员批准了」，
     * 回调也确实拿到 `admin_consent=True`）。然后 `info@` 去连，**照样撞
     * 「需要管理员批准」**。
     *
     * 原因：`prompt=consent` 的意思是「**不管之前批过没有，都让当前这个人
     * 再批一次**」。于是 Entra 走的是「用户自己授权」那条路 —— 而这家公司
     * （以及 Entra 的默认策略）不允许员工给未验证发布者的应用授权，
     * 于是当场拒掉。**管理员那次租户级批准根本没被查询。**
     *
     * 换成 `select_account`：
     *   · 仍然强制弹账号选择页 —— 那才是我们真正要的（浏览器里登着别人时
     *     Microsoft 会默认拿当前账号走完，2026-08-02 就是这么连错成 `bdm@` 的）
     *   · 不强制重新授权 —— 已有的租户级批准会被正常认下来，直接放行
     *
     * ## 顺带纠正一个误解
     *
     * 原先这行的注释写着「没有它，一小时后同步会安静地停掉」。刷新令牌不是
     * `prompt` 给的，是 **scope 里的 `offline_access`** 给的 —— 那一条一直都在，
     * 拿掉 `prompt=consent` 不影响刷新。
     */
    authUrl.searchParams.set('prompt', 'select_account')

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
