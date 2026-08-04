import { describe, it, expect } from 'vitest'
import { classifyNote } from '../note-parser'
import { segmentContact, todayWorklist, type ContactLike, type TouchpointLike } from '../segments'

/**
 * 甲方 2026-07-30 的线上反馈，逐条锁住。
 * 每个用例对应反馈里的一条，改坏了直接红。
 */

const NOW = new Date('2026-07-30T09:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

function contact(tps: TouchpointLike[], over: Partial<ContactLike> = {}): ContactLike {
  return {
    id: 'c1',
    displayName: '测试联系人',
    doNotContact: false,
    touchpoints: tps,
    ...over,
  }
}

const call = (daysBack: number, over: Partial<TouchpointLike> = {}): TouchpointLike => ({
  channel: 'phone',
  direction: 'outbound',
  occurredAt: daysAgo(daysBack),
  ...over,
})

describe('反馈 6：不可能的回电时间不该出现在名单上', () => {
  it('逾期超过 14 天的约定回电不再判为「该回电了」', () => {
    // CTS 线上 23 条 callback_at 全部落在 30 天前，最早 2023-07-07，
    // 名单显示「该回电了 · 1118 天前」。这种几乎必然是留言解析漏了年份。
    const seg = segmentContact(
      contact([call(400, { callbackAt: daysAgo(1118) })]),
      NOW,
    )
    expect(seg.segment).not.toBe('callback_due')
  })

  it('正常逾期（3 天前约的）仍然要进「该回电了」', () => {
    const seg = segmentContact(contact([call(5, { callbackAt: daysAgo(3) })]), NOW)
    expect(seg.segment).toBe('callback_due')
  })

  it('同一个人被改约多次时，按最后一次约定，不翻旧账', () => {
    const seg = segmentContact(
      contact([
        call(10, { callbackAt: daysAgo(9) }),
        call(2, { callbackAt: daysAgo(1) }),
      ]),
      NOW,
    )
    expect(seg.segment).toBe('callback_due')
    expect(seg.dueAt).toBe(daysAgo(1))
  })
})

describe('反馈 8：中文的「不感兴趣」要能识别', () => {
  it.each([
    '客户对旅游不感兴趣。',
    '客人没兴趣，不用再跟了',
    '说不想去了',
    '已经在别家订了',
    '找了另一家',
  ])('「%s」判为不再联系', (note) => {
    expect(classifyNote(note).outcome).toBe('not_interested')
  })

  it('英文原有判定不受影响', () => {
    expect(classifyNote('Not interested, thanks').outcome).toBe('not_interested')
  })

  it('普通备注不会被误判', () => {
    expect(classifyNote('客户很感兴趣，想要 5 月的行程').outcome).not.toBe('not_interested')
  })

  it('判为 not_interested 的人被排除出名单', () => {
    const seg = segmentContact(
      contact([call(2, { outcome: 'not_interested' })]),
      NOW,
    )
    expect(seg.segment).toBe('excluded')
    expect(seg.temperature).toBe('off')
  })
})

describe('反馈 1：名单排序', () => {
  const inbound = (daysBack: number): TouchpointLike => ({
    channel: 'meta_lead_form',
    direction: 'inbound',
    occurredAt: daysAgo(daysBack),
  })

  it('热线索桶（新客人）：最近进线的排前面', () => {
    // 线索会凉 —— 今天填表的人今天打最容易接
    const fresh = contact([inbound(1)], { id: 'fresh' })
    const old = contact([inbound(90)], { id: 'old' })

    const ids = todayWorklist([old, fresh], NOW).map((r) => r.id)
    expect(ids.indexOf('fresh')).toBeLessThan(ids.indexOf('old'))
  })

  it('回捞桶（打过没人接 / 聊过没下文）：等得最久的仍排前面', () => {
    // 这批人单独成桶就是为了防止沉底，按最近排等于让老线索永远轮不到。
    // 两个方向共存是有意的设计，不是遗漏。
    const recent = contact([call(3)], { id: 'recent' })
    const ancient = contact([call(120)], { id: 'ancient' })

    const ranked = todayWorklist([recent, ancient], NOW)
    // 前提：这两个都不在热线索桶里
    expect(FRESH_FIRST.has(ranked[0].seg.segment)).toBe(false)

    const ids = ranked.map((r) => r.id)
    expect(ids.indexOf('ancient')).toBeLessThan(ids.indexOf('recent'))
  })
})

/** 与 segments.ts 里的 FRESH_FIRST_SEGMENTS 保持一致（那个不导出）。 */
const FRESH_FIRST = new Set(['replied', 'new_untouched'])

describe('反馈：时长要说人话，不能是「835 小时」', () => {
  const seg = (tps: TouchpointLike[]) => segmentContact(contact(tps), NOW)

  it('超过两天的用「天」，不再用小时', () => {
    const r = seg([{ channel: 'meta_lead_form', direction: 'inbound', occurredAt: daysAgo(34) }])
    expect(r.reason).toContain('34 天')
    expect(r.reason).not.toContain('小时')
  })

  it('两天以内仍然用「小时」—— 今天/昨天的事，小时才有意义', () => {
    const r = seg([{ channel: 'meta_lead_form', direction: 'inbound', occurredAt: daysAgo(1) }])
    expect(r.reason).toContain('小时')
    expect(r.reason).not.toContain('天')
  })

  it('刚进线不到一小时不显示「0 小时」', () => {
    const justNow = new Date(NOW.getTime() - 10 * 60_000).toISOString()
    const r = seg([{ channel: 'meta_lead_form', direction: 'inbound', occurredAt: justNow }])
    expect(r.reason).toContain('不到 1 小时')
  })
})
