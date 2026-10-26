import { describe, it, expect, vi } from 'vitest'
import { buildPlanSeed, type PlanSeedDeps, type BuildArgs } from '../build'
import { sanitizeReason } from '../sanitize'
import type { PlanSeed, PlanSeedStep } from '../types'
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

const SECRET = 'EAAB' + 'x1Y2z3'.repeat(7)

describe('sanitize: raw exception text never reaches persisted reasons', () => {
  it('page token read failure', async () => {
    const deps = makeDeps({
      getPageToken: vi.fn<PlanSeedDeps['getPageToken']>(async () => {
        throw new Error(`graph said ${SECRET}`)
      }),
    })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)

    expect(JSON.stringify(seed)).not.toContain(SECRET)
    const skipped = seed.skipped.find((s) => s.step_key === 's1')
    expect(skipped).toBeDefined()
    expect(skipped?.why_empty).toContain('拿不到这个主页的访问令牌')
  })

  it('promote pages read failure', async () => {
    const deps = makeDeps({
      readPromotePages: vi.fn<PlanSeedDeps['readPromotePages']>(async () => {
        throw new Error(`boom ${SECRET}`)
      }),
    })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)

    expect(JSON.stringify(seed)).not.toContain(SECRET)
    expect(JSON.stringify(seed)).toContain('读不到（')
  })

  it('fallback error in runWork', async () => {
    const deps = makeDeps({
      now: vi.fn<PlanSeedDeps['now']>(() => {
        throw new Error(`clock ${SECRET}`)
      }),
    })

    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)

    expect(JSON.stringify(seed)).not.toContain(SECRET)
    const skipped = seed.skipped.find((s) => s.step_key === 's1')
    expect(skipped).toBeDefined()
    expect(skipped?.why_empty).toContain('取数出错')
  })

  it('sanitizeReason unit', () => {
    const token = sanitizeReason(`a access_token=${SECRET} b`)
    expect(token).toContain('access_token=***')
    expect(token).not.toContain(SECRET)

    const bearer = sanitizeReason('Bearer abcdef.ghijkl')
    expect(bearer).toContain('Bearer ***')

    expect(sanitizeReason('读不到')).toBe('读不到')
  })
})
