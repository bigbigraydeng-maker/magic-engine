/**
 * Meta action-stat parsing.
 *
 * Two invariants worth more than the rest of this file:
 *   - never sum across a hierarchical action list (double-counts outcomes)
 *   - never turn "Meta reported nothing" into 0 (invents free conversions)
 */

import { describe, it, expect } from 'vitest'
import {
  LEAD_ACTION_PRIORITY,
  MESSAGING_ACTION_PRIORITY,
  PURCHASE_ACTION_PRIORITY,
  parseObjectiveCosts,
  pickAction,
  pickActionCost,
} from '../objective-metrics'

describe('pickAction', () => {
  it('takes the first present type by priority, never the sum', () => {
    // `lead` (12) is the aggregate of `onsite_conversion.lead_grouped` (12).
    // Summing would report 24 leads and halve every cost-per-lead.
    const actions = [
      { action_type: 'lead', value: '12' },
      { action_type: 'onsite_conversion.lead_grouped', value: '12' },
    ]
    expect(pickAction(actions, LEAD_ACTION_PRIORITY)).toBe(12)
  })

  it('falls through to the child type when the aggregate is absent', () => {
    const actions = [{ action_type: 'onsite_conversion.lead_grouped', value: '7' }]
    expect(pickAction(actions, LEAD_ACTION_PRIORITY)).toBe(7)
  })

  it('returns 0 when no type in the priority list is present', () => {
    expect(pickAction([{ action_type: 'link_click', value: '99' }], LEAD_ACTION_PRIORITY)).toBe(0)
    expect(pickAction(undefined, LEAD_ACTION_PRIORITY)).toBe(0)
  })
})

describe('pickActionCost', () => {
  it('reads the cost Meta reported, in priority order', () => {
    const costs = [
      { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '4.35' },
      { action_type: 'link_click', value: '0.12' },
    ]
    expect(pickActionCost(costs, MESSAGING_ACTION_PRIORITY)).toBe(4.35)
  })

  it('returns NULL — not 0 — when Meta reported no such cost', () => {
    // A Messenger campaign has no cost-per-purchase. Zero would read as
    // "purchases are free" and poison every attribution built on it.
    const costs = [
      { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '4.35' },
    ]
    expect(pickActionCost(costs, PURCHASE_ACTION_PRIORITY)).toBeNull()
    expect(pickActionCost(undefined, PURCHASE_ACTION_PRIORITY)).toBeNull()
    expect(pickActionCost([], PURCHASE_ACTION_PRIORITY)).toBeNull()
  })

  it('skips an unparseable value rather than emitting NaN', () => {
    const costs = [{ action_type: 'purchase', value: 'n/a' }]
    expect(pickActionCost(costs, PURCHASE_ACTION_PRIORITY)).toBeNull()
  })

  it('keeps a genuine zero cost', () => {
    const costs = [{ action_type: 'lead', value: '0' }]
    expect(pickActionCost(costs, LEAD_ACTION_PRIORITY)).toBe(0)
  })
})

describe('parseObjectiveCosts', () => {
  it('reads all three costs off a mixed account', () => {
    expect(parseObjectiveCosts({
      cost_per_action_type: [
        { action_type: 'purchase', value: '31.20' },
        { action_type: 'lead', value: '8.40' },
        { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '4.35' },
      ],
    })).toEqual({ cpa: 31.20, cost_per_lead: 8.40, cost_per_conversation: 4.35 })
  })

  it('leaves purchase + lead null for a conversation-only account (30 Kiteroa)', () => {
    expect(parseObjectiveCosts({
      cost_per_action_type: [
        { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '6.10' },
        { action_type: 'link_click', value: '0.44' },
      ],
    })).toEqual({ cpa: null, cost_per_lead: null, cost_per_conversation: 6.10 })
  })

  it('returns all-null when the field is absent entirely', () => {
    expect(parseObjectiveCosts({}))
      .toEqual({ cpa: null, cost_per_lead: null, cost_per_conversation: null })
  })
})
