import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from '../manual-item-types'
import { pushGoalRolloverItems } from '../goal-rollover-items'

interface Row { id: string; client_id: string; title: string; primary_metric_key: string; period_end: string }

function sb(rows: Row[], error: { message: string } | null = null): SupabaseClient {
  return {
    from: () => ({ select: () => ({ eq: async () => ({ data: error ? null : rows, error }) }) }),
  } as unknown as SupabaseClient
}
const nameOf = (id: string) => `客户-${id}`
const row = (over: Partial<Row>): Row => ({
  id: 'g1', client_id: 'c1', title: '每月 300 个开聊', primary_metric_key: 'messaging_started', period_end: '2026-09-30', ...over,
})

describe('pushGoalRolloverItems', () => {
  it('最晚一条已过期两天以上 → 一条待办，三件套齐全', async () => {
    const items: ManualItem[] = []
    await pushGoalRolloverItems(sb([row({})]), items, nameOf, '2026-10-10')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'goal_rollover_missing', client_id: 'c1', client_name: '客户-c1' })
    expect(items[0].what).toContain('没有续上')
    expect(items[0].how.length).toBeGreaterThan(10)
    expect(items[0].href).toContain('/dashboard/clients/c1/goal/g1')
  })

  it('已经有续上的新一条 → 不报', async () => {
    const items: ManualItem[] = []
    await pushGoalRolloverItems(
      sb([row({}), row({ id: 'g2', period_end: '2026-10-31' })]), items, nameOf, '2026-10-10',
    )
    expect(items).toHaveLength(0)
  })

  it('月底当天夜里（宽限一天内）→ 不报', async () => {
    const items: ManualItem[] = []
    await pushGoalRolloverItems(sb([row({})]), items, nameOf, '2026-10-01')
    expect(items).toHaveLength(0)
  })

  it('没有任何月循环目标 → 不报', async () => {
    const items: ManualItem[] = []
    await pushGoalRolloverItems(sb([]), items, nameOf, '2026-10-10')
    expect(items).toHaveLength(0)
  })

  it('同一客户两个指标各自判断', async () => {
    const items: ManualItem[] = []
    await pushGoalRolloverItems(
      sb([row({}), row({ id: 'g3', primary_metric_key: 'leads_count', period_end: '2026-10-31' })]),
      items, nameOf, '2026-10-10',
    )
    expect(items).toHaveLength(1)
  })

  it('读库失败 → 抛错，不当成"没断档"', async () => {
    await expect(pushGoalRolloverItems(sb([], { message: 'boom' }), [], nameOf, '2026-10-10')).rejects.toThrow('boom')
  })
})
