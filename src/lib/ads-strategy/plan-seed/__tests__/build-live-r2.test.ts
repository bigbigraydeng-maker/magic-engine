import { describe, it, expect, vi } from 'vitest'
import { buildPlanSeed, liveCapMs, type PlanSeedDeps, type BuildArgs } from '../build'
import { planSeedSchema, type PlanSeed, type PlanSeedStep } from '../types'
import { STALE_AFTER_MS, LIVE_READ_TIMEOUT_MS } from '../constants'
import type { AdsDraftFacts } from '@/lib/marketing-plan/promo/draft-ads'
import type { AdPlay } from '../ad-plays'
import { formatNzTime } from '../format'
import type { LiveDelivering } from '../live-delivering'

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

type LiveFn = NonNullable<PlanSeedDeps['readLiveDelivering']>
const READ_AT = '2026-10-26T01:45:00Z'

function live(minor: number, over: Partial<LiveDelivering> = {}): LiveDelivering {
  return { minor, incomplete: false, readAtIso: READ_AT, currency: 'NZD', ...over }
}

function liveBasisOf(seed: PlanSeed, key: string) {
  const step = findStep(seed, key)
  if (!step || !step.daily_budget_cents.ok) throw new Error('expected a budget')
  return step.daily_budget_cents.basis.find((b) => b.label === '在投合计（实时）')
}

function budgetOf(seed: PlanSeed, key: string): number {
  const step = findStep(seed, key)
  if (!step || !step.daily_budget_cents.ok) throw new Error('expected a budget')
  return step.daily_budget_cents.value
}

function stepOf(seed: PlanSeed, key: string): PlanSeedStep {
  const step = findStep(seed, key)
  if (!step) throw new Error(`expected step ${key}`)
  return step
}

describe('live delivering round 2', () => {
  it('P1 incomplete live read (CBO) is not compared with the snapshot', async () => {
    const deps = makeDeps({
      loadFacts: vi.fn<PlanSeedDeps['loadFacts']>(async () =>
        facts({ account_delivering_minor: 4500 }),
      ),
      readLiveDelivering: vi.fn<LiveFn>(async () => live(5500, { incomplete: true })),
    })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)

    const nullDeps = makeDeps({
      loadFacts: vi.fn<PlanSeedDeps['loadFacts']>(async () =>
        facts({ account_delivering_minor: 4500 }),
      ),
      readLiveDelivering: vi.fn<LiveFn>(async () => null),
    })
    const nullSeed = await buildPlanSeed(args([thruplayPlay('s1')]), nullDeps)

    expect(budgetOf(seed, 's1')).toBe(2750)
    expect(budgetOf(seed, 's1')).toBe(budgetOf(nullSeed, 's1'))

    const basis = liveBasisOf(seed, 's1')
    expect(basis).toBeDefined()
    expect(basis?.value).toContain('不含系列级预算')
    expect(basis?.value).toContain('不能比')
    expect(basis?.value).not.toContain('这次用')

    const step = stepOf(seed, 's1')
    if (!step.daily_budget_cents.ok) throw new Error('expected a budget')
    const values = step.daily_budget_cents.basis.map((b) => b.value)
    expect(values.some((v) => v.includes('抓取之后新开的广告不在内'))).toBe(true)

    expect(step.ad_account_id.ok).toBe(true)
    if (step.ad_account_id.ok) {
      expect(step.ad_account_id.notes).toContain('这个数没算进该时间之后新开的广告')
    }
  })

  it('P1 control: complete live read still bumps', async () => {
    const deps = makeDeps({
      loadFacts: vi.fn<PlanSeedDeps['loadFacts']>(async () =>
        facts({ account_delivering_minor: 4500 }),
      ),
      readLiveDelivering: vi.fn<LiveFn>(async () => live(5500)),
    })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)

    expect(budgetOf(seed, 's1')).toBe(2250)

    const basis = liveBasisOf(seed, 's1')
    expect(basis).toBeDefined()
    expect(basis?.value).toContain('这次用')

    const step = stepOf(seed, 's1')
    expect(step.ad_account_id.ok).toBe(true)
    if (step.ad_account_id.ok) {
      expect(step.ad_account_id.notes).toEqual([])
    }
  })

  it('P2 zero room with a successful live read keeps the disclosure', async () => {
    const deps = makeDeps({
      loadFacts: vi.fn<PlanSeedDeps['loadFacts']>(async () =>
        facts({ account_delivering_minor: 0 }),
      ),
      readLiveDelivering: vi.fn<LiveFn>(async () => live(10000)),
    })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)

    expect(findStep(seed, 's1')).toBeUndefined()
    const skipped = seed.skipped.find((s) => s.step_key === 's1')
    expect(skipped).toBeDefined()
    expect(skipped?.why_empty).toContain('刚读的')
    expect(skipped?.why_empty).toContain('$100.00')
  })

  it('P2 zero room with a failed live read keeps the disclosure', async () => {
    const deps = makeDeps({
      loadFacts: vi.fn<PlanSeedDeps['loadFacts']>(async () =>
        facts({ account_delivering_minor: 10000 }),
      ),
      readLiveDelivering: vi.fn<LiveFn>(async () => {
        throw new Error('x')
      }),
    })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)

    const skipped = seed.skipped.find((s) => s.step_key === 's1')
    expect(skipped).toBeDefined()
    expect(skipped?.why_empty).toContain('实时在投没读到')
  })

  it('P2 zero room with an incomplete live read says it is not comparable', async () => {
    const deps = makeDeps({
      loadFacts: vi.fn<PlanSeedDeps['loadFacts']>(async () =>
        facts({ account_delivering_minor: 10000 }),
      ),
      readLiveDelivering: vi.fn<LiveFn>(async () => live(3000, { incomplete: true })),
    })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)

    const skipped = seed.skipped.find((s) => s.step_key === 's1')
    expect(skipped).toBeDefined()
    expect(skipped?.why_empty).toContain('不含系列级预算')
  })

  it('S1 candidate basis is labelled snapshot-based', async () => {
    const deps = makeDeps({
      readLiveDelivering: vi.fn<LiveFn>(async () => null),
    })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)

    const step = stepOf(seed, 's1')
    expect(step.ad_account_id.ok).toBe(true)
    if (step.ad_account_id.ok) {
      const candidate = step.ad_account_id.basis.find((b) => b.label === '合格候选账户')
      expect(candidate).toBeDefined()
      expect(candidate?.value).toContain('快照口径')
      expect(step.ad_account_id.notes).toContain('这个数没算进该时间之后新开的广告')
    }
  })

  it('S3 the 3-second cap is pinned', () => {
    expect(LIVE_READ_TIMEOUT_MS).toBe(3000)

    const cap = liveCapMs(Date.now() + 8000, 8000)
    expect(cap).toBeLessThanOrEqual(3000)
    expect(cap).toBeGreaterThanOrEqual(0)
    expect(cap + 500).toBeLessThanOrEqual(8000)

    expect(liveCapMs(Date.now() - 1000, 8000)).toBe(0)
  })
})
