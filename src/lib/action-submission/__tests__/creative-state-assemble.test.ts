/** Snapshot rows are keyed by level plus id. Insights stay on the bare ad id. */

import { describe, expect, it } from 'vitest'
import { assemble } from '../creative-state-live'

const now = new Date('2026-11-09T00:00:00.000Z')

describe('assemble', () => {
  it('keeps an ad when an ad set reuses the same id, and sums today on that ad', () => {
    const built = assemble(
      [
        { entity_id: 'ad-1', insight_date: '2026-11-08', spend: 4, leads: 1 },
        { entity_id: 'ad-1', insight_date: '2026-11-09', spend: 3, leads: 0 },
        { entity_id: 'same', insight_date: '2026-11-08', spend: 1, leads: 1 },
      ],
      [
        row('ad', 'same', { adset_id: 'set-1', effective_status: 'ACTIVE', entity_name: 'Other' }),
        row('adset', 'same', { captured_at: '2026-11-08T01:00:00.000Z', daily_budget_minor: 100, effective_status: 'ACTIVE', entity_name: 'Not the scale set' }),
        row('adset', 'set-1', { daily_budget_minor: 2000, effective_status: 'ACTIVE', entity_name: 'Scale' }),
        row('ad', 'ad-1', { adset_id: 'set-1', effective_status: 'ACTIVE', entity_name: 'Winner', creative_page_id: 'page-1' }),
      ],
      [{ ad_id: 'ad-1', post_id: 'post-1', page_id: 'page-1' }],
      'act_1',
      'set-1',
      null,
      now,
    )
    expect(built.creatives.map((item) => item.adId).sort()).toEqual(['ad-1', 'same'])
    expect(built.creatives.find((item) => item.adId === 'ad-1')).toMatchObject({ spend: 7, postId: 'post-1', stage: 'scale' })
    expect(built.scale).toEqual({ adsetId: 'set-1', dailyBudget: 20, spentToday: 3 })
  })
})

function row(level: string, id: string, extra: Record<string, unknown>) {
  return { level, entity_id: id, captured_at: '2026-11-08T00:00:00.000Z', capture_reason: null, ...extra }
}
