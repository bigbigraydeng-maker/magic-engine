/**
 * 经营测算场景接口 —— 谁能用、存什么、并发和重名怎么办。
 *
 * 盯的是几种「静默出错」：
 *   - 客户员工 / 非旅游客户调得通（内部财务假设泄露）→ 必须在碰库之前就挡住
 *   - 未知字段、越界数字被存进去（将来公式读到脏数据）
 *   - 同名覆盖、过期覆盖（两个人同时改，后存的把先存的悄悄吃掉）
 *
 * 假 supabase 是一张内存表，只认 me_calculator_scenarios，按 .eq 过滤；
 * 重名 / 超限用 failNext 注入成数据库会返回的那两种错误。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePlanApproverAccess: vi.fn() }))
vi.mock('@/lib/clients/industry-guard', () => ({ clientHasIndustryFeature: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { GET, POST } from '../route'
import { PATCH, DELETE } from '../[scenarioId]/route'
import { requirePlanApproverAccess } from '@/lib/auth/client-access'
import { clientHasIndustryFeature } from '@/lib/clients/industry-guard'
import { supabaseAdmin } from '@/lib/supabase'
import { DEFAULT_INPUTS } from '@/lib/crm/industry/travel-business-calculator'

const mockAccess = vi.mocked(requirePlanApproverAccess)
const mockFeature = vi.mocked(clientHasIndustryFeature)
const mockFrom = vi.mocked(supabaseAdmin.from)

const CLIENT = 'client-1'
const OTHER_CLIENT = 'client-2'
const ACTOR = 'fde@staff.test'

type Row = Record<string, unknown>
type DbError = { code?: string; message: string } | null

const state: { rows: Row[]; failNext: DbError; tableCalls: number; seq: number } = {
  rows: [],
  failNext: null,
  tableCalls: 0,
  seq: 0,
}

function stamp(): string {
  state.seq += 1
  return `2026-10-16T00:00:${String(state.seq).padStart(2, '0')}.000000+00:00`
}

/** 只实现接口用到的那几种链：select/order/limit、insert、update、delete，再加 eq 过滤。 */
function builder() {
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let payload: Row = {}
  const filters: Array<[string, unknown]> = []
  const matches = () => state.rows.filter(r => filters.every(([k, v]) => r[k] === v))

  const run = (): { data: Row[]; error: DbError } => {
    if (state.failNext) {
      const error = state.failNext
      state.failNext = null
      return { data: [], error }
    }
    if (op === 'insert') {
      const row = { id: `id-${state.rows.length + 1}`, created_at: stamp(), ...payload }
      state.rows.push(row)
      return { data: [row], error: null }
    }
    if (op === 'update') {
      const hit = matches()
      hit.forEach(r => Object.assign(r, payload))
      return { data: hit, error: null }
    }
    if (op === 'delete') {
      const hit = matches()
      state.rows = state.rows.filter(r => !hit.includes(r))
      return { data: hit, error: null }
    }
    return { data: matches(), error: null }
  }

  const api = {
    select: () => api,
    insert: (row: Row) => { op = 'insert'; payload = row; return api },
    update: (row: Row) => { op = 'update'; payload = row; return api },
    delete: () => { op = 'delete'; return api },
    eq: (col: string, val: unknown) => { filters.push([col, val]); return api },
    order: () => api,
    limit: () => api,
    single: async () => { const r = run(); return { data: r.data[0] ?? null, error: r.error } },
    maybeSingle: async () => { const r = run(); return { data: r.data[0] ?? null, error: r.error } },
    then: (resolve: (v: { data: Row[]; error: DbError }) => unknown) => resolve(run()),
  }
  return api
}

function ctx(scenarioId?: string) {
  return { params: { id: CLIENT, ...(scenarioId ? { scenarioId } : {}) } } as never
}

function req(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/x', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function seed(name: string, extra: Row = {}): Row {
  const row = { id: `seed-${name}`, client_id: CLIENT, name, inputs: {}, updated_at: '2026-10-15T00:00:00.000000+00:00', ...extra }
  state.rows.push(row)
  return row
}

beforeEach(() => {
  state.rows = []
  state.failNext = null
  state.tableCalls = 0
  state.seq = 0
  vi.clearAllMocks()
  mockAccess.mockResolvedValue({ ok: true, user: { email: ACTOR } } as never)
  mockFeature.mockResolvedValue(true)
  mockFrom.mockImplementation((() => { state.tableCalls += 1; return builder() }) as never)
})

describe('谁能用', () => {
  it.each([401, 403])('鉴权失败 %s 原样返回，且一次库都没碰', async status => {
    mockAccess.mockResolvedValue({ ok: false, status, error: 'nope' } as never)
    const calls = [
      () => GET(req(), ctx()),
      () => POST(req({ name: 'a', inputs: {} }), ctx()),
      () => PATCH(req({ expected_updated_at: 'x', name: 'b' }), ctx('s1')),
      () => DELETE(req(), ctx('s1')),
    ]
    for (const call of calls) {
      const res = await call()
      expect(res.status).toBe(status)
    }
    expect(state.tableCalls).toBe(0)
    expect(mockFeature).not.toHaveBeenCalled()
  })

  it('不是旅游客户 → 404 feature_unavailable，不碰库', async () => {
    mockFeature.mockResolvedValue(false)
    const res = await POST(req({ name: 'a', inputs: {} }), ctx())
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('feature_unavailable')
    expect(state.tableCalls).toBe(0)
  })

  it('账号没有邮箱 → 403，不碰库', async () => {
    mockAccess.mockResolvedValue({ ok: true, user: { email: null } } as never)
    const res = await POST(req({ name: 'a', inputs: {} }), ctx())
    expect(res.status).toBe(403)
    expect(state.tableCalls).toBe(0)
  })
})

