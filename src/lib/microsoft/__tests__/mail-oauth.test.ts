/**
 * 连接客户邮箱 —— 授权那一半的测试。
 *
 * 这条链路上最贵的两个错误，都不会当场报错：
 *
 *   1. **拿到一个没有刷新能力的令牌**。Microsoft 只在要过 offline_access 时才
 *      给刷新令牌。漏掉的话当天一切正常，一小时后同步安静地停摆，而没人会
 *      收到任何提示 —— 客人的邮件继续漏，我们以为接通了。
 *   2. **刷新时传的权限跟授权时不一致**。Microsoft 只给「本次要过」的权限发新
 *      令牌，两处对不上会悄悄降权，直到读信时才 403。
 *
 * 所以这里把「要哪些权限」当成一份契约钉死，而不是当成一个可以随手改的常量。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  exchangeCodeForTokens,
  fetchMailboxAddress,
  microsoftRedirectUri,
  MICROSOFT_ADMIN_CONSENT_URL,
  MICROSOFT_AUTH_URL,
  MICROSOFT_MAIL_SCOPES,
} from '../mail-oauth'

const OK_TOKENS = {
  access_token: 'at-1',
  refresh_token: 'rt-1',
  expires_in: 3600,
  scope: MICROSOFT_MAIL_SCOPES.join(' '),
}

/** 记下每次请求的 body —— 断言「传出去的权限」时要用。 */
let sentBodies: string[]

function mockFetch(body: unknown, ok = true, status = 200) {
  sentBodies = []
  const fn = vi.fn(async (_url: string, init?: { body?: string }) => {
    sentBodies.push(String(init?.body ?? ''))
    return { ok, status, json: async () => body } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('要哪些权限 —— 这是一份契约，不是一个随手改的常量', () => {
  it('必须要 offline_access，否则拿不到刷新令牌，一小时后安静断掉', () => {
    expect(MICROSOFT_MAIL_SCOPES).toContain('offline_access')
  })

  it('要读信的权限', () => {
    expect(MICROSOFT_MAIL_SCOPES).toContain('https://graph.microsoft.com/Mail.Read')
  })

  it('一并要发信权限 —— 省得以后做「从 CRM 回信」时让客户再点一次同意', () => {
    expect(MICROSOFT_MAIL_SCOPES).toContain('https://graph.microsoft.com/Mail.Send')
  })

  /**
   * Graph 的 `/me` 认 User.Read，不认 Mail.Read。少了它，换令牌会成功、读地址
   * 却 403 —— 连接卡在「连上了但读不到邮箱地址」，而信明明已经能读了。
   * 2026-08-02 CTS 实测踩到。
   */
  it('要 User.Read —— 少了它问不出「刚才登录的是哪个邮箱」', () => {
    expect(MICROSOFT_MAIL_SCOPES).toContain('https://graph.microsoft.com/User.Read')
  })

  /** 读信不需要改客户的邮箱。多要的每一分权限都是以后出事时说不清楚的地方。 */
  it('绝不要 Mail.ReadWrite —— 我们没有任何理由改客户的邮箱', () => {
    expect(MICROSOFT_MAIL_SCOPES.join(' ')).not.toContain('Mail.ReadWrite')
  })

  /**
   * 权限只该往「刚好够用」的方向走。读通讯录 / 读日历 / 读文件都跟这条管道
   * 无关，而客户老板在同意页上看到它们只会当场停下来。
   */
  it('不夹带跟收信无关的权限', () => {
    const s = MICROSOFT_MAIL_SCOPES.join(' ')
    for (const forbidden of ['Contacts.', 'Calendars.', 'Files.', 'Directory.', 'Mail.ReadWrite']) {
      expect(s).not.toContain(forbidden)
    }
  })
})

describe('管理员替全公司批准的入口', () => {
  /**
   * 有些公司的 Microsoft 365 关掉了「员工可以自己给外部软件授权」，info@ 自己
   * 点会撞上「需要管理员批准」。这条链接是给管理员走的。
   */
  it('用 adminconsent 专用端点', () => {
    expect(MICROSOFT_ADMIN_CONSENT_URL).toBe(
      'https://login.microsoftonline.com/common/adminconsent',
    )
  })

  /**
   * **这条是这个端点存在的全部理由**：它不回授权码。走这条路的是 IT 管理员，
   * 如果顺手换到了令牌，我们就会把**管理员自己的邮箱**存成客户的收信箱 ——
   * 那是这条管道最贵的错误。批准和连接必须是两步。
   */
  it('跟普通登录端点不是同一个 —— 批准和连接必须分两步走', () => {
    expect(MICROSOFT_ADMIN_CONSENT_URL).not.toBe(MICROSOFT_AUTH_URL)
    expect(MICROSOFT_ADMIN_CONSENT_URL).not.toContain('/authorize')
  })

  /** `common`：客户可能是 Outlook.com 个人账号，也可能是公司的 Microsoft 365。 */
  it('不写死某一个公司的租户号', () => {
    expect(MICROSOFT_ADMIN_CONSENT_URL).toContain('/common/')
  })
})

describe('拿授权码换令牌', () => {
  it('正常换到令牌', async () => {
    vi.stubEnv('MICROSOFT_CLIENT_ID', 'cid')
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'secret')
    mockFetch(OK_TOKENS)

    const r = await exchangeCodeForTokens('code-1')
    expect(r).toMatchObject({ ok: true, tokens: { access_token: 'at-1', refresh_token: 'rt-1' } })
  })

  /**
   * 这条是整份测试的重点。没有刷新令牌 = 没连上，只是暂时看起来像连上了。
   * 宁可当场失败让人重点一次，也不要一小时后无声停摆。
   */
  it('没拿到刷新令牌 → 当场判失败，绝不当作连接成功存下来', async () => {
    vi.stubEnv('MICROSOFT_CLIENT_ID', 'cid')
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'secret')
    mockFetch({ access_token: 'at-1', expires_in: 3600 })

    const r = await exchangeCodeForTokens('code-1')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toContain('offline_access')
  })

  it('换令牌时传的权限，跟授权时要的完全一致（不一致会悄悄降权）', async () => {
    vi.stubEnv('MICROSOFT_CLIENT_ID', 'cid')
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'secret')
    mockFetch(OK_TOKENS)

    await exchangeCodeForTokens('code-1')
    const sent = new URLSearchParams(sentBodies[0]).get('scope')
    expect(sent).toBe(MICROSOFT_MAIL_SCOPES.join(' '))
  })

  it('Microsoft 拒了 → 把它给的原因原样带回来，不吞掉', async () => {
    vi.stubEnv('MICROSOFT_CLIENT_ID', 'cid')
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'secret')
    mockFetch({ error: 'invalid_grant', error_description: '授权码已用过' }, false, 400)

    const r = await exchangeCodeForTokens('code-1')
    expect(r).toMatchObject({ ok: false, error: '授权码已用过' })
  })

  it('没配好环境变量 → 说清楚缺什么，不发请求', async () => {
    vi.stubEnv('MICROSOFT_CLIENT_ID', '')
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', '')
    const fn = mockFetch(OK_TOKENS)

    const r = await exchangeCodeForTokens('code-1')
    expect(r.ok).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('网络炸了也不抛异常 —— 回调页面要能对着人说一句话', async () => {
    vi.stubEnv('MICROSOFT_CLIENT_ID', 'cid')
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'secret')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))

    const r = await exchangeCodeForTokens('code-1')
    expect(r).toMatchObject({ ok: false, error: 'ECONNRESET' })
  })
})

