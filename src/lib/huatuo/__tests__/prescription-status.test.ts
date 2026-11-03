import { describe, expect, it } from 'vitest'
import { STALE_GENERATING_MS, isStaleGenerating } from '../prescription-status'

const started = '2026-10-26T00:00:00.000Z'
const startedMs = Date.parse(started)

describe('isStaleGenerating', () => {
  it('leaves a fresh generating row alone', () => {
    expect(isStaleGenerating('generating', started, startedMs + STALE_GENERATING_MS - 1)).toBe(false)
  })

  it('marks a generating row stale at the cutoff', () => {
    expect(isStaleGenerating('generating', started, startedMs + STALE_GENERATING_MS)).toBe(true)
  })

  it('ignores drafts and missing timestamps', () => {
    expect(isStaleGenerating('draft', started, startedMs + STALE_GENERATING_MS)).toBe(false)
    expect(isStaleGenerating('generating', null, startedMs + STALE_GENERATING_MS)).toBe(false)
  })
})
