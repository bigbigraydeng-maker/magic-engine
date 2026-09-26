import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import {
  selectRuleFindings,
  type RuleFindingArgs,
} from '../rule-findings'
import type { GrowthStateRow, RuleFinding } from '@/lib/ads-strategy/rules/patrol-findings'

const NOW = new Date('2026-09-25T20:00:00Z')

const args = (over: Partial<RuleFindingArgs> = {}): RuleFindingArgs => ({
  adAccountId: 'act_1',
  now: NOW,
  currency: 'NZD',
  deliveringAdIds: null,
  campaignFrequency: () => null,
  ...over,
})

const d10 = (adId = 'ad1', account = 'act_1', clientVisible = true): RuleFinding => ({
  code: 'D10',
  status: 'hit',
  title: 't',
  clientVisible,
  units: [{ level: 'ad', id: adId, name: adId, adAccountId: account }],
  evidence: {
    core_metric: 'lead',
    baseline_source: 'own_history',
    base_rate: 0.16,
    recent_rate: 0.04,
    base_cost_per_result: 7,
    recent_cost_per_result: 30,
    recent_spend: 100,
  },
})

const row = (
  date: string,
  problems: RuleFinding[],
  coverage: Array<{ adAccountId: string; ran: boolean; reason: string; adsChecked: number }> = [
    { adAccountId: 'act_1', ran: true, reason: 'ok', adsChecked: 5 },
  ],
  completeness = 'complete',
): GrowthStateRow => ({
  client_id: 'c',
  date,
  payload: { dataCompleteness: completeness, problems, adLevelCoverage: coverage },
})

describe('selectRuleFindings — none reasons', () => {
  it('no rows → not_connected', () => {
    const res = selectRuleFindings([], args())
    expect(res.section).toEqual({ source: 'none', reason: 'not_connected' })
    expect(res.findings).toEqual([])
  })

  it('newest partial → partial', () => {
    const res = selectRuleFindings([row('2026-09-24', [d10()], undefined, 'partial')], args())
    expect(res.section).toEqual({ source: 'none', reason: 'partial' })
  })

  it('newest too old → stale', () => {
    const res = selectRuleFindings([row('2026-09-20', [d10()])], args())
    expect(res.section).toEqual({ source: 'none', reason: 'stale' })
  })

  it('coverage missing for this account → not_connected', () => {
    const res = selectRuleFindings(
      [row('2026-09-24', [d10()], [{ adAccountId: 'act_9', ran: true, reason: 'ok', adsChecked: 5 }])],
      args(),
    )
    expect(res.section).toEqual({ source: 'none', reason: 'not_connected' })
  })

  it('coverage ran false shared_account → shared_account', () => {
    const res = selectRuleFindings(
      [row('2026-09-24', [d10()], [{ adAccountId: 'act_1', ran: false, reason: 'shared_account', adsChecked: 0 }])],
      args(),
    )
    expect(res.section).toEqual({ source: 'none', reason: 'shared_account' })
  })

  it('coverage ran false unknown reason → not_loaded', () => {
    const res = selectRuleFindings(
      [row('2026-09-24', [d10()], [{ adAccountId: 'act_1', ran: false, reason: 'weird', adsChecked: 0 }])],
      args(),
    )
    expect(res.section).toEqual({ source: 'none', reason: 'not_loaded' })
  })

  it('coverage ran true adsChecked 0 → no_delivering_ads', () => {
    const res = selectRuleFindings(
      [row('2026-09-24', [d10()], [{ adAccountId: 'act_1', ran: true, reason: 'ok', adsChecked: 0 }])],
      args(),
    )
    expect(res.section).toEqual({ source: 'none', reason: 'no_delivering_ads' })
  })

  it('payload without adLevelCoverage → preparing', () => {
    const noCoverage: GrowthStateRow = {
      client_id: 'c',
      date: '2026-09-24',
      payload: { dataCompleteness: 'complete', problems: [d10()] },
    }
    const res = selectRuleFindings([noCoverage], args())
    expect(res.section).toEqual({ source: 'none', reason: 'preparing' })
  })

  it('hit present but not renderable → incomplete_findings', () => {
    const unrenderable = (): RuleFinding => ({
      ...d10(),
      evidence: {
        core_metric: null,
        baseline_source: 'own_history',
        base_rate: 0.16,
        recent_rate: 0.04,
        base_cost_per_result: 7,
        recent_cost_per_result: 30,
        recent_spend: 100,
      },
    })
    const res = selectRuleFindings(
      [row('2026-09-24', [unrenderable()]), row('2026-09-23', [unrenderable()])],
      args(),
    )
    expect(res.section).toEqual({ source: 'none', reason: 'incomplete_findings' })
  })
})

