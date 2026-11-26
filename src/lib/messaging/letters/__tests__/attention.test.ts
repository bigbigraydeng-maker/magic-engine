import { describe, expect, it } from 'vitest'
import { needsAttention } from '../attention'
import type { LetterCounts, LetterStatus } from '../types'

function row(status: LetterStatus, over: Partial<LetterCounts> = {}) {
  return {
    status,
    counts: { recipients: 5, sent: 0, blocked: 0, failed: 0, rehearsal: 0, unknown: 0, opened: null, ...over } satisfies LetterCounts,
  }
}

describe('needsAttention · which "not sent" letters are worth an alarm', () => {
  it('errors or returned mail: yes', () => {
    expect(needsAttention(row('not_sent', { failed: 1 }))).toBe(true)
    expect(needsAttention(row('not_sent', { blocked: 3, failed: 2 }))).toBe(true)
  })

  it('released but nothing recorded at all (the numbers are still empty): yes', () => {
    expect(needsAttention(row('not_sent', { sent: null, blocked: null, failed: null }))).toBe(true)
  })

  it('everyone was skipped by the sending rules: only the status shows, no alarm', () => {
    expect(needsAttention(row('not_sent', { blocked: 5 }))).toBe(false)
  })

  it('only "not sent" letters can need it', () => {
    for (const status of ['draft', 'awaiting_release', 'sent', 'unknown'] as const) {
      expect(needsAttention(row(status, { failed: 3, sent: null }))).toBe(false)
    }
  })
})
