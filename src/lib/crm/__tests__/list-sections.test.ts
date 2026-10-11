/**
 * list-sections 是「全部客人」页两张名单视图的心。它漏一个 Segment × 意向组合，
 * 那批客人就在页面上凭空消失（2026-08-02 33 人事故形态）。
 */
import { describe, expect, it } from 'vitest'
import {
  SECTION_KEYS,
  buildSections,
  compareRanked,
  sectionMeta,
  type RankedContact,
  type SectionKey,
} from '../list-sections'
import { INTENT_LEVELS, listOf, type IntentLevel } from '../next-action'
import type { Segment, SegmentResult } from '../segments'
import { SEGMENT_META } from '../segments'

function seg(segment: Segment, over: Partial<SegmentResult> = {}): SegmentResult {
  return {
    segment,
    temperature: SEGMENT_META[segment].temperature,
    priority: SEGMENT_META[segment].priority,
    lastTouchAt: '2026-09-01T00:00:00.000Z',
    ...over,
  } as SegmentResult
}

function rk(id: string, segment: Segment, over: Partial<RankedContact> = {}): RankedContact {
  return { contactId: id, seg: seg(segment), pinnedAt: null, intent: null, ...over }
}

const row = (r: RankedContact) => ({ id: r.contactId, segment: r.seg.segment })

const ALL_SEGMENTS = Object.keys(SEGMENT_META) as Segment[]
const ALL_INTENTS: (IntentLevel | null)[] = [...INTENT_LEVELS, null]

describe('穷举：每个 Segment × 每个意向（含 null）都落进 hot 或 cold（防漏组合消失）', () => {
  it.each(ALL_SEGMENTS)('%s → 每个意向都落进两张名单之一', (s) => {
    for (const i of ALL_INTENTS) {
      expect(SECTION_KEYS).toContain(listOf(s, i))
    }
  })
})

describe('hot + cold 总数 = 输入总数', () => {
  it('每个 Segment × 意向各来一个人，两段 total 之和等于输入人数', () => {
    const contacts: RankedContact[] = []
    for (const s of ALL_SEGMENTS) {
      for (const i of ALL_INTENTS) {
        contacts.push(rk(`${s}-${i ?? 'null'}`, s, { intent: i }))
      }
    }
    const { sections } = buildSections(contacts, { open: { hot: true, cold: true }, getRow: row })
    const sum = sections.reduce((acc, s) => acc + s.total, 0)
    expect(sum).toBe(contacts.length)
  })
})

describe('意向不动人：stale_conversation 对每个意向都留在 cold', () => {
  it('high / medium / low / unknown / null 全部 → cold', () => {
    expect(listOf('stale_conversation', 'high')).toBe('cold')
    expect(listOf('stale_conversation', 'medium')).toBe('cold')
    expect(listOf('stale_conversation', 'low')).toBe('cold')
    expect(listOf('stale_conversation', 'unknown')).toBe('cold')
    expect(listOf('stale_conversation', null)).toBe('cold')
  })
})

describe('sectionMeta', () => {
  it('文案来自 LIST_META', () => {
    expect(sectionMeta('hot').title).toBe('今天要联系')
    expect(sectionMeta('cold').title).toBe('先放着')
  })
})

describe('compareRanked', () => {
  it('置顶在前；两位都置顶时按 pinnedAt 倒序', () => {
    const a = rk('a', 'replied', { pinnedAt: '2026-09-01T00:00:00Z' })
    const b = rk('b', 'replied', { pinnedAt: '2026-09-02T00:00:00Z' })
    const c = rk('c', 'replied', { pinnedAt: null })
    expect([a, b, c].sort(compareRanked).map((r) => r.contactId)).toEqual(['b', 'a', 'c'])
  })

  it('都不置顶按 compareNextAction：约好回电的最前，其余同一时间点的按引擎优先级', () => {
    const a = rk('a', 'replied') // priority 1
    const b = rk('b', 'callback_due') // 我们答应过的事，永远最前
    const c = rk('c', 'new_untouched') // priority 4
    expect([c, b, a].sort(compareRanked).map((r) => r.contactId)).toEqual(['b', 'a', 'c'])
  })

  it('意向不影响排序：同样的两个人，一个 high 一个 low → 0', () => {
    const a = rk('a', 'stale_conversation', { intent: 'high' })
    const b = rk('b', 'stale_conversation', { intent: 'low' })
    expect(compareRanked(a, b)).toBe(0)
  })
})

