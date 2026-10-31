import { describe, it, expect } from 'vitest'
import { clampTreeDays, toInsightRow, toSnapshotRow } from '../load'

describe('entity-tree load helpers', () => {
  it('maps numeric strings from the database and drops unknown levels', () => {
    const row = toInsightRow({
      level: 'adset', entity_id: 'a1', entity_name: 'A', parent_id: 'c1', insight_date: '2026-10-28',
      spend: '12.5', impressions: '1000', clicks: 30, leads: '2', messaging_conversations: null,
    })
    expect(row).toEqual({
      level: 'adset', entityId: 'a1', entityName: 'A', parentId: 'c1', date: '2026-10-28',
      spend: 12.5, impressions: 1000, clicks: 30, leads: 2, messagingConversations: 0,
    })
    expect(toInsightRow({ level: 'account', entity_id: 'x', entity_name: null, parent_id: null, insight_date: '2026-10-28', spend: 1, impressions: 1, clicks: 1, leads: 0, messaging_conversations: 0 })).toBeNull()
  })

  it('keeps a missing budget as null, not 0', () => {
    const row = toSnapshotRow({
      level: 'adset', entity_id: 'a1', entity_name: 'A', campaign_id: 'c1', adset_id: null,
      effective_status: 'ACTIVE', daily_budget_minor: null, currency: 'NZD', captured_at: '2026-10-28T12:30:00Z', creative_page_id: null,
    })
    expect(row?.dailyBudgetMinor).toBeNull()
    const withBudget = toSnapshotRow({
      level: 'adset', entity_id: 'a1', entity_name: 'A', campaign_id: 'c1', adset_id: null,
      effective_status: 'ACTIVE', daily_budget_minor: '5000', currency: 'NZD', captured_at: '2026-10-28T12:30:00Z', creative_page_id: '1616575215312482',
    })
    expect(withBudget?.dailyBudgetMinor).toBe(5000)
  })

  it('clamps days to 1..30 and falls back to 7', () => {
    expect(clampTreeDays(null)).toBe(7)
    expect(clampTreeDays('abc')).toBe(7)
    expect(clampTreeDays('0')).toBe(7)
    expect(clampTreeDays('14')).toBe(14)
    expect(clampTreeDays('999')).toBe(30)
  })
})
