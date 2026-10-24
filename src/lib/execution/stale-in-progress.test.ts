import { describe, expect, it } from 'vitest'
import { isStaleInProgress, STALE_IN_PROGRESS_DAYS } from './stale-in-progress'

const NOW = new Date('2026-10-24T00:00:00.000Z')

describe('isStaleInProgress', () => {
  it('is stale only when in_progress and untouched for more than 30 days', () => {
    const old = new Date(NOW.getTime() - (STALE_IN_PROGRESS_DAYS + 1) * 86_400_000).toISOString()
    expect(isStaleInProgress({ status: 'in_progress', updated_at: old }, NOW)).toBe(true)
  })

  it('leaves a card that was touched inside the window', () => {
    const recent = new Date(NOW.getTime() - (STALE_IN_PROGRESS_DAYS - 1) * 86_400_000).toISOString()
    expect(isStaleInProgress({ status: 'in_progress', updated_at: recent }, NOW)).toBe(false)
  })

  it('does not treat a missing timestamp as stale', () => {
    expect(isStaleInProgress({ status: 'in_progress', updated_at: null }, NOW)).toBe(false)
    expect(isStaleInProgress({ status: 'pending', updated_at: '2020-01-01T00:00:00.000Z' }, NOW)).toBe(false)
  })
})
