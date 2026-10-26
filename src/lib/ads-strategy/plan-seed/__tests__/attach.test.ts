import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrescriptionContent } from '@/types/diagnostic'
import type { AdsDraftFacts } from '@/lib/marketing-plan/promo/draft-ads'
import { planSeedSchema, type PlanSeed } from '../types'

vi.mock('../deps', () => ({
  productionDeps: () => ({
    now: () => new Date('2026-10-26T02:00:00Z'),
    loadOwnedAccounts: async () => { throw new Error('production dep must not be used') },
    loadFacts: async () => { throw new Error('production dep must not be used') },
    loadCaptureAt: async () => { throw new Error('production dep must not be used') },
    loadClientPageId: async () => { throw new Error('production dep must not be used') },
    getPageToken: async () => { throw new Error('production dep must not be used') },
    readForms: async () => { throw new Error('production dep must not be used') },
    readScopes: async () => { throw new Error('production dep must not be used') },
    readPromotePages: async () => { throw new Error('production dep must not be used') },
    playbookShare: async () => { throw new Error('production dep must not be used') },
  }),
  loadGoalPeriod: vi.fn(async () => null),
}))
vi.mock('../build', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../build')>()
  return { ...actual, buildPlanSeed: vi.fn(actual.buildPlanSeed) }
})
import { buildPlanSeed } from '../build'
import { attachPlanSeed, collectAdPlays, sanitizeAdPlays, carryPriorAdPlays, type AttachDeps } from '../attach'

function facts(): AdsDraftFacts {
  return {
    today: '2026-10-26',
    headroom: {
      ok: true,
      headroom_minor: 15000,
      delivering_minor: 5000,
      cap_minor: 20000,
      currency: 'NZD',
      as_of: null,
    },
    account_delivering_minor: 0,
    account_cap_minor: 10000,
    committed_minor: 0,
    daily: [],
    insights_as_of: null,
    account_status: 1,
    audiences: [],
    audiences_complete: true,
    approved_creatives: [],
    budget_share_of_headroom: 0.5,
    min_audience_size: 1000,
    max_creatives: 3,
  }
}

function fullDeps(): AttachDeps {
  return {
    now: () => new Date('2026-10-26T02:00:00Z'),
    loadOwnedAccounts: async () => [{ id: 'act_A', cap: 10000, label: 'A' }],
    loadFacts: async () => facts(),
    loadCaptureAt: async () => '2026-10-26T00:00:00Z',
    loadClientPageId: async () => '555',
    getPageToken: async () => 'tok',
    readForms: async () => ({ state: 'ok', value: [{ id: 'f1', active: true }] }),
    readScopes: async () => ({
      source: 'client_page',
      scopes: { state: 'ok', value: ['leads_retrieval', 'pages_manage_ads'] },
    }),
    readPromotePages: async () => ({ state: 'ok', value: ['555'] }),
    playbookShare: async () => 0.5,
    loadPeriod: async () => ({ start_date: '2026-10-27', end_date: '2026-11-10' }),
  }
}

function seedOf(c: PrescriptionContent): PlanSeed {
  return planSeedSchema.parse(c.plan_seed)
}

function content(plays?: unknown, extra: Record<string, unknown> = {}): PrescriptionContent {
  return {
    summary: 's',
    kpi_targets: [],
    budget_allocation: [],
    phases: [
      {
        phase_number: 1,
        name: 'p',
        duration_weeks: 1,
        actions: [],
        initiative_seed: {
          initiative_type: 'demand_generation',
          title: 't',
          ...(plays === undefined ? {} : { ad_plays: plays }),
        },
      },
    ],
    ...extra,
  } as PrescriptionContent
}

