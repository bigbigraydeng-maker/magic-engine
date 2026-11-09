import { describe, it, expect } from 'vitest'
import { buildJourney, type JourneyTouch, type JourneyNode, type JourneyItem } from '../returning-journey'
import type { ReturningLead } from '../returning-lead'

const NOW = new Date('2026-10-27T01:00:00Z')
const TZ = 'Pacific/Auckland'

function t(
  channel: string,
  direction: 'inbound' | 'outbound',
  iso: string,
  extra: Partial<JourneyTouch> = {},
): JourneyTouch {
  return { channel, direction, occurredAt: iso, ...extra }
}

const INFO: ReturningLead = {
  firstEnquiryAt: '2026-06-15T07:55:00.000Z',
  latestFormAt: '2026-10-26T23:47:00.000Z',
  ourLastContactAt: '2026-10-24T01:11:00.000Z',
  ourContacts: 3,
  earlierForms: 1,
}

function realShape(): JourneyTouch[] {
  return [
    t('meta_lead_form', 'inbound', '2026-06-15T07:55:00.000Z', {
      tour: 'still_deciding_—_show_me_all_4',
    }),
    t('phone', 'outbound', '2026-06-15T07:55:00.000Z', { unansweredCall: true }),
    t('messenger', 'outbound', '2026-06-15T07:55:00.000Z'),
    t('messenger', 'inbound', '2026-06-15T07:57:00.000Z'),
    t('email', 'inbound', '2026-10-08T07:51:00.000Z', { engagement: 'click' }),
    t('email', 'outbound', '2026-10-09T08:47:00.000Z'),
    t('email', 'outbound', '2026-10-24T01:11:00.000Z'),
    t('meta_lead_form', 'inbound', '2026-10-26T23:47:00.000Z', {
      tour: 'best_of_china_–_15_days',
    }),
    t('email', 'inbound', '2026-07-08T16:10:00.000Z', { engagement: 'open' }),
    t('email', 'outbound', '2026-07-09T00:00:00.000Z', { automated: true }),
  ]
}

function nodesOf(items: JourneyItem[]): JourneyNode[] {
  return items.filter((i): i is { type: 'node'; node: JourneyNode } => i.type === 'node').map((i) => i.node)
}

