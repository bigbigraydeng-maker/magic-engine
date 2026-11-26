import { describe, expect, it, vi } from 'vitest'
import { scheduleDaily, type DailyEntry } from '../daily-run'

const style = (template: string, music: string, group: string) => ({ template, music, variantGroup: group, signature: null })
const entry = (id: string, rankAt: string, st: ReturnType<typeof style>): DailyEntry => ({ id, scheduledOn: null, productKey: null, rankAt, eligible: true, style: st })
const write = vi.fn(async (args: { assignments: Array<{ id: string; publishOn: string }> }) => ({ ok: true as const, written: args.assignments, skipped: [] }))
const base = { clientId: 'c', slotDates: ['2026-11-06'], reelPerDay: 1, dryRun: true, today: '2026-11-05' }
const row = (id: string, music: string) => ({ id, created_at: '2026-11-01T00:00:00Z', brief: { remotion: { template: 'list', props: { musicFile: music, scenes: [{}, {}, {}] } } }, publishedOn: '2026-11-04' })

describe('scheduleDaily · reels already public', () => {
  it('a track used by a reel published yesterday is avoided; without that port the older reel would win', async () => {
    const entries = [entry('a', '2026-11-01', style('postcard', 'jade-river', 'ga')), entry('b', '2026-11-02', style('postcard', 'other', 'gb'))]
    const withRecent = await scheduleDaily(write as never, { ...base, entries }, undefined, async () => [row('zz', 'music/jade-river.mp3')])
    expect(withRecent.written).toEqual([{ id: 'b', publishOn: '2026-11-06' }])
    const without = await scheduleDaily(write as never, { ...base, entries })
    expect(without.written).toEqual([{ id: 'a', publishOn: '2026-11-06' }])
  })

  it('an unreadable recent list does not stop the schedule, it is reported', async () => {
    const entries = [entry('a', '2026-11-01', style('postcard', 'x', 'ga'))]
    const res = await scheduleDaily(write as never, { ...base, entries }, undefined, async () => { throw new Error('db down') })
    expect(res.written).toEqual([{ id: 'a', publishOn: '2026-11-06' }])
    expect(res.errors).toContain('recent_published_unreadable')
  })
})
