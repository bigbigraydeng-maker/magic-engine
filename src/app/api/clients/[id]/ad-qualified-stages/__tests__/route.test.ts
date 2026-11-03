/**
 * 「哪些阶段算合格客人」设置接口（修复方案第 1 刀 ③；设计 docs/specs/2026-11-03-ads-scorecard-qualified-column-v0.md §4）。
 *
 * 盯四种静默出错：
 *   - 非内部员工能读 / 改 → 403 且不碰库
 *   - 存进客户阶段表里没有的阶段 → 400 且不写库
 *   - 客户还没有广告设置那一行时顺手新建一行（新行默认打开广告健康监测）→ 409，不新建
 *   - 改了「广告结果怎么算」那几项或它们的修改记录 → 不许
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ guardGlobalAdmin: vi.fn() }))
vi.mock('@/lib/auth/require-session', () => ({ requireSession: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { NextResponse } from 'next/server'
import { GET, PATCH } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { requireSession } from '@/lib/auth/require-session'
import { supabaseAdmin } from '@/lib/supabase'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockGuard = vi.mocked(guardGlobalAdmin)
const mockSession = vi.mocked(requireSession)
const mockFrom = vi.mocked(supabaseAdmin.from)

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const STAFF = 'fde@magicengine.cloud'
const STAGES = [
  { stage_key: 'new', label: '新线索', sort_order: 10 },
  { stage_key: 'quoted', label: '已报价', sort_order: 30 },
  { stage_key: 'no_response', label: '无下文', sort_order: 60 },
  { stage_key: 'deposit_paid', label: '已付定金', sort_order: 40 },
]

type Row = Record<string, unknown>
type Err = { code?: string; message: string } | null

function fake(opts: { row?: Row | null; readError?: Err; updateError?: Err } = {}) {
  let row: Row | null = opts.row === undefined ? { client_id: CLIENT, primary_result: 'lead', outcome_config_updated_by: 'old@x.com' } : opts.row
  const update = vi.fn((patch: Row) => ({
    eq: () => ({
      select: async () => {
        if (opts.updateError) return { data: null, error: opts.updateError }
        if (!row) return { data: [], error: null }
        row = { ...row, ...patch }
        return { data: [{ client_id: CLIENT }], error: null }
      },
    }),
  }))
  const insertLike = vi.fn()
  mockFrom.mockImplementation(((table: string) => {
    if (table === 'client_pipeline_stages') {
      return { select: () => ({ eq: () => ({ order: async () => ({ data: STAGES, error: null }) }) }) }
    }
    if (table === 'ad_strategy_configs') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.readError ? null : row, error: opts.readError ?? null }) }) }),
        update,
        upsert: insertLike,
        insert: insertLike,
      }
    }
    throw new Error(`unexpected table ${table}`)
  }) as never)
  return { update, insertLike, current: () => row }
}

const params = () => ({ params: { id: CLIENT } })
const getReq = () => new NextRequest(`http://localhost:3001/api/clients/${CLIENT}/ad-qualified-stages`)
const patchReq = (body: unknown) => new NextRequest(`http://localhost:3001/api/clients/${CLIENT}/ad-qualified-stages`, {
  method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
})

beforeEach(() => {
  mockAccess.mockResolvedValue({ ok: true, user: { email: STAFF } as never, role: 'admin', tier: 'admin', allowedClientId: null } as never)
  mockGuard.mockResolvedValue(null)
  mockSession.mockResolvedValue({ ok: true, user: { email: STAFF } as never })
})
afterEach(() => { vi.clearAllMocks() })

describe('GET', () => {
  it('按客户自己的阶段下发（顺序照排序号，不切），带已勾的和修改记录', async () => {
    fake({ row: { client_id: CLIENT, qualified_stage_keys: ['quoted'], qualified_stages_updated_by: STAFF, qualified_stages_updated_at: '2026-11-03T01:00:00Z' } })
    const json = await (await GET(getReq(), params())).json()
    expect(json.stages.map((s: { key: string }) => s.key)).toEqual(['new', 'quoted', 'no_response', 'deposit_paid'])
    expect(json).toMatchObject({ source: 'row', selected: ['quoted'], updatedBy: STAFF })
  })

  it('还没加列 → not_migrated；别的读错 → read_error；都不当成「没勾」', async () => {
    fake({ readError: { code: '42703', message: 'column ad_strategy_configs.qualified_stage_keys does not exist' } })
    expect((await (await GET(getReq(), params())).json()).source).toBe('not_migrated')
    fake({ readError: { code: 'XX000', message: 'boom' } })
    expect((await (await GET(getReq(), params())).json()).source).toBe('read_error')
  })

  it('非内部员工 → 403，不读库', async () => {
    mockGuard.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    fake()
    expect((await GET(getReq(), params())).status).toBe(403)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

describe('PATCH', () => {
  it('只改合格阶段和它自己的修改记录，不动「广告结果怎么算」那几项', async () => {
    const t = fake()
    const res = await PATCH(patchReq({ qualified_stage_keys: ['quoted', 'deposit_paid', 'quoted'] }), params())
    expect(res.status).toBe(200)
    const patch = t.update.mock.calls[0][0] as Row
    expect(Object.keys(patch).sort()).toEqual(['qualified_stage_keys', 'qualified_stages_updated_at', 'qualified_stages_updated_by'])
    expect(patch.qualified_stage_keys).toEqual(['quoted', 'deposit_paid'])
    expect(patch.qualified_stages_updated_by).toBe(STAFF)
    expect(t.current()).toMatchObject({ primary_result: 'lead', outcome_config_updated_by: 'old@x.com' })
    expect((await res.json()).selected).toEqual(['quoted', 'deposit_paid'])
  })

  it('空列表 = 清空，存成 null', async () => {
    const t = fake()
    await PATCH(patchReq({ qualified_stage_keys: [] }), params())
    expect((t.update.mock.calls[0][0] as Row).qualified_stage_keys).toBeNull()
  })

  it('阶段不在客户阶段表里 → 400，不写库', async () => {
    const t = fake()
    const res = await PATCH(patchReq({ qualified_stage_keys: ['quoted', 'made_up'] }), params())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('made_up')
    expect(t.update).not.toHaveBeenCalled()
  })

  it('格式不对（不是列表 / 有空串）→ 400，不写库', async () => {
    const t = fake()
    expect((await PATCH(patchReq({ qualified_stage_keys: 'quoted' }), params())).status).toBe(400)
    expect((await PATCH(patchReq({ qualified_stage_keys: [''] }), params())).status).toBe(400)
    expect(t.update).not.toHaveBeenCalled()
  })

  it('客户还没有广告设置那一行 → 409，不新建（新行会默认打开广告健康监测）', async () => {
    const t = fake({ row: null })
    const res = await PATCH(patchReq({ qualified_stage_keys: ['quoted'] }), params())
    expect(res.status).toBe(409)
    expect(t.insertLike).not.toHaveBeenCalled()
  })

  it('还没加列 → 503 人话', async () => {
    fake({ updateError: { code: 'PGRST204', message: "Could not find the 'qualified_stage_keys' column" } })
    expect((await PATCH(patchReq({ qualified_stage_keys: ['quoted'] }), params())).status).toBe(503)
  })

  it('非内部员工 → 403，不写库', async () => {
    mockGuard.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const t = fake()
    expect((await PATCH(patchReq({ qualified_stage_keys: ['quoted'] }), params())).status).toBe(403)
    expect(t.update).not.toHaveBeenCalled()
  })
})
