import { describe, it, expect, vi } from 'vitest'

vi.mock('../../portfolio/goal-context', () => ({ buildDigestGoalContext: vi.fn() }))

import { overlayLiveGoal } from '../growth-live-goal'
import type { DigestGoalContext } from '../../portfolio/internal-digest'

const NOW = new Date('2026-10-21T20:00:00Z') // NZ 2026-10-22 09:00
const pace = { expectedToDate: 10, actualToDate: 12, gapPct: 20, projectedEnd: 40, verdict: 'on_track', reason: 'ok' } as const
const live: DigestGoalContext = { title: '新目标', label: '留资', target: 50, dayIndex: 2, totalDays: 30, pace: { ...pace } }
const row = {
  date: '2026-10-21',
  payload: { headline: 'h', goal: { title: '旧目标', label: '留资', target: 20, dayIndex: 9, totalDays: 14 } },
  goal_pace: { ...pace, verdict: 'behind' },
}

describe('overlayLiveGoal', () => {
  it('replaces the stored goal and pace with the live ones, keeps other payload fields', async () => {
    const read = vi.fn().mockResolvedValue(live)
    const out = await overlayLiveGoal('c1', row, NOW, read)
    expect(read).toHaveBeenCalledWith('c1', '2026-10-22')
    expect(out.payload).toMatchObject({ headline: 'h', goal: { title: '新目标', target: 50, dayIndex: 2, totalDays: 30 } })
    expect(out.goal_pace).toEqual(live.pace)
    expect(out.goal_live).toEqual({ live: true, readAtIso: NOW.toISOString() })
    expect(out.date).toBe('2026-10-21')
  })

  it('keeps the cached values and marks not-live when the live read returns nothing', async () => {
    const out = await overlayLiveGoal('c1', row, NOW, vi.fn().mockResolvedValue(null))
    expect(out.payload).toBe(row.payload)
    expect(out.goal_pace).toBe(row.goal_pace)
    expect(out.goal_live.live).toBe(false)
  })

  it('tolerates a non-object payload', async () => {
    const out = await overlayLiveGoal('c1', { payload: null, goal_pace: null }, NOW, vi.fn().mockResolvedValue(live))
    expect(out.payload).toMatchObject({ goal: { title: '新目标' } })
  })
})