describe('连的到底是哪个邮箱 —— 必须问出来，不能让人手填', () => {
  it('企业邮箱走 mail 字段', async () => {
    mockFetch({ mail: 'info@ctstours.co.nz', userPrincipalName: 'svc@ctstours.onmicrosoft.com' })
    expect(await fetchMailboxAddress('at')).toBe('info@ctstours.co.nz')
  })

  it('没有 mail 字段时退回登录名（个人版 Outlook 常见）', async () => {
    mockFetch({ mail: null, userPrincipalName: 'someone@outlook.com' })
    expect(await fetchMailboxAddress('at')).toBe('someone@outlook.com')
  })

  it('问不出来就回 null —— 调用方据此拒绝保存，不留一条不知道是谁的连接', async () => {
    mockFetch({}, false, 403)
    expect(await fetchMailboxAddress('at')).toBeNull()
  })

  /**
   * 退路：有些租户会把 User.Read 单独砍掉（或者管理员只批了邮件那两项）。
   * 这时**读信是通的**，只有问「我是谁」不通 —— 没有退路的话，整条管道会因为
   * 一句纯展示用的地址而连不上，而信明明已经能读了。
   * 退路只用 Mail.Read：从「已发送」里取一封的发件人，那就是这个邮箱自己。
   */
  describe('问不出「我是谁」时的退路', () => {
    /** 按 URL 分别应答 —— /me 和「已发送」要能给出不同结果。 */
    function mockByUrl(routes: { me?: () => Response; sent?: () => Response }) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.includes('/mailFolders/sentitems/')) {
            return routes.sent?.() ?? ({ ok: false, status: 404 } as unknown as Response)
          }
          return routes.me?.() ?? ({ ok: false, status: 403 } as unknown as Response)
        }),
      )
    }

    const okJson = (body: unknown) =>
      ({ ok: true, status: 200, json: async () => body }) as unknown as Response

    it('/me 被拒 → 从「已发送」里认出这个邮箱', async () => {
      mockByUrl({
        sent: () => okJson({ value: [{ from: { emailAddress: { address: 'info@ctstours.co.nz' } } }] }),
      })
      expect(await fetchMailboxAddress('at')).toBe('info@ctstours.co.nz')
    })

    /** 刚建的邮箱一封都没发过 —— 认不出来就如实回 null，不猜。 */
    it('已发送是空的 → 回 null，不猜', async () => {
      mockByUrl({ sent: () => okJson({ value: [] }) })
      expect(await fetchMailboxAddress('at')).toBeNull()
    })

    it('两条路都不通 → 回 null', async () => {
      mockByUrl({})
      expect(await fetchMailboxAddress('at')).toBeNull()
    })

    /** /me 能答就不该多打一次「已发送」—— 正路通的时候不浪费一次请求。 */
    it('/me 答得出来就不走退路', async () => {
      const sent = vi.fn(() => okJson({ value: [] }))
      mockByUrl({ me: () => okJson({ mail: 'info@ctstours.co.nz' }), sent })
      expect(await fetchMailboxAddress('at')).toBe('info@ctstours.co.nz')
      expect(sent).not.toHaveBeenCalled()
    })
  })
})

describe('跳回地址', () => {
  it('start 和 callback 用同一个值 —— 两边写得不一样 Microsoft 会直接拒掉', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.magicengine.com.au')
    expect(microsoftRedirectUri()).toBe(
      'https://app.magicengine.com.au/api/auth/microsoft/mail/callback',
    )
  })

  it('配置里多写一个斜杠也不会变成双斜杠', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.magicengine.com.au/')
    expect(microsoftRedirectUri()).not.toContain('//api/')
  })
})
