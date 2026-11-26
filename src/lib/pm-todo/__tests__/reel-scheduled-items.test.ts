import { describe, expect, it } from 'vitest'
import { buildReelScheduledItems, REEL_SCHEDULED_TODO_KIND } from '../reel-scheduled-items'

const grant = (status: string, extra: Record<string, unknown> = {}) => ({
  scheduled_go_public: {
    ...extra, status, work_order_id: 'w1', publish_on: '2026-11-09', fingerprint: 'fp', card_run_id: 'week-card',
    authorized_by: 'boss@x.com', authorized_at: '2026-11-06T00:00:00.000Z', catalog_version_at_approval: 13,
  },
})

describe('buildReelScheduledItems', () => {
  it('only the four states that need a person become to-dos, each with what / how / href', () => {
    const rows = ['armed', 'claimed', 'consumed', 'stale', 'missed', 'failed', 'unknown', 'revoked']
      .map((s) => ({ client_id: 'c1', payload: grant(s) }))
    const items = buildReelScheduledItems(rows, () => 'CTS', '2026-11-09')
    expect(items).toHaveLength(4)
    for (const item of items) {
      expect(item.kind).toBe(REEL_SCHEDULED_TODO_KIND)
      expect(item.what).toContain('2026-11-09')
      expect(item.how.length).toBeGreaterThan(10)
      expect(item.href).toContain('/dashboard/clients/c1')
    }
  })

  it('rows without a readable grant are ignored', () => {
    expect(buildReelScheduledItems([{ client_id: 'c1', payload: {} }, { client_id: 'c1', payload: null }], () => 'CTS', '2026-11-09')).toEqual([])
  })

  it('still armed / claimed after its day = no run reached it → to-do; on the day itself → not yet', () => {
    const rows = ['armed', 'claimed'].map((s) => ({ client_id: 'c1', payload: grant(s) }))
    expect(buildReelScheduledItems(rows, () => 'CTS', '2026-11-09')).toHaveLength(0)
    const late = buildReelScheduledItems(rows, () => 'CTS', '2026-11-10')
    expect(late).toHaveLength(2)
    for (const item of late) expect(item.what).toContain('过了发布日')
  })

  it('published but first comment failed → to-do; published fine → none', () => {
    const failedComment = { ...grant('consumed', { reason: 'first_comment_failed' }), promote_authorization: { first_comment_status: 'failed' } }
    const retried = { ...grant('consumed', { reason: 'first_comment_failed' }), promote_authorization: { first_comment_status: 'ok' } }
    const items = buildReelScheduledItems([
      { client_id: 'c1', payload: failedComment },
      { client_id: 'c1', payload: retried },
      { client_id: 'c1', payload: grant('consumed', { reason: 'promoted' }) },
    ], () => 'CTS', '2026-11-12')
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('订团链接')
    expect(items[0].href).toContain('/dashboard/factory')
  })
})
