import { describe, it, expect } from 'vitest'
import { RETURN_REASONS, buildRealCustomerNote, buildReturnNote, isReturnReasonCode, parseFeedbackNote } from '../feedback'

describe('feedback notes', () => {
  it('round-trips a return note with text', () => {
    const note = buildReturnNote('solicitation', '地接社来推销')
    expect(note).toBe('[退回|solicitation] 地接社来推销')
    expect(parseFeedbackNote(note)).toEqual({ kind: 'return', code: 'solicitation', text: '地接社来推销' })
  })

  it('round-trips without text', () => {
    expect(parseFeedbackNote(buildReturnNote('protest'))).toEqual({ kind: 'return', code: 'protest', text: '' })
  })

  it('collapses newlines and truncates long text to 200 chars', () => {
    const note = buildReturnNote('other', 'a\nb\r\nc' + 'x'.repeat(300))
    expect(note.includes('\n')).toBe(false)
    expect(parseFeedbackNote(note)).toMatchObject({ kind: 'return', code: 'other' })
    expect((parseFeedbackNote(note) as { text: string }).text.length).toBeLessThanOrEqual(200)
  })

  it('real-customer notes round-trip', () => {
    expect(parseFeedbackNote(buildRealCustomerNote('他是同行报价'))).toEqual({ kind: 'real', text: '他是同行报价' })
    expect(parseFeedbackNote(buildRealCustomerNote())).toEqual({ kind: 'real', text: '' })
  })

  it('an unknown reason code is read back as "other" (the correction is never dropped)', () => {
    expect(parseFeedbackNote('[退回|brand_new_code] x')).toEqual({ kind: 'return', code: 'other', text: 'x' })
  })

  it('ordinary notes / null / machine notes are not feedback', () => {
    expect(parseFeedbackNote(null)).toBeNull()
    expect(parseFeedbackNote('')).toBeNull()
    expect(parseFeedbackNote('读往来记录判的：客户对旅游信息感兴趣')).toBeNull()
    expect(parseFeedbackNote('不是咨询：疑似群发营销 [model]')).toBeNull()
  })

  it('every offered reason code is accepted and unknown codes are rejected', () => {
    for (const r of RETURN_REASONS) expect(isReturnReasonCode(r.code)).toBe(true)
    expect(isReturnReasonCode('nope')).toBe(false)
    expect(isReturnReasonCode(5)).toBe(false)
  })
})
