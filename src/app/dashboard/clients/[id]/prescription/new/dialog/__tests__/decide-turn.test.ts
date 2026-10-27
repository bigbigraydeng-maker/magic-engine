import { describe, expect, it } from 'vitest'
import { decideTurn, type DecideInput } from '../decide-turn'

const base: DecideInput = {
  text: '',
  prescriptionStatus: null,
  prescriptionId: null,
  discoveryReady: true,
  goals: [{ id: 'g1', title: '十一月线索' }],
  selectedGoalId: null,
  pendingGoal: null,
  pendingBudget: null,
  waitingFor: null,
  supplementOf: null,
  reviseOf: null,
  writing: false,
}

describe('decideTurn', () => {
  it('asks for a budget instead of inventing one', () => {
    const decision = decideTurn({ ...base, text: '开一个要 300 条线索的方' })
    expect(decision.kind).toBe('ask')
    if (decision.kind === 'ask') expect(decision.waitingFor).toBe('budget')
  })

  it('turns a sentence with a budget into a generate call', () => {
    const decision = decideTurn({ ...base, text: '开一个要 300 条线索的方，预算 3700' })
    expect(decision).toMatchObject({ kind: 'generate', budget: 3700, goalId: 'g1', mode: 'new' })
  })

  it('uses the follow-up number as the budget', () => {
    const decision = decideTurn({
      ...base,
      text: '3700',
      waitingFor: 'budget',
      pendingGoal: '开一个要 300 条线索的方',
    })
    expect(decision).toMatchObject({ kind: 'generate', budget: 3700, businessGoal: '开一个要 300 条线索的方' })
  })

  it('revises an existing draft in plain language', () => {
    const decision = decideTurn({ ...base, text: '把第一阶段去掉', prescriptionStatus: 'draft', prescriptionId: 'p1' })
    expect(decision).toEqual({ kind: 'refine', comments: '把第一阶段去掉' })
  })

  it('does not treat an agreed prescription as editable until a new version is asked for', () => {
    const blocked = decideTurn({ ...base, text: '把第一阶段去掉', prescriptionStatus: 'approved', prescriptionId: 'p1' })
    expect(blocked.kind).toBe('say')
    const again = decideTurn({ ...base, text: '再开一版，预算 800', prescriptionStatus: 'approved', prescriptionId: 'p1' })
    expect(again).toMatchObject({ kind: 'generate', mode: 'revise', priorId: 'p1', budget: 800 })
  })

  it('refuses to open a prescription before the brand scan is confirmed', () => {
    const decision = decideTurn({ ...base, discoveryReady: false, text: '开方，预算 500' })
    expect(decision.kind).toBe('say')
    if (decision.kind === 'say') expect(decision.text).toContain('品牌扫描')
  })
})
