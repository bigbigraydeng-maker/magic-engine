import { describe, expect, it } from 'vitest'
import { buildWinnerConfirmItem, openFactoryWinnerRounds, planWinnerConfirmTodos, pushFactoryWinnerItems } from '../factory-winner-items'
import { winnerDecisionEventId, type WinnerRow } from '@/lib/factory/winner-gate'
import { createFakeSupabase, type Tables } from '@/lib/kernel/__tests__/fake-supabase'
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

describe('待办文案', () => {
  it('三件套齐全、用客户名、不写死原因，归「要你认一下」那一栏', () => {
    const item = buildWinnerConfirmItem({ client_id: 'c1', winner_id: 'w', round: 2 }, 'Demo Client')
    expect(item.what).toContain('Demo Client')
    expect(item.what).toContain('最后一轮')
    expect(item.how).toContain('Demo Client 自己的员工')
    expect(item.href).toContain('/dashboard/factory?client=c1')
    expect(laneOf(item)).toBe('truth')
  })
})

function tablesWith(winner: WinnerRow, factoryConfig: Record<string, unknown> = {}): Tables {
  return { winner_structures: [{ ...winner }], clients: [{ id: winner.client_id, factory_config: factoryConfig }] }
}
const perfOf = (t: Tables): Record<string, unknown> => t.winner_structures[0].performance as Record<string, unknown>

describe('读路径只读不写（dev-debt / 今日待办页 / 周报都会调到）', () => {
  it('还没开轮的候选：读多少次都不出现、不写 todo_pushes、不动 updated_at', async () => {
    const tables = tablesWith(row('w', 'c1'))
    const log: Array<{ table: string; op: string }> = []
    const sb = createFakeSupabase(tables, { log: log as never })
    for (let i = 0; i < 3; i++) {
      const items: ManualItem[] = []
      await pushFactoryWinnerItems(sb, items, new Date(NOW), () => 'Demo Client')
      expect(items).toEqual([])
    }
    expect(perfOf(tables).todo_pushes).toBeUndefined()
    expect(log.filter((l) => l.op !== 'select')).toEqual([])
  })

  it('本轮已开的候选：读多少次都照常出现，推送记录不变', async () => {
    const tables = tablesWith(row('w', 'c1', { todo_pushes: [ago(2)] }))
    for (let i = 0; i < 2; i++) {
      const items: ManualItem[] = []
      await pushFactoryWinnerItems(createFakeSupabase(tables), items, new Date(NOW), () => 'Demo Client')
      expect(items).toHaveLength(1)
    }
    expect(perfOf(tables).todo_pushes).toEqual([ago(2)])
  })
})

describe('openFactoryWinnerRounds（只有每日待办邮件路径调）', () => {
  it('开新一轮：合并写推送时间，其它字段不动；开完读路径才出现', async () => {
    const tables = tablesWith(row('w', 'c1'))
    const sb = createFakeSupabase(tables)
    const res = await openFactoryWinnerRounds(sb, new Date(NOW))
    expect(res).toEqual({ opened: ['w'], failed: [] })
    const perf = perfOf(tables)
    expect(perf.todo_pushes).toEqual([new Date(NOW).toISOString()])
    expect(perf.cost_per_result).toBe(4.57)
    const items: ManualItem[] = []
    await pushFactoryWinnerItems(sb, items, new Date(NOW), () => 'Demo Client')
    expect(items.map((i) => i.kind)).toEqual(['factory_winner_confirm'])
  })

  it('同一天再开一次不重复记（本轮已开）', async () => {
    const tables = tablesWith(row('w', 'c1'))
    const sb = createFakeSupabase(tables)
    await openFactoryWinnerRounds(sb, new Date(NOW))
    const again = await openFactoryWinnerRounds(sb, new Date(NOW + 60_000))
    expect(again.opened).toEqual([])
    expect((perfOf(tables).todo_pushes as unknown[]).length).toBe(1)
  })

  it('推送记录写失败 → 当天这条待办不出现，也没记「推过」（最多两轮不会被绕开）', async () => {
    const tables = tablesWith(row('w', 'c1'))
    const sb = createFakeSupabase(tables, { failOn: [{ table: 'winner_structures', op: 'update', message: 'db down' }] })
    const res = await openFactoryWinnerRounds(sb, new Date(NOW))
    expect(res.opened).toEqual([])
    expect(res.failed).toMatchObject([{ winner_id: 'w', error: expect.stringContaining('db down') }])
    const items: ManualItem[] = []
    await pushFactoryWinnerItems(sb, items, new Date(NOW), () => 'Demo Client')
    expect(items).toEqual([])
    expect(perfOf(tables).todo_pushes).toBeUndefined()
  })
})

describe('「只认 PM」没写进客户设置 → 开发欠账（dev 车道）', () => {
  const marked = (): WinnerRow => row('w', 'c1', { pm_only_required: { by: 'pm@magiclab.nz', at: ago(1) } })
  it('赢家行有标记、客户配置没有开关 → 出一条 dev 待办', async () => {
    const items: ManualItem[] = []
    await pushFactoryWinnerItems(createFakeSupabase(tablesWith(marked())), items, new Date(NOW), () => 'Demo Client')
    const dev = items.filter((i) => i.kind === 'factory_winner_pm_only_unsynced')
    expect(dev).toHaveLength(1)
    expect(laneOf(dev[0])).toBe('dev')
  })
  it('客户配置已有开关 → 不出；没标记 → 不出', async () => {
    const a: ManualItem[] = []
    await pushFactoryWinnerItems(createFakeSupabase(tablesWith(marked(), { winner_confirm_pm_only: true })), a, new Date(NOW), () => 'x')
    const b: ManualItem[] = []
    await pushFactoryWinnerItems(createFakeSupabase(tablesWith(row('w', 'c1'))), b, new Date(NOW), () => 'x')
    expect([...a, ...b].filter((i) => i.kind === 'factory_winner_pm_only_unsynced')).toEqual([])
  })
})
