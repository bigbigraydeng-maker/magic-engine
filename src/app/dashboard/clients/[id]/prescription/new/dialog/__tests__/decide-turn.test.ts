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

  describe('个人 IP 客户', () => {
    const personal: DecideInput = { ...base, clientKind: 'personal_ip' }

    it('只有个人 IP 才多问每周能拍几条', () => {
      const decision = decideTurn({ ...personal, text: '帮我涨影响力，预算 500' })
      expect(decision).toMatchObject({ kind: 'ask', waitingFor: 'shoot', budget: 500 })
      const plain = decideTurn({ ...base, text: '帮我涨影响力，预算 500' })
      expect(plain).toMatchObject({ kind: 'generate', clientKind: 'standard', weeklyShoot: null })
    })

    it('客户类型从资料读，句子里出现「个人 IP」字样不会改变类型', () => {
      const decision = decideTurn({ ...base, text: '这是个人 IP 方案，预算 500' })
      expect(decision).toMatchObject({ kind: 'generate', clientKind: 'standard' })
    })

    it('回答条数后开方，并把条数带进去', () => {
      const decision = decideTurn({
        ...personal,
        text: '3',
        waitingFor: 'shoot',
        pendingGoal: '帮我涨影响力',
        pendingBudget: 500,
      })
      expect(decision).toMatchObject({
        kind: 'generate', clientKind: 'personal_ip', weeklyShoot: 3, budget: 500, goalId: 'g1',
      })
    })

    it('一句话里已经说了每周拍几条，就不再追问', () => {
      const decision = decideTurn({ ...personal, text: '帮我涨影响力，预算 500，每周能拍 2 条' })
      expect(decision).toMatchObject({ kind: 'generate', clientKind: 'personal_ip', weeklyShoot: 2 })
    })

    it('没看懂条数就再问一次，不编一个', () => {
      const decision = decideTurn({ ...personal, text: '看情况', waitingFor: 'shoot', pendingGoal: '涨影响力', pendingBudget: 500 })
      expect(decision.kind).toBe('say')
    })

    it('说「按普通客户开」就这一次改回普通，不再追问条数', () => {
      const decision = decideTurn({ ...personal, text: '按普通客户开，预算 500' })
      expect(decision).toMatchObject({ kind: 'generate', clientKind: 'standard', weeklyShoot: null })
    })

    it('先问了预算再回数字，「按普通客户开」仍然有效', () => {
      const asked = decideTurn({ ...personal, text: '按普通客户开' })
      expect(asked).toMatchObject({ kind: 'ask', waitingFor: 'budget' })
      const decision = decideTurn({
        ...personal, text: '500', waitingFor: 'budget', pendingGoal: '按普通客户开',
      })
      expect(decision).toMatchObject({ kind: 'generate', clientKind: 'standard' })
    })

    it('多个目标要选时，条数跟着走', () => {
      const goals = [{ id: 'g1', title: '十一月线索' }, { id: 'g2', title: '品牌' }]
      const asked = decideTurn({ ...personal, goals, text: '涨影响力，预算 500，每周拍 4 条' })
      expect(asked).toMatchObject({ kind: 'ask', waitingFor: 'goal', shoot: 4 })
      const decision = decideTurn({
        ...personal, goals, text: '2', waitingFor: 'goal', pendingGoal: '涨影响力', pendingBudget: 500, pendingShoot: 4,
      })
      expect(decision).toMatchObject({ kind: 'generate', goalId: 'g2', weeklyShoot: 4 })
    })
  })

  it('refuses to open a prescription before the brand scan is confirmed', () => {
    const decision = decideTurn({ ...base, discoveryReady: false, text: '开方，预算 500' })
    expect(decision.kind).toBe('say')
    if (decision.kind === 'say') expect(decision.text).toContain('品牌扫描')
  })
})