describe('buildJourney', () => {
  it('real shape: node order and shape', () => {
    const j = buildJourney(realShape(), INFO, NOW, TZ)
    const nodes = nodesOf(j.items)
    expect(nodes[0].label).toBe('客人填表')
    expect(nodes[0].detail).toContain('想选：Still deciding')
    const last = nodes[nodes.length - 1]
    expect(last.label).toBe('客人填表')
    expect(last.highlight).toBe(true)
    expect(last.dayLabel).toBe('今天')
  })

  it('open and automated emails never appear', () => {
    const j = buildJourney(realShape(), INFO, NOW, TZ)
    const nodes = nodesOf(j.items)
    expect(nodes.some((n) => n.at === '2026-07-08T16:10:00.000Z')).toBe(false)
    expect(nodes.some((n) => n.at === '2026-07-09T00:00:00.000Z')).toBe(false)
  })

  it('same-day merging respects actor+kind', () => {
    const j = buildJourney(realShape(), INFO, NOW, TZ)
    const nodes = nodesOf(j.items)
    const phoneUnanswered = nodes.find((n) => n.kind === 'phone_unanswered')
    expect(phoneUnanswered?.count).toBe(1)
    const usMessenger = nodes.find((n) => n.kind === 'messenger' && n.actor === 'us')
    expect(usMessenger?.count).toBe(1)
    const custMessenger = nodes.find((n) => n.kind === 'message' && n.actor === 'customer')
    expect(custMessenger?.count).toBe(1)
  })

  it('two outbound emails on same day merge into one node with count 2', () => {
    const touches = [
      t('email', 'outbound', '2026-10-24T01:00:00.000Z'),
      t('email', 'outbound', '2026-10-24T02:00:00.000Z'),
    ]
    const j = buildJourney(touches, null, NOW, TZ)
    const nodes = nodesOf(j.items)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].count).toBe(2)
  })

  it('gap between 06-15 and 10-08 is ~115 days with 约 4 个月 label; no gap 10-24 to 10-26', () => {
    const j = buildJourney(realShape(), INFO, NOW, TZ)
    const gaps = j.items.filter((i): i is { type: 'gap'; days: number; label: string } => i.type === 'gap')
    const big = gaps.find((g) => g.days > 100)
    expect(big).toBeDefined()
    expect(big!.days).toBeGreaterThanOrEqual(114)
    expect(big!.days).toBeLessThanOrEqual(116)
    expect(big!.label.startsWith('隔了 约 4 个月')).toBe(true)
    expect(gaps.some((g) => g.days === 2)).toBe(false)
  })

  it('gap label below 60 days uses days', () => {
    const touches = [
      t('email', 'outbound', '2026-10-01T00:00:00.000Z'),
      t('email', 'outbound', '2026-10-21T00:00:00.000Z'),
    ]
    const j = buildJourney(touches, null, NOW, TZ)
    const gap = j.items.find((i): i is { type: 'gap'; days: number; label: string } => i.type === 'gap')
    expect(gap).toBeDefined()
    expect(gap!.days).toBe(20)
    expect(gap!.label).toBe('隔了 20 天')
  })

  it('reasons on real shape', () => {
    const j = buildJourney(realShape(), INFO, NOW, TZ)
    expect(j.reasons).toContain('主动再填表')
    expect(j.reasons).toContain('点过我们邮件里的链接')
    expect(j.reasons.some((r) => r.startsWith('隔了') && r.endsWith('又回来'))).toBe(false)
    expect(j.reasons).toContain('这次选的团和上次不一样')
    expect(j.reasons).toContain('我们联系过 3 次，他仍主动回来')
  })

  it('tourChange on real shape', () => {
    const j = buildJourney(realShape(), INFO, NOW, TZ)
    expect(j.tourChange).toEqual({
      from: 'Still deciding — show me all 4',
      to: 'Best of china – 15 days',
    })
  })

  it('silence reason present when >= 30 days before latest form', () => {
    const touches = [
      t('messenger', 'inbound', '2026-06-15T00:00:00.000Z'),
      t('email', 'outbound', '2026-06-20T00:00:00.000Z'),
      t('meta_lead_form', 'inbound', '2026-10-26T23:47:00.000Z', { tour: 'best_of_china_–_15_days' }),
    ]
    const j = buildJourney(touches, INFO, NOW, TZ)
    expect(j.reasons).toContain('隔了 约 4 个月 又回来')
  })

  it('same tour with different punctuation/case → no tourChange', () => {
    const touches = [
      t('meta_lead_form', 'inbound', '2026-06-15T00:00:00.000Z', { tour: 'best_of_china_–_15_days' }),
      t('meta_lead_form', 'inbound', '2026-10-26T23:47:00.000Z', { tour: 'Best Of China 15 Days' }),
    ]
    const j = buildJourney(touches, INFO, NOW, TZ)
    expect(j.tourChange).toBeNull()
    expect(j.reasons).not.toContain('这次选的团和上次不一样')
  })

  it('info null → empty reasons and null tourChange but items still built', () => {
    const j = buildJourney(realShape(), null, NOW, TZ)
    expect(j.reasons).toEqual([])
    expect(j.tourChange).toBeNull()
    expect(j.items.length).toBeGreaterThan(0)
  })

  it('cap: 20 nodes with maxNodes 12 → one omitted with count 8', () => {
    const touches: JourneyTouch[] = []
    for (let i = 0; i < 20; i++) {
      const day = String(i + 1).padStart(2, '0')
      touches.push(t('email', 'outbound', `2026-09-${day}T00:00:00.000Z`))
    }
    const j = buildJourney(touches, null, NOW, TZ, 12)
    expect(j.totalNodes).toBe(20)
    const omitted = j.items.filter((i): i is { type: 'omitted'; count: number; label: string } => i.type === 'omitted')
    expect(omitted).toHaveLength(1)
    expect(omitted[0].count).toBe(8)
    const nodes = nodesOf(j.items)
    expect(nodes).toHaveLength(12)
    expect(nodes[0].at).toBe('2026-09-01T00:00:00.000Z')
    expect(nodes[1].at).toBe('2026-09-02T00:00:00.000Z')
    expect(nodes[nodes.length - 1].at).toBe('2026-09-20T00:00:00.000Z')
  })

  it('no touches does not throw', () => {
    const j = buildJourney([], null, NOW, TZ)
    expect(j.items).toEqual([])
    expect(j.totalNodes).toBe(0)
    expect(j.reasons).toEqual([])
  })

  it('unparseable date is ignored', () => {
    const touches = [
      t('email', 'outbound', 'not-a-date'),
      t('email', 'outbound', '2026-10-24T01:00:00.000Z'),
    ]
    const j = buildJourney(touches, null, NOW, TZ)
    expect(j.totalNodes).toBe(1)
  })

  it('calling twice yields deep-equal results', () => {
    const a = buildJourney(realShape(), INFO, NOW, TZ)
    const b = buildJourney(realShape(), INFO, NOW, TZ)
    expect(a).toEqual(b)
  })

  it('calendar day uses given time zone, not UTC', () => {
    const touches = [
      t('email', 'outbound', '2026-10-24T10:00:00.000Z'),
      t('email', 'outbound', '2026-10-24T12:30:00.000Z'),
    ]
    const j = buildJourney(touches, null, NOW, TZ)
    expect(j.totalNodes).toBe(2)
  })

  it('我们只联系过 1 次时不写「联系过 N 次」这条原因', () => {
    const j = buildJourney(realShape(), { ...INFO, ourContacts: 1 }, NOW, TZ)
    expect(j.reasons.some((r) => r.includes('我们联系过'))).toBe(false)
    const j2 = buildJourney(realShape(), { ...INFO, ourContacts: 2 }, NOW, TZ)
    expect(j2.reasons).toContain('我们联系过 2 次，他仍主动回来')
  })

  it('同一天填了两张表：节点上写最晚那张的团，与输入顺序无关', () => {
    const early = t('web_form', 'inbound', '2026-10-26T20:00:00.000Z', { tour: 'silk_road' })
    const late = t('web_form', 'inbound', '2026-10-26T23:47:00.000Z', { tour: 'best_of_china_–_15_days' })
    for (const order of [[early, late], [late, early]]) {
      const j = buildJourney(order, INFO, NOW, TZ)
      const form = j.items.flatMap((i) => (i.type === 'node' ? [i.node] : []))[0]
      expect(form.count).toBe(2)
      expect(form.detail).toContain('Best of china')
    }
  })
})
