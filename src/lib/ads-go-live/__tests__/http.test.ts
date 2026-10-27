import { describe, expect, it } from 'vitest'
import { ConfirmationCardError } from '@/lib/confirmation-card'
import { parseGoLiveDecision, parseGoLiveIssue } from '../http'

const RUN = '11111111-1111-4111-8111-111111111111'
const DECISION = '22222222-2222-4222-8222-222222222222'
const FINGERPRINT = 'a'.repeat(64)

describe('go-live HTTP bodies', () => {
  it('accepts only a draft id on issue', () => {
    expect(parseGoLiveIssue({ draftId: 'Draft_1' })).toBe('Draft_1')
    expect(() => parseGoLiveIssue({ draftId: 'Draft_1', launch: true })).toThrow(/不认识/)
    expect(() => parseGoLiveIssue({ draftId: '../nope' })).toThrow(ConfirmationCardError)
  })

  it('refuses chat words and extra fields on a click', () => {
    expect(() => parseGoLiveDecision({
      resolution: '可以',
      expectedDecisionId: DECISION,
      fingerprint: FINGERPRINT,
      runId: RUN,
    })).toThrow(/只能点/)
    expect(() => parseGoLiveDecision({
      resolution: 'confirm',
      expectedDecisionId: DECISION,
      fingerprint: FINGERPRINT,
      runId: RUN,
      execute: true,
    })).toThrow(/不认识/)
    const parsed = parseGoLiveDecision({
      resolution: 'decline',
      expectedDecisionId: DECISION,
      fingerprint: FINGERPRINT,
      runId: RUN.toUpperCase(),
    })
    expect(parsed.runId).toBe(RUN)
    expect(parsed.resolution).toBe('decline')
  })
})
