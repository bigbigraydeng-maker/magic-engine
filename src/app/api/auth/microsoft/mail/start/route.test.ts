/**
 * 「去 Microsoft 登录」这条链接怎么拼。
 *
 * ## 为什么这个文件是 2026-08-03 之后才有的
 *
 * 那天 CTS 的管理员点了「同意授权」、页面也正常跳回来了，然后 `info@` 再去连，
 * 照样撞「需要管理员批准」。原因是管理员那条链接**没带 `scope`** ——
 * v2.0 的 adminconsent 端点把 `scope` 列为必填，不带就只批应用注册里静态配置
 * 的权限，而我们整套走动态授权、一条都没静态配。**批下去的是空集合。**
 *
 * 这个 bug 活了一整天，因为它三面都在骗人：管理员看到成功、页面显示成功、
 * 而唯一能证伪它的信号（info@ 再撞一次墙）要等到下一步才出现。
 *
 * 所以这里钉的是**链接本身长什么样**，不是「代码有没有跑通」。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn(async () => ({ ok: true })),
}))

import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { MICROSOFT_MAIL_SCOPES } from '@/lib/microsoft/mail-oauth'
import { GET } from './route'

const CLIENT = 'client-a'

/** 走一趟，把 Microsoft 那边的地址解析出来。 */
async function target(params: Record<string, string> = {}): Promise<URL> {
  const u = new URL('https://app.magicengine.com.au/api/auth/microsoft/mail/start')
  u.searchParams.set('clientId', CLIENT)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  const res = await GET(new NextRequest(u))
  return new URL(res.headers.get('location') ?? '')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('MICROSOFT_CLIENT_ID', 'app-guid')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.magicengine.com.au')
})

describe('普通登录（要连的那个人自己点）', () => {
  it('去 authorize 端点，带授权码流程该有的东西', async () => {
    const u = await target()
    expect(u.pathname).toContain('/authorize')
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('client_id')).toBe('app-guid')
  })

  /** 少了它第二次连接会拿到不能刷新的令牌，一小时后同步安静地停掉。 */
  it('强制每次都回传刷新令牌', async () => {
    expect((await target()).searchParams.get('prompt')).toBe('consent')
  })

  /**
   * 填了地址就告诉 Microsoft 用哪个账号。
   *
   * 浏览器里已经登着别的账号时 Microsoft **不会问**，会直接拿当前那个走完 ——
   * 2026-08-02 CTS 就是这么把 `bdm@` 连了上去，而要连的是 `info@`。
   */
  it('把要连的地址传给 Microsoft，别让它拿当前登录的账号顶上', async () => {
    const u = await target({ loginHint: 'info@ctstours.co.nz' })
    expect(u.searchParams.get('login_hint')).toBe('info@ctstours.co.nz')
  })
})

describe('管理员替全公司批准', () => {
  const admin = () => target({ admin: '1' })

  it('去 adminconsent 端点，不去 authorize', async () => {
    const u = await admin()
    expect(u.pathname).toContain('/adminconsent')
    expect(u.pathname).not.toContain('/authorize')
  })

  /**
   * **这一条就是那天的事故。**
   *
   * 不带 `scope`，v2.0 的 adminconsent 会去批应用注册里静态配置的权限 ——
   * 我们一条都没配，所以批的是空集合。管理员看到成功，实际什么都没批到。
   */
  it('必须带 scope —— 不带就是批了个空集合', async () => {
    const scope = (await admin()).searchParams.get('scope')
    expect(scope).toBeTruthy()
    for (const s of MICROSOFT_MAIL_SCOPES) expect(scope).toContain(s)
  })

  /** 批的权限跟等下真正要用的必须是同一串，否则批的是另一件事。 */
  it('批的权限跟普通登录要的完全一致', async () => {
    expect((await admin()).searchParams.get('scope')).toBe(
      (await target()).searchParams.get('scope'),
    )
  })

  /**
   * **这条是两步设计的全部理由**：这条路走的是 IT 管理员。要是它顺手回一个
   * 授权码，我们就会把**管理员自己的邮箱**存成客户的收信箱 ——
   * 这条管道最贵的错误。批准和连接必须分开：管理员开门，info@ 自己进门。
   */
  it('绝不要授权码 —— 否则连进来的会是管理员自己的邮箱', async () => {
    const u = await admin()
    expect(u.searchParams.get('response_type')).toBeNull()
    expect(u.searchParams.get('login_hint')).toBeNull()
  })

  it('跳回地址跟普通登录用同一个 —— 两边不一致 Microsoft 会直接拒', async () => {
    expect((await admin()).searchParams.get('redirect_uri')).toBe(
      (await target()).searchParams.get('redirect_uri'),
    )
  })
})

describe('不该放行的', () => {
  it('没有这个客户的管理权限 → 不给链接', async () => {
    vi.mocked(requireDashboardClientAccess).mockResolvedValueOnce({
      ok: false,
      error: 'forbidden',
      status: 403,
    } as Awaited<ReturnType<typeof requireDashboardClientAccess>>)
    const u = new URL('https://app.magicengine.com.au/api/auth/microsoft/mail/start')
    u.searchParams.set('clientId', CLIENT)
    const res = await GET(new NextRequest(u))
    expect(res.status).toBe(403)
  })

  it('没说要连哪个客户 → 400', async () => {
    const res = await GET(
      new NextRequest(new URL('https://app.magicengine.com.au/api/auth/microsoft/mail/start')),
    )
    expect(res.status).toBe(400)
  })
})
