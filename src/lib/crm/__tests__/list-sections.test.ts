/**
 * list-sections 是「全部客人」页 4 段视图的心。它漏一个 Segment，
 * 那批客人就在页面上凭空消失（2026-08-02 33 人事故形态）。
 */
import { describe, expect, it } from 'vitest'
import {
  SECTION_OF_SEGMENT,
  buildSections,
  compareRanked,
  sectionMeta,
  type RankedContact,
  type SectionKey,
} from '../list-sections'
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
  return { contactId: id, seg: seg(segment), pinnedAt: null, ...over }
}

const row = (r: RankedContact) => ({ id: r.contactId, segment: r.seg.segment })

describe('SECTION_OF_SEGMENT — 穷举每一个 Segment 都必须能落进一段（防漏段消失）', () => {
  const allSegments = Object.keys(SEGMENT_META) as Segment[]
  it.each(allSegments)('%s → 已配置对应段', (s) => {
    const key = SECTION_OF_SEGMENT[s]
    expect(key).toBeTruthy()
    expect(['waiting', 'acted', 'queued', 'off_list']).toContain(key)
  })

  it('nurture_future 和 excluded 都进 off_list', () => {
    expect(SECTION_OF_SEGMENT.nurture_future).toBe('off_list')
    expect(SECTION_OF_SEGMENT.excluded).toBe('off_list')
  })
})

describe('sectionMeta', () => {
  it('前三段的文案取自 LAYER_META（同今天页）', () => {
    expect(sectionMeta('waiting').title).toBeTruthy()
    expect(sectionMeta('waiting').hint).toBeTruthy()
    expect(sectionMeta('acted').title).toBeTruthy()
    expect(sectionMeta('queued').title).toBeTruthy()
  })

  it('off_list 自己一套文案', () => {
    expect(sectionMeta('off_list').title).toContain('不在今天名单')
  })
})

describe('compareRanked', () => {
  it('置顶在前；两位都置顶时按 pinnedAt 倒序', () => {
    const a = rk('a', 'replied', { pinnedAt: '2026-09-01T00:00:00Z' })
    const b = rk('b', 'replied', { pinnedAt: '2026-09-02T00:00:00Z' })
    const c = rk('c', 'replied', { pinnedAt: null })
    expect([a, b, c].sort(compareRanked).map((r) => r.contactId)).toEqual(['b', 'a', 'c'])
  })

  it('都不置顶按 compareForWorklist（优先级小的在前）', () => {
    const a = rk('a', 'replied') // priority 1
    const b = rk('b', 'callback_due') // priority 2
    const c = rk('c', 'new_untouched') // priority 4
    expect([c, b, a].sort(compareRanked).map((r) => r.contactId)).toEqual(['a', 'b', 'c'])
  })
})

describe('buildSections — 装桶 / 分页 / focus', () => {
  it('默认前两段展开、后两段收起（收起时 items = null）', () => {
    const contacts: RankedContact[] = [
      rk('r1', 'replied'),
      rk('c1', 'clicked_link'),
      rk('n1', 'new_untouched'),
      rk('s1', 'stale_conversation'),
      rk('e1', 'excluded'),
    ]
    const { sections } = buildSections(contacts, { getRow: row })
    const byKey = Object.fromEntries(sections.map((s) => [s.key, s])) as Record<SectionKey, (typeof sections)[number]>
    expect(byKey.waiting.open).toBe(true)
    expect(byKey.waiting.items).not.toBeNull()
    expect(byKey.acted.open).toBe(true)
    expect(byKey.queued.open).toBe(false)
    expect(byKey.queued.items).toBeNull()
    expect(byKey.off_list.open).toBe(false)
    expect(byKey.off_list.items).toBeNull()
  })

  it('每段独立 total（不受展开 / 分页影响）', () => {
    const contacts: RankedContact[] = [
      rk('a', 'replied'),
      rk('b', 'replied'),
      rk('c', 'new_untouched'),
      rk('d', 'stale_conversation'),
      rk('e', 'excluded'),
      rk('f', 'nurture_future'),
    ]
    const { sections } = buildSections(contacts, { getRow: row })
    const byKey = Object.fromEntries(sections.map((s) => [s.key, s]))
    expect(byKey.waiting.total).toBe(2)
    expect(byKey.acted.total).toBe(1)
    expect(byKey.queued.total).toBe(1)
    expect(byKey.off_list.total).toBe(2)
  })

  it('段内分页：perPage=2、page=2 → 展开的段返回该页 items', () => {
    const contacts: RankedContact[] = ['r1', 'r2', 'r3', 'r4', 'r5'].map((id) => rk(id, 'replied'))
    const { sections } = buildSections(contacts, {
      perPage: 2,
      page: { waiting: 2 },
      getRow: row,
    })
    const waiting = sections.find((s) => s.key === 'waiting')!
    expect(waiting.total).toBe(5)
    expect(waiting.page).toBe(2)
    expect(waiting.items).toHaveLength(2)
  })

  it('open 覆盖默认：off_list 显式展开 → items 出现', () => {
    const contacts: RankedContact[] = [rk('x', 'nurture_future')]
    const { sections } = buildSections(contacts, {
      open: { off_list: true },
      getRow: row,
    })
    const off = sections.find((s) => s.key === 'off_list')!
    expect(off.open).toBe(true)
    expect(off.items).toEqual([{ id: 'x', segment: 'nurture_future' }])
  })

  it('focus 命中某人 → 返回他所在段与 1-based 页；页内位置正确', () => {
    const contacts: RankedContact[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => rk(id, 'replied'))
    const { focus } = buildSections(contacts, { focusContactId: 'e', perPage: 3, getRow: row })
    expect(focus.found).toBe(true)
    expect(focus.section).toBe('waiting')
    // e 在排好序里索引 4，perPage=3 → 第 2 页
    expect(focus.page).toBe(2)
  })

  it('focus 没命中 → found=false，不抛错', () => {
    const contacts: RankedContact[] = [rk('a', 'replied')]
    const { focus } = buildSections(contacts, { focusContactId: 'ghost', getRow: row })
    expect(focus.found).toBe(false)
  })

  it('empty → 4 段都是 total=0；展开的两段 items=[]', () => {
    const { sections } = buildSections([], { getRow: row })
    expect(sections.map((s) => s.total)).toEqual([0, 0, 0, 0])
    const byKey = Object.fromEntries(sections.map((s) => [s.key, s]))
    expect(byKey.waiting.items).toEqual([])
    expect(byKey.acted.items).toEqual([])
    expect(byKey.queued.items).toBeNull()
    expect(byKey.off_list.items).toBeNull()
  })

  it('sections 顺序固定为 waiting / acted / queued / off_list', () => {
    const { sections } = buildSections([], { getRow: row })
    expect(sections.map((s) => s.key)).toEqual(['waiting', 'acted', 'queued', 'off_list'])
  })
})
