/**
 * 连接客户自己的邮箱 —— 授权那一半。
 *
 * 为什么存在（2026-08-02）：ME 的四条获客管道里，邮件是唯一一条**正在往外漏**
 * 的 —— 客人发到 CTS 的 info@ 的邮件，系统里一个字都看不到（库里那 20 条是人手
 * 敲进去的，7/29 之后就停了）。接进来的第一步是拿到那个邮箱的授权。
 *
 * ## 为什么用「本人登录」而不是「管理员给整个公司授权」
 *
 * Microsoft 有两条路：
 *  · 应用权限 + 租户管理员同意 —— 一次授权能读**全公司**每一个邮箱，然后再用
 *    一条访问策略把范围收回到 info@。权力先给满再收，而且必须找到租户管理员。
 *  · 委托权限（这里选的）—— 能进 info@ 的那个人自己点一次同意，拿到的令牌
 *    **只能碰他自己能碰的邮箱**。范围由 Microsoft 的账号体系保证，不靠我们
 *    额外配一条策略不出错。
 *
 * 对客户老板来说，第二条也是唯一说得清楚的一句话：「用你收 info@ 的那个账号
 * 登录一下」。第一条要解释什么是租户管理员、什么是应用权限 —— 按铁律 3，
 * 一个需要解释的人工步骤等于没做好。
 *
 * ## 权限要五个
 *  · Mail.Read      —— 读进来的信
 *  · Mail.ReadWrite —— **2026-09-15 补**：从 CRM 回信要先建一份回复草稿
 *                      （`createReply`），这个动作在 Graph 眼里是「新建一个
 *                      邮件对象」，跟「读信」是两件事——只给 `Mail.Send` 不够，
 *                      真邮箱一测会在建草稿这一步直接收到 403（第三方复审
 *                      机器人在 PR #1714 抓到，写代码时漏查了 Graph 权限表）。
 *                      `Mail.Send` 管的只是「把已经建好的草稿发出去」那一步。
 *  · Mail.Send      —— 把草稿发出去
 *  · User.Read      —— 只为问一句「刚才登录的是哪个邮箱」。Graph 的 `/me`
 *                      认的是这个权限，`Mail.Read` 不管用 —— 少了它换令牌会
 *                      成功、读地址却 403，连接卡在「连上了但读不到邮箱地址」
 *                      （2026-08-02 CTS 实测踩到）
 *  · offline_access —— 换取刷新令牌。漏掉它，一小时后就断，且断得很安静
 *
 * ⚠️ 这份清单一改，**已经连过的邮箱（目前只有 CTS）不会自动拿到新权限**——
 * 刷新令牌走的是同一个 `scope` 列表（见 token-manager.ts 的
 * `refreshMicrosoftToken`），但刷新本身换不来一个从没同意过的新权限，
 * 必须重新走一次登录同意。这次改动上线前跟 PM 报备过：CTS 的邮件**读取**
 * 不受影响（`Mail.Read` 没变），只是「回信」这个新功能在 CTS 重新连接之前
 * 用不了；这个功能第一个真实客户是 NAL，NAL 还没连过，第一次连就是新权限，
 * 不受影响。
 *
 * ## 有些公司的 Microsoft 365 不让员工自己同意
 *
 * 企业租户可以把「允许用户为第三方应用授权」关掉（CTS 就是关的）。这时 info@
 * 自己点会撞上一面「需要管理员批准」的墙，**不是我们的 bug，也不是他账号的问题**。
 * 解法是让这家公司的 Microsoft 365 管理员走一次 `adminconsent` 端点，替整个
 * 公司批准一次；批完之后 info@ 再按原来的按钮连，就通了。见下面的
 * `MICROSOFT_ADMIN_CONSENT_URL`。
 */

import { PLATFORM_PROVIDERS } from '@/lib/platform-oauth/vocabulary'

/**
 * 授权要的权限。**顺序和内容必须跟刷新令牌时传的一致** —— Microsoft 只给
 * 「本次请求要了的」权限发新令牌，两处对不上就会悄悄降权，读信时才 403。
 */
export const MICROSOFT_MAIL_SCOPES = [
  'offline_access',
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/Mail.ReadWrite',
  'https://graph.microsoft.com/Mail.Send',
] as const

/**
 * `common` 而不是具体的 tenant id —— 客户可能是 Outlook.com 个人账号，也可能是
 * 公司的 Microsoft 365，写死任一种都会把另一种挡在门外。
 */
const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0'

export const MICROSOFT_AUTH_URL  = `${AUTHORITY}/authorize`
export const MICROSOFT_TOKEN_URL = `${AUTHORITY}/token`

