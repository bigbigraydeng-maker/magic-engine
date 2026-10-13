import { describe, it, expect } from 'vitest'
import {
  ASSISTANT_LIMIT_TEXT,
  UNKNOWN_ERROR_TEXT,
  assistantErrorLabel,
  departureAddedText,
  errorLabel,
  formatDateTimeWithYear,
  proposalWarningText,
  savedAsDraftText,
} from '../catalog-format'

describe('formatDateTimeWithYear', () => {
  it('puts the year in front of the local date and time', () => {
    expect(formatDateTimeWithYear('2026-10-10T03:30:00Z')).toMatch(/^2026年10月\d+日 \d{2}:\d{2}$/)
    // a local-time input has no timezone ambiguity
    expect(formatDateTimeWithYear('2026-10-10T16:30:00')).toBe('2026年10月10日 16:30')
  })

  it('returns the raw text when it is not a date', () => {
    expect(formatDateTimeWithYear('not a date')).toBe('not a date')
  })
})

describe('errorLabel', () => {
  it('known codes keep their sentence', () => {
    expect(errorLabel('feed_unavailable')).toBe('网站暂时读取不到')
  })

  it('unknown codes never reach the screen', () => {
    expect(errorLabel('HTTP 500')).toBe(UNKNOWN_ERROR_TEXT)
    expect(errorLabel('some_new_code')).toBe(UNKNOWN_ERROR_TEXT)
    expect(errorLabel('')).toBe(UNKNOWN_ERROR_TEXT)
  })
})

describe('assistantErrorLabel', () => {
  it('429 or assistant_limit: the daily-limit sentence', () => {
    expect(assistantErrorLabel(undefined, 429)).toBe(ASSISTANT_LIMIT_TEXT)
    expect(assistantErrorLabel('assistant_limit', 400)).toBe(ASSISTANT_LIMIT_TEXT)
  })

  it('keeps the too-long sentence and falls back to a plain one', () => {
    expect(assistantErrorLabel('assistant_truncated', 502)).toBe('这个改动太长，AI 一次没写完，请拆成几步再说')
    expect(assistantErrorLabel('assistant_unavailable', 503)).toBe('AI 助手暂时用不了，请稍后再试')
    expect(assistantErrorLabel('whatever', 500)).toBe('AI 助手暂时用不了，请稍后再试')
    expect(assistantErrorLabel(undefined, 500)).toBe('AI 助手暂时用不了，请稍后再试')
  })
})

describe('draft wording by the channels switch', () => {
  it('connected: the original wording', () => {
    expect(savedAsDraftText(true)).toBe('已存为草稿，客人还看不到')
    expect(departureAddedText(true)).toBe('已新增到草稿，客人还看不到')
  })

  it('not connected: says it is not published, nothing about customers', () => {
    expect(savedAsDraftText(false)).toBe('已存为草稿，还没上架')
    expect(departureAddedText(false)).toBe('已新增到草稿，还没上架')
  })
})

describe('proposalWarningText', () => {
  it('explains each known warning in plain words and never prints raw fields for unknown ones', () => {
    expect(proposalWarningText({ code: 'itinerary_shrinks', from: 18, to: 12 })).toContain('从 18 天减到 12 天')
    expect(proposalWarningText({ code: 'itinerary_mostly_changed', changed: 9, total: 10 })).toContain('10 天有 9 天')
    expect(proposalWarningText({ code: 'itinerary_extras_unmatched', days: [2, 5] })).toBe(
      '第 2、5 天的住宿和节日标记对不上原来的行程，没有自动带过来，请逐天确认。',
    )
    const unknown = proposalWarningText({ code: 'something_new' })
    expect(unknown).not.toContain('undefined')
    expect(unknown).toContain('请仔细核对')
  })
})
