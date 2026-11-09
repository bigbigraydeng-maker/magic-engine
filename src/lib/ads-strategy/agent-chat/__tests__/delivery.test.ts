import { describe, expect, it } from 'vitest'
import { classifyDeliveryIssues } from '../delivery'

describe('classifyDeliveryIssues', () => {
  it('tags disapproved and learning', () => {
    const issues = classifyDeliveryIssues([
      {
        level: 'ad',
        entity_id: 'ad-1',
        entity_name: 'Creative A',
        effective_status: 'DISAPPROVED',
        status: 'DISAPPROVED',
        learning_stage: null,
      },
      {
        level: 'adset',
        entity_id: 'as-1',
        entity_name: 'Set B',
        effective_status: 'ACTIVE',
        status: 'ACTIVE',
        learning_stage: 'LEARNING_LIMITED',
      },
    ])
    expect(issues.map(i => i.category)).toEqual(['rejected', 'learning_limited'])
  })

  it('detects parent pause while child active', () => {
    const issues = classifyDeliveryIssues([
      {
        level: 'ad',
        entity_id: 'ad-2',
        entity_name: 'Child',
        effective_status: 'CAMPAIGN_PAUSED',
        status: 'ACTIVE',
        learning_stage: null,
      },
    ])
    expect(issues[0]?.category).toBe('paused_by_parent')
  })
})
