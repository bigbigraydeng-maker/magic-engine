/**
 * 邮箱授权回调的测试。
 *
 * 这条路由决定**谁的邮箱被挂到谁的客户名下**，所以钉的全是「不该发生的事」：
 *
 *   · state 对不上就必须停 —— 否则别人拿一个自己的授权码，就能把他的邮箱挂到
 *     你的客户下面，此后那个客户的 CRM 里会出现完全不相干的人的邮件。
 *   · cookie 里的 clientId 不能当权限用 —— cookie 是客户端来的，能伪造。
 *     它只用来记住「是哪个客户」，权限必须重新验一遍。
 *   · 问不出邮箱地址就不存 —— 否则设置页上会出现一条不知道是谁的连接，
 *     而人会对着它点「开始同步」。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/platform-oauth/connection-store', () => ({
  upsertConnection: vi.fn(async () => undefined),
}))
vi.mock('@/lib/microsoft/mail-oauth', async (orig) => {
  const actual = await orig<typeof import('@/lib/microsoft/mail-oauth')>()
  return {
    ...actual,
    exchangeCodeForTokens: vi.fn(async () => ({
      ok: true as const,
      tokens: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 's' },
    })),
    fetchMailboxAddress: vi.fn(async () => 'info@ctstours.co.nz'),
  }
})

import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { upsertConnection } from '@/lib/platform-oauth/connection-store'
import { exchangeCodeForTokens, fetchMailboxAddress } from '@/lib/microsoft/mail-oauth'
import { GET } from './route'

const NONCE = 'abc123'
const CLIENT = 'client-a'

function call(opts: { code?: string | null; state?: string | null; cookie?: string; error?: string } = {}) {
  const u = new URL('https://app.magicengine.com.au/api/auth/microsoft/mail/callback')
  if (opts.code !== null) u.searchParams.set('code', opts.code ?? 'code-1')
  if (opts.state !== null) u.searchParams.set('state', opts.state ?? NONCE)
  if (opts.error) u.searchParams.set('error', opts.error)
  const req = new NextRequest(u, {
    headers: { cookie: `ms_mail_oauth_state=${opts.cookie ?? `${NONCE}:${CLIENT}`}` },
  })
  return GET(req)
}

/** 跳回去的地址里带的那句人话。 */
function landed(res: Response) {
  return new URL(res.headers.get('location') ?? '')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.magicengine.com.au')
})

describe('连上了', () => {
  it('存进连接表，并把连上的邮箱地址带回设置页给人看', async () => {
    const url = landed(await call())
    expect(url.pathname).toBe(`/dashboard/clients/${CLIENT}/settings`)
    expect(url.searchParams.get('mail')).toBe('ok')
    expect(url.searchParams.get('addr')).toBe('info@ctstours.co.nz')
    expect(upsertConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: CLIENT,
        provider: 'microsoft_mail',
        accountId: 'info@ctstours.co.nz',
      }),
    )
  })

  it('用完就把那个一次性 cookie 清掉 —— 留着只会变成一把能被重放的钥匙', async () => {
    const res = await call()
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})

