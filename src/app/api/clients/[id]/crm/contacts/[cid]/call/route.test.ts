import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const access = vi.fn()
const start = vi.fn()
vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: (id: string) => access(id) }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/telephony/twilio/outbound', async () => {
  const actual = await vi.importActual<typeof import('@/lib/telephony/twilio/outbound')>('@/lib/telephony/twilio/outbound')
  return { ...actual, startOutboundCall: (a: unknown) => start(a) }
})

import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

interface Db {
  contact: { id: string; primary_phone: string | null; do_not_contact: boolean } | null
  touches: Array<{ metadata: Record<string, unknown> | null; occurred_at: string }>
  conn: Record<string, unknown> | null
  touchesError?: boolean
}
const CONN = { id: 'conn-1', provider_account_id: 'ACx', secret_ref: 'TWILIO_AUTH_TOKEN_CTS', extension_map: { '+64210000099': 'staff@example.test' }, default_country: 'NZ' }

function mockDb(db: Db) {
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    const chain = (data: unknown, error: unknown = null) => {
      const c: Record<string, unknown> = {}
      c.select = () => c
      c.eq = () => c
      c.maybeSingle = async () => ({ data, error })
      c.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error }).then(res)
      return c
    }
    if (table === 'contacts') return chain(db.contact)
    if (table === 'contact_touchpoints') return chain(db.touches, db.touchesError ? { message: 'x' } : null)
    if (table === 'telephony_connections') return chain(db.conn)
    throw new Error(`unexpected table ${table}`)
  })
}

let n = 0
const call = () => POST(new NextRequest('http://localhost:3001/x', { method: 'POST' }), { params: { id: 'client-a', cid: `c-${++n}` } })

beforeEach(() => {
  vi.clearAllMocks()
  access.mockResolvedValue({ ok: true, user: { email: 'staff@example.test' }, tier: 'admin', allowedClientId: null })
  start.mockResolvedValue({ callSid: 'CA1' })
  vi.stubEnv('TELEPHONY_OUTBOUND_ENABLED', '1')
  vi.stubEnv('TWILIO_AUTH_TOKEN_CTS', 'tok')
  mockDb({ contact: { id: 'c', primary_phone: '021 000 0001', do_not_contact: false }, touches: [], conn: CONN })
})
afterEach(() => vi.unstubAllEnvs())

describe('POST 点击外呼', () => {
  it('成功：只发一次外呼，参数是登记过的员工手机 + 认出的客人号码', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(start).toHaveBeenCalledTimes(1)
    expect(start.mock.calls[0][0]).toMatchObject({ staffPhone: '+64210000099', customer: '+64210000001', connectionId: 'conn-1', accountSid: 'ACx', authToken: 'tok' })
  })

  it('开关没开（默认）→ 403，不外呼', async () => {
    vi.stubEnv('TELEPHONY_OUTBOUND_ENABLED', '')
    expect((await call()).status).toBe(403)
    expect(start).not.toHaveBeenCalled()
  })

  it('没权限 → 原样返回，不外呼', async () => {
    access.mockResolvedValue({ ok: false, status: 401, error: 'no' })
    expect((await call()).status).toBe(401)
    expect(start).not.toHaveBeenCalled()
  })

  it('说过别再联系（联系人标记）→ 409；只靠触点说过也 → 409；读不到触点 → 500 不拨', async () => {
    mockDb({ contact: { id: 'c', primary_phone: '021 000 0001', do_not_contact: true }, touches: [], conn: CONN })
    expect((await call()).status).toBe(409)
    mockDb({ contact: { id: 'c', primary_phone: '021 000 0001', do_not_contact: false }, touches: [{ metadata: { outcome: 'do_not_contact' }, occurred_at: '2026-10-01T00:00:00Z' }], conn: CONN })
    expect((await call()).status).toBe(409)
    mockDb({ contact: { id: 'c', primary_phone: '021 000 0001', do_not_contact: false }, touches: [], conn: CONN, touchesError: true })
    expect((await call()).status).toBe(500)
    expect(start).not.toHaveBeenCalled()
  })

  it('员工没登记手机 / 客人号码认不出 / 没接入电话 / 令牌没配 → 拒绝，不拨', async () => {
    mockDb({ contact: { id: 'c', primary_phone: '021 000 0001', do_not_contact: false }, touches: [], conn: { ...CONN, extension_map: {} } })
    expect((await call()).status).toBe(422)
    mockDb({ contact: { id: 'c', primary_phone: 'abc', do_not_contact: false }, touches: [], conn: CONN })
    expect((await call()).status).toBe(422)
    mockDb({ contact: { id: 'c', primary_phone: '021 000 0001', do_not_contact: false }, touches: [], conn: null })
    expect((await call()).status).toBe(422)
    mockDb({ contact: { id: 'c', primary_phone: '021 000 0001', do_not_contact: false }, touches: [], conn: CONN })
    vi.stubEnv('TWILIO_AUTH_TOKEN_CTS', '')
    expect((await call()).status).toBe(500)
    expect(start).not.toHaveBeenCalled()
  })

  it('联系人不属于这个客户 → 404', async () => {
    mockDb({ contact: null, touches: [], conn: CONN })
    expect((await call()).status).toBe(404)
  })

  it('同一个人连点：第二次 429；外呼失败 → 502 且可立即重试', async () => {
    const same = () => POST(new NextRequest('http://localhost:3001/x', { method: 'POST' }), { params: { id: 'client-a', cid: 'same-contact' } })
    expect((await same()).status).toBe(200)
    expect((await same()).status).toBe(429)
    expect(start).toHaveBeenCalledTimes(1)
    start.mockRejectedValueOnce(new Error('boom'))
    const other = () => POST(new NextRequest('http://localhost:3001/x', { method: 'POST' }), { params: { id: 'client-a', cid: 'fails' } })
    expect((await other()).status).toBe(502)
    expect((await other()).status).toBe(200)
  })
})
