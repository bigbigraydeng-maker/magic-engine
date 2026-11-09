import { describe, expect, it } from 'vitest'
import { existingAdSetCountsAsLive } from '../existing-ad-set-live'

describe('existingAdSetCountsAsLive', () => {
  it('does not count a paused or archived existing ad set as live', () => {
    expect(existingAdSetCountsAsLive('PAUSED')).toBe(false)
    expect(existingAdSetCountsAsLive('ARCHIVED')).toBe(false)
    expect(existingAdSetCountsAsLive('ACTIVE')).toBe(true)
    expect(existingAdSetCountsAsLive(null)).toBe(false)
    expect(existingAdSetCountsAsLive(undefined)).toBe(false)
  })
})
