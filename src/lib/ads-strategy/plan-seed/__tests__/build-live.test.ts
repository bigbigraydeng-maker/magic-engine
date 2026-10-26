import { describe, it, expect, vi } from 'vitest'
import { buildPlanSeed, type PlanSeedDeps, type BuildArgs } from '../build'
import { planSeedSchema, type PlanSeed, type PlanSeedStep } from '../types'
import { STALE_AFTER_MS } from '../constants'
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

function leadPlay(step_key = 's1'): { step_key: string; play: AdPlay['play'] } {
  return { step_key, play: 'lead_form_harvest' }
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

describe('live delivering', () => {
  it('a) snapshot 0, live 5000 -> budget 2500 with live basis', async () => {
    const deps = makeDeps({
      readLiveDelivering: vi.fn<LiveFn>(async () => live(5000)),
    })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)

    expect(budgetOf(seed, 's1')).toBe(2500)

    const basis = liveBasisOf(seed, 's1')
    expect(basis).toBeDefined()
    expect(basis?.value).toContain('实时 $50.00')
    expect(basis?.value).toContain('这次用 $50.00')
    expect(basis?.value).not.toContain('其它账户')

    const step = findStep(seed, 's1')
    if (!step || !step.daily_budget_cents.ok) throw new Error('expected a budget')
    const values = step.daily_budget_cents.basis.map((b) => b.value)
    for (const v of values) {
      expect(v).not.toContain('读到的在投合计来自最近一次数据抓取')
    }
    const how = step.daily_budget_cents.basis.find((b) => b.label === '预算怎么算的')
    expect(how).toBeDefined()
    expect(how?.value).toContain('客户余量 $100.00')
    expect(how?.value).toContain('账户余量 $50.00')
  })

  it('b) readLiveDelivering null -> budget 5000, snapshot-only disclosure', async () => {
    const deps = makeDeps({
      readLiveDelivering: vi.fn<LiveFn>(async () => null),
    })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)

    expect(budgetOf(seed, 's1')).toBe(5000)

    const basis = liveBasisOf(seed, 's1')
    expect(basis).toBeDefined()
    expect(basis?.value).toContain('实时在投没读到')

    const step = findStep(seed, 's1')
    if (!step || !step.daily_budget_cents.ok) throw new Error('expected a budget')
    const values = step.daily_budget_cents.basis.map((b) => b.value)
    expect(
      values.some((v) =>
        v.includes('读到的在投合计来自最近一次数据抓取，抓取之后新开的广告不在内。'),
      ),
    ).toBe(true)
  })

  it('c) live below snapshot uses snapshot; same budget as null live', async () => {
    const deps = makeDeps({
      loadFacts: vi.fn<PlanSeedDeps['loadFacts']>(async () =>
        facts({ account_delivering_minor: 4000 }),
      ),
      readLiveDelivering: vi.fn<LiveFn>(async () => live(3000)),
    })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)

    expect(budgetOf(seed, 's1')).toBe(3000)
    const basis = liveBasisOf(seed, 's1')
    expect(basis).toBeDefined()
    expect(basis?.value).toContain('这次用 $40.00')

    const nullDeps = makeDeps({
      loadFacts: vi.fn<PlanSeedDeps['loadFacts']>(async () =>
        facts({ account_delivering_minor: 4000 }),
      ),
      readLiveDelivering: vi.fn<LiveFn>(async () => null),
    })
    const nullSeed = await buildPlanSeed(args([thruplayPlay('s1')]), nullDeps)
    expect(budgetOf(nullSeed, 's1')).toBe(budgetOf(seed, 's1'))
  })

  it('d1) readLiveDelivering rejects -> resolves, budget 5000, unavailable basis', async () => {
    const deps = makeDeps({
      readLiveDelivering: vi.fn<LiveFn>(async () => {
        throw new Error('boom')
      }),
    })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)

    expect(planSeedSchema.safeParse(seed).success).toBe(true)
    expect(budgetOf(seed, 's1')).toBe(5000)
    const basis = liveBasisOf(seed, 's1')
    expect(basis).toBeDefined()
    expect(basis?.value).toContain('实时在投没读到')
  })

  it('d2) live currency USD -> budget 5000, mismatch basis', async () => {
    const deps = makeDeps({
      readLiveDelivering: vi.fn<LiveFn>(async () => live(5000, { currency: 'USD' })),
    })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)

    expect(budgetOf(seed, 's1')).toBe(5000)
    const basis = liveBasisOf(seed, 's1')
    expect(basis).toBeDefined()
    expect(basis?.value).toContain('币种和账户不一致')
  })

  it('d3) live currency null -> budget 5000, mismatch basis', async () => {
    const deps = makeDeps({
      readLiveDelivering: vi.fn<LiveFn>(async () => live(5000, { currency: null })),
    })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)

    expect(budgetOf(seed, 's1')).toBe(5000)
    const basis = liveBasisOf(seed, 's1')
    expect(basis).toBeDefined()
    expect(basis?.value).toContain('币种和账户不一致')
  })

  it('e) two steps on same account: live read once, both budgets 2000', async () => {
    const deps = makeDeps({
      readLiveDelivering: vi.fn<LiveFn>(async () => live(2000)),
    })
    const seed = await buildPlanSeed(args([leadPlay('s1'), thruplayPlay('s2')]), deps)

    expect(deps.readLiveDelivering).toHaveBeenCalledTimes(1)
    expect(budgetOf(seed, 's1')).toBe(2000)
    expect(budgetOf(seed, 's2')).toBe(2000)
    expect(liveBasisOf(seed, 's1')).toBeDefined()
    expect(liveBasisOf(seed, 's2')).toBeDefined()
  })

  it('e2) client headroom binds: shared account bump is deducted from the client layer once', async () => {
    const deps = makeDeps({
      loadFacts: vi.fn<PlanSeedDeps['loadFacts']>(async () =>
        facts({
          headroom: {
            ok: true,
            headroom_minor: 6000,
            delivering_minor: 14000,
            cap_minor: 20000,
            currency: 'NZD',
            as_of: null,
          },
        }),
      ),
      readLiveDelivering: vi.fn<LiveFn>(async () => live(2000)),
    })
    const seed = await buildPlanSeed(args([leadPlay('s1'), thruplayPlay('s2')]), deps)
    // client (6000-2000)/2=2000, account (10000-2000)/2=4000 -> 0.5*2000 = 1000 each
    expect(budgetOf(seed, 's1')).toBe(1000)
    expect(budgetOf(seed, 's2')).toBe(1000)
  })

  it('f) incomplete live read adds lower-bound note', async () => {
    {
      const deps = makeDeps({
        readLiveDelivering: vi.fn<LiveFn>(async () => live(5000, { incomplete: true })),
      })
      const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)
      const basis = liveBasisOf(seed, 's1')
      expect(basis).toBeDefined()
      expect(basis?.value).toContain('只是下限')
    }
    {
      const deps = makeDeps({
        readLiveDelivering: vi.fn<LiveFn>(async () => live(5000)),
      })
      const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)
      const basis = liveBasisOf(seed, 's1')
      expect(basis).toBeDefined()
      expect(basis?.value).not.toContain('只是下限')
    }
  })

  it('g) hanging live read does not block past timeout', async () => {
    const deps = makeDeps({
      readLiveDelivering: vi.fn<LiveFn>(() => new Promise(() => {})),
    })

    const start = performance.now()
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps, { timeoutMs: 200 })
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(450)
    expect(seed.skipped).toEqual([])
    expect(seed.notes).not.toContain('取数超时，只返回已经算出的部分')
    expect(budgetOf(seed, 's1')).toBe(5000)
    const basis = liveBasisOf(seed, 's1')
    expect(basis).toBeDefined()
    expect(basis?.value).toContain('实时在投没读到')
  })

  it('h) no readLiveDelivering dep -> budget 5000, unavailable basis', async () => {
    const deps = makeDeps()
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)

    expect(budgetOf(seed, 's1')).toBe(5000)
    const basis = liveBasisOf(seed, 's1')
    expect(basis).toBeDefined()
    expect(basis?.value).toContain('实时在投没读到')
  })

  it('i) disclosure names the other account snapshot time', async () => {
    const deps = makeDeps({
      loadOwnedAccounts: vi.fn<PlanSeedDeps['loadOwnedAccounts']>(async () => [
        { id: 'act_A', cap: 10000, label: 'A' },
        { id: 'act_B', cap: 10000, label: 'B' },
      ]),
      loadFacts: vi.fn<PlanSeedDeps['loadFacts']>(async (_clientId: string, accountId: string) =>
        accountId === 'act_B' ? facts({ account_delivering_minor: 9000 }) : facts(),
      ),
      loadCaptureAt: vi.fn<PlanSeedDeps['loadCaptureAt']>(async (_clientId: string, accountId: string) =>
        accountId === 'act_B' ? '2026-10-26T00:30:00Z' : FRESH,
      ),
      readLiveDelivering: vi.fn<LiveFn>(async () => live(5000)),
    })

    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)
    const step = findStep(seed, 's1')
    expect(step).toBeDefined()
    expect(step?.ad_account_id.ok).toBe(true)
    if (step?.ad_account_id.ok) {
      expect(step.ad_account_id.value).toBe('act_A')
    }

    const basis = liveBasisOf(seed, 's1')
    expect(basis).toBeDefined()
    expect(basis?.value).toContain('这个账户的在投是刚读的（' + formatNzTime(READ_AT) + '）')
    expect(basis?.value).toContain(
      '客户余量里其它账户仍按 ' + formatNzTime('2026-10-26T00:30:00Z') + ' 的快照算',
    )
  })

  it('j) stale other account still halves even when selected live read succeeds', async () => {
    const deps = makeDeps({
      loadOwnedAccounts: vi.fn<PlanSeedDeps['loadOwnedAccounts']>(async () => [
        { id: 'act_A', cap: 10000, label: 'A' },
        { id: 'act_B', cap: 10000, label: 'B' },
      ]),
      loadFacts: vi.fn<PlanSeedDeps['loadFacts']>(async (_clientId: string, accountId: string) =>
        accountId === 'act_B' ? facts({ account_delivering_minor: 9000 }) : facts(),
      ),
      loadCaptureAt: vi.fn<PlanSeedDeps['loadCaptureAt']>(async (_clientId: string, accountId: string) =>
        accountId === 'act_B' ? STALE : FRESH,
      ),
      readLiveDelivering: vi.fn<LiveFn>(async () => live(5000)),
    })

    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)

    expect(deps.readLiveDelivering).toHaveBeenCalledWith('c1', 'act_A')
    expect(deps.readLiveDelivering).toHaveBeenCalledTimes(1)

    expect(budgetOf(seed, 's1')).toBe(1250)

    const step = findStep(seed, 's1')
    if (!step || !step.daily_budget_cents.ok) throw new Error('expected a budget')
    expect(
      step.daily_budget_cents.basis.some((b) => b.value.includes('只减半一次')),
    ).toBe(true)
  })

  it('k) both accounts fresh -> no halving, budget 2500', async () => {
    const deps = makeDeps({
      loadOwnedAccounts: vi.fn<PlanSeedDeps['loadOwnedAccounts']>(async () => [
        { id: 'act_A', cap: 10000, label: 'A' },
        { id: 'act_B', cap: 10000, label: 'B' },
      ]),
      loadFacts: vi.fn<PlanSeedDeps['loadFacts']>(async (_clientId: string, accountId: string) =>
        accountId === 'act_B' ? facts({ account_delivering_minor: 9000 }) : facts(),
      ),
      loadCaptureAt: vi.fn<PlanSeedDeps['loadCaptureAt']>(async () => FRESH),
      readLiveDelivering: vi.fn<LiveFn>(async () => live(5000)),
    })

    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)
    expect(budgetOf(seed, 's1')).toBe(2500)
  })

  it('l) live success does not loosen selected account stale flag', async () => {
    const deps = makeDeps({
      loadCaptureAt: vi.fn<PlanSeedDeps['loadCaptureAt']>(async () => STALE),
      readLiveDelivering: vi.fn<LiveFn>(async () => live(5000)),
    })

    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)

    expect(budgetOf(seed, 's1')).toBe(1250)
    expect(liveBasisOf(seed, 's1')).toBeDefined()
  })
})
