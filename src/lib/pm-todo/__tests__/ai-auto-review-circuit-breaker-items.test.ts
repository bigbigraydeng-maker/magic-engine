/**
 * `pushAiAutoReviewCircuitBreakerItems()` 测试——拉模式的今日待办条目，
 * 只在 `ai_auto_review_paused_reason` 非空时下发（区分"熔断自动暂停" vs "人工手动关"）。
 */
import { describe, expect, it, vi } from 'vitest'
import { pushAiAutoReviewCircuitBreakerItems } from '../ai-auto-review-circuit-breaker-items'
import type { ManualItem } from '../manual-items'

type Row = Record<string, unknown>

function fakeSupabase(clients: Row[]) {
  return {
    from: vi.fn(() => ({
      select: () => ({
        not: (col: string, _op: string, val: unknown) => {
          const rows = clients.filter((c) => (val === null ? c[col] != null : c[col] !== val))
          return Promise.resolve({ data: rows, error: null })
        },
      }),
    })),
  }
}

describe('pushAiAutoReviewCircuitBreakerItems', () => {
  it('paused_reason 非空的客户 → 生成一条待办', async () => {
    const supabase = fakeSupabase([
      { id: 'c1', name: 'NAL', ai_auto_review_paused_reason: 'volume_spike: 笔数异常' },
      { id: 'c2', name: 'CTS', ai_auto_review_paused_reason: null },
    ])
    const items: ManualItem[] = []
    await pushAiAutoReviewCircuitBreakerItems(supabase as never, items)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'ai_auto_review_circuit_breaker', client_id: 'c1', client_name: 'NAL' })
    expect(items[0].what).toContain('笔数异常')
    expect(items[0].href).toContain('c1')
  })

  it('全部客户都没有被熔断 → 不生成任何待办', async () => {
    const supabase = fakeSupabase([{ id: 'c1', name: 'NAL', ai_auto_review_paused_reason: null }])
    const items: ManualItem[] = []
    await pushAiAutoReviewCircuitBreakerItems(supabase as never, items)
    expect(items).toHaveLength(0)
  })

  it('查询失败 → 抛错（由调用方 manual-items.ts 的 .catch() 兜底，不在这里吞掉）', async () => {
    const supabase = {
      from: () => ({ select: () => ({ not: () => Promise.resolve({ data: null, error: { message: '模拟故障' } }) }) }),
    }
    const items: ManualItem[] = []
    await expect(pushAiAutoReviewCircuitBreakerItems(supabase as never, items)).rejects.toThrow('模拟故障')
  })
})
