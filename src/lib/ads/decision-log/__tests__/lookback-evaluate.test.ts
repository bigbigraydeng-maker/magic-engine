import { describe, expect, it } from 'vitest'
import {
  evaluateDecisionLookback,
  fixtureGroupACreativeDecision,
} from '../lookback-evaluate'
import type { DecisionDailyInsightRow } from '../types'

const REVIEW_DAY = '2026-11-17'
const TARGET_CPL = 50
const ADSET = 'fixture-adset-group-a'
const AD_PRICE = 'fixture-ad-static-price'
const AD_HOOK = 'fixture-ad-static-hook'

function insight(
  date: string,
  level: string,
  entity: string,
  partial: Partial<DecisionDailyInsightRow>,
): DecisionDailyInsightRow {
  return {
    insight_date: date,
    level,
    entity_id: entity,
    spend: null,
    impressions: null,
    clicks: null,
    ctr: null,
    leads: null,
    results: null,
    ...partial,
  }
}

describe('fixture group A day-3 lookback', () => {
  const decision = fixtureGroupACreativeDecision(REVIEW_DAY)

  it('met when new static CTRs pass and adset CPL stays at or below target', () => {
    const rows: DecisionDailyInsightRow[] = [
      insight('2026-11-16', 'ad', AD_PRICE, { ctr: 0.02, clicks: 40, impressions: 2000 }),
      insight('2026-11-17', 'ad', AD_HOOK, { ctr: 0.019, clicks: 38, impressions: 2000 }),
      insight('2026-11-16', 'adset', ADSET, { spend: 40, results: 1 }),
      insight('2026-11-17', 'adset', ADSET, { spend: 45, results: 1 }),
    ]
    const out = evaluateDecisionLookback({
      decision,
      insights: rows,
      targetCplMajor: TARGET_CPL,
      reviewAsOf: REVIEW_DAY,
      adsetRef: ADSET,
    })
    expect(out.result.verdict).toBe('met')
  })

  it('not_met when CTR on a new static falls below 1.8%', () => {
    const rows: DecisionDailyInsightRow[] = [
      insight('2026-11-16', 'ad', AD_PRICE, { ctr: 0.012, clicks: 20, impressions: 2000 }),
      insight('2026-11-17', 'ad', AD_HOOK, { ctr: 0.022, clicks: 44, impressions: 2000 }),
      insight('2026-11-16', 'adset', ADSET, { spend: 40, results: 1 }),
      insight('2026-11-17', 'adset', ADSET, { spend: 42, results: 1 }),
    ]
    const out = evaluateDecisionLookback({
      decision,
      insights: rows,
      targetCplMajor: TARGET_CPL,
      reviewAsOf: REVIEW_DAY,
      adsetRef: ADSET,
    })
    expect(out.result.verdict).toBe('not_met')
  })

  it('cant_tell when adset spend exists but no outcomes', () => {
    const rows: DecisionDailyInsightRow[] = [
      insight('2026-11-17', 'ad', AD_PRICE, { ctr: 0.021, clicks: 42, impressions: 2000 }),
      insight('2026-11-17', 'ad', AD_HOOK, { ctr: 0.02, clicks: 40, impressions: 2000 }),
      insight('2026-11-16', 'adset', ADSET, { spend: 60, results: 0 }),
      insight('2026-11-17', 'adset', ADSET, { spend: 55, results: 0 }),
    ]
    const out = evaluateDecisionLookback({
      decision,
      insights: rows,
      targetCplMajor: TARGET_CPL,
      reviewAsOf: REVIEW_DAY,
      adsetRef: ADSET,
    })
    expect(out.result.verdict).toBe('cant_tell')
  })
})
