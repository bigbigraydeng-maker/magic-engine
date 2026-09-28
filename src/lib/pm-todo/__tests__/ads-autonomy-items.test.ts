/**
 * `isCircuitBreakerTripped`（release-circuit-breaker 路由 GET 状态位用的单客户查询）。
 * 查询形状必须跟 `pushAdsAutonomyCircuitBreakerItems` 的多客户版本保持一致——
 * 两处认的是同一把锁（mode='deny' + updated_by 前缀 circuit-breaker:）。
 */
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isCircuitBreakerTripped, pushAdsAutonomyCircuitBreakerItems } from '../ads-autonomy-items'
import type { ManualItem } from '../manual-item-types'

const CLIENT = 'client-uuid-circuit-status-test'
const NOW = new Date('2026-09-28T00:00:00Z')

function fakeSupabase(rows: Array<{ client_id: string }>, errorMessage?: string) {
  const eq = vi.fn()
  const chain = {
    select: () => chain,
    eq: (...args: unknown[]) => {
      eq(...args)
      return chain
    },
    like: () => chain,
    lte: () => chain,
    or: () => chain,
    limit: async () => (errorMessage ? { data: null, error: { message: errorMessage } } : { data: rows, error: null }),
  }
  const sb = {
    from: (table: string) => {
      if (table !== 'client_automation_policies') throw new Error('unexpected table ' + table)
      return chain
    },
  } as unknown as SupabaseClient
  return { sb, eq }
}

describe('isCircuitBreakerTripped', () => {
  it('存在生效中的熔断 deny 行 → true', async () => {
    const { sb } = fakeSupabase([{ client_id: CLIENT }])
    await expect(isCircuitBreakerTripped(sb, CLIENT, NOW)).resolves.toBe(true)
  })

  it('没有命中行 → false', async () => {
    const { sb } = fakeSupabase([])
    await expect(isCircuitBreakerTripped(sb, CLIENT, NOW)).resolves.toBe(false)
  })

  it('按 client_id 过滤（不会把别的客户的熔断行算进来）', async () => {
    const { sb, eq } = fakeSupabase([])
    await isCircuitBreakerTripped(sb, CLIENT, NOW)
    expect(eq).toHaveBeenCalledWith('client_id', CLIENT)
    expect(eq).toHaveBeenCalledWith('mode', 'deny')
  })

  it('读取失败 → 抛错（route 层用 .catch(() => false) 兜底，这里不吞）', async () => {
    const { sb } = fakeSupabase([], 'boom')
    await expect(isCircuitBreakerTripped(sb, CLIENT, NOW)).rejects.toThrow('boom')
  })
})

/** `pushAdsAutonomyCircuitBreakerItems` 的假 `.from()` 链——最后一环是 `.in()`。 */
function fakePolicyRows(rows: Array<{ client_id: string; updated_by: string }>) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    like: () => chain,
    lte: () => chain,
    or: () => chain,
    in: async () => ({ data: rows, error: null }),
  }
  const sb = {
    from: (table: string) => {
      if (table !== 'client_automation_policies') throw new Error('unexpected table ' + table)
      return chain
    },
  } as unknown as SupabaseClient
  return sb
}

describe('pushAdsAutonomyCircuitBreakerItems', () => {
  const nameOf = (id: string) => `客户-${id}`

  it('🔴 Codex P2：updated_by 带 [accountId] → what/how 点名触发账户，不用 FDE 自己去 Meta 逐个排查', async () => {
    const sb = fakePolicyRows([{ client_id: CLIENT, updated_by: 'circuit-breaker:[123456789] 花费突增:2026-09-28T00:00:00.000Z' }])
    const items: ManualItem[] = []
    await pushAdsAutonomyCircuitBreakerItems(sb, items, NOW, nameOf, [CLIENT])

    expect(items).toHaveLength(1)
    const item = items[0] as unknown as { what: string; how: string; client_id: string }
    expect(item.client_id).toBe(CLIENT)
    expect(item.what).toContain('123456789')
    expect(item.how).toContain('123456789')
  })

  it('updated_by 不带 [accountId]（如手工构造的 deny 行）→ 退回不点名账户的通用文案，不抛错', async () => {
    const sb = fakePolicyRows([{ client_id: CLIENT, updated_by: 'circuit-breaker:manual-note:2026-09-28T00:00:00.000Z' }])
    const items: ManualItem[] = []
    await pushAdsAutonomyCircuitBreakerItems(sb, items, NOW, nameOf, [CLIENT])

    expect(items).toHaveLength(1)
    const item = items[0] as unknown as { what: string; how: string }
    expect(item.what).not.toContain('触发账户')
    expect(item.how).toContain('逐个核对')
  })

  it('同一客户多个 ads.* 键都命中 → 只生成一条待办（按 client_id 去重）', async () => {
    const sb = fakePolicyRows([
      { client_id: CLIENT, updated_by: 'circuit-breaker:[act_1] r:2026-09-28T00:00:00.000Z' },
      { client_id: CLIENT, updated_by: 'circuit-breaker:[act_1] r:2026-09-28T00:00:00.000Z' },
    ])
    const items: ManualItem[] = []
    await pushAdsAutonomyCircuitBreakerItems(sb, items, NOW, nameOf, [CLIENT])
    expect(items).toHaveLength(1)
  })

  it('activeClientIds 空 → 不查库、不生成待办', async () => {
    const fromSpy = vi.fn()
    const sb = { from: fromSpy } as unknown as SupabaseClient
    const items: ManualItem[] = []
    await pushAdsAutonomyCircuitBreakerItems(sb, items, NOW, nameOf, [])
    expect(items).toHaveLength(0)
    expect(fromSpy).not.toHaveBeenCalled()
  })
})
