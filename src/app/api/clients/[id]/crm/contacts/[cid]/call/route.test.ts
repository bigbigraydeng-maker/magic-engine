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
  touches: Array<{ channel?: string; direction?: string; source?: string | null; metadata: Record<string, unknown> | null; occurred_at: string }>
  conn: Record<string, unknown> | null
  conns?: Array<Record<string, unknown>>
  touchesError?: boolean
  /** [客户今天已外呼次数, 该员工今天已外呼次数]；null = 读失败 */
  counts?: [number, number] | null
}
const CONN: Record<string, unknown> = { id: 'conn-1', provider_account_id: 'ACx', secret_ref: 'TWILIO_AUTH_TOKEN_CTS', extension_map: { '+64210000099': 'staff@example.test' }, default_country: 'NZ' }

function mockDb(db: Db) {
  let rawCalls = 0
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    const chain = (data: unknown, error: unknown = null, count?: number) => {
      const c: Record<string, unknown> = {}
      c.select = () => c
      c.eq = () => c
      c.gte = () => c
      c.limit = () => c
      c.maybeSingle = async () => ({ data, error })
      c.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error, count }).then(res)
      return c
    }
    if (table === 'contacts') return chain(db.contact)
    if (table === 'contact_touchpoints') return chain(db.touches, db.touchesError ? { message: 'x' } : null)
    if (table === 'telephony_connections') return chain(db.conns ?? (db.conn ? [db.conn] : []))
    if (table === 'telephony_raw_events') {
      const counts = db.counts === undefined ? ([0, 0] as [number, number]) : db.counts
      const i = rawCalls++
      return counts === null ? chain(null, { message: 'x' }) : chain(null, null, counts[i % 2])
    }
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

  it('号码所在国家不在放行名单 / 高价号段 → 422，不拨；环境变量可加国家', async () => {
    mockDb({ contact: { id: 'c', primary_phone: '+86 138 0013 8000', do_not_contact: false }, touches: [], conn: CONN })
    expect((await call()).status).toBe(422)
    mockDb({ contact: { id: 'c', primary_phone: '+64 900 123 456', do_not_contact: false }, touches: [], conn: CONN })
    expect((await call()).status).toBe(422)
    expect(start).not.toHaveBeenCalled()
    // 澳洲号码：默认也拒（PM 2026-10-15 定只限新西兰）；环境变量显式加回才放行
    mockDb({ contact: { id: 'c', primary_phone: '+61 412 345 678', do_not_contact: false }, touches: [], conn: CONN })
    expect((await call()).status).toBe(422)
    vi.stubEnv('TELEPHONY_OUTBOUND_COUNTRIES', '+64,+61')
    mockDb({ contact: { id: 'c', primary_phone: '+61 412 345 678', do_not_contact: false }, touches: [], conn: CONN })
    expect((await call()).status).toBe(200)
    start.mockClear()
    vi.stubEnv('TELEPHONY_OUTBOUND_COUNTRIES', '+86')
    mockDb({ contact: { id: 'c', primary_phone: '+86 138 0013 8000', do_not_contact: false }, touches: [], conn: CONN })
    expect((await call()).status).toBe(200)
  })

  it('每日上限：客户或员工任一到顶 → 429；读不到计数 → 500；都不拨', async () => {
    mockDb({ contact: { id: 'c', primary_phone: '021 000 0001', do_not_contact: false }, touches: [], conn: CONN, counts: [80, 0] })
    expect((await call()).status).toBe(429)
    mockDb({ contact: { id: 'c', primary_phone: '021 000 0001', do_not_contact: false }, touches: [], conn: CONN, counts: [0, 40] })
    expect((await call()).status).toBe(429)
    mockDb({ contact: { id: 'c', primary_phone: '021 000 0001', do_not_contact: false }, touches: [], conn: CONN, counts: null })
    expect((await call()).status).toBe(500)
    expect(start).not.toHaveBeenCalled()
    vi.stubEnv('TELEPHONY_OUTBOUND_DAILY_CAP_STAFF', '41')
    mockDb({ contact: { id: 'c', primary_phone: '021 000 0001', do_not_contact: false }, touches: [], conn: CONN, counts: [0, 40] })
    expect((await call()).status).toBe(200)
  })

  it('号码已标成打不通（最近一次电话结果是 bad_number）→ 409，不拨', async () => {
    mockDb({ contact: { id: 'c', primary_phone: '021 000 0001', do_not_contact: false }, touches: [{ channel: 'phone', direction: 'outbound', source: 'voice_agent', metadata: { outcome: 'bad_number' }, occurred_at: '2026-10-01T00:00:00Z' }], conn: CONN })
    expect((await call()).status).toBe(409)
    expect(start).not.toHaveBeenCalled()
  })

  it('一个客户有多条电话连接 → 不猜，422', async () => {
    mockDb({ contact: { id: 'c', primary_phone: '021 000 0001', do_not_contact: false }, touches: [], conn: CONN, conns: [CONN, { ...CONN, id: 'conn-2' }] })
    expect((await call()).status).toBe(422)
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
