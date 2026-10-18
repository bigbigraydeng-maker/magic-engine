import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from '../manual-item-types'
import { pushGoalRolloverItems } from '../goal-rollover-items'

interface Row {
  id: string; client_id: string; title: string; primary_metric_key: string; period_end: string
  recurrence?: 'monthly' | null
}

/** 按表建模的假库：goals（eq / in / gte 过滤）与 clients（in 过滤）。 */
function sb(rows: Row[], opts: { archived?: string[]; error?: { message: string } } = {}): SupabaseClient {
  const goalsQuery = () => {
    const f: Array<(r: Row) => boolean> = []
    const q: Record<string, unknown> = {
      eq: (k: string, v: unknown) => { f.push(r => (r as unknown as Record<string, unknown>)[k] === v); return q },
      in: (k: string, v: unknown[]) => { f.push(r => v.includes((r as unknown as Record<string, unknown>)[k])); return q },
      gt: (k: string, v: string) => { f.push(r => (r as unknown as Record<string, string>)[k] > v); return q },
      then: (res: (x: unknown) => void) => res(opts.error
        ? { data: null, error: opts.error }
        : { data: rows.filter(r => f.every(x => x(r))), error: null }),
    }
    return q
  }
  return {
    from: (table: string) => ({
      select: () => table === 'clients'
        ? { in: async (_k: string, ids: string[]) => ({
            data: ids.map(id => ({ id, client_status: opts.archived?.includes(id) ? 'archived' : 'active' })), error: null,
          }) }
        : goalsQuery(),
    }),
  } as unknown as SupabaseClient
}
const nameOf = (id: string) => `客户-${id}`
const row = (over: Partial<Row>): Row => ({
  recurrence: 'monthly', id: 'g1', client_id: 'c1', title: '每月 300 个开聊', primary_metric_key: 'messaging_started', period_end: '2026-09-30', ...over,
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
    await expect(pushGoalRolloverItems(sb([], { error: { message: 'boom' } }), [], nameOf, '2026-10-10')).rejects.toThrow('boom')
  })

  it('PM 清掉最新一条的 recurrence 来叫停：旧月份不会让待办永远误报', async () => {
    const items: ManualItem[] = []
    await pushGoalRolloverItems(
      sb([row({ id: 'aug', period_end: '2026-08-31' }), row({ id: 'sept', recurrence: null, period_end: '2026-09-30' })]),
      items, nameOf, '2026-10-10',
    )
    expect(items).toHaveLength(0)
  })

  it('已归档客户 → 不催', async () => {
    const items: ManualItem[] = []
    await pushGoalRolloverItems(sb([row({})], { archived: ['c1'] }), items, nameOf, '2026-10-10')
    expect(items).toHaveLength(0)
  })

  it('手工建了十月目标（不是月循环）→ 有人接手，不催', async () => {
    const items: ManualItem[] = []
    await pushGoalRolloverItems(
      sb([row({}), row({ id: 'manual', recurrence: null, period_end: '2026-10-31' })]), items, nameOf, '2026-10-10',
    )
    expect(items).toHaveLength(0)
  })
})
