/**
 * `isCircuitBreakerTripped`（release-circuit-breaker 路由 GET 状态位用的单客户查询）。
 * 查询形状必须跟 `pushAdsAutonomyCircuitBreakerItems` 的多客户版本保持一致——
 * 两处认的是同一把锁（mode='deny' + updated_by 前缀 circuit-breaker:）。
 */
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isCircuitBreakerTripped } from '../ads-autonomy-items'

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
