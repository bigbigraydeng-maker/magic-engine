import { describe, expect, it } from 'vitest'
import { parsePrescriptionAsk, readShootAnswer } from '../utterance'

describe('parsePrescriptionAsk', () => {
  it('reads a budget written with a thousands comma', () => {
    const ask = parsePrescriptionAsk('给这个客户开个 11 月的方，预算 3,700，要 300 条线索')
    expect(ask.monthlyBudget).toBe(3700)
    expect(ask.businessGoal).toContain('300 条线索')
    expect(ask.wantsNewDraft).toBe(false)
  })

  it('treats a bare number as a budget follow-up', () => {
    const ask = parsePrescriptionAsk('3700')
    expect(ask.monthlyBudget).toBe(3700)
    expect(ask.businessGoal).toBe('')
  })

  it('leaves the budget empty when the sentence does not name one', () => {
    expect(parsePrescriptionAsk('先把落地页写清楚').monthlyBudget).toBeNull()
  })

  it('notices a request to open another version', () => {
    expect(parsePrescriptionAsk('再开一版，预算 1200').wantsNewDraft).toBe(true)
  })

  it('reads how many posts the person can shoot per week, only when it is written', () => {
    expect(parsePrescriptionAsk('预算 500，每周能拍 3 条').weeklyShoot).toBe(3)
    expect(parsePrescriptionAsk('一周拍两条').weeklyShoot).toBe(2)
    expect(parsePrescriptionAsk('预算 500').weeklyShoot).toBeNull()
  })

  it('reads a bare number as the shoot count only when asked for it', () => {
    expect(readShootAnswer('3')).toBe(3)
    expect(readShootAnswer('大概 4 条')).toBe(4)
    expect(readShootAnswer('看情况')).toBeNull()
    expect(readShootAnswer('0')).toBeNull()
    expect(parsePrescriptionAsk('3').weeklyShoot).toBeNull()
  })

  it('notices a one-off switch back to a standard client', () => {
    expect(parsePrescriptionAsk('按普通客户开，预算 500').forceStandard).toBe(true)
    expect(parsePrescriptionAsk('预算 500').forceStandard).toBe(false)
  })
})
