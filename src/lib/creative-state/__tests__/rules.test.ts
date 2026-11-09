import { describe, expect, it } from 'vitest'
import {
  capturesFresh,
  decideCreatives,
  rulesFromConfig,
  type LiveCreative,
  type ScaleRoom,
  type PlanRoom,
} from '../rules'

const NOW = new Date('2026-11-09T00:00:00.000Z')
const FRESH = [{ accountId: 'act_1', complete: true, capturedAt: '2026-11-08T12:00:00.000Z' }]
const SCALE: ScaleRoom = { adsetId: 'set-scale', dailyBudget: 20, spentToday: 2 }
const PLAN: PlanRoom = { approvedDailyCap: 30, committedDaily: 10 }

function rules(target: number | null = 4, minPrimary?: number) {
  return rulesFromConfig({
    target_cost_per_primary: target,
    min_primary_per_unit: minPrimary,
  })
}

function ad(over: Partial<LiveCreative> = {}): LiveCreative {
  return {
    adId: 'ad-1', name: '春季', stage: 'test', status: 'ACTIVE', liveDays: 7, leads: 10, spend: 28,
    postId: 'post-1', pageId: 'page-1', adAccountId: 'act_1', adsetId: 'set-test', ...over,
  }
}

function decide(over: Partial<Parameters<typeof decideCreatives>[0]> = {}) {
  return decideCreatives({
    rules: rules(), captures: FRESH, creatives: [ad()], scale: SCALE, plan: PLAN, promotionsToday: 0, now: NOW, ...over,
  })
}

describe('creative state rules', () => {
  it('reads the client target and never lowers the lead floor', () => {
    expect(rulesFromConfig(null).targetCpl).toBeNull()
    expect(rulesFromConfig({ target_cost_per_primary: 0 }).targetCpl).toBeNull()
    expect(rules(4, 5).minLeads).toBe(10)
    expect(rules(4, 15).minLeads).toBe(15)
  })

  it('fails closed when the newest capture is missing, incomplete, or old', () => {
    expect(decide({ captures: [] }).skipped).toEqual(['stale_snapshot'])
    expect(decide({ captures: [{ accountId: 'act_1', complete: false, capturedAt: FRESH[0].capturedAt }] }).proposals).toEqual([])
    expect(decide({ captures: [{ accountId: 'act_1', complete: true, capturedAt: '2026-11-07T00:00:00.000Z' }] }).skipped).toEqual(['stale_snapshot'])
    expect(capturesFresh([{ accountId: 'act_1', complete: true, capturedAt: 'not-a-date' }], NOW, 24)).toBe(false)
  })

  it('moves a winner without raising budget', () => {
    const out = decide()
    expect(out.proposals.map((item) => item.kind)).toEqual(['move_to_scale'])
    expect(out.proposals[0]).toMatchObject({ scaleAdsetId: 'set-scale', ad: { adId: 'ad-1' } })
  })

  it('proposes a new plan instead of raising the live one, and stops at the cap', () => {
    const tight: ScaleRoom = { adsetId: 'set-scale', dailyBudget: 5, spentToday: 4 }
    const raised = decide({ scale: tight })
    expect(raised.proposals[0]?.kind).toBe('new_plan')
    if (raised.proposals[0]?.kind === 'new_plan') {
      expect(raised.proposals[0].nextDailyTotal).toBeLessThanOrEqual(30)
    }
    const blocked = decide({ scale: tight, plan: { approvedDailyCap: 12, committedDaily: 10 } })
    expect(blocked.proposals).toEqual([])
    expect(blocked.skipped).toContain('over_plan_cap')
  })

  it('does not promote without a target, a post, a scale budget, or a free daily slot', () => {
    expect(decide({ rules: rules(null) }).skipped).toEqual(['no_target'])
    expect(decide({ creatives: [ad({ postId: null })] }).skipped).toContain('no_post')
    expect(decide({ scale: { adsetId: 'set-scale', dailyBudget: null, spentToday: 0 } }).skipped).toContain('scale_budget_unread')
    expect(decide({ scale: { adsetId: null, dailyBudget: 20, spentToday: 0 } }).skipped).toContain('no_scale_adset')
    expect(decide({ promotionsToday: 1 }).skipped).toContain('promotion_cap')
    expect(decide({ creatives: [ad({ liveDays: 6 })] }).proposals).toEqual([])
    expect(decide({ creatives: [ad({ leads: 9 })] }).proposals).toEqual([])
    expect(decide({ creatives: [ad({ stage: 'scale', adsetId: 'set-scale' })] }).proposals).toEqual([])
  })

  it('picks the cheaper winner and pauses a costly ad without touching budget', () => {
    const cheap = ad({ adId: 'ad-a', spend: 20, leads: 10 })
    const costly = ad({ adId: 'ad-b', spend: 80, leads: 2 })
    const out = decide({ creatives: [costly, cheap] })
    expect(out.proposals.map((item) => item.kind)).toEqual(['move_to_scale', 'pause'])
    expect(out.proposals[0]).toMatchObject({ ad: { adId: 'ad-a' } })
    expect(out.proposals[1]).toMatchObject({ kind: 'pause', ad: { adId: 'ad-b' } })
    const zeroLeads = decide({ creatives: [ad({ adId: 'ad-z', leads: 0, spend: 40 })], promotionsToday: 1 })
    expect(zeroLeads.proposals.map((item) => item.kind)).toEqual(['pause'])
  })
})
