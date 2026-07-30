/**
 * Tests for the stop-loss planner — P21.K
 *
 * This is the module that spends (or un-spends) real client money on a single
 * PM click, so every branch that could silently do the WRONG thing is locked
 * here: reactivating a deliberately-paused ad set, reporting "nothing to cut"
 * when the lookup merely failed, or attempting a cut Meta would reject.
 */

import { describe, it, expect } from 'vitest'
import {
  resolveBudgetLocation,
  planCut,
  summariseCut,
  STOP_LOSS_CUT_RATIO,
  MIN_VIABLE_DAILY_CENTS,
} from '../stop-loss'
import type { CampaignDetails } from '@/lib/meta/client'
import type { AdSetSummary } from '@/lib/meta/adsets'

const campaign = (over: Partial<CampaignDetails> = {}): CampaignDetails => ({
  id: 'c1',
  name: 'Oztop — Lead Form — Cold Broad',
  status: 'ACTIVE',
  ...over,
})

const adSet = (over: Partial<AdSetSummary> = {}): AdSetSummary => ({
  id: 'as1',
  name: 'Cold Broad AU',
  status: 'ACTIVE',
  ...over,
})

describe('resolveBudgetLocation — find where the money actually is', () => {
  it('CBO: budget on the campaign', () => {
    const loc = resolveBudgetLocation(campaign({ daily_budget: '6000' }), null)
    expect(loc.kind).toBe('campaign')
    if (loc.kind !== 'campaign') throw new Error('narrowing')
    expect(loc.targets).toEqual([
      { id: 'c1', name: 'Oztop — Lead Form — Cold Broad', currentCents: 6000, wasActive: true },
    ])
  })

  it('ABO: no campaign budget → falls back to the ad sets', () => {
    const loc = resolveBudgetLocation(campaign(), [
      adSet({ id: 'as1', daily_budget: '2000' }),
      adSet({ id: 'as2', daily_budget: '4000' }),
    ])
    expect(loc.kind).toBe('adsets')
    if (loc.kind !== 'adsets') throw new Error('narrowing')
    expect(loc.targets.map(t => t.id)).toEqual(['as1', 'as2'])
    expect(loc.targets.reduce((s, t) => s + t.currentCents, 0)).toBe(6000)
  })

  it('NEVER touches a paused ad set — cutting it saves nothing and reactivating it would override a human', () => {
    const loc = resolveBudgetLocation(campaign(), [
      adSet({ id: 'live', status: 'ACTIVE', daily_budget: '3000' }),
      adSet({ id: 'off', status: 'PAUSED', daily_budget: '9999' }),
    ])
    if (loc.kind !== 'adsets') throw new Error('expected adsets')
    expect(loc.targets.map(t => t.id)).toEqual(['live'])
    expect(loc.targets.every(t => t.wasActive)).toBe(true)
  })

  it('a FAILED ad-set lookup (null) is not "no ad sets" — must not claim there is nothing to cut', () => {
    // null = we could not look. Reporting 'no_daily_budget' is the honest
    // outcome; claiming an empty campaign would be a fabricated fact.
    const loc = resolveBudgetLocation(campaign(), null)
    expect(loc.kind).toBe('none')
  })

  it('distinguishes a lifetime-budget campaign from one with no budget at all', () => {
    const lifetime = resolveBudgetLocation(campaign({ lifetime_budget: '50000' }), [])
    expect(lifetime).toEqual({ kind: 'none', reason: 'lifetime_budget' })

    const neither = resolveBudgetLocation(campaign(), [])
    expect(neither).toEqual({ kind: 'none', reason: 'no_daily_budget' })
  })

  it('ignores ad sets whose budget is zero or unparseable', () => {
    const loc = resolveBudgetLocation(campaign(), [
      adSet({ id: 'zero', daily_budget: '0' }),
      adSet({ id: 'junk', daily_budget: 'not-a-number' }),
      adSet({ id: 'none' }),
    ])
    expect(loc.kind).toBe('none')
  })

  it('a paused CAMPAIGN still resolves its budget, but is marked not-active', () => {
    // Needed so the force-pause guard does NOT reactivate a campaign the
    // operator had already switched off before the cut.
    const loc = resolveBudgetLocation(campaign({ status: 'PAUSED', daily_budget: '6000' }), null)
    if (loc.kind !== 'campaign') throw new Error('expected campaign')
    expect(loc.targets[0].wasActive).toBe(false)
  })
})

