import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn(async () => ({ ok: true, allowedClientId: 'client-a', user: { email: 's@x.co.nz' } })) }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/crm/profile', async () => {
  const actual = await vi.importActual<typeof import('@/lib/crm/profile')>('@/lib/crm/profile')
  return { ...actual, loadProfile: vi.fn(), setProfileName: vi.fn(), addProfileIdentity: vi.fn() }
})

import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { addProfileIdentity, loadProfile, setProfileName } from '@/lib/crm/profile'
import { GET, PATCH } from './route'
import { POST } from './identities/route'

const params = { params: { id: 'client-a', cid: 'p1' } }
const req = (body?: unknown, raw?: string) => new NextRequest('http://x/api', { method: body === undefined && raw === undefined ? 'GET' : 'PATCH', body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) })

beforeEach(() => vi.clearAllMocks())

describe('profile route', () => {
  it('GET：没权限原样回鉴权失败，不碰数据库；找不到 404；有则 200', async () => {
    ;(requirePaidClientAccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 403, error: 'no' })
    expect((await GET(req(), params)).status).toBe(403)
    expect(loadProfile).not.toHaveBeenCalled()
    ;(loadProfile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    expect((await GET(req(), params)).status).toBe(404)
    ;(loadProfile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ contactId: 'p1' })
    expect(await (await GET(req(), params)).json()).toEqual({ profile: { contactId: 'p1' } })
  })

  it('PATCH：邮箱形状的名字 400，且不写库；缺 name 400；坏 JSON 400', async () => {
    expect((await PATCH(req({ name: 'a@b.com' }), params)).status).toBe(400)
    expect((await PATCH(req({}), params)).status).toBe(400)
    expect((await PATCH(req(undefined, '{bad'), params)).status).toBe(400)
    expect(setProfileName).not.toHaveBeenCalled()
  })

  it('PATCH：合法名字写库（按路径上的 client / contact）；空串清空；找不到 404', async () => {
    ;(setProfileName as ReturnType<typeof vi.fn>).mockResolvedValue('ok')
    ;(loadProfile as ReturnType<typeof vi.fn>).mockResolvedValue({ contactId: 'p1', name: 'Chris' })
    expect((await PATCH(req({ name: ' Chris ' }), params)).status).toBe(200)
    expect(setProfileName).toHaveBeenCalledWith(expect.anything(), 'client-a', 'p1', 'Chris')
    await PATCH(req({ name: '' }), params)
    expect(setProfileName).toHaveBeenLastCalledWith(expect.anything(), 'client-a', 'p1', null)
    ;(setProfileName as ReturnType<typeof vi.fn>).mockResolvedValueOnce('not_found')
    expect((await PATCH(req({ name: 'Chris' }), params)).status).toBe(404)
  })

  it('identities POST：kind 不对 400；冲突 409 原样返回；成功 200 带 added', async () => {
    const post = (body: unknown) => POST(new NextRequest('http://x/api', { method: 'POST', body: JSON.stringify(body) }), params)
    ;(vi.mocked(await import('@/lib/supabase')).supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { default_phone_country: 'AU' } }) }) }),
    })
    expect((await post({ kind: 'fb_psid', value: 'x' })).status).toBe(400)
    ;(addProfileIdentity as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 409, error: '已属于别人' })
    const conflict = await post({ kind: 'email', value: 'a@b.com' })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({ error: '已属于别人' })
    ;(addProfileIdentity as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, added: true })
    ;(loadProfile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ contactId: 'p1' })
    const ok = await post({ kind: 'phone', value: '021 1' })
    expect(await ok.json()).toEqual({ profile: { contactId: 'p1' }, added: true })
    expect(addProfileIdentity).toHaveBeenLastCalledWith(expect.anything(), 'client-a', 'p1', 'phone', '021 1', 'AU')
  })
})