describe('selectRuleFindings — patrol', () => {
  it('hit on two consecutive rows → one finding', () => {
    const res = selectRuleFindings(
      [row('2026-09-24', [d10()]), row('2026-09-23', [d10()])],
      args(),
    )
    expect(res.section.source).toBe('patrol')
    if (res.section.source !== 'patrol') throw new Error('expected patrol')
    expect(res.section.dataDate).toBe('2026-09-24')
    expect(res.section.adsChecked).toBe(5)
    expect(res.findings).toHaveLength(1)
    expect(res.findings[0].adName).toBe('ad1')
  })

  it('hit only on the newest row → zero findings (streak < 2)', () => {
    const res = selectRuleFindings(
      [row('2026-09-24', [d10()]), row('2026-09-23', [])],
      args(),
    )
    expect(res.section.source).toBe('patrol')
    expect(res.findings).toEqual([])
  })

  it('clientVisible false → zero findings', () => {
    const res = selectRuleFindings(
      [row('2026-09-24', [d10('ad1', 'act_1', false)]), row('2026-09-23', [d10('ad1', 'act_1', false)])],
      args(),
    )
    expect(res.findings).toEqual([])
  })

  it('ad unit on another account → zero findings', () => {
    const res = selectRuleFindings(
      [row('2026-09-24', [d10('ad1', 'act_2')]), row('2026-09-23', [d10('ad1', 'act_2')])],
      args(),
    )
    expect(res.findings).toEqual([])
  })

  it('ad unit without adAccountId → zero findings', () => {
    const noAccount = (): RuleFinding => ({
      ...d10(),
      units: [{ level: 'ad', id: 'ad1', name: 'ad1' }],
    })
    const res = selectRuleFindings(
      [row('2026-09-24', [noAccount()]), row('2026-09-23', [noAccount()])],
      args(),
    )
    expect(res.findings).toEqual([])
  })

  it('normalises act_ prefix on the requested account id', () => {
    const res = selectRuleFindings(
      [row('2026-09-24', [d10()]), row('2026-09-23', [d10()])],
      args({ adAccountId: '1' }),
    )
    expect(res.findings).toHaveLength(1)
  })

  it('deliveringAdIds excludes non-delivering ads', () => {
    const rows = [row('2026-09-24', [d10()]), row('2026-09-23', [d10()])]
    expect(selectRuleFindings(rows, args({ deliveringAdIds: new Set(['other']) })).findings).toEqual([])
    expect(selectRuleFindings(rows, args({ deliveringAdIds: new Set(['ad1']) })).findings).toHaveLength(1)
  })

  it('sorts rows passed in ascending order', () => {
    const res = selectRuleFindings(
      [row('2026-09-23', [d10()]), row('2026-09-24', [d10()])],
      args(),
    )
    expect(res.section.source).toBe('patrol')
    if (res.section.source !== 'patrol') throw new Error('expected patrol')
    expect(res.section.dataDate).toBe('2026-09-24')
    expect(res.findings).toHaveLength(1)
  })
})
