import { describe, expect, it } from 'vitest'
import { parsePrescriptionAsk } from '../utterance'

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
})
