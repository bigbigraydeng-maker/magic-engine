/**
 * Tests for /api/clients/[id]/campaign-daily-plan/tune-suggestions
 *
 * 覆盖：auth 拒 / 缺参数拒 / 无 action 空返回 / 完整链路 fan-out /
 *       actions 读失败 500 / receipts 读失败 500 /
 *       过滤链断言（client_id + action_type + payload.source + payload.campaign_id + window_hours 都命中）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { GET } from '../route'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

const mockAccess = vi.mocked(requireDashboardClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CAMPAIGN_ID = '6612eabf-dd7e-47f0-bcc4-e6a7fd813aea'

function request(query = `campaign_id=${CAMPAIGN_ID}`) {
  return new NextRequest(
    `http://localhost/api/clients/${CLIENT_ID}/campaign-daily-plan/tune-suggestions?${query}`,
    { method: 'GET' },
  )
}
function params(id = CLIENT_ID) { return { params: { id } } }

interface ActionsResult { data: Array<{ id: string; payload: Record<string, unknown> }> | null; error: { message: string } | null }
interface ReceiptsResult { data: Array<{ action_id: string; window_hours: number; status: string; values: unknown; missing: unknown }> | null; error: { message: string } | null }

function installFrom(opts: {
  actions:        ActionsResult
  receipts?:      ReceiptsResult
  actionFilters?: Record<string, unknown>
  receiptFilters?: Record<string, unknown>
  receiptIn?:     { column: string; values: unknown[] } | null
}) {
  const spy = {
    actionFilters:  {} as Record<string, unknown>,
    actionLimit:    null as number | null,
    receiptFilters: {} as Record<string, unknown>,
    receiptIn:      null as { column: string; values: unknown[] } | null,
    tablesTouched:  [] as string[],
  }
  mockFrom.mockImplementation(((table: string) => {
    spy.tablesTouched.push(table)
    if (table === 'flywheel_actions') {
      const filters: Record<string, unknown> = {}
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = (col: string, val: unknown) => { filters[col] = val; return chain }
      chain.order = () => chain
      chain.limit = (n: number) => {
        spy.actionFilters = { ...filters }
        spy.actionLimit = n
        return Promise.resolve(opts.actions)
      }
      return chain
    }
    if (table === 'social_post_measurement_receipts') {
      const filters: Record<string, unknown> = {}
      let inFilter: { column: string; values: unknown[] } | null = null
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.in = (col: string, vals: unknown[]) => { inFilter = { column: col, values: [...vals] }; return chain }
      chain.eq = (col: string, val: unknown) => {
        filters[col] = val
        spy.receiptFilters = { ...filters }
        spy.receiptIn = inFilter ? { column: inFilter.column, values: [...inFilter.values] } : null
        return Promise.resolve(opts.receipts ?? { data: [], error: null })
      }
      return chain
    }
    throw new Error(`route test: unexpected table '${table}'`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any)
  return spy
}

afterEach(() => { vi.clearAllMocks() })

describe('GET tune-suggestions — auth', () => {
  it('access denied → 403', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'FORBIDDEN' } as never)
    const res = await GET(request(), params())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toEqual({ success: false, error: 'FORBIDDEN' })
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

describe('GET tune-suggestions — 参数', () => {
  it('缺 campaign_id → 400', async () => {
    mockAccess.mockResolvedValue({ ok: true } as never)
    const res = await GET(request(''), params())
    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

describe('GET tune-suggestions — 空态', () => {
  it('无候选 action → suggestions {} + 0/0 diagnostics', async () => {
    mockAccess.mockResolvedValue({ ok: true } as never)
    installFrom({ actions: { data: [], error: null } })
    const res = await GET(request(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      success: true,
      suggestions: {},
      diagnostics: { candidateActionCount: 0, withT72ReceiptCount: 0 },
    })
  })

  it('payload 缺 idempotency_key 的 action 被丢弃（不进 suggestions、不参与 in()）', async () => {
    mockAccess.mockResolvedValue({ ok: true } as never)
    const spy = installFrom({
      actions: { data: [
        { id: 'a1', payload: { idempotency_key: 'fbpost_p1', post_id: '1616575215312482_175000001' } },
        { id: 'a2', payload: {}                       },  // 缺 idempotency_key
        { id: 'a3', payload: { idempotency_key: 123 } },  // 非字符串
      ], error: null },
      receipts: { data: [], error: null },
    })
    await GET(request(), params())
    expect(spy.receiptIn?.values).toEqual(['a1'])  // 只带 a1 去查
  })
})

describe('GET tune-suggestions — 过滤链', () => {
  it('actions 过滤：client_id + action_type + payload.source + payload.campaign_id 全部命中', async () => {
    mockAccess.mockResolvedValue({ ok: true } as never)
    const spy = installFrom({
      actions: { data: [{ id: 'a1', payload: { idempotency_key: 'fbpost_p1', post_id: '1616575215312482_175000001' } }], error: null },
      receipts: { data: [], error: null },
    })
    await GET(request(), params())
    expect(spy.actionFilters).toEqual({
      client_id:                CLIENT_ID,
      action_type:              'social.publish_post',
      'payload->>source':       'daily_plan',
      'payload->>campaign_id':  CAMPAIGN_ID,
    })
    expect(spy.actionLimit).toBe(50)
    expect(spy.receiptFilters).toEqual({ window_hours: 72 })
    expect(spy.receiptIn?.column).toBe('action_id')
  })
})

describe('GET tune-suggestions — 完整链路', () => {
  it('4 条 action + 4 条 T+72 → 每条 idempotency_key 都有 recommendation', async () => {
    mockAccess.mockResolvedValue({ ok: true } as never)
    installFrom({
      actions: { data: [
        { id: 'a1', payload: { idempotency_key: 'fbpost_p1', post_id: '1616575215312482_175000001' } },
        { id: 'a2', payload: { idempotency_key: 'fbpost_p2', post_id: '1616575215312482_175000002' } },
        { id: 'a3', payload: { idempotency_key: 'fbpost_p3', post_id: '1616575215312482_175000003' } },
        { id: 'a4', payload: { idempotency_key: 'fbpost_p4', post_id: '1616575215312482_175000004' } },
      ], error: null },
      receipts: { data: [
        { action_id: 'a1', window_hours: 72, status: 'ok', values: { likes: 20 }, missing: {} },
        { action_id: 'a2', window_hours: 72, status: 'ok', values: { likes: 10 }, missing: {} },
        { action_id: 'a3', window_hours: 72, status: 'ok', values: { likes: 10 }, missing: {} },
        { action_id: 'a4', window_hours: 72, status: 'ok', values: { likes: 10 }, missing: {} },
      ], error: null },
    })
    const res = await GET(request(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.suggestions['fbpost_p1'].decision).toBe('REPEAT')
    expect(body.suggestions['fbpost_p1'].deltaPct).toBe(100)
    expect(body.suggestions['fbpost_p2'].decision).toBeDefined()  // 不 REPEAT，具体不重要
    expect(body.diagnostics).toEqual({ candidateActionCount: 4, withT72ReceiptCount: 4 })
  })

  it('🔴 建议按 idempotency_key 对账，不按 post_id —— 排期帖回执存照片编号、动作行存帖子编号', async () => {
    mockAccess.mockResolvedValue({ ok: true } as never)
    installFrom({
      actions: { data: [
        // 动作行里是解析后的帖子编号；回执（面板）里同一条帖子存的是照片编号 1750000001。
        { id: 'a1', payload: { idempotency_key: 'fbpost_p1', post_id: '1616575215312482_1750000001' } },
        { id: 'a2', payload: { idempotency_key: 'fbpost_p2', post_id: '1616575215312482_1750000002' } },
        { id: 'a3', payload: { idempotency_key: 'fbpost_p3', post_id: '1616575215312482_1750000003' } },
        { id: 'a4', payload: { idempotency_key: 'fbpost_p4', post_id: '1616575215312482_1750000004' } },
      ], error: null },
      receipts: { data: [
        { action_id: 'a1', window_hours: 72, status: 'ok', values: { likes: 20 }, missing: {} },
        { action_id: 'a2', window_hours: 72, status: 'ok', values: { likes: 10 }, missing: {} },
        { action_id: 'a3', window_hours: 72, status: 'ok', values: { likes: 10 }, missing: {} },
        { action_id: 'a4', window_hours: 72, status: 'ok', values: { likes: 10 }, missing: {} },
      ], error: null },
    })
    const body = await (await GET(request(), params())).json()
    expect(Object.keys(body.suggestions).sort()).toEqual(['fbpost_p1', 'fbpost_p2', 'fbpost_p3', 'fbpost_p4'])
    expect(body.suggestions).not.toHaveProperty('1616575215312482_1750000001')
  })
})

describe('GET tune-suggestions — 错误', () => {
  it('actions 读失败 → 500 + 明确 error 前缀', async () => {
    mockAccess.mockResolvedValue({ ok: true } as never)
    installFrom({ actions: { data: null, error: { message: 'connection reset' } } })
    const res = await GET(request(), params())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/tune-suggestions:.*flywheel_actions.*connection reset/)
  })

  it('receipts 读失败 → 500', async () => {
    mockAccess.mockResolvedValue({ ok: true } as never)
    installFrom({
      actions: { data: [{ id: 'a1', payload: { idempotency_key: 'fbpost_p1', post_id: '1616575215312482_175000001' } }], error: null },
      receipts: { data: null, error: { message: 'timeout' } },
    })
    const res = await GET(request(), params())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/social_post_measurement_receipts.*timeout/)
  })
})
