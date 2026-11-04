import { describe, expect, it } from 'vitest'
import {
  confirmIsPmOnly,
  judgeWinner,
  shouldRevertToPmOnly,
  winnerDecisionEventId,
  type PmDecision,
} from './winner-gate'
import { intakeClientMatch } from './review-sync'

const NOW = Date.parse('2026-11-05T09:00:00Z')
const AT = '2026-11-05T08:00:00.000Z'

function decision(over: Partial<PmDecision> = {}): PmDecision {
  return {
    decision: 'approved',
    by: 'lisa@ctstours.co.nz',
    role: 'client_staff',
    event_id: winnerDecisionEventId('w', 'approved', AT),
    at: AT,
    acknowledged_check_state: 'passed',
    ...over,
  }
}

function row(performance: unknown, status = 'active') {
  return { id: 'w', status, performance }
}

describe('judgeWinner 关闭即失败', () => {
  const ok = { program_check: { state: 'passed', at: AT }, pm_decision: decision(), cost_per_result: 4.57 }

  it('全齐 → 可用，带单次成本', () => {
    expect(judgeWinner(row(ok), NOW)).toEqual({ usable: true, costPerResult: 4.57 })
  })

  it.each([
    ['not_active', row(ok, 'retired')],
    ['performance_unreadable', row([])],
    ['program_check_missing', row({ ...ok, program_check: undefined })],
    ['program_check_failed', row({ ...ok, program_check: { state: 'failed', at: AT } })],
    ['pm_decision_missing', row({ ...ok, pm_decision: undefined })],
    ['pm_decision_missing', row({ ...ok, pm_decision: { ...decision(), by: 'no-email' } })],
    ['pm_decision_missing', row({ ...ok, pm_decision: { ...decision(), role: 'boss' } })],
    ['receipt_invalid', row({ ...ok, pm_decision: decision({ event_id: 'forged' }) })],
    ['receipt_invalid', row({ ...ok, pm_decision: decision({ at: '2027-01-01T00:00:00.000Z', event_id: winnerDecisionEventId('w', 'approved', '2027-01-01T00:00:00.000Z') }) })],
    ['pm_decision_rejected', row({ ...ok, pm_decision: decision({ decision: 'rejected', event_id: winnerDecisionEventId('w', 'rejected', AT) }) })],
    ['cost_per_result_missing', row({ ...ok, cost_per_result: undefined })],
    ['cost_per_result_missing', row({ ...ok, cost_per_result: 0 })],
  ])('%s', (reason, r) => {
    expect(judgeWinner(r, NOW)).toEqual({ usable: false, reason })
  })

  it('复核没过（needs_human）：点认时没看到这个状态 → 不可用；看过截图点认 → 可用', () => {
    const nh = { ...ok, program_check: { state: 'needs_human', at: AT } }
    expect(judgeWinner(row(nh), NOW)).toEqual({ usable: false, reason: 'human_check_not_acknowledged' })
    const acked = { ...nh, pm_decision: decision({ acknowledged_check_state: 'needs_human' }) }
    expect(judgeWinner(row(acked), NOW)).toEqual({ usable: true, costPerResult: 4.57 })
  })
})

describe('推翻与只认 PM 开关', () => {
  it('PM 推翻员工认过的赢家 → 建议回到只认 PM', () => {
    expect(shouldRevertToPmOnly(decision(), { decision: 'rejected', role: 'magic_lab' })).toBe(true)
  })
  it('PM 推翻 PM 自己认的、员工改认、员工推翻 → 不触发', () => {
    expect(shouldRevertToPmOnly(decision({ role: 'magic_lab' }), { decision: 'rejected', role: 'magic_lab' })).toBe(false)
    expect(shouldRevertToPmOnly(decision(), { decision: 'approved', role: 'magic_lab' })).toBe(false)
    expect(shouldRevertToPmOnly(decision(), { decision: 'rejected', role: 'client_staff' })).toBe(false)
    expect(shouldRevertToPmOnly(null, { decision: 'rejected', role: 'magic_lab' })).toBe(false)
  })
  it('配置开关只认显式 true', () => {
    expect(confirmIsPmOnly({ winner_confirm_pm_only: true })).toBe(true)
    expect(confirmIsPmOnly({ winner_confirm_pm_only: 'true' })).toBe(false)
    expect(confirmIsPmOnly(null)).toBe(false)
  })
})

describe('Winner Intake 客户匹配', () => {
  it('精确名字唯一命中才收；零个或多个都不收', () => {
    expect(intakeClientMatch([{ id: 'c1' }])).toEqual({ id: 'c1' })
    expect(intakeClientMatch([])).toBeNull()
    expect(intakeClientMatch([{ id: 'c1' }, { id: 'c2' }])).toBeNull()
    expect(intakeClientMatch(null)).toBeNull()
  })
})
