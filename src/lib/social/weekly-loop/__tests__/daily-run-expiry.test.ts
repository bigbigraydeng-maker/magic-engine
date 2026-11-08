/** Knife 2: past-day reels never approved are handed to the expiry port and stop occupying their day. */
import { describe, expect, it, vi } from 'vitest'
import { scheduleDaily, type DailyEntry } from '../daily-run'
import type { WriteReelScheduleArgs, WriteReelScheduleResult } from '../schedule-writer'

const write = vi.fn(async (a: WriteReelScheduleArgs): Promise<WriteReelScheduleResult> => ({ ok: true, dryRun: a.dryRun, written: a.assignments, skipped: [] }))
const entry = (id: string, scheduledOn: string | null, eligible = true): DailyEntry => ({ id, scheduledOn, productKey: null, rankAt: `2026-11-0${id.length}`, eligible })

describe('scheduleDaily · expiry', () => {
  it('sends only past-day rows to the expiry port; expired rows free their day and are reported', async () => {
    const expire = vi.fn(async (a: { ids: string[] }) => a.ids.map((id) => ({ id, outcome: 'expired' as const })))
    const r = await scheduleDaily(write, {
      clientId: 'c1', slotDates: ['2026-11-06', '2026-11-07'], reelPerDay: 1, dryRun: false, today: '2026-11-05',
      entries: [entry('old', '2026-11-04', false), entry('future', '2026-11-06', false), entry('a', null), entry('bb', null)],
    }, expire)
    expect(expire).toHaveBeenCalledWith({ clientId: 'c1', ids: ['old'], today: '2026-11-05', dryRun: false })
    expect(r.expired).toEqual(['old'])
    expect(r.written.map((x) => x.publishOn)).toEqual(['2026-11-07'])
    expect(r.alreadyScheduled).toBe(1)
  })

  it('a broken expiry check is reported as an error, the row is kept', async () => {
    const expire = vi.fn(async (a: { ids: string[] }) => a.ids.map((id) => ({ id, outcome: 'check_failed' as const })))
    const r = await scheduleDaily(write, {
      clientId: 'c1', slotDates: ['2026-11-06'], reelPerDay: 1, dryRun: false, today: '2026-11-05',
      entries: [entry('old', '2026-11-04', false)],
    }, expire)
    expect(r.expired).toEqual([])
    expect(r.errors).toEqual(['expire_failed:1'])
  })
})
