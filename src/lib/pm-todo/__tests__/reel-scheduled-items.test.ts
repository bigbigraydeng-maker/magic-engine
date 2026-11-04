import { describe, expect, it } from 'vitest'
import { buildReelScheduledItems, REEL_SCHEDULED_TODO_KIND } from '../reel-scheduled-items'

const grant = (status: string) => ({
  scheduled_go_public: {
    status, work_order_id: 'w1', publish_on: '2026-11-09', fingerprint: 'fp', card_run_id: 'week-card',
    authorized_by: 'boss@x.com', authorized_at: '2026-11-06T00:00:00.000Z', catalog_version_at_approval: 13,
  },
})

describe('buildReelScheduledItems', () => {
  it('only the four states that need a person become to-dos, each with what / how / href', () => {
    const rows = ['armed', 'claimed', 'consumed', 'stale', 'missed', 'failed', 'unknown', 'revoked']
      .map((s) => ({ client_id: 'c1', payload: grant(s) }))
    const items = buildReelScheduledItems(rows, () => 'CTS')
    expect(items).toHaveLength(4)
    for (const item of items) {
      expect(item.kind).toBe(REEL_SCHEDULED_TODO_KIND)
      expect(item.what).toContain('2026-11-09')
      expect(item.how.length).toBeGreaterThan(10)
      expect(item.href).toContain('/dashboard/clients/c1')
    }
  })

  it('rows without a readable grant are ignored', () => {
    expect(buildReelScheduledItems([{ client_id: 'c1', payload: {} }, { client_id: 'c1', payload: null }], () => 'CTS')).toEqual([])
  })
})
