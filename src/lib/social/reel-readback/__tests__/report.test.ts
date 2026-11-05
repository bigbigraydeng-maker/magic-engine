import { describe, expect, it } from 'vitest'
import { buildReelReadback, workOrderIdOf, type ReelMeta } from '../report'
import { buildSuggestion } from '../suggest'
import type { PublishActionRow, ReceiptRow } from '@/lib/social/post-performance'

const NOW = new Date('2026-11-20T00:00:00Z')
const meta = (id: string, template: string | null = 'postcard', pillar: string | null = null): ReelMeta => ({ id, title: `t-${id}`, template, pillar })
// The real factory-reel action keeps its work order only inside idempotency_key (factory-reel-measurement-adapter.ts), never as work_order_id.
const action = (id: string, wo: string, publishedAt: string): PublishActionRow => ({ id, executed_at: publishedAt, payload: { source: 'factory_reel', idempotency_key: `factory-reel:${wo}:vid-${id}`, published_at: publishedAt, permalink: `https://fb/${wo}` } })
const receipt = (actionId: string, hours: number, values: Record<string, number>, status = 'ok', extra: Partial<ReceiptRow> = {}): ReceiptRow => ({ action_id: actionId, window_hours: hours, status, measured_at: null, values, missing: null, reason: null, ...extra })

describe('workOrderIdOf', () => {
  it('reads the id out of the real idempotency_key, prefers an explicit work_order_id, and refuses anything else', () => {
    expect(workOrderIdOf({ idempotency_key: 'factory-reel:wo-1:vid-9' })).toBe('wo-1')
    expect(workOrderIdOf({ work_order_id: 'wo-2', idempotency_key: 'factory-reel:wo-1:vid-9' })).toBe('wo-2')
    expect(workOrderIdOf({ idempotency_key: 'daily-plan:abc' })).toBeNull()
    expect(workOrderIdOf({})).toBeNull()
  })
})

describe('buildReelReadback', () => {
  it('two videos of one work order stay two rows with their own action ids', () => {
    const { items } = buildReelReadback({ actions: [action('a1', 'w1', '2026-11-10T00:00:00Z'), action('a2', 'w1', '2026-11-11T00:00:00Z')], receipts: [], metas: new Map([['w1', meta('w1')]]), now: NOW })
    expect(items.map((i) => i.action_id)).toEqual(['a2', 'a1'])
  })

  it('just past 72 hours with no receipt yet still counts as on its way, not unreadable', () => {
    const { items } = buildReelReadback({ actions: [action('a1', 'w1', '2026-11-16T22:00:00Z')], receipts: [], metas: new Map([['w1', meta('w1')]]), now: new Date('2026-11-20T00:00:00Z') })
    expect(items[0].status).toBe('pending')
  })

  it('reads the 72h receipt, sums engagement, and keeps newest first', () => {
    const { items } = buildReelReadback({
      actions: [action('a1', 'w1', '2026-11-10T00:00:00Z'), action('a2', 'w2', '2026-11-12T00:00:00Z')],
      receipts: [receipt('a1', 72, { likes: 5, comments: 2, shares: 1 }), receipt('a1', 4, { likes: 1, comments: 0, shares: 0 }), receipt('a2', 72, { likes: 1, comments: 0, shares: 0 })],
      metas: new Map([['w1', meta('w1')], ['w2', meta('w2')]]), now: NOW,
    })
    expect(items.map((i) => i.work_order_id)).toEqual(['w2', 'w1'])
    expect(items[1]).toMatchObject({ status: 'measured', engagement: { kind: 'value', value: 8 } })
  })

  it('a reel younger than 72h is pending, not zero', () => {
    const { items } = buildReelReadback({ actions: [action('a1', 'w1', '2026-11-19T00:00:00Z')], receipts: [receipt('a1', 4, { likes: 1, comments: 0, shares: 0 })], metas: new Map([['w1', meta('w1')]]), now: NOW })
    expect(items[0]).toMatchObject({ status: 'pending', engagement: { kind: 'not_readable' }, likes: { kind: 'not_readable' } })
  })

  it('an old reel with no readable 72h receipt says so (not 0)', () => {
    const { items } = buildReelReadback({ actions: [action('a1', 'w1', '2026-11-10T00:00:00Z')], receipts: [receipt('a1', 72, {}, 'unmeasurable', { reason: 'token_expired' })], metas: new Map([['w1', meta('w1')]]), now: NOW })
    expect(items[0]).toMatchObject({ status: 'not_readable' })
    expect(items[0].note).toContain('token_expired')
    expect(items[0].engagement.kind).toBe('not_readable')
  })

  it('one unreadable metric makes engagement unreadable, the other numbers stay', () => {
    const { items } = buildReelReadback({ actions: [action('a1', 'w1', '2026-11-10T00:00:00Z')], receipts: [receipt('a1', 72, { likes: 3, comments: 1 }, 'partial', { missing: { shares: 'no_permission' } })], metas: new Map([['w1', meta('w1')]]), now: NOW })
    expect(items[0].likes).toEqual({ kind: 'value', value: 3 })
    expect(items[0].shares).toEqual({ kind: 'not_readable', reason: 'no_permission' })
    expect(items[0].engagement).toEqual({ kind: 'not_readable', reason: 'incomplete' })
  })

  it('an action whose work order is unknown is counted, not shown', () => {
    const out = buildReelReadback({ actions: [action('a1', 'ghost', '2026-11-10T00:00:00Z')], receipts: [], metas: new Map(), now: NOW })
    expect(out).toEqual({ items: [], unmatched: 1 })
  })
})

