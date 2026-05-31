import { describe, it, expect } from 'vitest'
import { findSlots } from '../slot-finder'
import type { PendingPost, ExistingScheduleEntry, SlotFinderInput } from '../slot-finder'

// Base date: 2026-07-01 00:00:00 UTC (2026-07-01 10:00 AEST)
const BASE = new Date('2026-07-01T00:00:00Z')

describe('findSlots', () => {
  it('assigns platform peak time on base day when no conflicts', () => {
    const input: SlotFinderInput = {
      posts: [{ id: 'p1', platform: 'facebook' }],
      existingSchedule: [],
      baseDate: BASE,
    }
    const result = findSlots(input)
    expect(result.suggestions).toHaveLength(1)
    expect(result.unscheduled).toHaveLength(0)

    const s = result.suggestions[0]
    expect(s.post_id).toBe('p1')
    expect(s.platform).toBe('facebook')
    // Facebook peak: 08:30 AEST (UTC+10) = 2026-06-30T22:30Z (08:30 - 10h wraps to prev UTC day)
    expect(s.suggested_at).toBe('2026-06-30T22:30:00.000Z')
  })

  it('assigns correct peak time for each platform', () => {
    const platforms = ['instagram', 'linkedin', 'google'] as const
    // instagram 18:00 AEST = 08:00 UTC, linkedin 07:30 AEST = 21:30 UTC prev day, google 12:00 AEST = 02:00 UTC
    const expectedUtc: Record<string, string> = {
      instagram: '2026-07-01T08:00:00.000Z',
      linkedin:  '2026-06-30T21:30:00.000Z',
      google:    '2026-07-01T02:00:00.000Z',
    }
    for (const platform of platforms) {
      const result = findSlots({
        posts: [{ id: 'p', platform }],
        existingSchedule: [],
        baseDate: BASE,
      })
      expect(result.suggestions[0].suggested_at).toBe(expectedUtc[platform])
    }
  })

  it('bumps to next day when platform slot is full', () => {
    const existing: ExistingScheduleEntry[] = [
      { platform: 'instagram', scheduled_at: '2026-07-01T08:00:00Z' },
    ]
    const result = findSlots({
      posts: [{ id: 'p1', platform: 'instagram' }],
      existingSchedule: existing,
      baseDate: BASE,
    })
    // Should land on 2026-07-02 18:00 AEST = 2026-07-02T08:00Z
    expect(result.suggestions[0].suggested_at).toBe('2026-07-02T08:00:00.000Z')
  })

  it('allows TikTok 2 posts per day using different slots', () => {
    const result = findSlots({
      posts: [
        { id: 't1', platform: 'tiktok' },
        { id: 't2', platform: 'tiktok' },
      ],
      existingSchedule: [],
      baseDate: BASE,
    })
    expect(result.suggestions).toHaveLength(2)
    // slot 0 = 12:00 AEST = 02:00 UTC, slot 1 = 19:00 AEST = 09:00 UTC
    expect(result.suggestions[0].suggested_at).toBe('2026-07-01T02:00:00.000Z')
    expect(result.suggestions[1].suggested_at).toBe('2026-07-01T09:00:00.000Z')
  })

  it('third TikTok post bumps to next day', () => {
    const result = findSlots({
      posts: [
        { id: 't1', platform: 'tiktok' },
        { id: 't2', platform: 'tiktok' },
        { id: 't3', platform: 'tiktok' },
      ],
      existingSchedule: [],
      baseDate: BASE,
    })
    expect(result.suggestions[2].suggested_at).toBe('2026-07-02T02:00:00.000Z')
  })

  it('multi-platform batch places each platform independently', () => {
    const result = findSlots({
      posts: [
        { id: 'fb', platform: 'facebook' },
        { id: 'ig', platform: 'instagram' },
        { id: 'li', platform: 'linkedin' },
      ],
      existingSchedule: [],
      baseDate: BASE,
    })
    expect(result.suggestions).toHaveLength(3)
    expect(result.unscheduled).toHaveLength(0)
    const ids = result.suggestions.map(s => s.post_id)
    expect(ids).toContain('fb')
    expect(ids).toContain('ig')
    expect(ids).toContain('li')
  })

  it('returns unscheduled when window exhausted', () => {
    // Fill all 3 days for facebook with existing
    const existing: ExistingScheduleEntry[] = [
      { platform: 'facebook', scheduled_at: '2026-06-30T22:30:00Z' }, // day 1
      { platform: 'facebook', scheduled_at: '2026-07-01T22:30:00Z' }, // day 2
      { platform: 'facebook', scheduled_at: '2026-07-02T22:30:00Z' }, // day 3
    ]
    const result = findSlots({
      posts: [{ id: 'p1', platform: 'facebook' }],
      existingSchedule: existing,
      baseDate: BASE,
      windowDays: 3,
    })
    expect(result.suggestions).toHaveLength(0)
    expect(result.unscheduled).toContain('p1')
  })

  it('respects existing + session usage together', () => {
    // 1 existing instagram today, then 2 new posts: second should go to day 2
    const existing: ExistingScheduleEntry[] = [
      { platform: 'instagram', scheduled_at: '2026-07-01T08:00:00Z' },
    ]
    const result = findSlots({
      posts: [
        { id: 'n1', platform: 'instagram' },
        { id: 'n2', platform: 'instagram' },
      ],
      existingSchedule: existing,
      baseDate: BASE,
    })
    expect(result.suggestions[0].suggested_at).toBe('2026-07-02T08:00:00.000Z')
    expect(result.suggestions[1].suggested_at).toBe('2026-07-03T08:00:00.000Z')
  })

  it('empty posts returns empty result', () => {
    const result = findSlots({ posts: [], existingSchedule: [], baseDate: BASE })
    expect(result.suggestions).toHaveLength(0)
    expect(result.unscheduled).toHaveLength(0)
  })
})