describe('planCut — a real cut, or an honest refusal', () => {
  it('cuts by exactly the advertised ratio', () => {
    expect(STOP_LOSS_CUT_RATIO).toBe(0.2)
    expect(planCut(6000)).toEqual({ newCents: 4800 })
  })

  it('refuses when the result would fall under the viable minimum', () => {
    // $2.40/day → 20% off = $1.92, under the floor. Pausing is the real action.
    const p = planCut(240)
    expect(p.newCents).toBeNull()
    expect(p.reason).toBe('below_minimum')
  })

  it('allows a cut that lands exactly on the minimum', () => {
    expect(planCut(MIN_VIABLE_DAILY_CENTS / 0.8).newCents).toBe(MIN_VIABLE_DAILY_CENTS)
  })
})

describe('summariseCut — what the PM is shown before pressing', () => {
  it('reports the before/after dollars for a CBO campaign', () => {
    const s = summariseCut(resolveBudgetLocation(campaign({ daily_budget: '6000' }), null))
    expect(s).toEqual({ currentDaily: 60, plannedDaily: 48, cuttable: true })
  })

  it('sums across ad sets', () => {
    const s = summariseCut(resolveBudgetLocation(campaign(), [
      adSet({ id: 'a', daily_budget: '2000' }),
      adSet({ id: 'b', daily_budget: '4000' }),
    ]))
    expect(s.currentDaily).toBe(60)
    expect(s.plannedDaily).toBe(48)
    expect(s.cuttable).toBe(true)
  })

  it('all-or-nothing: one un-cuttable ad set blocks the whole cut', () => {
    // A partial cut would leave the campaign in a state nobody chose and that
    // is hard to explain or undo — so we offer "pause" instead, not half a cut.
    const s = summariseCut(resolveBudgetLocation(campaign(), [
      adSet({ id: 'big', daily_budget: '4000' }),
      adSet({ id: 'tiny', daily_budget: '150' }),
    ]))
    expect(s.cuttable).toBe(false)
    expect(s.plannedDaily).toBeNull()
    expect(s.currentDaily).toBe(41.5)   // still tells the truth about spend
  })

  it('a no-budget campaign is not cuttable and reports no spend', () => {
    expect(summariseCut({ kind: 'none', reason: 'lifetime_budget' }))
      .toEqual({ currentDaily: 0, plannedDaily: null, cuttable: false })
  })
})

// ── executeStopLoss: the force-pause guard is the whole ballgame ─────────────

import { executeStopLoss, type StopLossDeps } from '../stop-loss'

/** Deps that always succeed and report entities as still ACTIVE after a write. */
function deps(over: Partial<StopLossDeps> = {}): StopLossDeps {
  return {
    getCampaign: async () => campaign({ daily_budget: '6000' }),
    setCampaignStatus: async () => true,
    setCampaignBudget: async () => true,
    listAdSets: async () => [],
    setAdSetBudget: async () => true,
    getAdSet: async () => adSet({ status: 'ACTIVE' }),
    setAdSetStatus: async () => true,
    ...over,
  }
}

describe('executeStopLoss — pause', () => {
  it('pauses regardless of where the budget lives', async () => {
    const calls: string[] = []
    const r = await executeStopLoss('c1', 'pause', deps({
      // No budget anywhere — pause must still work.
      getCampaign: async () => campaign(),
      setCampaignStatus: async (id, s) => { calls.push(`${id}:${s}`); return true },
    }))
    expect(r).toMatchObject({ action: 'pause', ok: true })
    expect(calls).toEqual(['c1:PAUSED'])
  })

  it('reports failure honestly when Meta refuses', async () => {
    const r = await executeStopLoss('c1', 'pause', deps({ setCampaignStatus: async () => false }))
    expect(r).toMatchObject({ ok: false })
  })
})