describe('buildSuggestion', () => {
  const measured = (i: number, template: string, value: number) => buildReelReadback({
    actions: [action(`a${i}`, `w${i}`, '2026-11-10T00:00:00Z')],
    receipts: [receipt(`a${i}`, 72, { likes: value, comments: 0, shares: 0 })],
    metas: new Map([[`w${i}`, meta(`w${i}`, template)]]), now: NOW,
  }).items[0]

  it('fewer than 6 measured reels: no advice, and it says why', () => {
    const s = buildSuggestion([measured(1, 'a', 5), measured(2, 'a', 5)])
    expect(s.status).toBe('not_enough_data')
    expect(s.lines[0]).toContain('样本太少')
  })

  it('a template at 1.5x or more is "more", at 0.5x or less is "less", groups under 3 reels are silent', () => {
    const items = [
      ...[1, 2, 3].map((i) => measured(i, 'hot', 20)),
      ...[4, 5, 6].map((i) => measured(i, 'cold', 2)),
      ...[7, 8, 9].map((i) => measured(i, 'mid', 8)),
      measured(10, 'single', 10),
    ]
    const s = buildSuggestion(items)
    expect(s.status).toBe('ok')
    const verdicts = Object.fromEntries(s.groups.map((g) => [g.key, g.verdict]))
    expect(verdicts).toEqual({ hot: 'more', cold: 'less', mid: 'keep' })
    expect(s.groups.find((g) => g.key === 'single')).toBeUndefined()
    expect(s.lines.join('\n')).toContain('多做')
  })

  it('all-zero reels are flagged, one hit reel cannot lift a group (median), and one work order counts once', () => {
    const zeros = buildSuggestion([1, 2, 3, 4, 5, 6].map((i) => measured(i, 'a', 0)))
    expect(zeros).toMatchObject({ status: 'not_enough_data', all_zero: true })
    const hit = buildSuggestion([...[1, 2, 3].map((i) => measured(i, 'x', i === 3 ? 100 : 1)), ...[4, 5, 6].map((i) => measured(i, 'y', 1))])
    expect(hit.groups.find((g) => g.key === 'x')?.verdict).not.toBe('more')
    const twice = buildReelReadback({
      actions: [action('d1', 'dup', '2026-11-10T00:00:00Z'), action('d2', 'dup', '2026-11-11T00:00:00Z')],
      receipts: [receipt('d1', 72, { likes: 9, comments: 0, shares: 0 }), receipt('d2', 72, { likes: 9, comments: 0, shares: 0 })],
      metas: new Map([['dup', meta('dup')]]), now: NOW,
    }).items
    expect(buildSuggestion(twice).measured).toBe(1)
  })

  it('reels without a readable 72h number do not count as zero', () => {
    const unread = buildReelReadback({ actions: [action('u', 'wu', '2026-11-10T00:00:00Z')], receipts: [], metas: new Map([['wu', meta('wu', 'hot')]]), now: NOW }).items
    const s = buildSuggestion([...[1, 2, 3, 4, 5, 6].map((i) => measured(i, 'a', 10)), ...unread])
    expect(s.measured).toBe(6)
  })
})
