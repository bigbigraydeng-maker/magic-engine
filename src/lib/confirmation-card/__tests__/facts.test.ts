import { describe, expect, it } from 'vitest'
import { confirmBlockReason, contentFingerprint, normalizeFacts, type CardFacts } from '../facts'
import { ConfirmationCardError } from '../errors'

const facts: CardFacts = {
  subjectKey: 'weekly-budget',
  what: '记下要不要调每周预算',
  account: '测试广告账户',
  amount: '每天一百新西兰元',
  date: '下周一',
  scope: '只记这一张卡',
  hardChecks: [{ label: '账户能读到', state: 'green', reason: '' }],
}

describe('confirmation card facts', () => {
  it('keeps the same fingerprint when the words are the same', () => {
    const left = contentFingerprint(normalizeFacts(facts))
    const right = contentFingerprint(normalizeFacts({ ...facts, hardChecks: [...facts.hardChecks] }))
    expect(left).toBe(right)
    expect(left).toMatch(/^[a-f0-9]{64}$/)
  })

  it('changes the fingerprint when the amount changes', () => {
    const left = contentFingerprint(normalizeFacts(facts))
    const right = contentFingerprint(normalizeFacts({ ...facts, amount: '每天两百新西兰元' }))
    expect(left).not.toBe(right)
  })

  it('blocks confirm when checks are missing, red, or unreadable', () => {
    expect(confirmBlockReason([])).toMatch(/不能确认/)
    expect(confirmBlockReason([{ label: '花费', state: 'red', reason: '超了' }])).toMatch(/超了/)
    expect(confirmBlockReason([{ label: '花费', state: 'unread', reason: '' }])).toMatch(/读不到/)
    expect(confirmBlockReason(facts.hardChecks)).toBeNull()
  })

  it('refuses code-like text and a red check with no reason', () => {
    expect(() => normalizeFacts({ ...facts, what: '{"a":1}' })).toThrow(ConfirmationCardError)
    expect(() => normalizeFacts({
      ...facts,
      hardChecks: [{ label: '花费', state: 'red', reason: '   ' }],
    })).toThrow(/原因/)
  })
})
