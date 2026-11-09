/**
 * Daily cadence wiring of the social weekly draft function (dev plan v1.2, knife 1):
 * clients with the social agent on are due every day; a manual event may force the daily cadence only in a practice run.
 */
import { describe, expect, it, vi } from 'vitest'
import { forceDaily, parseDueEvent, planFanOut } from '../cloud-social-weekly-draft'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

// 2026-11-05 is a Thursday in NZ; default draft weekday is Thursday (4).
const FRIDAY_NZ = new Date('2026-11-06T00:00:00Z')
const ENV = { SOCIAL_WEEKLY_LOOP_ENABLED: 'true', SOCIAL_WEEKLY_LOOP_WRITE: 'true' }

describe('daily cadence fan-out', () => {
  it('a client with the social agent on is due on a non-draft day; a weekly client is not', () => {
    const plan = planFanOut(ENV, FRIDAY_NZ, [
      { id: 'daily', config: { weekly_loop: { enabled: true }, social_agent: { enabled: true } } },
      { id: 'weekly', config: { weekly_loop: { enabled: true } } },
      { id: 'agent-but-loop-off', config: { social_agent: { enabled: true } } },
    ])
    expect(plan.due).toEqual(['daily'])
  })

  it('social_agent.enabled must be strictly true', () => {
    const plan = planFanOut(ENV, FRIDAY_NZ, [
      { id: 'c', config: { weekly_loop: { enabled: true }, social_agent: { enabled: 'true' } } },
    ])
    expect(plan.due).toEqual([])
  })
})

describe('manual daily practice runs', () => {
  it('a manual event with cadence daily forces it only in a dry run', () => {
    const ctx = parseDueEvent({ id: 'e1', data: { clientId: 'c1', mode: 'dry_run', cadence: 'daily' } }, FRIDAY_NZ)
    expect(ctx.forceDaily).toBe(true)
    expect(forceDaily(ctx, 'dry_run')).toBe(true)
    expect(forceDaily(ctx, 'write')).toBe(false)
  })

  it('a cron event can never force the daily cadence', () => {
    const ctx = parseDueEvent({ id: 'e2', data: { clientId: 'c1', mode: 'write', source: 'cron', cadence: 'daily' } }, FRIDAY_NZ)
    expect(ctx.forceDaily).toBe(false)
  })
})