const ctx = { clientId: 'c1', goalId: 'g1' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('attachPlanSeed', () => {
  it('drops client/LLM-supplied plan_seed when there are no ad_plays', async () => {
    const input = content(undefined, { plan_seed: { evil: 1 } })
    const result = await attachPlanSeed(input, ctx, fullDeps())
    expect('plan_seed' in result).toBe(false)
    expect(buildPlanSeed).not.toHaveBeenCalled()
  })

  it('replaces a forged plan_seed with a real one when ad_plays exist', async () => {
    const input = content([{ step_key: 's1', play: 'thruplay_pool_build' }], {
      plan_seed: { evil: 1 },
    })
    const result = await attachPlanSeed(input, ctx, fullDeps())
    expect(result).toBe(input)
    expect(result.plan_seed).toBeDefined()
    expect(planSeedSchema.safeParse(result.plan_seed).success).toBe(true)
    expect(seedOf(result).ad_steps.length).toBe(1)
    expect(JSON.stringify(result.plan_seed)).not.toContain('evil')
  })

  it('resolves without throwing when buildPlanSeed rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(buildPlanSeed).mockRejectedValueOnce(new Error('boom'))
    const input = content([{ step_key: 's1', play: 'thruplay_pool_build' }], {
      plan_seed: { evil: 1 },
    })
    const result = await attachPlanSeed(input, ctx, fullDeps())
    expect(result).toBe(input)
    expect('plan_seed' in result).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('still resolves and builds a seed with period null when loadPeriod throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = fullDeps()
    deps.loadPeriod = async () => {
      throw new Error('period boom')
    }
    const input = content([{ step_key: 's1', play: 'thruplay_pool_build' }])
    const result = await attachPlanSeed(input, ctx, deps)
    expect(result.plan_seed).toBeDefined()
    expect(seedOf(result).ad_steps).toEqual([])
    expect(
      seedOf(result).notes.some((n) => n.includes('目标没有周期')),
    ).toBe(true)
    warn.mockRestore()
  })

  it('passes ctx.goalId to loadPeriod', async () => {
    const loadPeriod = vi.fn(async () => ({
      start_date: '2026-10-27',
      end_date: '2026-11-10',
    }))
    const deps = fullDeps()
    deps.loadPeriod = loadPeriod
    await attachPlanSeed(content([{ step_key: 's1', play: 'thruplay_pool_build' }]), ctx, deps)
    expect(loadPeriod).toHaveBeenCalledWith('g1')
  })

  it('cleans illegal ad_plays and writes back the legal ones', async () => {
    const input = content([
      { step_key: 'ok', play: 'reach_awareness' },
      { step_key: 'BAD KEY', play: 'x' },
      'junk',
    ])
    const result = await attachPlanSeed(input, ctx, fullDeps())
    const phases = result.phases as unknown as Array<{
      initiative_seed: { ad_plays?: unknown }
    }>
    expect(phases[0].initiative_seed.ad_plays).toEqual([
      { step_key: 'ok', play: 'reach_awareness' },
    ])
  })

  it('removes the ad_plays key and produces no plan_seed when all items are illegal', async () => {
    const input = content([{ step_key: 'BAD KEY', play: 'x' }, 'junk'])
    const result = await attachPlanSeed(input, ctx, fullDeps())
    const phases = result.phases as unknown as Array<{
      initiative_seed: Record<string, unknown>
    }>
    expect('ad_plays' in phases[0].initiative_seed).toBe(false)
    expect('plan_seed' in result).toBe(false)
  })
})

describe('carryPriorAdPlays via attachPlanSeed', () => {
  it('carries prior ad_plays into a refined content with none', async () => {
    const prior = content([{ step_key: 'p1', play: 'lead_form_harvest' }])
    const next = content(undefined)
    const result = await attachPlanSeed(
      next,
      { clientId: 'c1', goalId: 'g1', priorContent: prior },
      fullDeps(),
    )
    const phases = result.phases as unknown as Array<{
      initiative_seed: { ad_plays?: unknown }
    }>
    expect(phases[0].initiative_seed.ad_plays).toEqual([
      { step_key: 'p1', play: 'lead_form_harvest' },
    ])
    const seed = seedOf(result)
    const mentioned =
      seed.ad_steps.some((s) => s.step_key === 'p1') ||
      seed.skipped.some((s) => s.step_key === 'p1')
    expect(mentioned).toBe(true)
  })

  it('does not overwrite new ad_plays with prior ones', async () => {
    const prior = content([{ step_key: 'p1', play: 'lead_form_harvest' }])
    const next = content([{ step_key: 'n1', play: 'reach_awareness' }])
    const result = await attachPlanSeed(
      next,
      { clientId: 'c1', goalId: 'g1', priorContent: prior },
      fullDeps(),
    )
    const phases = result.phases as unknown as Array<{
      initiative_seed: { ad_plays?: unknown }
    }>
    expect(phases[0].initiative_seed.ad_plays).toEqual([
      { step_key: 'n1', play: 'reach_awareness' },
    ])
  })
})

describe('collectAdPlays', () => {
  it('is pure, collects across phases, and drops later duplicate step_keys', () => {
    const input = {
      summary: 's',
      kpi_targets: [],
      budget_allocation: [],
      phases: [
        {
          phase_number: 1,
          name: 'p1',
          duration_weeks: 1,
          actions: [],
          initiative_seed: {
            initiative_type: 'demand_generation',
            title: 't',
            ad_plays: [
              { step_key: 'a', play: 'reach_awareness' },
              { step_key: 'b', play: 'thruplay_pool_build' },
            ],
          },
        },
        {
          phase_number: 2,
          name: 'p2',
          duration_weeks: 1,
          actions: [],
          initiative_seed: {
            initiative_type: 'demand_generation',
            title: 't',
            ad_plays: [
              { step_key: 'a', play: 'lead_form_harvest' },
              { step_key: 'c', play: 'lead_form_harvest' },
            ],
          },
        },
      ],
    } as PrescriptionContent
    const before = JSON.stringify(input)
    const plays = collectAdPlays(input)
    expect(JSON.stringify(input)).toBe(before)
    expect(plays.map((p) => p.step_key)).toEqual(['a', 'b', 'c'])
    expect(plays[0].play).toBe('reach_awareness')
  })

  it('returns [] when phases is not an array', () => {
    const input = { phases: 'x' } as unknown as PrescriptionContent
    expect(collectAdPlays(input)).toEqual([])
  })
})

describe('sanitizeAdPlays', () => {
  it('never throws for null / string initiative_seed or missing phases', () => {
    const nullSeed = {
      summary: 's',
      kpi_targets: [],
      budget_allocation: [],
      phases: [{ phase_number: 1, name: 'p', duration_weeks: 1, actions: [], initiative_seed: null }],
    } as unknown as PrescriptionContent
    const stringSeed = {
      summary: 's',
      kpi_targets: [],
      budget_allocation: [],
      phases: [
        { phase_number: 1, name: 'p', duration_weeks: 1, actions: [], initiative_seed: 'nope' },
      ],
    } as unknown as PrescriptionContent
    const noPhases = { summary: 's', kpi_targets: [], budget_allocation: [] } as unknown as PrescriptionContent
    expect(() => sanitizeAdPlays(nullSeed)).not.toThrow()
    expect(() => sanitizeAdPlays(stringSeed)).not.toThrow()
    expect(() => sanitizeAdPlays(noPhases)).not.toThrow()
  })
})

describe('carryPriorAdPlays', () => {
  it('matches phases by phase_number', () => {
    const prior = {
      summary: 's',
      kpi_targets: [],
      budget_allocation: [],
      phases: [
        {
          phase_number: 1,
          name: 'p1',
          duration_weeks: 1,
          actions: [],
          initiative_seed: {
            initiative_type: 'demand_generation',
            title: 't',
            ad_plays: [{ step_key: 'one', play: 'reach_awareness' }],
          },
        },
        {
          phase_number: 2,
          name: 'p2',
          duration_weeks: 1,
          actions: [],
          initiative_seed: {
            initiative_type: 'demand_generation',
            title: 't',
            ad_plays: [{ step_key: 'two', play: 'lead_form_harvest' }],
          },
        },
      ],
    } as PrescriptionContent
    const next = {
      summary: 's',
      kpi_targets: [],
      budget_allocation: [],
      phases: [
        { phase_number: 1, name: 'p1', duration_weeks: 1, actions: [], initiative_seed: { initiative_type: 'demand_generation', title: 't' } },
        { phase_number: 2, name: 'p2', duration_weeks: 1, actions: [], initiative_seed: { initiative_type: 'demand_generation', title: 't' } },
      ],
    } as PrescriptionContent
    carryPriorAdPlays(next, prior)
    const phases = next.phases as unknown as Array<{
      phase_number: number
      initiative_seed: { ad_plays?: unknown }
    }>
    expect(phases[0].initiative_seed.ad_plays).toEqual([
      { step_key: 'one', play: 'reach_awareness' },
    ])
    expect(phases[1].initiative_seed.ad_plays).toEqual([
      { step_key: 'two', play: 'lead_form_harvest' },
    ])
  })

  it('carryPriorAdPlays returns true only when something was carried', () => {
    const prior = content([{ step_key: 'p1', play: 'lead_form_harvest' }])
    const empty = content(undefined)
    expect(carryPriorAdPlays(empty, prior)).toBe(true)

    const withOwn = content([{ step_key: 'n1', play: 'reach_awareness' }])
    expect(carryPriorAdPlays(withOwn, prior)).toBe(false)

    const noPriorPlays = content(undefined)
    expect(carryPriorAdPlays(noPriorPlays, content(undefined))).toBe(false)
  })
})

describe('attachPlanSeed budget', () => {
  it('a hanging loadPeriod cannot hold attach beyond the budget', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps: AttachDeps = {
      ...fullDeps(),
      timeoutMs: 100,
      loadPeriod: () => new Promise(() => {}),
    }
    const input = content([{ step_key: 's1', play: 'thruplay_pool_build' }])
    const startedAt = Date.now()
    const result = await attachPlanSeed(input, ctx, deps)
    const elapsed = Date.now() - startedAt
    expect(elapsed).toBeLessThan(1500)
    expect(result).toBe(input)
    expect('plan_seed' in result).toBe(false)
    warn.mockRestore()
  })

  it('total time includes period read: remaining budget is passed to buildPlanSeed', async () => {
    const deps: AttachDeps = {
      ...fullDeps(),
      timeoutMs: 400,
      loadPeriod: () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve({ start_date: '2026-10-27', end_date: '2026-11-10' }),
            100,
          )
        }),
    }
    const input = content([{ step_key: 's1', play: 'thruplay_pool_build' }])
    await attachPlanSeed(input, ctx, deps)
    const calls = vi.mocked(buildPlanSeed).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const lastCall = calls[calls.length - 1]
    const options = lastCall[2]
    expect(options).toBeDefined()
    const remaining = options?.timeoutMs
    expect(typeof remaining).toBe('number')
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeLessThanOrEqual(300)
  })
})

describe('carried plays note', () => {
  it('carried plays leave a note', async () => {
    const prior = content([{ step_key: 'p1', play: 'lead_form_harvest' }])
    const next = content(undefined)
    const result = await attachPlanSeed(
      next,
      { clientId: 'c1', goalId: 'g1', priorContent: prior },
      fullDeps(),
    )
    expect(seedOf(result).notes).toContain('打法是从上一版处方带回来的')
  })

  it('own plays leave no carried note', async () => {
    const prior = content([{ step_key: 'p1', play: 'lead_form_harvest' }])
    const next = content([{ step_key: 'n1', play: 'reach_awareness' }])
    const result = await attachPlanSeed(
      next,
      { clientId: 'c1', goalId: 'g1', priorContent: prior },
      fullDeps(),
    )
    expect(seedOf(result).notes).not.toContain('打法是从上一版处方带回来的')
  })
})
