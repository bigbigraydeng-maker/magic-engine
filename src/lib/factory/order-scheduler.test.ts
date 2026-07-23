/**
 * 自动排产调度器测试。
 *
 * 要钉死三件事:
 * ① **默认不下单** —— 只有显式开了 auto_order_enabled 的客户才排产。这是花钱开关,
 *    "默认全客户开跑" 是最贵的一种 bug。
 * ② **一天一单** —— dedupe_key 按 NZ 日切天,cron 重试/手动重跑不会重复开单。
 * ③ **单客户失败不拖累其他客户** —— 一个客户查询炸了,别人照常排产。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('./evaluate', async () => ({
  evaluateSignal: vi.fn(async () => ({ outcome: 'accepted', work_order_id: 'wo-new' })),
  // 真实实现按 Pacific/Auckland 切天,测试里保持同样语义即可
  nzDay: (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' }),
}))

import { runOrderScheduler } from './order-scheduler'
import { supabaseAdmin } from '@/lib/supabase'
import { evaluateSignal } from './evaluate'

const mockFrom = vi.mocked(supabaseAdmin.from)
const mockEvaluate = vi.mocked(evaluateSignal)

const CTS = { id: 'c0000000-0000-0000-0000-000000000000', name: 'CTS Tours NZ' }
const OZTOP = { id: 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84', name: 'oztop' }

let inserted: Record<string, unknown>[]

interface Opts {
  clients: Array<{ id: string; name: string; factory_config: Record<string, unknown> }>
  clientsError?: string
  /** 让第 N 次 insert 返回该错误(模拟 dedupe 冲突或故障) */
  insertError?: (n: number) => { code?: string; message: string } | null
}

function installMocks(o: Opts) {
  inserted = []
  let insertCount = 0

  mockFrom.mockImplementation((table: string) => {
    const ctx = { isInsert: false, payload: null as Record<string, unknown> | null }
    const resolve = () => {
      if (table === 'clients') {
        return o.clientsError
          ? { data: null, error: { message: o.clientsError } }
          : { data: o.clients, error: null }
      }
      if (table === 'content_demand_signals' && ctx.isInsert) {
        insertCount += 1
        inserted.push(ctx.payload ?? {})
        const err = o.insertError?.(insertCount) ?? null
        return err ? { data: null, error: err } : { data: { id: `sig-${insertCount}` }, error: null }
      }
      return { data: null, error: null }
    }

    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'not', 'single', 'maybeSingle', 'order', 'limit']) b[m] = () => b
    b.insert = (p: Record<string, unknown>) => { ctx.isInsert = true; ctx.payload = p; return b }
    ;(b as { then: unknown }).then = (r: (v: { data: unknown; error: unknown }) => unknown) => r(resolve())
    return b as never
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockEvaluate.mockResolvedValue({ outcome: 'accepted', work_order_id: 'wo-new' } as never)
})

describe('自动排产 — 开关(花钱闸)', () => {
  it('🔴 没开开关的客户一律不排产(默认不花钱)', async () => {
    installMocks({ clients: [
      { ...CTS, factory_config: {} },
      { ...OZTOP, factory_config: { publish_target: { platform: 'facebook', page_id: '1' } } },
    ] })
    const s = await runOrderScheduler()

    expect(s.enabled_clients).toBe(0)
    expect(inserted).toHaveLength(0)
    expect(mockEvaluate).not.toHaveBeenCalled()
  })

  it('🔴 开关必须严格是布尔 true,字符串 "true" 不算(防 jsonb 脏数据误开)', async () => {
    installMocks({ clients: [{ ...CTS, factory_config: { auto_order_enabled: 'true' } }] })
    expect((await runOrderScheduler()).enabled_clients).toBe(0)
    expect(inserted).toHaveLength(0)
  })

  it('只给开了开关的客户排产,没开的不动', async () => {
    installMocks({ clients: [
      { ...CTS, factory_config: { auto_order_enabled: true } },
      { ...OZTOP, factory_config: { auto_order_enabled: false } },
    ] })
    const s = await runOrderScheduler()

    expect(s.enabled_clients).toBe(1)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].client_id).toBe(CTS.id)
  })
})

describe('自动排产 — 一天一单', () => {
  it('🔴 dedupe_key 带 NZ 日期,同一天重跑撞唯一索引 → deduped,不重复开单', async () => {
    installMocks({
      clients: [{ ...CTS, factory_config: { auto_order_enabled: true } }],
      insertError: () => ({ code: '23505', message: 'duplicate key' }),
    })
    const s = await runOrderScheduler(new Date('2026-07-23T08:00:00+12:00'))

    expect(s.outcomes[0].result).toBe('deduped')
    expect(mockEvaluate).not.toHaveBeenCalled() // 没真插入就不该去评估
    expect(String(inserted[0].dedupe_key)).toContain('2026-07-23')
    expect(String(inserted[0].dedupe_key)).toContain(CTS.id)
  })

  it('信号类型是 new_campaign,且不预设角度(角度由 strategist 溯源 brief)', async () => {
    installMocks({ clients: [{ ...CTS, factory_config: { auto_order_enabled: true } }] })
    await runOrderScheduler()

    expect(inserted[0].signal_type).toBe('new_campaign')
    expect(inserted[0].source).toBe('factory-order-scheduler')
    // 调度器塞角度 = 绕过护栏 2 的溯源要求
    expect(inserted[0].evidence).toEqual({})
    expect(JSON.stringify(inserted[0].request)).not.toMatch(/angle/i)
  })
})

describe('自动排产 — 结果与容错', () => {
  it('闸门拒单(余额低/配额满)如实回报原因,不当成功', async () => {
    installMocks({ clients: [{ ...CTS, factory_config: { auto_order_enabled: true } }] })
    mockEvaluate.mockResolvedValue({ outcome: 'rejected', reject_reason: 'balance_low' } as never)

    const s = await runOrderScheduler()
    expect(s.outcomes[0].result).toBe('rejected')
    expect(s.outcomes[0].detail).toBe('balance_low')
  })

  it('🔴 一个客户炸了不拖累其他客户', async () => {
    installMocks({
      clients: [
        { ...CTS, factory_config: { auto_order_enabled: true } },
        { ...OZTOP, factory_config: { auto_order_enabled: true } },
      ],
      insertError: (n) => (n === 1 ? { message: 'db exploded' } : null),
    })
    const s = await runOrderScheduler()

    expect(s.outcomes).toHaveLength(2)
    expect(s.outcomes[0].result).toBe('error')
    expect(s.outcomes[1].result).toBe('accepted')
  })

  it('客户表查询失败 → 抛给 cron(整轮失败要看得见,不静默吞掉)', async () => {
    installMocks({ clients: [], clientsError: 'connection refused' })
    await expect(runOrderScheduler()).rejects.toThrow(/clients query failed/)
  })
})
