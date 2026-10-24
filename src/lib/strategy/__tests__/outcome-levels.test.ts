import { describe, expect, it } from 'vitest'

import {
  GEO_QUALIFIED_MENTION_GOAL_METRIC_KEY,
  PRIMARY_METRIC_CATALOG,
} from '@/types/strategy'
import {
  CATALOG_KEYS_OUTSIDE_OUTCOME_LEVELS,
  METRIC_KEYS_BY_OUTCOME_LEVEL,
  OUTCOME_LEVELS,
  SIGNUPS_COUNT_CAVEAT,
  SIGNUPS_COUNT_METRIC_KEY,
  compareOutcomeLevels,
  judgeOutcomeEvidence,
  levelMayStandFor,
  outcomeLevelOf,
} from '../outcome-levels'

describe('outcome levels', () => {
  it('orders exposure/clicks below contact, then qualified lead, then a closed deal', () => {
    expect(OUTCOME_LEVELS).toEqual([
      'exposure_or_clicks',
      'contact_success',
      'qualified_lead',
      'closed_deal',
    ])
    expect(compareOutcomeLevels('exposure_or_clicks', 'contact_success')).toBe(-1)
    expect(compareOutcomeLevels('contact_success', 'qualified_lead')).toBe(-1)
    expect(compareOutcomeLevels('qualified_lead', 'closed_deal')).toBe(-1)
    expect(compareOutcomeLevels('closed_deal', 'closed_deal')).toBe(0)
  })

  it('lets a rung stand only for itself', () => {
    for (const candidate of OUTCOME_LEVELS) {
      for (const required of OUTCOME_LEVELS) {
        expect(levelMayStandFor(candidate, required)).toBe(candidate === required)
      }
    }
  })

  it('maps each catalog key once and leaves contact success empty', () => {
    expect(METRIC_KEYS_BY_OUTCOME_LEVEL.contact_success).toEqual([])

    const mapped = OUTCOME_LEVELS.flatMap((level) => [...METRIC_KEYS_BY_OUTCOME_LEVEL[level]])
    const classified = [...mapped, ...CATALOG_KEYS_OUTSIDE_OUTCOME_LEVELS]
    const catalogKeys = PRIMARY_METRIC_CATALOG.map((metric) => metric.key)

    expect(new Set(mapped).size).toBe(mapped.length)
    expect(new Set(classified)).toEqual(new Set(catalogKeys))
    expect(classified).toHaveLength(catalogKeys.length)

    for (const key of mapped) {
      expect(PRIMARY_METRIC_CATALOG.some((metric) => metric.key === key)).toBe(true)
      expect(outcomeLevelOf(key)).not.toBeNull()
    }
    for (const key of CATALOG_KEYS_OUTSIDE_OUTCOME_LEVELS) {
      expect(outcomeLevelOf(key)).toBeNull()
    }
  })

  it('rejects clicks and leads as sales evidence and says they cannot replace a deal', () => {
    const clicks = judgeOutcomeEvidence('sales', 'seo_gsc_clicks_28d')
    expect(clicks.accepted).toBe(false)
    expect(clicks.countsAsClosedDeal).toBe(false)
    expect(clicks.level).toBe('exposure_or_clicks')
    expect(clicks.reasonCode).toBe('exposure_cannot_replace_deal')
    expect(clicks.reason).toContain('点击')
    expect(clicks.reason).toContain('不能代替成交')

    for (const key of METRIC_KEYS_BY_OUTCOME_LEVEL.exposure_or_clicks) {
      const judged = judgeOutcomeEvidence('sales', key)
      expect(judged.accepted).toBe(false)
      expect(judged.reason).toContain('不能代替成交')
    }

    for (const key of METRIC_KEYS_BY_OUTCOME_LEVEL.qualified_lead) {
      const judged = judgeOutcomeEvidence('sales', key)
      expect(judged.accepted).toBe(false)
      expect(judged.countsAsClosedDeal).toBe(false)
      expect(judged.level).toBe('qualified_lead')
      expect(judged.reasonCode).toBe('lead_cannot_replace_deal')
      expect(judged.reason).toContain('线索')
      expect(judged.reason).toContain('不能代替成交')
    }
  })

  it('accepts closed-deal keys for sales and marks signups as a transaction count', () => {
    for (const key of METRIC_KEYS_BY_OUTCOME_LEVEL.closed_deal) {
      const judged = judgeOutcomeEvidence('sales', key)
      expect(judged.accepted).toBe(true)
      expect(judged.countsAsClosedDeal).toBe(true)
      expect(judged.reasonCode).toBe('accepted_closed_deal')
    }

    const signups = judgeOutcomeEvidence('sales', SIGNUPS_COUNT_METRIC_KEY)
    expect(signups.caveat).toBe(SIGNUPS_COUNT_CAVEAT)
    expect(signups.caveat).toContain('笔数')
    expect(signups.caveat).toContain('不是座位')
    expect(signups.caveat).toContain('不是线索')
    expect(judgeOutcomeEvidence('sales', 'orders_count').caveat).toBeNull()
  })

  it('does not read a sales catalog rate or stock figure as a closed deal', () => {
    for (const key of CATALOG_KEYS_OUTSIDE_OUTCOME_LEVELS) {
      const judged = judgeOutcomeEvidence('sales', key)
      expect(judged.accepted).toBe(true)
      expect(judged.countsAsClosedDeal).toBe(false)
      expect(judged.level).toBeNull()
      expect(judged.reasonCode).toBe('accepted_sales_metric_not_deal_count')
      expect(judged.reason).toContain('不是成交')
    }
  })

  it('keeps lead evidence on acquisition and exposure evidence on awareness', () => {
    for (const key of METRIC_KEYS_BY_OUTCOME_LEVEL.qualified_lead) {
      const judged = judgeOutcomeEvidence('acquisition', key)
      expect(judged.accepted).toBe(true)
      expect(judged.countsAsClosedDeal).toBe(false)
      expect(judged.reason).toContain('不是成交')
    }

    for (const key of METRIC_KEYS_BY_OUTCOME_LEVEL.exposure_or_clicks) {
      expect(judgeOutcomeEvidence('awareness', key).accepted).toBe(true)
    }

    const clicksForAcquisition = judgeOutcomeEvidence('acquisition', 'seo_gsc_clicks_28d')
    expect(clicksForAcquisition.accepted).toBe(true)
    expect(clicksForAcquisition.reason).toContain('不是线索')
    expect(clicksForAcquisition.reason).toContain('不是成交')

    expect(judgeOutcomeEvidence('acquisition', 'organic_traffic').accepted).toBe(true)
    expect(judgeOutcomeEvidence('acquisition', 'brand_search_volume').accepted).toBe(false)
    expect(judgeOutcomeEvidence('acquisition', 'signups_count').accepted).toBe(false)
    expect(judgeOutcomeEvidence('awareness', 'leads_count').accepted).toBe(false)
    expect(judgeOutcomeEvidence('awareness', 'signups_count').reason).toContain('分开计')
  })

  it('does not treat an unknown key as zero or as evidence', () => {
    const judged = judgeOutcomeEvidence('sales', 'not_a_catalog_key')
    expect(judged.accepted).toBe(false)
    expect(judged.countsAsClosedDeal).toBe(false)
    expect(judged.level).toBeNull()
    expect(judged.reasonCode).toBe('unknown_metric')
    expect(judged.reason).toContain('未知')
    expect(judged.reason).toContain('不能当成 0')
  })

  it('keeps the AI mention metric on exposure, not on qualified leads', () => {
    expect(outcomeLevelOf(GEO_QUALIFIED_MENTION_GOAL_METRIC_KEY)).toBe('exposure_or_clicks')
    const judged = judgeOutcomeEvidence('sales', GEO_QUALIFIED_MENTION_GOAL_METRIC_KEY)
    expect(judged.accepted).toBe(false)
    expect(judged.reasonCode).toBe('exposure_cannot_replace_deal')
  })
})