describe('buildSections — 装桶 / 分页 / focus', () => {
  it('默认 hot 展开、cold 收起（收起时 items = null）', () => {
    const contacts: RankedContact[] = [
      rk('r1', 'replied'),
      rk('c1', 'clicked_link'),
      rk('n1', 'new_untouched'),
      rk('s1', 'stale_conversation'),
      rk('e1', 'excluded'),
    ]
    const { sections } = buildSections(contacts, { getRow: row })
    const byKey = Object.fromEntries(sections.map((s) => [s.key, s])) as Record<SectionKey, (typeof sections)[number]>
    expect(byKey.hot.open).toBe(true)
    expect(byKey.hot.items).not.toBeNull()
    expect(byKey.cold.open).toBe(false)
    expect(byKey.cold.items).toBeNull()
  })

  it('每段独立 total（不受展开 / 分页影响）', () => {
    const contacts: RankedContact[] = [
      rk('a', 'replied'),
      rk('b', 'replied'),
      rk('c', 'new_untouched'),
      rk('d', 'handoff_sop'),
      rk('e', 'excluded'),
      rk('f', 'excluded'),
    ]
    const { sections } = buildSections(contacts, { getRow: row })
    const byKey = Object.fromEntries(sections.map((s) => [s.key, s]))
    expect(byKey.hot.total).toBe(3)
    expect(byKey.cold.total).toBe(3)
  })

  it('段内分页：perPage=2、page=2 → 展开的段返回该页 items', () => {
    const contacts: RankedContact[] = ['r1', 'r2', 'r3', 'r4', 'r5'].map((id) => rk(id, 'replied'))
    const { sections } = buildSections(contacts, {
      perPage: 2,
      page: { hot: 2 },
      getRow: row,
    })
    const hot = sections.find((s) => s.key === 'hot')!
    expect(hot.total).toBe(5)
    expect(hot.page).toBe(2)
    expect(hot.items).toHaveLength(2)
  })

  it('open 覆盖默认：cold 显式展开 → items 出现', () => {
    const contacts: RankedContact[] = [rk('x', 'nurture_future')]
    const { sections } = buildSections(contacts, {
      open: { cold: true },
      getRow: row,
    })
    const cold = sections.find((s) => s.key === 'cold')!
    expect(cold.open).toBe(true)
    expect(cold.items).toEqual([{ id: 'x', segment: 'nurture_future' }])
  })

  it('focus 命中某人 → 返回他所在段与 1-based 页；页内位置正确', () => {
    const contacts: RankedContact[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => rk(id, 'excluded'))
    const { focus } = buildSections(contacts, { focusContactId: 'e', perPage: 3, getRow: row })
    expect(focus.found).toBe(true)
    expect(focus.section).toBe('cold')
    // e 在排好序里索引 4，perPage=3 → 第 2 页
    expect(focus.page).toBe(2)
  })

  it('focus 没命中 → found=false，不抛错', () => {
    const contacts: RankedContact[] = [rk('a', 'replied')]
    const { focus } = buildSections(contacts, { focusContactId: 'ghost', getRow: row })
    expect(focus.found).toBe(false)
  })

  it('empty → 两段都是 total=0；hot items=[]，cold items=null', () => {
    const { sections } = buildSections([], { getRow: row })
    expect(sections.map((s) => s.total)).toEqual([0, 0])
    const byKey = Object.fromEntries(sections.map((s) => [s.key, s]))
    expect(byKey.hot.items).toEqual([])
    expect(byKey.cold.items).toBeNull()
  })

  it('sections 顺序固定为 hot / cold', () => {
    const { sections } = buildSections([], { getRow: row })
    expect(sections.map((s) => s.key)).toEqual(['hot', 'cold'])
  })
})
