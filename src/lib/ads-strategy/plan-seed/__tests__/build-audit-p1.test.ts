import { describe, it, expect, vi } from 'vitest'
import { buildPlanSeed, type PlanSeedDeps, type BuildArgs } from '../build'
import { planSeedSchema, type PlanSeed, type PlanSeedStep } from '../types'
import { STALE_AFTER_MS } from '../constants'
import type { AdsDraftFacts } from '@/lib/marketing-plan/promo/draft-ads'
import type { AdPlay } from '../ad-plays'

const NOW = new Date('2026-10-26T02:00:00Z')
const FRESH = '2026-10-26T00:00:00Z' // 2h old
const STALE = '2026-10-25T10:00:00Z' // 16h old
const PERIOD = { start_date: '2026-10-27', end_date: '2026-11-10' }

function facts(over: Partial<AdsDraftFacts> = {}): AdsDraftFacts {
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
    ...over,
  }
}

function makeDeps(over: Partial<PlanSeedDeps> = {}): PlanSeedDeps {
  const defaults: PlanSeedDeps = {
    now: vi.fn<PlanSeedDeps['now']>(() => NOW),
    loadOwnedAccounts: vi.fn<PlanSeedDeps['loadOwnedAccounts']>(async () => [
      { id: 'act_A', cap: 10000, label: 'A' },
    ]),
    loadFacts: vi.fn<PlanSeedDeps['loadFacts']>(async () => facts()),
    loadCaptureAt: vi.fn<PlanSeedDeps['loadCaptureAt']>(async () => FRESH),
    loadClientPageId: vi.fn<PlanSeedDeps['loadClientPageId']>(async () => '555'),
    getPageToken: vi.fn<PlanSeedDeps['getPageToken']>(async () => 'tok'),
    readForms: vi.fn<PlanSeedDeps['readForms']>(async () => ({
      state: 'ok',
      value: [{ id: 'f1', active: true }],
    })),
    readScopes: vi.fn<PlanSeedDeps['readScopes']>(async () => ({
      source: 'client_page',
      scopes: { state: 'ok', value: ['leads_retrieval', 'pages_manage_ads'] },
    })),
    readPromotePages: vi.fn<PlanSeedDeps['readPromotePages']>(async () => ({
      state: 'ok',
      value: ['555'],
    })),
    playbookShare: vi.fn<PlanSeedDeps['playbookShare']>(async () => 0.5),
  }
  return { ...defaults, ...over }
}

function args(
  plays: { step_key: string; play: AdPlay['play'] }[],
  over: Partial<BuildArgs> = {},
): BuildArgs {
  return {
    clientId: 'c1',
    plays: plays as AdPlay[],
    period: PERIOD,
    ...over,
  }
}

function thruplayPlay(step_key = 's1'): { step_key: string; play: AdPlay['play'] } {
  return { step_key, play: 'thruplay_pool_build' }
}

function findStep(seed: PlanSeed, key: string): PlanSeedStep | undefined {
  return seed.ad_steps.find((s) => s.step_key === key)
}

const day = (date: string, spend_cents: number) => ({
  date,
  spend_cents,
  results: 0,
  account_status: 1,
})

describe('client-layer conservative flags cover non-selected accounts', () => {
  it('B whole snapshot read failed (facts rejects) -> halves: 2500', async () => {
    const deps = makeDeps({
      loadOwnedAccounts: vi.fn(async () => [
        { id: 'act_A', cap: 10000, label: 'A' },
        { id: 'act_B', cap: 10000, label: 'B' },
      ]),
      loadFacts: vi.fn(async (_c: string, accountId: string) => {
        if (accountId === 'act_A') return facts({ daily: [day('2026-10-25', 5000)] })
        throw new Error('boom')
      }),
    })

    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)
    const step = findStep(seed, 's1')
    expect(step).toBeDefined()
    expect(step?.ad_account_id.ok).toBe(true)
    if (step?.ad_account_id.ok) {
      expect(step.ad_account_id.value).toBe('act_A')
    }
    expect(step?.daily_budget_cents.ok).toBe(true)
    if (step?.daily_budget_cents.ok) {
      expect(step.daily_budget_cents.value).toBe(2500)
    }
  })

  it('B headroom read failed but B recent spend is 98% of client cap -> halves: 2500', async () => {
    const deps = makeDeps({
      loadOwnedAccounts: vi.fn(async () => [
        { id: 'act_A', cap: 10000, label: 'A' },
        { id: 'act_B', cap: 10000, label: 'B' },
      ]),
      loadFacts: vi.fn(async (_c: string, accountId: string) => {
        if (accountId === 'act_A') return facts({ daily: [day('2026-10-25', 5000)] })
        return facts({ headroom: { ok: false, reason: 'x' }, daily: [day('2026-10-25', 19600)] })
      }),
    })

    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)
    const step = findStep(seed, 's1')
    expect(step).toBeDefined()
    expect(step?.ad_account_id.ok).toBe(true)
    if (step?.ad_account_id.ok) {
      expect(step.ad_account_id.value).toBe('act_A')
    }
    expect(step?.daily_budget_cents.ok).toBe(true)
    if (step?.daily_budget_cents.ok) {
      expect(step.daily_budget_cents.value).toBe(2500)
    }
  })

  it('control: B healthy under cap -> 5000', async () => {
    const deps = makeDeps({
      loadOwnedAccounts: vi.fn(async () => [
        { id: 'act_A', cap: 10000, label: 'A' },
        { id: 'act_B', cap: 10000, label: 'B' },
      ]),
      loadFacts: vi.fn(async (_c: string, accountId: string) => {
        if (accountId === 'act_A') return facts({ daily: [day('2026-10-25', 5000)] })
        return facts({ daily: [day('2026-10-25', 5000)], account_delivering_minor: 5000 })
      }),
    })

    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)
    const step = findStep(seed, 's1')
    expect(step).toBeDefined()
    expect(step?.ad_account_id.ok).toBe(true)
    if (step?.ad_account_id.ok) {
      expect(step.ad_account_id.value).toBe('act_A')
    }
    expect(step?.daily_budget_cents.ok).toBe(true)
    if (step?.daily_budget_cents.ok) {
      expect(step.daily_budget_cents.value).toBe(5000)
    }
  })
})
