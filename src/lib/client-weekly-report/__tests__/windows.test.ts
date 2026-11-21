import { describe, it, expect } from 'vitest'
import { vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/gsc/client', () => ({ querySearchAnalyticsRows: vi.fn(), withGscAccess: vi.fn() }))
vi.mock('@/lib/ga4/client', () => ({ fetchGa4Snapshot: vi.fn() }))

import { computeWindows } from '../gather'

describe('computeWindows', () => {
  it('ends 3 days before now and gives two adjacent 7-day windows', () => {
    const w = computeWindows(new Date('2026-11-05T12:00:00Z'))
    expect(w.window).toEqual({ start: '2026-10-27', end: '2026-11-02' })
    expect(w.previousWindow).toEqual({ start: '2026-10-20', end: '2026-10-26' })
  })

  it('windows are exactly 7 days and touch without overlap', () => {
    const w = computeWindows(new Date('2026-03-01T00:00:00Z'))
    const days = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000
    expect(days(w.window.start, w.window.end)).toBe(6)
    expect(days(w.previousWindow.start, w.previousWindow.end)).toBe(6)
    expect(days(w.previousWindow.end, w.window.start)).toBe(1)
  })
})
