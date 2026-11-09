import { describe, expect, it } from 'vitest'
import { PLATFORM_RULES, platformRulesFor } from '../platform-rules'
import {
  INDUSTRY_TEMPLATES,
  industryTemplateFor,
  type IndustryTemplate,
} from '../industry-templates'

const FORBIDDEN_METRIC_PATTERN = /follower|reach|dm_count|impression/i

describe('platformRulesFor', () => {
  it('returns the implemented facebook rule set with the expected keys and topics', () => {
    const rules = platformRulesFor('facebook')
    expect(rules.status).toBe('implemented')
    const keys = rules.rules.map((rule) => rule.key)
    expect(keys).toContain('link_in_first_comment')
    expect(keys).toContain('unreadable_metrics_not_for_acceptance')
    expect(keys).toContain('story_not_for_selling')
    expect(keys).toContain('never_auto_reply_price_complaint_refund')
    expect(keys).toContain('groups_me_drafts_human_posts')
    expect(keys).toContain('marketplace_no_tours')
    expect(rules.neverAutoReplyTopics).toEqual(['price', 'complaint', 'refund'])
  })

  it('returns not_connected with empty rules for instagram', () => {
    const rules = platformRulesFor('instagram')
    expect(rules.status).toBe('not_connected')
    expect(rules.rules).toHaveLength(0)
    expect(rules.neverAutoReplyTopics).toHaveLength(0)
  })

  it('returns not_connected with empty rules for tiktok', () => {
    const rules = platformRulesFor('tiktok')
    expect(rules.status).toBe('not_connected')
    expect(rules.rules).toHaveLength(0)
    expect(rules.neverAutoReplyTopics).toHaveLength(0)
  })
})

describe('industryTemplateFor', () => {
  it('resolves travel and logistics to templates with matching keys', () => {
    const travel = industryTemplateFor('travel')
    expect(travel).not.toBeNull()
    expect(travel?.key).toBe('travel')

    const logistics = industryTemplateFor('logistics')
    expect(logistics).not.toBeNull()
    expect(logistics?.key).toBe('logistics')
  })

  it('resolves aliases to the correct template', () => {
    expect(industryTemplateFor('Tourism-Operator')?.key).toBe('travel')
    expect(industryTemplateFor(' LOGISTICS_3PL ')?.key).toBe('logistics')
    expect(industryTemplateFor('freight')?.key).toBe('logistics')
  })

  it('returns null for unknown industries and never falls back to travel', () => {
    expect(industryTemplateFor('real_estate')).toBeNull()
    expect(industryTemplateFor('other')).toBeNull()
    expect(industryTemplateFor('')).toBeNull()
    expect(industryTemplateFor(null)).toBeNull()
    expect(industryTemplateFor(undefined)).toBeNull()
    expect(industryTemplateFor('constructor')).toBeNull()
    expect(industryTemplateFor('toString')).toBeNull()
  })
})

function assertSuggestedNumbers(template: IndustryTemplate): void {
  const { reelPerWeek, postPerWeek, storyPerDay } = template.quotas
  expect(reelPerWeek.suggested).toBe(true)
  expect(postPerWeek.suggested).toBe(true)
  expect(storyPerDay.suggested).toBe(true)

  for (const value of Object.values(template.mix)) {
    expect(value.suggested).toBe(true)
  }

  const leadTime = template.peakSeasons.leadTimeWeeks
  if (leadTime !== null) {
    expect(leadTime.suggested).toBe(true)
  }
}

describe('industry templates', () => {
  it('marks every suggested number in both templates with suggested true', () => {
    assertSuggestedNumbers(INDUSTRY_TEMPLATES.travel)
    assertSuggestedNumbers(INDUSTRY_TEMPLATES.logistics)
  })

  it('has mix values that sum to 100 for both templates', () => {
    const travelSum = Object.values(INDUSTRY_TEMPLATES.travel.mix).reduce(
      (acc, value) => acc + value.value,
      0,
    )
    expect(travelSum).toBe(100)

    const logisticsSum = Object.values(INDUSTRY_TEMPLATES.logistics.mix).reduce(
      (acc, value) => acc + value.value,
      0,
    )
    expect(logisticsSum).toBe(100)
  })

  it('includes the explainPillarKey inside each template mix', () => {
    expect(
      Object.prototype.hasOwnProperty.call(
        INDUSTRY_TEMPLATES.travel.mix,
        INDUSTRY_TEMPLATES.travel.explainPillarKey,
      ),
    ).toBe(true)
    expect(
      Object.prototype.hasOwnProperty.call(
        INDUSTRY_TEMPLATES.logistics.mix,
        INDUSTRY_TEMPLATES.logistics.explainPillarKey,
      ),
    ).toBe(true)
  })

  it('does not mention follower, reach, dm_count or impression metrics', () => {
    expect(JSON.stringify(INDUSTRY_TEMPLATES.travel)).not.toMatch(
      FORBIDDEN_METRIC_PATTERN,
    )
    expect(JSON.stringify(INDUSTRY_TEMPLATES.logistics)).not.toMatch(
      FORBIDDEN_METRIC_PATTERN,
    )
    expect(JSON.stringify(PLATFORM_RULES)).not.toMatch(FORBIDDEN_METRIC_PATTERN)
  })
})
