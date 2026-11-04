import { describe, expect, it } from 'vitest'
import { buildWinnerConfirmItem, pickWinnerConfirmTodos } from '../factory-winner-items'
import { winnerDecisionEventId, type WinnerRow } from '@/lib/factory/winner-gate'
import { laneOf } from '../five-kinds'

const DAY = 86_400_000
const NOW = Date.parse('2026-11-05T09:00:00Z')

function row(id: string, clientId: string, checkedDaysAgo: number, extra: Record<string, unknown> = {}): WinnerRow {
  return {
    id,
    client_id: clientId,
    status: 'active',
    performance: {
      program_check: { state: 'needs_human', at: new Date(NOW - checkedDaysAgo * DAY).toISOString() },
      cost_per_result: 4.57,
      ...extra,
    },
    hook_segment: {},
    middle_segment: {},
    cta_segment: {},
    win_reason_tags: [],
    cost_per_thruplay: null,
    current_frequency: null,
    updated_at: new Date(NOW).toISOString(),
  }
}

describe('pickWinnerConfirmTodos 注意力预算', () => {
  it('复核后 0–7 天第一轮、7–14 天再推一次、14 天后不再进待办', () => {
    expect(pickWinnerConfirmTodos([row('w', 'c1', 1)], NOW)).toMatchObject([{ round: 1, needs_human_check: true }])
    expect(pickWinnerConfirmTodos([row('w', 'c1', 8)], NOW)).toMatchObject([{ round: 2 }])
    expect(pickWinnerConfirmTodos([row('w', 'c1', 14)], NOW)).toEqual([])
  })

  it('每个客户最多一条（挑复核最新的），不同客户各一条', () => {
    const out = pickWinnerConfirmTodos([row('old', 'c1', 5), row('new', 'c1', 1), row('x', 'c2', 2)], NOW)
    expect(out.map((t) => t.winner_id).sort()).toEqual(['new', 'x'])
  })

  it('已经认过 / 没复核 / 已退役的不进', () => {
    const at = new Date(NOW - DAY).toISOString()
    const approved = row('a', 'c1', 1, {
      pm_decision: {
        decision: 'approved', by: 'pm@x.nz', role: 'magic_lab', at,
        event_id: winnerDecisionEventId('a', 'approved', at), acknowledged_check_state: 'needs_human',
      },
    })
    const unchecked: WinnerRow = { ...row('u', 'c2', 1), performance: { cost_per_result: 4.57 } }
    const retired: WinnerRow = { ...row('r', 'c3', 1), status: 'retired' }
    expect(pickWinnerConfirmTodos([approved, unchecked, retired], NOW)).toEqual([])
  })

  it('待办三件套齐全，归「要你认一下」那一栏', () => {
    const item = buildWinnerConfirmItem({ client_id: 'c1', winner_id: 'w', needs_human_check: true, round: 1 }, 'CTS Tours NZ')
    expect(item.href).toContain('/dashboard/factory?client=c1')
    expect(item.what).toContain('拿不到原视频')
    expect(item.how).toContain('「认」')
    expect(laneOf(item)).toBe('truth')
  })
})