/**
 * 管理员替整个公司批准一次的入口。
 *
 * 刻意用这个专用端点、而不是在普通登录链接上加 `prompt=admin_consent`：专用
 * 端点只回一个 `admin_consent=True`，**不回授权码**。这一点很重要 —— 走这条路
 * 的是 IT 管理员，如果它同时回一个授权码，我们就会把**管理员自己的邮箱**存成
 * 客户的收信箱，而这正是这条管道最贵的错误。批准和连接必须是两步：管理员开门，
 * info@ 自己进门。
 *
 * ## 2026-08-03：这个地址原先是错的，批了等于没批
 *
 * 原先写的是 `https://login.microsoftonline.com/common/adminconsent` —— **v1 的
 * 端点**。CTS 的管理员点了、页面也跳回来了，然后 `info@` 再去连，照样撞
 * 「需要管理员批准」。三处错，每一处单独都足以让它失效：
 *
 * **① v1 端点不接受 `scope`，它批的是应用注册里「静态配置」的那些权限。**
 * 我们整套走的是动态授权（权限在请求时才带上，注册里没静态配一份），
 * 所以 v1 批下去的是一个空集合 —— 一个字都没批到。必须用
 * [v2.0 端点](https://learn.microsoft.com/en-us/entra/identity-platform/v2-admin-consent)，
 * 它的 `scope` 是**必填**。
 *
 * **② `common` 不是这个端点的合法租户值。** 文档只认 GUID、租户域名、或
 * `organizations`。管理员批准本来就只对公司账号成立（个人 Outlook.com 账号
 * 没有「管理员」这回事），所以这里用 `organizations` 才是对的语义。
 *
 * **③ 失败时它回的是 `admin_consent=True` **加上** 一个 `error`。**
 * 只看 `admin_consent` 就会把失败读成成功 —— 见 callback 里必须先判 `error`。
 */
export const MICROSOFT_ADMIN_CONSENT_URL =
  'https://login.microsoftonline.com/organizations/v2.0/adminconsent'

/** 防 CSRF 的一次性随机数存在这个 cookie 里，回调时必须对得上。 */
export const MICROSOFT_STATE_COOKIE = 'ms_mail_oauth_state'

/** state cookie 的有效期（秒）。10 分钟。 */
export const MICROSOFT_STATE_TTL_SECS = 600

export const MICROSOFT_MAIL_PROVIDER = PLATFORM_PROVIDERS.MICROSOFT_MAIL

/** 授权完跳回哪里。放这里是为了 start 和 callback 两边永远同一个值 —— 两边写得不一样，Microsoft 会拒掉。 */
export function microsoftRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.magicengine.com.au'
  return `${base.replace(/\/$/, '')}/api/auth/microsoft/mail/callback`
}

export interface MicrosoftTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string
}

export type ExchangeResult =
  | { ok: true; tokens: MicrosoftTokenResponse }
  | { ok: false; error: string }

/**
 * 拿授权码换令牌。永不抛异常 —— 回调页面必须能对着人说一句话，
 * 而不是把一个堆栈丢在浏览器里。
 */
export async function exchangeCodeForTokens(code: string): Promise<ExchangeResult> {
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return { ok: false, error: 'MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET 没有配置' }
  }

  try {
    const res = await fetch(MICROSOFT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: microsoftRedirectUri(),
        scope: MICROSOFT_MAIL_SCOPES.join(' '),
      }).toString(),
    })

    const data = (await res.json()) as Partial<MicrosoftTokenResponse> & {
      error?: string
      error_description?: string
    }

    if (!res.ok || !data.access_token) {
      return { ok: false, error: data.error_description ?? data.error ?? `HTTP ${res.status}` }
    }
    // 没有刷新令牌就等于没连上：令牌一小时后过期，而且是安静地过期。
    // 宁可当场失败让人重点一次，也不要一小时后同步无声停摆。
    if (!data.refresh_token) {
      return { ok: false, error: '没拿到刷新令牌 —— 授权时缺了 offline_access' }
    }

    return {
      ok: true,
      tokens: {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in ?? 3600,
        scope: data.scope ?? MICROSOFT_MAIL_SCOPES.join(' '),
      },
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '换取令牌失败' }
  }
}

/**
 * 问 Microsoft：刚才登录的到底是哪个邮箱。
 *
 * 必须问，不能让人手填：连错邮箱是这条管道最贵的错误 —— 会把另一个部门
 * （甚至老板私人）的邮件抓进客户的 CRM。这里拿到的地址会显示在设置页上，
 * 让人当场看见自己连的是哪一个。
 */
export async function fetchMailboxAddress(accessToken: string): Promise<string | null> {
  const headers = { Authorization: `Bearer ${accessToken}` }

  // 正路：问 Graph「我是谁」。需要 User.Read（见上面的权限说明）。
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
      headers,
    })
    if (res.ok) {
      const data = (await res.json()) as { mail?: string | null; userPrincipalName?: string | null }
      const addr = data.mail ?? data.userPrincipalName ?? null
      if (addr) return addr
    }
  } catch {
    // 落到下面的退路
  }

  // 退路：从「已发送」里取一封信的发件人 —— 那就是这个邮箱自己。
  //
  // 为什么留这条退路：有些租户会把 User.Read 单独砍掉（或者管理员只批了邮件
  // 那两项）。这时读信是通的、只有问「我是谁」不通 —— 没有退路的话，整条管道
  // 会因为一句纯展示用的地址而连不上，而信明明已经能读了。
  // 只用 Mail.Read，不额外要任何权限。
  try {
    const res = await fetch(
      'https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$top=1&$select=from',
      { headers },
    )
    if (!res.ok) return null
    const data = (await res.json()) as {
      value?: { from?: { emailAddress?: { address?: string | null } | null } | null }[]
    }
    return data.value?.[0]?.from?.emailAddress?.address?.trim() || null
  } catch {
    return null
  }
}