describe('保存场景 POST', () => {
  it('存校验后的参数，记录谁存的，公式版本 1', async () => {
    const res = await POST(req({ name: '  旺季方案  ', inputs: { cpl: 9, adSpend: 8000 } }), ctx())
    expect(res.status).toBe(201)
    const { scenario } = await res.json()
    expect(scenario.name).toBe('旺季方案')
    expect(scenario.created_by).toBe(ACTOR)
    expect(scenario.formula_version).toBe(1)
    expect(scenario.inputs).toEqual({ ...DEFAULT_INPUTS, cpl: 9, adSpend: 8000 })
    expect(state.rows[0].client_id).toBe(CLIENT)
  })

  it.each([
    ['空名', { name: '   ', inputs: {} }, 'bad_name'],
    ['超长名', { name: 'a'.repeat(61), inputs: {} }, 'bad_name'],
    ['名字不是字符串', { name: 5, inputs: {} }, 'bad_name'],
    ['未知字段', { name: 'a', inputs: { foo: 1 } }, 'bad_inputs'],
    ['负数', { name: 'a', inputs: { adSpend: -1 } }, 'bad_inputs'],
    ['不是数字', { name: 'a', inputs: { cpl: '7' } }, 'bad_inputs'],
  ])('%s → 400，且没存', async (_label, body, code) => {
    const res = await POST(req(body), ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe(code)
    expect(state.rows).toHaveLength(0)
  })

  it('重名 → 409 duplicate_name', async () => {
    state.failNext = { code: '23505', message: 'duplicate key value' }
    const res = await POST(req({ name: 'a', inputs: {} }), ctx())
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('duplicate_name')
  })

  it('超 50 个 → 409 limit_reached', async () => {
    state.failNext = { code: '23514', message: 'scenario_limit_reached' }
    const res = await POST(req({ name: 'a', inputs: {} }), ctx())
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('limit_reached')
  })
})

describe('列出场景 GET', () => {
  it('只返回这个客户的', async () => {
    seed('A')
    state.rows.push({ id: 'x', client_id: OTHER_CLIENT, name: 'B', inputs: {}, updated_at: 'z' })
    const res = await GET(req(), ctx())
    expect(res.status).toBe(200)
    const { scenarios } = await res.json()
    expect(scenarios.map((s: Row) => s.name)).toEqual(['A'])
  })
})

describe('改场景 PATCH', () => {
  it('锁对得上 → 改成功，换新 updated_at，参数改了就升公式版本', async () => {
    const row = seed('A')
    const res = await PATCH(
      req({ expected_updated_at: row.updated_at, name: 'A2', inputs: { cpl: 8 } }),
      ctx(String(row.id)),
    )
    expect(res.status).toBe(200)
    const { scenario } = await res.json()
    expect(scenario.name).toBe('A2')
    expect(scenario.updated_at).not.toBe('2026-10-15T00:00:00.000000+00:00')
    expect(scenario.formula_version).toBe(1)
  })

  it('版本锁不是时间 → 400 bad_lock，不碰库', async () => {
    const res = await PATCH(req({ expected_updated_at: 'abc', name: 'A2' }), ctx('s1'))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('bad_lock')
    expect(state.tableCalls).toBe(0)
  })

  it('没带版本锁 → 400 missing_lock', async () => {
    const row = seed('A')
    const res = await PATCH(req({ name: 'A2' }), ctx(String(row.id)))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('missing_lock')
  })

  it('锁过期（别人先改了）→ 409 stale，且没改动', async () => {
    const row = seed('A')
    const res = await PATCH(
      req({ expected_updated_at: '2026-01-01T00:00:00.000000+00:00', name: 'A2' }),
      ctx(String(row.id)),
    )
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('stale')
    expect(row.name).toBe('A')
  })

  it('场景已被删 → 404 not_found', async () => {
    const res = await PATCH(
      req({ expected_updated_at: '2026-10-15T00:00:00.000000+00:00', name: 'A2' }),
      ctx('gone'),
    )
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('not_found')
  })

  it('改名撞名 → 409 duplicate_name', async () => {
    const row = seed('A')
    state.failNext = { code: '23505', message: 'duplicate key value' }
    const res = await PATCH(
      req({ expected_updated_at: row.updated_at, name: 'B' }),
      ctx(String(row.id)),
    )
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('duplicate_name')
  })

  it('别的客户的场景改不动（当作不存在）', async () => {
    const row = seed('A', { client_id: OTHER_CLIENT })
    const res = await PATCH(
      req({ expected_updated_at: row.updated_at, name: 'A2' }),
      ctx(String(row.id)),
    )
    expect(res.status).toBe(404)
    expect(row.name).toBe('A')
  })

  it('什么都没给要改 → 400', async () => {
    const row = seed('A')
    const res = await PATCH(req({ expected_updated_at: row.updated_at }), ctx(String(row.id)))
    expect(res.status).toBe(400)
  })
})

describe('删场景 DELETE', () => {
  it('删掉自己客户的场景', async () => {
    const row = seed('A')
    const res = await DELETE(req(), ctx(String(row.id)))
    expect(res.status).toBe(200)
    expect(state.rows).toHaveLength(0)
  })

  it('不存在或别的客户的 → 404，且别的客户的没被删', async () => {
    const other = seed('A', { client_id: OTHER_CLIENT })
    const res = await DELETE(req(), ctx(String(other.id)))
    expect(res.status).toBe(404)
    expect(state.rows).toHaveLength(1)
  })
})
