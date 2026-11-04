import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WINNER_RESULT_TYPES,
  confirmIsPmOnly,
  confirmerAuthorized,
  isGlobalAdminByEmail,
  judgeWinner,
  shouldRevertToPmOnly,
  staffCannotOverride,
  winnerDecisionEventId,
  type ConfirmerDirectory,
  type PmDecision,
} from './winner-gate'
import { intakeClientMatch } from './review-sync'
import { CORE_METRIC_NOUN } from '@/lib/ads-strategy/rules/core-metric'

const NOW = Date.parse('2026-11-05T09:00:00Z')
const AT = '2026-11-05T08:00:00.000Z'
const DIR: ConfirmerDirectory = {
  isGlobalAdmin: (e) => e === 'pm@magiclab.nz',
  staffEmails: new Set(['lisa@ctstours.co.nz']),
}

function decision(over: Partial<PmDecision> = {}): PmDecision {
  const d = over.decision ?? 'approved'
  const at = over.at ?? AT
  return { decision: d, by: 'lisa@ctstours.co.nz', role: 'client_staff', event_id: winnerDecisionEventId('w', d, at), at, ...over }
}

function row(performance: unknown, status = 'active') {
  return { id: 'w', status, performance }
}

const ok = { program_check: { state: 'passed', at: AT }, pm_decision: decision(), cost_per_result: 4.57, result_type: 'lead' }

describe('judgeWinner 关闭即失败', () => {
  it('全齐 → 可用，带单次成本和结果种类', () => {
    expect(judgeWinner(row(ok), NOW, DIR)).toEqual({ usable: true, costPerResult: 4.57, resultType: 'lead' })
  })

  it.each([
    ['not_active', row(ok, 'retired')],
    ['performance_unreadable', row([])],
    ['program_check_missing', row({ ...ok, program_check: undefined })],
    ['program_check_not_passed', row({ ...ok, program_check: { state: 'needs_human', at: AT } })],
    ['program_check_not_passed', row({ ...ok, program_check: { state: 'failed', at: AT } })],
    ['pm_decision_missing', row({ ...ok, pm_decision: undefined })],
    ['pm_decision_missing', row({ ...ok, pm_decision: { ...decision(), by: 'no-email' } })],
    ['pm_decision_missing', row({ ...ok, pm_decision: { ...decision(), role: 'boss' } })],
    ['receipt_invalid', row({ ...ok, pm_decision: decision({ event_id: 'forged' }) })],
    ['receipt_invalid', row({ ...ok, pm_decision: decision({ at: '2027-01-01T00:00:00.000Z' }) })],
    ['confirmer_not_authorized', row({ ...ok, pm_decision: decision({ by: 'stranger@example.com' }) })],
    ['confirmer_not_authorized', row({ ...ok, pm_decision: decision({ by: 'lisa@ctstours.co.nz', role: 'magic_lab' }) })],
    ['confirmer_not_authorized', row({ ...ok, pm_decision: decision({ by: 'pm@magiclab.nz', role: 'client_staff' }) })],
    ['pm_decision_rejected', row({ ...ok, pm_decision: decision({ decision: 'rejected' }) })],
    ['result_type_unknown', row({ ...ok, result_type: undefined })],
    ['result_type_unknown', row({ ...ok, result_type: 'thruplay' })],
    ['cost_per_result_missing', row({ ...ok, cost_per_result: undefined })],
    ['cost_per_result_missing', row({ ...ok, cost_per_result: 0 })],
  ])('%s', (reason, r) => {
    expect(judgeWinner(r, NOW, DIR)).toEqual({ usable: false, reason })
  })

  it('Magic Lab 确认的、确认人仍在全局管理员名单 → 可用', () => {
    const r = row({ ...ok, pm_decision: decision({ by: 'pm@magiclab.nz', role: 'magic_lab' }) })
    expect(judgeWinner(r, NOW, DIR).usable).toBe(true)
  })
})

describe('确认人名单', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('全局管理员判定与 requireGlobalAdmin 同源：演示 / 受限管理员不算', () => {
    vi.stubEnv('ADMIN_EMAILS', 'pm@magiclab.nz')
    vi.stubEnv('DEMO_ADMINS', 'demo@magiclab.nz:c0000000-0000-0000-0000-000000000000')
    expect(isGlobalAdminByEmail('pm@magiclab.nz')).toBe(true)
    expect(isGlobalAdminByEmail('demo@magiclab.nz')).toBe(false)
    expect(isGlobalAdminByEmail('lisa@ctstours.co.nz')).toBe(false)
  })

  it('员工角色的人同时是全局管理员 → 角色对不上，不算', () => {
    expect(confirmerAuthorized(decision({ by: 'pm@magiclab.nz' }), {
      isGlobalAdmin: () => true,
      staffEmails: new Set(['pm@magiclab.nz']),
    })).toBe(false)
  })
})

describe('推翻、改不了、只认 PM 开关', () => {
  it('PM 推翻员工认过的赢家 → 回到只认 PM', () => {
    expect(shouldRevertToPmOnly(decision(), { decision: 'rejected', role: 'magic_lab' })).toBe(true)
  })
  it('其它组合不触发', () => {
    expect(shouldRevertToPmOnly(decision({ role: 'magic_lab', by: 'pm@magiclab.nz' }), { decision: 'rejected', role: 'magic_lab' })).toBe(false)
    expect(shouldRevertToPmOnly(decision(), { decision: 'approved', role: 'magic_lab' })).toBe(false)
    expect(shouldRevertToPmOnly(null, { decision: 'rejected', role: 'magic_lab' })).toBe(false)
  })
  it('员工改不了 Magic Lab 的决定；Magic Lab 能改员工的', () => {
    expect(staffCannotOverride(decision({ role: 'magic_lab' }), 'client_staff')).toBe(true)
    expect(staffCannotOverride(decision(), 'client_staff')).toBe(false)
    expect(staffCannotOverride(decision(), 'magic_lab')).toBe(false)
    expect(staffCannotOverride(null, 'client_staff')).toBe(false)
  })
  it('配置开关只认显式 true', () => {
    expect(confirmIsPmOnly({ winner_confirm_pm_only: true })).toBe(true)
    expect(confirmIsPmOnly({ winner_confirm_pm_only: 'true' })).toBe(false)
    expect(confirmIsPmOnly(null)).toBe(false)
  })
})

describe('结果种类词表', () => {
  it('与广告策略的 CoreMetric 取值一致', () => {
    expect([...WINNER_RESULT_TYPES].sort()).toEqual(Object.keys(CORE_METRIC_NOUN).sort())
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
