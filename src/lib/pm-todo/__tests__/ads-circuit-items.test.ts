/**
 * `ads-circuit-items.ts` 的 vitest 测试草稿（稍后挪进 `src/lib/pm-todo/__tests__/`）。
 *
 * 假 supabase 按表建模：`from(table)` 按表名分派，其它表名直接抛错 —— 否则写错
 * 表名测试还是绿的。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from '../manual-item-types'
import { pushAdsCircuitItems, CIRCUIT_BREAKER_ACTOR_LABEL } from '../ads-circuit-items'

interface ConfigRow {
  client_id: string
  updated_at: string
}

interface EventRow {
  trigger_code: string
  occurred_on: string
  evidence: unknown
}

interface FakeOptions {
  configRows?: ConfigRow[]
  configError?: { message: string } | null
  eventRows?: EventRow[]
  eventError?: { message: string } | null
}

/** 按表建模的假 supabase：只认这两张表，其它表名直接抛错。 */
function makeFakeSupabase(options: FakeOptions): SupabaseClient {
  const {
    configRows = [],
    configError = null,
    eventRows = [],
    eventError = null,
  } = options

  const fake = {
    from(table: string) {
      if (table === 'ad_strategy_configs') {
        const chain = {
          eq() {
            return chain
          },
          then(
            resolve: (value: { data: ConfigRow[]; error: { message: string } | null }) => void,
          ) {
            resolve({ data: configRows, error: configError })
          },
        }
        return { select: () => chain }
      }
      if (table === 'ads_circuit_events') {
        const chain = {
          eq() {
            return chain
          },
          order() {
            return chain
          },
          limit() {
            return chain
          },
          then(
            resolve: (value: { data: EventRow[]; error: { message: string } | null }) => void,
          ) {
            resolve({ data: eventRows, error: eventError })
          },
        }
        return { select: () => chain }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }

  return fake as unknown as SupabaseClient
}

function nameOf(id: string): string {
  return `客户 ${id}`
}

describe('pushAdsCircuitItems', () => {
  it('没有任何客户处在熔断状态时不出待办', async () => {
    const supabase = makeFakeSupabase({ configRows: [] })
    const items: ManualItem[] = []
    await pushAdsCircuitItems(supabase, items, nameOf)
    expect(items).toHaveLength(0)
  })

  it('被熔断压着的客户出一条待办，含中文原因与看板链接', async () => {
    const supabase = makeFakeSupabase({
      configRows: [
        {
          client_id: 'c1',
          updated_at: '2026-09-27T00:00:00.000Z',
        },
      ],
      eventRows: [
        { trigger_code: 'spend_spike', occurred_on: '2026-09-27', evidence: {} },
      ],
    })
    const items: ManualItem[] = []
    await pushAdsCircuitItems(supabase, items, nameOf)

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('ads_autonomy_circuit_tripped')
    expect(items[0].what).toContain('只观察')
    expect(items[0].what).toContain('花钱突然暴涨')
    expect(items[0].href).toContain('/ads-health')
    expect(typeof items[0].how).toBe('string')
    expect(items[0].how.length).toBeGreaterThan(0)
  })

  it('查不到熔断事件时仍然出待办，原因写成「原因没查到」', async () => {
    const supabase = makeFakeSupabase({
      configRows: [
        {
          client_id: 'c1',
          updated_at: '2026-09-27T00:00:00.000Z',
        },
      ],
      eventRows: [],
    })
    const items: ManualItem[] = []
    await pushAdsCircuitItems(supabase, items, nameOf)

    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('原因没查到')
  })

  it('同一天两条触发时两个中文原因都拼进 what', async () => {
    const supabase = makeFakeSupabase({
      configRows: [
        {
          client_id: 'c1',
          updated_at: '2026-09-27T00:00:00.000Z',
        },
      ],
      eventRows: [
        { trigger_code: 'spend_spike', occurred_on: '2026-09-27', evidence: {} },
        { trigger_code: 'kernel_rollback_failed', occurred_on: '2026-09-27', evidence: {} },
      ],
    })
    const items: ManualItem[] = []
    await pushAdsCircuitItems(supabase, items, nameOf)

    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('花钱突然暴涨')
    expect(items[0].what).toContain('有动作撤回失败')
  })

  it('映射表里没有的 code 原样出现在 what 里', async () => {
    const supabase = makeFakeSupabase({
      configRows: [
        {
          client_id: 'c1',
          updated_at: '2026-09-27T00:00:00.000Z',
        },
      ],
      eventRows: [
        { trigger_code: 'brand_new_code', occurred_on: '2026-09-27', evidence: {} },
      ],
    })
    const items: ManualItem[] = []
    await pushAdsCircuitItems(supabase, items, nameOf)

    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('brand_new_code')
  })

  it('读配置出错时抛错', async () => {
    const supabase = makeFakeSupabase({
      configError: { message: 'boom' },
    })
    const items: ManualItem[] = []
    await expect(pushAdsCircuitItems(supabase, items, nameOf)).rejects.toThrow()
  })

  it('读熔断事件出错时抛错', async () => {
    const supabase = makeFakeSupabase({
      configRows: [
        {
          client_id: 'c1',
          updated_at: '2026-09-27T00:00:00.000Z',
        },
      ],
      eventError: { message: 'boom' },
    })
    const items: ManualItem[] = []
    await expect(pushAdsCircuitItems(supabase, items, nameOf)).rejects.toThrow()
  })

  it('两个客户都被熔断时出两条待办，client_id 不同', async () => {
    const supabase = makeFakeSupabase({
      configRows: [
        {
          client_id: 'c1',
          updated_at: '2026-09-27T00:00:00.000Z',
        },
        {
          client_id: 'c2',
          updated_at: '2026-09-27T00:00:00.000Z',
        },
      ],
      eventRows: [
        { trigger_code: 'spend_spike', occurred_on: '2026-09-27', evidence: {} },
      ],
    })
    const items: ManualItem[] = []
    await pushAdsCircuitItems(supabase, items, nameOf)

    expect(items).toHaveLength(2)
    expect(items[0].client_id).not.toBe(items[1].client_id)
  })
})
