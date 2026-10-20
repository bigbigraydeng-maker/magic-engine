import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import { summarizeLiveAds } from '../live-ads'

describe('summarizeLiveAds', () => {
  it('counts only ACTIVE adsets and ignores disappeared', () => {
    const fact = summarizeLiveAds({
      adsets: [
        { entity_id: 'a1', effective_status: 'ACTIVE', capture_reason: 'scheduled', captured_at: '2024-06-01T10:00:00Z' },
        { entity_id: 'a2', effective_status: 'ACTIVE', capture_reason: 'disappeared', captured_at: '2024-06-01T11:00:00Z' },
        { entity_id: 'a3', effective_status: 'PAUSED', capture_reason: 'scheduled', captured_at: '2024-06-01T12:00:00Z' },
        { entity_id: 'a4', effective_status: 'ACTIVE', capture_reason: null, captured_at: '2024-06-01T09:00:00Z' },
      ],
      insights: [],
      currency: 'USD',
      today: '2024-06-01',
    })
    expect(fact.ok).toBe(true)
    if (!fact.ok) return
    expect(fact.live_adsets).toBe(2)
    expect(fact.as_of).toBe('2024-06-01T12:00:00Z')
    expect(fact.currency).toBe('USD')
  })

  it('sums spend_today when latest insight_date equals today', () => {
    const fact = summarizeLiveAds({
      adsets: [],
      insights: [
        { insight_date: '2024-06-01', spend: 10 },
        { insight_date: '2024-06-01', spend: 5.5 },
        { insight_date: '2024-05-31', spend: 100 },
      ],
      currency: 'USD',
      today: '2024-06-01',
    })
    expect(fact.ok).toBe(true)
    if (!fact.ok) return
    expect(fact.spend_day).toBe('2024-06-01')
    expect(fact.spend_today).toBe(15.5)
  })

  it('returns spend_today null when latest day is yesterday', () => {
    const fact = summarizeLiveAds({
      adsets: [],
      insights: [
        { insight_date: '2024-05-31', spend: 42 },
        { insight_date: '2024-05-30', spend: 7 },
      ],
      currency: 'USD',
      today: '2024-06-01',
    })
    expect(fact.ok).toBe(true)
    if (!fact.ok) return
    expect(fact.spend_day).toBe('2024-05-31')
    expect(fact.spend_today).toBeNull()
  })

  it('handles empty inputs', () => {
    const fact = summarizeLiveAds({
      adsets: [],
      insights: [],
      currency: null,
      today: '2024-06-01',
    })
    expect(fact.ok).toBe(true)
    if (!fact.ok) return
    expect(fact.live_adsets).toBe(0)
    expect(fact.spend_today).toBeNull()
    expect(fact.spend_day).toBeNull()
    expect(fact.as_of).toBeNull()
    expect(fact.currency).toBeNull()
  })
})
