import { describe, expect, it } from 'vitest'

import { OUTCOME_STEPS } from '@/lib/ads-strategy/portfolio/outcome-ladder'
import {
  GEO_QUALIFIED_MENTION_GOAL_METRIC_KEY,
  PRIMARY_METRIC_CATALOG,
} from '@/types/strategy'
import {
  CATALOG_KEYS_OUTSIDE_OUTCOME_LEVELS,
  CATALOG_LADDER_STEP,
  METRIC_KEYS_BY_OUTCOME_LEVEL,
  OUTCOME_LEVELS,
  SIGNUPS_COUNT_CAVEAT,
  SIGNUPS_COUNT_METRIC_KEY,
  compareOutcomeLevels,
  judgeOutcomeEvidence,
  ladderStepForCatalogKey,
  ladderStepIsQualifiedLead,
  levelMayStandFor,
  outcomeLevelOf,
} from '../outcome-levels'

describe('outcome levels', () => {
  it('orders exposure below contact, then a plain lead, then a qualified lead, then a deal', () => {
    expect(OUTCOME_LEVELS).toEqual([
      'exposure_or_clicks',
      'contact_success',
      'plain_lead',
      'qualified_lead',
      'closed_deal',
    ])
    expect(compareOutcomeLevels('exposure_or_clicks', 'contact_success')).toBe(-1)
    expect(compareOutcomeLevels('contact_success', 'plain_lead')).toBe(-1)
    expect(compareOutcomeLevels('plain_lead', 'qualified_lead')).toBe(-1)
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

  it('maps each catalog key once and leaves qualified leads empty', () => {
    expect(METRIC_KEYS_BY_OUTCOME_LEVEL.contact_success).toEqual([])
    expect(METRIC_KEYS_BY_OUTCOME_LEVEL.qualified_lead).toEqual([])

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

    for (const key of ['leads_count', 'form_submissions', 'messaging_started', 'phone_calls'] as const) {
      const judged = judgeOutcomeEvidence('sales', key)
      expect(judged.accepted).toBe(false)
      expect(judged.countsAsClosedDeal).toBe(false)
      expect(judged.level).toBe('plain_lead')
      expect(judged.level).not.toBe('qualified_lead')
      expect(judged.reasonCode).toBe('lead_cannot_replace_deal')
      expect(judged.reason).toContain('未筛选线索')
      expect(judged.reason).toContain('不能代替成交')
    }

    expect(judgeOutcomeEvidence('sales', 'leads_count').ladderStep).toBe('lead')
    expect(judgeOutcomeEvidence('sales', 'form_submissions').ladderStep).toBe('lead')
    const started = judgeOutcomeEvidence('sales', 'messaging_started')
    expect(started.ladderStep).toBe('messaging_started')
    expect(judgeOutcomeEvidence('sales', 'phone_calls').ladderStep).toBeNull()
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

  it('keeps raw DM starts and form leads below a qualified enquiry', () => {
    const leadAt = OUTCOME_STEPS.indexOf('lead')
    const qualifiedAt = OUTCOME_STEPS.indexOf('qualified_enquiry')
    expect(OUTCOME_STEPS.indexOf('messaging_started')).toBeLessThan(leadAt)
    expect(leadAt).toBeLessThan(qualifiedAt)
    expect(ladderStepIsQualifiedLead('messaging_started')).toBe(false)
    expect(ladderStepIsQualifiedLead('lead')).toBe(false)
    expect(ladderStepIsQualifiedLead('qualified_enquiry')).toBe(true)

    expect(ladderStepForCatalogKey('messaging_started')).toBe('messaging_started')
    expect(outcomeLevelOf('messaging_started')).toBe('plain_lead')
    const started = judgeOutcomeEvidence('acquisition', 'messaging_started')
    expect(started.level).toBe('plain_lead')
    expect(started.level).not.toBe('qualified_lead')
    expect(started.reason).toContain('未筛选线索')
    expect(started.reason).toContain('不是合格线索')

    for (const key of ['leads_count', 'form_submissions'] as const) {
      expect(CATALOG_LADDER_STEP[key]).toBe('lead')
      expect(outcomeLevelOf(key)).toBe('plain_lead')
      const judged = judgeOutcomeEvidence('acquisition', key)
      expect(judged.level).toBe('plain_lead')
      expect(judged.level).not.toBe('qualified_lead')
      expect(judged.reason).toContain('不是合格线索')
    }

    for (const key of Object.keys(CATALOG_LADDER_STEP)) {
      const step = ladderStepForCatalogKey(key)
      expect(METRIC_KEYS_BY_OUTCOME_LEVEL.qualified_lead).not.toContain(key)
      expect(step).not.toBeNull()
      expect(step === null ? false : ladderStepIsQualifiedLead(step)).toBe(false)
    }
  })

  it('keeps plain leads on acquisition and exposure evidence on awareness', () => {
    expect(METRIC_KEYS_BY_OUTCOME_LEVEL.plain_lead.length).toBeGreaterThan(0)
    for (const key of METRIC_KEYS_BY_OUTCOME_LEVEL.plain_lead) {
      const judged = judgeOutcomeEvidence('acquisition', key)
      expect(judged.accepted).toBe(true)
      expect(judged.level).toBe('plain_lead')
      expect(judged.level).not.toBe('qualified_lead')
      expect(judged.countsAsClosedDeal).toBe(false)
      expect(judged.reason).toContain('未筛选线索')
      expect(judged.reason).toContain('不是合格线索')
      expect(judged.reason).toContain('不是成交')
    }
    for (const key of PRIMARY_METRIC_CATALOG.map((metric) => metric.key)) {
      expect(outcomeLevelOf(key)).not.toBe('qualified_lead')
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
