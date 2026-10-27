import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

function leadPlay(step_key = 's1'): { step_key: string; play: AdPlay['play'] } {
  return { step_key, play: 'lead_form_harvest' }
}

function thruplayPlay(step_key = 's1'): { step_key: string; play: AdPlay['play'] } {
  return { step_key, play: 'thruplay_pool_build' }
}

function findStep(seed: PlanSeed, key: string): PlanSeedStep | undefined {
  return seed.ad_steps.find((s) => s.step_key === key)
}

function findSkipped(seed: { skipped: { step_key: string; why_empty: string }[] }, key: string) {
  return seed.skipped.find((s) => s.step_key === key)
}

describe('buildPlanSeed', () => {
  it('happy path: one lead_form_harvest step', async () => {
    const deps = makeDeps()
    const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)

    expect(seed.ad_steps).toHaveLength(1)
    expect(seed.skipped).toEqual([])

    const step = seed.ad_steps[0]
    expect(step.step_key).toBe('s1')
    expect(step.play).toBe('lead_form_harvest')

    expect(step.page_id.ok).toBe(true)
    if (step.page_id.ok) {
      expect(step.page_id.value).toBe('555')
      expect(step.page_id.basis[0].source).toContain('clients.facebook_page_id')
    }

    expect(step.ad_account_id.ok).toBe(true)
    if (step.ad_account_id.ok) {
      expect(step.ad_account_id.value).toBe('act_A')
      const meEntry = step.ad_account_id.basis.find((b) => b.label.includes('成功建过广告'))
      expect(meEntry).toBeDefined()
      expect(meEntry?.value).toBe('本版读不到')
    }

    expect(step.daily_budget_cents.ok).toBe(true)
    if (step.daily_budget_cents.ok) {
      expect(step.daily_budget_cents.value).toBe(5000)
    }

    expect(seed.currency).toBe('NZD')
    expect(seed.captured_at).toEqual({ act_A: FRESH })
    expect(seed.period).toEqual(PERIOD)
    expect(seed.facts_as_of).toBe(NOW.toISOString())

    for (const field of [step.page_id, step.ad_account_id, step.daily_budget_cents]) {
      if (field.ok) expect(field.basis.length).toBeGreaterThanOrEqual(1)
    }

    expect(planSeedSchema.safeParse(seed).success).toBe(true)
  })

  it('period null: empty seed, no deps called', async () => {
    const deps = makeDeps()
    const seed = await buildPlanSeed(args([leadPlay('s1')], { period: null }), deps)

    expect(seed.ad_steps).toEqual([])
    expect(seed.skipped).toEqual([])
    expect(seed.notes.some((n) => n.includes('目标没有周期'))).toBe(true)
    expect(deps.loadOwnedAccounts).not.toHaveBeenCalled()
  })

  it('conservative halving', async () => {
    // stale capture
    {
      const deps = makeDeps({ loadCaptureAt: vi.fn(async () => STALE) })
      const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)
      const step = findStep(seed, 's1')
      expect(step).toBeDefined()
      expect(step?.daily_budget_cents.ok).toBe(true)
      if (step?.daily_budget_cents.ok) {
        expect(step.daily_budget_cents.value).toBe(2500)
        expect(
          step.daily_budget_cents.basis.some((b) => b.value.includes('按保守口径减半')),
        ).toBe(true)
      }
    }

    // null capture
    {
      const deps = makeDeps({ loadCaptureAt: vi.fn(async () => null) })
      const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)
      const step = findStep(seed, 's1')
      expect(step).toBeDefined()
      expect(step?.daily_budget_cents.ok).toBe(true)
      if (step?.daily_budget_cents.ok) {
        expect(step.daily_budget_cents.value).toBe(2500)
      }
      expect(seed.captured_at.act_A).toBeNull()
    }

    // daily unknown
    {
      const deps = makeDeps({ loadFacts: vi.fn(async () => facts({ daily: null })) })
      const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)
      const step = findStep(seed, 's1')
      expect(step).toBeDefined()
      expect(step?.daily_budget_cents.ok).toBe(true)
      if (step?.daily_budget_cents.ok) {
        expect(step.daily_budget_cents.value).toBe(2500)
      }
    }

    // all three at once -> still halved once
    {
      const deps = makeDeps({
        loadCaptureAt: vi.fn(async () => STALE),
        loadFacts: vi.fn(async () => facts({ daily: null })),
      })
      const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)
      const step = findStep(seed, 's1')
      expect(step).toBeDefined()
      expect(step?.daily_budget_cents.ok).toBe(true)
      if (step?.daily_budget_cents.ok) {
        expect(step.daily_budget_cents.value).toBe(2500)
      }
    }

    // fresh + daily [] -> no halving
    {
      const deps = makeDeps()
      const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)
      const step = findStep(seed, 's1')
      expect(step).toBeDefined()
      expect(step?.daily_budget_cents.ok).toBe(true)
      if (step?.daily_budget_cents.ok) {
        expect(step.daily_budget_cents.value).toBe(5000)
      }
    }
  })

  it('failure isolation: each dep throwing still resolves', async () => {
    const depNames: (keyof PlanSeedDeps)[] = [
      'loadOwnedAccounts',
      'loadFacts',
      'loadCaptureAt',
      'loadClientPageId',
      'getPageToken',
      'readForms',
      'readScopes',
      'readPromotePages',
      'playbookShare',
    ]

    for (const name of depNames) {
      const throwing = (async () => {
        throw new Error('boom')
      }) as unknown as PlanSeedDeps[typeof name]
      const deps = makeDeps({ [name]: throwing } as Partial<PlanSeedDeps>)
      const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)

      expect(planSeedSchema.safeParse(seed).success).toBe(true)

      if (
        name === 'loadOwnedAccounts' ||
        name === 'loadFacts' ||
        name === 'loadClientPageId' ||
        name === 'getPageToken' ||
        name === 'readForms' ||
        name === 'readScopes'
      ) {
        expect(seed.ad_steps).toEqual([])
        const skipped = findSkipped(seed, 's1')
        expect(skipped).toBeDefined()
        expect(skipped?.why_empty.length).toBeGreaterThan(0)
        if (name === 'loadOwnedAccounts') {
          expect(skipped?.why_empty).toBe('读不到客户名下账户')
        }
      } else if (name === 'loadCaptureAt') {
        const step = findStep(seed, 's1')
        expect(step).toBeDefined()
        expect(step?.daily_budget_cents.ok).toBe(true)
        if (step?.daily_budget_cents.ok) {
          expect(step.daily_budget_cents.value).toBe(2500)
        }
      } else if (name === 'readPromotePages') {
        const step = findStep(seed, 's1')
        expect(step).toBeDefined()
        expect(step?.daily_budget_cents.ok).toBe(true)
        if (step?.daily_budget_cents.ok) {
          expect(step.daily_budget_cents.value).toBe(5000)
        }
      } else if (name === 'playbookShare') {
        expect(seed.ad_steps).toEqual([])
        const skipped = findSkipped(seed, 's1')
        expect(skipped).toBeDefined()
        expect(skipped?.why_empty).toContain('读不到剧本里的预算比例')
      }
    }
  })

  it('loadOwnedAccounts null / empty', async () => {
    {
      const deps = makeDeps({ loadOwnedAccounts: vi.fn(async () => null) })
      const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)
      const skipped = findSkipped(seed, 's1')
      expect(skipped?.why_empty).toBe('读不到客户名下账户')
    }
    {
      const deps = makeDeps({ loadOwnedAccounts: vi.fn(async () => []) })
      const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)
      const skipped = findSkipped(seed, 's1')
      expect(skipped?.why_empty).toBe('客户名下没有广告账户')
    }
  })

  it('does not include and exclude the same audience on one step', async () => {
    const readAudienceStatus = vi.fn(async () => ({
      state: 'ok' as const,
      value: {
        '111111': { operation: 200, delivery: 200 },
        '222222': { operation: 200, delivery: 200 },
      },
    }))
    const deps = makeDeps({
      loadFacts: vi.fn(async () =>
        facts({
          audiences: [
            { ref: '111111', name: 'Warm', size_lower: 800, last_used_on: '2026-10-20', as_of: null, subtype: 'ENGAGEMENT' },
          ],
          audiences_complete: true,
          excluded_in_use: [{ ref: '111111', adsets: 2 }],
        }),
      ),
      readAudienceStatus,
    })
    const seed = await buildPlanSeed(args([{ step_key: 's1', play: 'warm_pool_retarget' }]), deps)
    const step = findStep(seed, 's1')
    expect(step).toBeDefined()
    expect(step?.audience_ids?.ok).toBe(true)
    expect(step?.excluded_audience_ids?.ok).toBe(false)
    if (step?.audience_ids?.ok) expect(step.audience_ids.value).toEqual(['111111'])
    if (step?.excluded_audience_ids && step.excluded_audience_ids.ok === false) {
      expect(step.excluded_audience_ids.why_empty).toContain('自相矛盾')
    }
    const included = step?.audience_ids?.ok ? step.audience_ids.value : []
    const excluded = step?.excluded_audience_ids?.ok ? step.excluded_audience_ids.value : []
    expect(included.filter((id) => excluded.includes(id))).toEqual([])
  })

  it('picks a warm audience that is not already on the exclusion list', async () => {
    const deps = makeDeps({
      loadFacts: vi.fn(async () =>
        facts({
          audiences: [
            { ref: '111111', name: 'Warm', size_lower: 800, last_used_on: '2026-10-20', as_of: null, subtype: 'ENGAGEMENT' },
            { ref: '222222', name: 'List', size_lower: 400, last_used_on: '2026-10-01', as_of: null, subtype: 'CUSTOM' },
          ],
          audiences_complete: true,
          excluded_in_use: [{ ref: '111111', adsets: 2 }, { ref: '333333', adsets: 1 }],
        }),
      ),
      readAudienceStatus: vi.fn(async () => ({
        state: 'ok' as const,
        value: {
          '111111': { operation: 200, delivery: 200 },
          '222222': { operation: 200, delivery: 200 },
          '333333': { operation: 200, delivery: 200 },
        },
      })),
    })
    const seed = await buildPlanSeed(args([{ step_key: 's1', play: 'warm_pool_retarget' }]), deps)
    const step = findStep(seed, 's1')
    expect(step?.audience_ids?.ok).toBe(true)
    expect(step?.excluded_audience_ids?.ok).toBe(true)
    if (step?.audience_ids?.ok) expect(step.audience_ids.value).toEqual(['222222'])
    if (step?.excluded_audience_ids?.ok) expect(step.excluded_audience_ids.value).toEqual(['111111', '333333'])
  })

  it('slow audience read keeps the step and leaves the audience empty', async () => {
    const readAudienceStatus = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 150))
      return {
        state: 'ok' as const,
        value: { '111111': { operation: 200, delivery: 200 } },
      }
    })
    const deps = makeDeps({
      loadFacts: vi.fn(async () =>
        facts({
          audiences: [{ ref: '111111', name: 'A', size_lower: 50, last_used_on: '2026-10-20', as_of: null, subtype: 'ENGAGEMENT' }],
          audiences_complete: true,
        }),
      ),
      readAudienceStatus,
    })
    const seed = await buildPlanSeed(args([{ step_key: 's1', play: 'warm_pool_retarget' }]), deps, {
      timeoutMs: 100,
    })
    expect(readAudienceStatus).toHaveBeenCalledWith('c1', ['111111'], 'act_A')
    expect(seed.ad_steps).toHaveLength(1)
    expect(seed.skipped).toEqual([])
    expect(seed.notes.some((n) => n.includes('取数超时'))).toBe(false)
    const step = seed.ad_steps[0]
    expect(step.audience_state).toBe('unreadable')
    expect(step.audience_ids?.ok).toBe(false)
    if (step.audience_ids && step.audience_ids.ok === false) {
      expect(step.audience_ids.why_empty).toBe('读受众状态超时，先留空')
    }
  })

  it('NaN facts_as_of still resolves and leaves the schedule empty', async () => {
    class BadClock extends Date {
      override toISOString(): string {
        return 'not-a-date'
      }
    }
    const deps = makeDeps({
      now: () => new BadClock(NOW.getTime()),
    })
    const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)
    expect(seed.facts_as_of).toBe('not-a-date')
    expect(Number.isNaN(Date.parse(seed.facts_as_of))).toBe(true)
    expect(seed.schedule?.ok).toBe(false)
    if (seed.schedule && seed.schedule.ok === false) {
      expect(seed.schedule.why_empty).toBe('取数时间读不到，不猜起止日')
    }
    expect(seed.ad_steps).toHaveLength(1)
    expect(planSeedSchema.safeParse(seed).success).toBe(true)
  })

  it('timeout: returns partial seed and late work does not mutate it', async () => {
    const deps = makeDeps({
      loadFacts: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 400))
        return facts()
      }),
    })

    const start = Date.now()
    const seed = await buildPlanSeed(args([leadPlay('s1')]), deps, { timeoutMs: 50 })
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(300)
    expect(seed.ad_steps).toEqual([])
    const skipped = findSkipped(seed, 's1')
    expect(skipped).toBeDefined()
    expect(skipped?.why_empty).toBe('取数超时')
    expect(seed.notes.some((n) => n.includes('取数超时'))).toBe(true)

    const snapshot = JSON.stringify(seed)
    await new Promise((r) => setTimeout(r, 500))
    expect(JSON.stringify(seed)).toBe(snapshot)
  })

  it('loadFacts called once per account', async () => {
    {
      const deps = makeDeps()
      await buildPlanSeed(
        args([
          { step_key: 'a', play: 'thruplay_pool_build' },
          { step_key: 'b', play: 'messenger_direct' },
          { step_key: 'c', play: 'reach_awareness' },
        ]),
        deps,
      )
      expect(deps.loadFacts).toHaveBeenCalledTimes(1)
    }
    {
      const deps = makeDeps({
        loadOwnedAccounts: vi.fn(async () => [
          { id: 'act_A', cap: 10000, label: 'A' },
          { id: 'act_B', cap: 10000, label: 'B' },
        ]),
      })
      await buildPlanSeed(args([thruplayPlay('s1')]), deps)
      expect(deps.loadFacts).toHaveBeenCalledTimes(2)
    }
  })

  it('multi-account: choose largest room', async () => {
    const deps = makeDeps({
      loadOwnedAccounts: vi.fn(async () => [
        { id: 'act_A', cap: 10000, label: 'A' },
        { id: 'act_B', cap: 10000, label: 'B' },
      ]),
      loadFacts: vi.fn(async (_clientId: string, accountId: string) => {
        if (accountId === 'act_A') {
          return facts({ account_cap_minor: 10000, account_delivering_minor: 8000 })
        }
        return facts({ account_cap_minor: 10000, account_delivering_minor: 1000 })
      }),
    })

    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)
    const step = findStep(seed, 's1')
    expect(step).toBeDefined()
    expect(step?.ad_account_id.ok).toBe(true)
    if (step?.ad_account_id.ok) {
      expect(step.ad_account_id.value).toBe('act_B')
      const basis = step.ad_account_id.basis
      expect(
        basis.some((b) => b.value.includes('act_A') && b.value.includes('可用余量 $20.00 NZD')),
      ).toBe(true)
      expect(
        basis.some((b) => b.value.includes('act_B') && b.value.includes('可用余量 $90.00 NZD')),
      ).toBe(true)
    }
    expect(step?.daily_budget_cents.ok).toBe(true)
    if (step?.daily_budget_cents.ok) {
      expect(step.daily_budget_cents.value).toBe(4500)
    }
  })

  it('N is cut once, over passing steps only', async () => {
    // (a) forms empty -> s1 skipped, s2 gets full N=1
    {
      const deps = makeDeps({
        readForms: vi.fn(async () => ({ state: 'empty' as const })),
      })
      const seed = await buildPlanSeed(
        args([leadPlay('s1'), thruplayPlay('s2')]),
        deps,
      )
      const skipped = findSkipped(seed, 's1')
      expect(skipped).toBeDefined()
      expect(skipped?.why_empty).toContain('也可能是这个令牌看不到')
      const step = findStep(seed, 's2')
      expect(step).toBeDefined()
      expect(step?.daily_budget_cents.ok).toBe(true)
      if (step?.daily_budget_cents.ok) {
        expect(step.daily_budget_cents.value).toBe(5000)
      }
    }

    // (b) forms ok -> both present, each 2500
    {
      const deps = makeDeps()
      const seed = await buildPlanSeed(
        args([leadPlay('s1'), thruplayPlay('s2')]),
        deps,
      )
      expect(seed.skipped).toEqual([])
      const s1 = findStep(seed, 's1')
      const s2 = findStep(seed, 's2')
      expect(s1).toBeDefined()
      expect(s2).toBeDefined()
      expect(s1?.daily_budget_cents.ok).toBe(true)
      expect(s2?.daily_budget_cents.ok).toBe(true)
      if (s1?.daily_budget_cents.ok) expect(s1.daily_budget_cents.value).toBe(2500)
      if (s2?.daily_budget_cents.ok) expect(s2.daily_budget_cents.value).toBe(2500)
    }
  })

  it('no eligible account', async () => {
    const deps = makeDeps({
      loadFacts: vi.fn(async () => facts({ account_status: 2 })),
    })
    const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)
    expect(seed.ad_steps).toEqual([])
    const skipped = findSkipped(seed, 's1')
    expect(skipped).toBeDefined()
    expect(skipped?.why_empty).toContain('没有合格的广告账户')
    expect(skipped?.why_empty).toContain('账户状态码是 2')
  })

  it('headroom unreadable', async () => {
    const deps = makeDeps({
      loadFacts: vi.fn(async () =>
        facts({ headroom: { ok: false, reason: '快照没抓全' } }),
      ),
    })
    const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)
    expect(findStep(seed, 's1')).toBeUndefined()
    const skipped = findSkipped(seed, 's1')
    expect(skipped?.why_empty).toContain('客户预算余量读不全')
    expect(skipped?.why_empty).toContain('快照没抓全')
  })

  it('page missing', async () => {
    const deps = makeDeps({ loadClientPageId: vi.fn(async () => null) })
    const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)
    const skipped = findSkipped(seed, 's1')
    expect(skipped).toBeDefined()
    expect(skipped?.why_empty).toContain('客户没配主页')
  })

  it('readForms called only for lead_form_harvest', async () => {
    {
      const deps = makeDeps()
      await buildPlanSeed(args([leadPlay('s1')]), deps)
      expect(deps.readForms).toHaveBeenCalledWith('555', 'tok')
    }
    {
      const deps = makeDeps()
      await buildPlanSeed(args([thruplayPlay('s1')]), deps)
      expect(deps.readForms).not.toHaveBeenCalled()
    }
  })

  it('currency empty -> ineligible', async () => {
    const deps = makeDeps({
      loadFacts: vi.fn(async () =>
        facts({
          headroom: {
            ok: true,
            headroom_minor: 15000,
            delivering_minor: 5000,
            cap_minor: 20000,
            currency: '',
            as_of: null,
          },
        }),
      ),
    })
    const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)
    const skipped = findSkipped(seed, 's1')
    expect(skipped).toBeDefined()
    expect(skipped?.why_empty).toContain('读不到账户币种')
  })

  it('source guard: no hidden_from_ad_health string', () => {
    const files = [
      '../build.ts',
      '../deps.ts',
      '../attach.ts',
      '../../../marketing-plan/promo/facts.ts',
    ]
    for (const rel of files) {
      const path = resolve(__dirname, rel)
      const content = readFileSync(path, 'utf8')
      expect(content).not.toContain('hidden_from_ad_health')
    }
  })

  it('stale boundary', async () => {
    const budgetOf = (seed: PlanSeed): number => {
      const step = findStep(seed, 's1')
      expect(step).toBeDefined()
      expect(step?.daily_budget_cents.ok).toBe(true)
      if (step === undefined || !step.daily_budget_cents.ok) throw new Error('no budget')
      return step.daily_budget_cents.value
    }

    // (i) exactly at the threshold -> not stale
    {
      const at = new Date(NOW.getTime() - STALE_AFTER_MS).toISOString()
      const deps = makeDeps({ loadCaptureAt: vi.fn(async () => at) })
      const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)
      expect(budgetOf(seed)).toBe(5000)
    }

    // (ii) one minute older -> stale
    {
      const older = new Date(NOW.getTime() - STALE_AFTER_MS - 60_000).toISOString()
      const deps = makeDeps({ loadCaptureAt: vi.fn(async () => older) })
      const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)
      expect(budgetOf(seed)).toBe(2500)
      const step = findStep(seed, 's1')
      expect(step).toBeDefined()
      if (step !== undefined && step.daily_budget_cents.ok) {
        expect(
          step.daily_budget_cents.basis.some((b) => b.value.includes('按保守口径减半')),
        ).toBe(true)
      }
    }

    // (iii) null capture -> stale
    {
      const deps = makeDeps({ loadCaptureAt: vi.fn(async () => null) })
      const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)
      expect(budgetOf(seed)).toBe(2500)
    }
  })

  it('stale threshold is 6.5 hours in real terms', async () => {
    const budgetOf = (seed: PlanSeed): number => {
      const step = findStep(seed, 's1')
      expect(step).toBeDefined()
      expect(step?.daily_budget_cents.ok).toBe(true)
      if (step === undefined || !step.daily_budget_cents.ok) throw new Error('no budget')
      return step.daily_budget_cents.value
    }

    // 6h old -> not stale
    {
      const sixHoursAgo = new Date(NOW.getTime() - 6 * 3600 * 1000).toISOString()
      const deps = makeDeps({ loadCaptureAt: vi.fn(async () => sixHoursAgo) })
      const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)
      expect(budgetOf(seed)).toBe(5000)
    }

    // 7h old -> stale
    {
      const sevenHoursAgo = new Date(NOW.getTime() - 7 * 3600 * 1000).toISOString()
      const deps = makeDeps({ loadCaptureAt: vi.fn(async () => sevenHoursAgo) })
      const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)
      expect(budgetOf(seed)).toBe(2500)
    }
  })

  it('client layer looks at all candidate accounts', async () => {
    const deps = makeDeps({
      loadOwnedAccounts: vi.fn(async () => [
        { id: 'act_A', cap: 10000, label: 'A' },
        { id: 'act_B', cap: 10000, label: 'B' },
      ]),
      loadFacts: vi.fn(async (_clientId: string, accountId: string) => {
        if (accountId === 'act_A') return facts()
        return facts({ account_cap_minor: 10000, account_delivering_minor: 9500 })
      }),
      loadCaptureAt: vi.fn(async (_clientId: string, accountId: string) =>
        accountId === 'act_A' ? FRESH : STALE,
      ),
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
      expect(
        step.daily_budget_cents.basis.some((b) => b.value.includes('客户名下账户')),
      ).toBe(true)
    }
  })

  it('selected stale, other fresh still halves', async () => {
    const deps = makeDeps({
      loadOwnedAccounts: vi.fn(async () => [
        { id: 'act_A', cap: 10000, label: 'A' },
        { id: 'act_B', cap: 10000, label: 'B' },
      ]),
      loadFacts: vi.fn(async (_clientId: string, accountId: string) => {
        if (accountId === 'act_A') return facts()
        return facts({ account_cap_minor: 10000, account_delivering_minor: 9500 })
      }),
      loadCaptureAt: vi.fn(async (_clientId: string, accountId: string) =>
        accountId === 'act_A' ? STALE : FRESH,
      ),
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

  it('failed read still counts in N', async () => {
    const deps = makeDeps({
      readForms: vi.fn(async () => ({ state: 'failed' as const, reason: '读表单失败' })),
    })
    const seed = await buildPlanSeed(args([leadPlay('s1'), thruplayPlay('s2')]), deps)

    expect(findSkipped(seed, 's1')).toBeDefined()
    expect(findStep(seed, 's1')).toBeUndefined()

    const s2 = findStep(seed, 's2')
    expect(s2).toBeDefined()
    expect(s2?.daily_budget_cents.ok).toBe(true)
    if (s2?.daily_budget_cents.ok) {
      expect(s2.daily_budget_cents.value).toBe(3750)
      expect(
        s2.daily_budget_cents.basis.some((b) =>
          b.value.includes(
            '本来 2 步，其中 1 步因为读不到表单列表被丢掉，除数仍按 2 算（读不到≠没有）',
          ),
        ),
      ).toBe(true)
    }
  })

  it('definitely ineligible does not count in N', async () => {
    const deps = makeDeps({
      readForms: vi.fn(async () => ({ state: 'empty' as const })),
    })
    const seed = await buildPlanSeed(args([leadPlay('s1'), thruplayPlay('s2')]), deps)

    const s2 = findStep(seed, 's2')
    expect(s2).toBeDefined()
    expect(s2?.daily_budget_cents.ok).toBe(true)
    if (s2?.daily_budget_cents.ok) {
      expect(s2.daily_budget_cents.value).toBe(5000)
      expect(s2.daily_budget_cents.basis.some((b) => b.label === '除数说明')).toBe(false)
    }
  })

  it('no bare minor numbers in user-visible text', async () => {
    const collectText = (seed: PlanSeed): string[] => {
      const out: string[] = []
      for (const step of seed.ad_steps) {
        for (const field of [step.page_id, step.ad_account_id, step.daily_budget_cents]) {
          if (field.ok) {
            for (const b of field.basis) out.push(b.value)
          } else {
            out.push(field.why_empty)
          }
          out.push(...field.notes)
        }
      }
      for (const s of seed.skipped) out.push(s.why_empty)
      out.push(...seed.notes)
      return out
    }

    const assertNoBareMinor = (seed: PlanSeed): void => {
      for (const text of collectText(seed)) {
        expect(text).not.toContain('15000')
        expect(text).not.toContain('10000')
        expect(text).not.toContain('5000')
      }
    }

    // happy path
    {
      const deps = makeDeps()
      const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)
      assertNoBareMinor(seed)

      const step = findStep(seed, 's1')
      expect(step).toBeDefined()
      expect(step?.daily_budget_cents.ok).toBe(true)
      if (step?.daily_budget_cents.ok) {
        const how = step.daily_budget_cents.basis.find((b) => b.label === '预算怎么算的')
        expect(how).toBeDefined()
        expect(how?.value).toContain('$150.00 NZD')
        expect(how?.value).toContain('$50.00 NZD')
      }
    }

    // halved
    {
      const deps = makeDeps({ loadCaptureAt: vi.fn(async () => STALE) })
      const seed = await buildPlanSeed(args([leadPlay('s1')]), deps)
      assertNoBareMinor(seed)
    }
  })

  it('never rejects even when deps.now throws', async () => {
    // NOTE: build.ts calls deps.now() synchronously at the top of buildPlanSeed
    // (and again in emptyPeriodSeed), so a throwing now() will reject. This test
    // documents the desired contract; if it fails, the implementation needs a
    // try/catch around deps.now().
    const deps = makeDeps({
      now: vi.fn<PlanSeedDeps['now']>(() => {
        throw new Error('x')
      }),
    })
    await expect(buildPlanSeed(args([leadPlay('s1')]), deps)).resolves.toBeDefined()
  })

  it('budget basis carries the three fixed sentences', async () => {
    const deps = makeDeps()
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)
    const step = findStep(seed, 's1')
    expect(step).toBeDefined()
    expect(step?.daily_budget_cents.ok).toBe(true)
    if (step?.daily_budget_cents.ok) {
      const values = step.daily_budget_cents.basis.map((b) => b.value)
      expect(values).toContain(
        '这是第一版建议：只按客户和账户的日上限、在投合计算，不含受众与素材。',
      )
      expect(values).toContain('没扣掉计划里人工已填的步骤。')
      expect(values).toContain(
        '读到的在投合计来自最近一次数据抓取，抓取之后新开的广告不在内。',
      )
    }
  })

  it('stale + unknown daily halves exactly once (125, not quartered)', async () => {
    const deps = makeDeps({
      loadCaptureAt: vi.fn(async () => STALE),
      loadFacts: vi.fn(async () =>
        facts({ account_cap_minor: 10000, account_delivering_minor: 9500, daily: null }),
      ),
    })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)
    const step = findStep(seed, 's1')
    expect(step).toBeDefined()
    expect(step?.daily_budget_cents.ok).toBe(true)
    if (step?.daily_budget_cents.ok) {
      expect(step.daily_budget_cents.value).toBe(125)
      const halved = step.daily_budget_cents.basis.filter((b) =>
        b.value.includes('只减半一次'),
      )
      expect(halved).toHaveLength(1)
    }
  })

  const day = (date: string, spend_cents: number) => ({
    date,
    spend_cents,
    results: 0,
    account_status: 1,
  })

  it('recent max daily spend >= 95% of client cap halves once: 5000 -> 2500', async () => {
    const deps = makeDeps({
      loadFacts: vi.fn(async () => facts({ daily: [day('2026-10-25', 19000)] })),
    })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)
    const step = findStep(seed, 's1')
    expect(step?.daily_budget_cents.ok).toBe(true)
    if (step?.daily_budget_cents.ok) {
      expect(step.daily_budget_cents.value).toBe(2500)
      expect(
        step.daily_budget_cents.basis.some((b) => b.value.includes('贴近上限')),
      ).toBe(true)
    }
  })

  it('recent daily spend well under cap keeps full 5000 and no halve basis', async () => {
    const deps = makeDeps({
      loadFacts: vi.fn(async () => facts({ daily: [day('2026-10-25', 5000)] })),
    })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)
    const step = findStep(seed, 's1')
    if (step?.daily_budget_cents.ok) {
      expect(step.daily_budget_cents.value).toBe(5000)
      expect(step.daily_budget_cents.basis.some((b) => b.label === '保守口径')).toBe(false)
    } else {
      throw new Error('expected a budget')
    }
  })

  it('near cap + stale + unknown-free still halves exactly once (2500)', async () => {
    const deps = makeDeps({
      loadCaptureAt: vi.fn(async () => STALE),
      loadFacts: vi.fn(async () => facts({ daily: [day('2026-10-25', 19000)] })),
    })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)
    const step = findStep(seed, 's1')
    if (step?.daily_budget_cents.ok) {
      expect(step.daily_budget_cents.value).toBe(2500)
    } else {
      throw new Error('expected a budget')
    }
  })

  it('a step with no budget goes to skipped, not ad_steps', async () => {
    const deps = makeDeps({
      loadFacts: vi.fn(async () =>
        facts({ account_cap_minor: 10000, account_delivering_minor: 10000 }),
      ),
    })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)
    expect(seed.ad_steps).toEqual([])
    const skipped = findSkipped(seed, 's1')
    expect(skipped).toBeDefined()
    expect(skipped?.why_empty.length).toBeGreaterThan(0)
  })

  it('empty page id string never becomes a valid page', async () => {
    const deps = makeDeps({ loadClientPageId: vi.fn(async () => '   ') })
    const seed = await buildPlanSeed(args([thruplayPlay('s1')]), deps)
    expect(seed.ad_steps).toEqual([])
    expect(findSkipped(seed, 's1')).toBeDefined()
  })
})