describe('不该发生的事', () => {
  it('state 跟 cookie 对不上 → 停下，绝不存', async () => {
    const url = landed(await call({ state: '别人的随机数' }))
    expect(url.searchParams.get('mail')).toBe('error')
    expect(upsertConnection).not.toHaveBeenCalled()
  })

  it('根本没有 cookie（换了浏览器 / 过期了）→ 停下', async () => {
    const url = landed(await call({ cookie: '' }))
    expect(url.searchParams.get('mail')).toBe('error')
    expect(upsertConnection).not.toHaveBeenCalled()
  })

  /** cookie 是客户端来的，能伪造。它只用来记住是哪个客户，不能当权限用。 */
  it('cookie 里写着某客户，但这个人没权限管他 → 停下', async () => {
    ;(requireDashboardClientAccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'not a member',
    })
    const url = landed(await call())
    expect(url.searchParams.get('mail')).toBe('error')
    expect(exchangeCodeForTokens).not.toHaveBeenCalled()
    expect(upsertConnection).not.toHaveBeenCalled()
  })

  it('问不出邮箱地址 → 不存，不留一条不知道是谁的连接', async () => {
    ;(fetchMailboxAddress as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    const url = landed(await call())
    expect(url.searchParams.get('mail')).toBe('error')
    expect(upsertConnection).not.toHaveBeenCalled()
  })

  it('换令牌失败 → 把 Microsoft 给的原因原样带回设置页', async () => {
    ;(exchangeCodeForTokens as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      error: '没拿到刷新令牌 —— 授权时缺了 offline_access',
    })
    const url = landed(await call())
    expect(url.searchParams.get('why')).toContain('offline_access')
    expect(upsertConnection).not.toHaveBeenCalled()
  })
})

describe('客户在 Microsoft 那边点了取消', () => {
  it('不是故障 —— 照实说一句，别让人以为系统坏了', async () => {
    const url = landed(await call({ error: 'access_denied' }))
    expect(url.searchParams.get('mail')).toBe('error')
    expect(url.searchParams.get('why')).toContain('取消')
    expect(exchangeCodeForTokens).not.toHaveBeenCalled()
  })
})

/**
 * 有些公司的 Microsoft 365 关掉了「员工可以自己给外部软件授权」，info@ 自己点
 * 会撞上「需要管理员批准」。管理员走 adminconsent 端点批一次，回到这里时带的是
 * `admin_consent=True`，**没有授权码**。
 */
describe('管理员替全公司批准之后回来', () => {
  function callAdmin(value: string) {
    const u = new URL('https://app.magicengine.com.au/api/auth/microsoft/mail/callback')
    u.searchParams.set('admin_consent', value)
    u.searchParams.set('tenant', 'tenant-guid')
    const req = new NextRequest(u, {
      headers: { cookie: `ms_mail_oauth_state=${NONCE}:${CLIENT}` },
    })
    return GET(req)
  }

  /**
   * **这条是整个两步设计的理由**：走这条路的是 IT 管理员。如果这里顺手存一条
   * 连接，客户的收信箱就会变成**管理员自己的邮箱** —— 那是这条管道最贵的错误。
   */
  it('绝不因此存下一条连接 —— 否则连进来的是管理员自己的邮箱', async () => {
    await callAdmin('True')
    expect(upsertConnection).not.toHaveBeenCalled()
    expect(exchangeCodeForTokens).not.toHaveBeenCalled()
  })

  it('告诉人门开了，但还得自己再连一次', async () => {
    const url = landed(await callAdmin('True'))
    expect(url.searchParams.get('mail')).toBe('admin_ok')
    expect(url.pathname).toContain(CLIENT)
  })

  it('管理员点了拒绝 → 照实说，不假装成功', async () => {
    const url = landed(await callAdmin('False'))
    expect(url.searchParams.get('mail')).toBe('error')
    expect(url.searchParams.get('why')).toContain('没有批准')
    expect(upsertConnection).not.toHaveBeenCalled()
  })

  /** 没有授权码这条路走不到换令牌，但「不存」这件事必须是明确的，不能靠巧合。 */
  it('就算带了授权码也不换 —— 这条路只负责开门', async () => {
    const u = new URL('https://app.magicengine.com.au/api/auth/microsoft/mail/callback')
    u.searchParams.set('admin_consent', 'True')
    u.searchParams.set('code', 'code-1')
    u.searchParams.set('state', NONCE)
    const req = new NextRequest(u, {
      headers: { cookie: `ms_mail_oauth_state=${NONCE}:${CLIENT}` },
    })
    await GET(req)
    expect(exchangeCodeForTokens).not.toHaveBeenCalled()
    expect(upsertConnection).not.toHaveBeenCalled()
  })
})