describe('executeStopLoss — cut + the force-pause guard', () => {
  it('reactivates a campaign Meta force-paused by the budget write', async () => {
    // Meta silently pauses the entity on a daily_budget update. Without this
    // guard, "降 20%" would quietly become "停投" — the exact opposite of what
    // the PM chose.
    let status: 'ACTIVE' | 'PAUSED' = 'ACTIVE'
    const r = await executeStopLoss('c1', 'cut', deps({
      setCampaignBudget: async () => { status = 'PAUSED'; return true },
      getCampaign: async () => campaign({ daily_budget: '6000', status }),
      setCampaignStatus: async (_id, s) => { status = s; return true },
    }))
    expect(r).toMatchObject({ action: 'cut', ok: true, currentDaily: 60, newDaily: 48 })
    expect(status).toBe('ACTIVE')
  })

  it('warns loudly when reactivation FAILS — the ad is left stopped', async () => {
    // ACTIVE on the pre-read (so the guard is armed), PAUSED on the re-read
    // (Meta force-paused it), and reactivation refused.
    let reads = 0
    const r = await executeStopLoss('c1', 'cut', deps({
      getCampaign: async () =>
        campaign({ daily_budget: '6000', status: ++reads === 1 ? 'ACTIVE' : 'PAUSED' }),
      setCampaignStatus: async () => false,
    }))
    if (!('touched' in r!)) throw new Error('expected outcome')
    expect(r.touched[0].warning).toContain('手动开启')
  })

  it('warns when it cannot certify the post-change status', async () => {
    let reads = 0
    const r = await executeStopLoss('c1', 'cut', deps({
      getCampaign: async () => (++reads === 1 ? campaign({ daily_budget: '6000' }) : null),
    }))
    if (!('touched' in r!)) throw new Error('expected outcome')
    expect(r.touched[0].warning).toContain('没能确认')
  })

  it('does NOT reactivate a campaign that was already paused before the cut', async () => {
    const statuses: string[] = []
    await executeStopLoss('c1', 'cut', deps({
      getCampaign: async () => campaign({ daily_budget: '6000', status: 'PAUSED' }),
      setCampaignStatus: async (_i, s) => { statuses.push(s); return true },
    }))
    expect(statuses).toEqual([])   // never touched — a human had switched it off
  })

  it('ABO: cuts every active ad set and skips the paused one', async () => {
    const wrote: Array<[string, number]> = []
    const r = await executeStopLoss('c1', 'cut', deps({
      getCampaign: async () => campaign(),           // no campaign-level budget
      listAdSets: async () => [
        adSet({ id: 'a', status: 'ACTIVE', daily_budget: '2000' }),
        adSet({ id: 'b', status: 'ACTIVE', daily_budget: '4000' }),
        adSet({ id: 'off', status: 'PAUSED', daily_budget: '9999' }),
      ],
      setAdSetBudget: async (id, cents) => { wrote.push([id, cents]); return true },
    }))
    expect(wrote).toEqual([['a', 1600], ['b', 3200]])
    expect(r).toMatchObject({ where: 'adsets', ok: true, currentDaily: 60, newDaily: 48 })
  })

  it('returns notCuttable (never a "go do it yourself") when no daily budget exists', async () => {
    const r = await executeStopLoss('c1', 'cut', deps({
      getCampaign: async () => campaign({ lifetime_budget: '50000' }),
      listAdSets: async () => [],
    }))
    expect(r).toMatchObject({ notCuttable: true })
    if (!('location' in r!)) throw new Error('expected notCuttable')
    expect(r.location).toMatchObject({ kind: 'none', reason: 'lifetime_budget' })
  })

  it('null when the campaign cannot be read at all', async () => {
    expect(await executeStopLoss('c1', 'cut', deps({ getCampaign: async () => null }))).toBeNull()
  })

  it('skips the ad-set lookup entirely for a CBO campaign (no wasted Meta calls)', async () => {
    let listed = 0
    await executeStopLoss('c1', 'cut', deps({
      listAdSets: async () => { listed++; return [] },
    }))
    expect(listed).toBe(0)
  })
})
