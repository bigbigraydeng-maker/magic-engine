import { describe, expect, it } from 'vitest'
import { buildWinnerConfirmItem, planWinnerConfirmTodos, pushFactoryWinnerItems } from '../factory-winner-items'
import { winnerDecisionEventId, type WinnerRow } from '@/lib/factory/winner-gate'
import { createFakeSupabase } from '@/lib/kernel/__tests__/fake-supabase'
import type { ManualItem } from '../manual-item-types'
import { laneOf } from '../five-kinds'

const DAY = 86_400_000
const NOW = Date.parse('2026-11-05T09:00:00Z')
const ago = (days: number) => new Date(NOW - days * DAY).toISOString()

function row(id: string, clientId: string, extra: Record<string, unknown> = {}, checkState = 'passed'): WinnerRow {
  return {
    id,
    client_id: clientId,
    status: 'active',
    performance: { program_check: { state: checkState, at: ago(1) }, cost_per_result: 4.57, result_type: 'lead', ...extra },
    hook_segment: {}, middle_segment: {}, cta_segment: {}, win_reason_tags: [],
    cost_per_thruplay: null, current_frequency: null, updated_at: ago(1),
  }
}

describe('planWinnerConfirmTodos 注意力预算', () => {
  it('从没推过 → 第 1 轮，记一次推送', () => {
    const plan = planWinnerConfirmTodos([row('w', 'c1')], NOW)
    expect(plan.todos).toMatchObject([{ winner_id: 'w', round: 1 }])
    expect(plan.newRounds.map((r) => r.id)).toEqual(['w'])
  })
  it('本轮 7 天内 → 照常出现，不再记推送', () => {
    const plan = planWinnerConfirmTodos([row('w', 'c1', { todo_pushes: [ago(3)] })], NOW)
    expect(plan.todos).toMatchObject([{ round: 1 }])
    expect(plan.newRounds).toEqual([])
  })
  it('第 1 轮过期 → 再推一轮；第 2 轮也过期 → 不进待办', () => {
    expect(planWinnerConfirmTodos([row('w', 'c1', { todo_pushes: [ago(8)] })], NOW).todos).toMatchObject([{ round: 2 }])
    expect(planWinnerConfirmTodos([row('w', 'c1', { todo_pushes: [ago(16), ago(8)] })], NOW).todos).toEqual([])
  })
  it('每个客户每周最多一条：本轮还在的那条优先，别的候选不新开', () => {
    const plan = planWinnerConfirmTodos([row('live', 'c1', { todo_pushes: [ago(2)] }), row('other', 'c1')], NOW)
    expect(plan.todos.map((t) => t.winner_id)).toEqual(['live'])
    expect(plan.newRounds).toEqual([])
  })
  it('复核没通过 / 已有人决定 / 已退役 → 不进', () => {
    const at = ago(1)
    const decided = row('d', 'c1', { pm_decision: { decision: 'approved', by: 'pm@x.nz', role: 'magic_lab', at, event_id: winnerDecisionEventId('d', 'approved', at) } })
    const nh = row('n', 'c2', {}, 'needs_human')
    const retired: WinnerRow = { ...row('r', 'c3'), status: 'retired' }
    expect(planWinnerConfirmTodos([decided, nh, retired], NOW).todos).toEqual([])
  })
})

describe('待办文案与写回', () => {
  it('三件套齐全、用客户名、不写死原因，归「要你认一下」那一栏', () => {
    const item = buildWinnerConfirmItem({ client_id: 'c1', winner_id: 'w', round: 2 }, 'Demo Client')
    expect(item.what).toContain('Demo Client')
    expect(item.what).toContain('最后一轮')
    expect(item.how).toContain('Demo Client 自己的员工')
    expect(item.href).toContain('/dashboard/factory?client=c1')
    expect(laneOf(item)).toBe('truth')
  })
  it('新开一轮时把推送时间合并写回该行（其它字段不动）', async () => {
    const r = row('w', 'c1')
    const tables = { winner_structures: [{ ...r }] }
    const items: ManualItem[] = []
    await pushFactoryWinnerItems(createFakeSupabase(tables), items, new Date(NOW), () => 'Demo Client')
    expect(items).toHaveLength(1)
    const perf = tables.winner_structures[0].performance as Record<string, unknown>
    expect(perf.todo_pushes).toEqual([new Date(NOW).toISOString()])
    expect(perf.cost_per_result).toBe(4.57)
  })
})
