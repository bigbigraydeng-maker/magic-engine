import { describe, expect, it } from 'vitest'
import { parseDecisionBody, parseIssueBody } from '../http'
import { ConfirmationCardError } from '../errors'

const DECISION = 'dec00000-0000-4000-8000-000000000001'
const FINGERPRINT = 'a'.repeat(64)

describe('confirmation card HTTP bodies', () => {
  it('accepts only confirm or decline', () => {
    expect(parseDecisionBody({
      resolution: 'confirm',
      expectedDecisionId: DECISION,
      fingerprint: FINGERPRINT,
    }).resolution).toBe('confirm')
    expect(() => parseDecisionBody({
      resolution: '确认',
      expectedDecisionId: DECISION,
      fingerprint: FINGERPRINT,
    })).toThrow(ConfirmationCardError)
    expect(() => parseDecisionBody({
      resolution: '好',
      expectedDecisionId: DECISION,
      fingerprint: FINGERPRINT,
    })).toThrow(/只能点/)
  })

  it('refuses extra fields', () => {
    expect(() => parseDecisionBody({
      resolution: 'decline',
      expectedDecisionId: DECISION,
      fingerprint: FINGERPRINT,
      execute: true,
    })).toThrow(/不认识/)
    expect(() => parseIssueBody({
      subjectKey: 'weekly-budget',
      what: '记下',
      account: '测试账户',
      amount: '一百',
      date: '下周一',
      scope: '只记卡',
      hardChecks: [],
      launch: true,
    })).toThrow(/不认识/)
  })
})
