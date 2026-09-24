import { describe, it, expect } from 'vitest'
import { buildRow, dedupKeys, emptyNotes, formatLocalMinute, normaliseAnswerValue } from '../row'
import type { LeadRecord, LeadSheetRoute } from '../types'

const lead: LeadRecord = {
  leadId: '1826850481833456',
  occurredAt: '2026-09-23T21:52:24+00:00',
  name: 'Jamila Sahid',
  email: 'jenny@example.com',
  phone: '+64221543231',
  adId: '120249907696560307',
  adName: 'GC · Grand Tour',
  adsetId: '120247480862400307',
  adsetName: null,
  campaignId: '120247480862390307',
  campaignName: 'CTS — Reborn',
  formId: '3232987727090852',
  formName: null,
  platform: 'fb',
  isOrganic: false,
  answers: {
    'which_tour_interests_you_most?': 'still_deciding_-_show_me_all',
    'whats_your_budget_per_person_nzd?': 'around_3000',
  },
}

const route: LeadSheetRoute = {
  routeKey: 'test',
  label: null,
  spreadsheetId: 'sheet-1',
  tabName: 'Tab',
  matchAnyAnswerFields: [],
  priority: 1,
  columns: [
    { field: 'occurred_at', format: 'local' },
    { field: 'contact_name' },
    { field: 'contact_phone' },
    { field: 'answer', key: 'which_tour_interests_you_most?', mapped: true },
    { field: 'answer', key: 'whats_your_budget_per_person_nzd?', mapped: true },
    { field: 'adset_name' },
    { field: 'blank' },
  ],
  valueLabels: { still_deciding_show_me_all: '还在决定', around_3000: '约$3000' },
  dedupColumns: [0, 2],
  dedupIdColumn: null,
  timezone: 'Pacific/Auckland',
  backfillSince: null,
  enabled: true,
}

describe('normaliseAnswerValue', () => {
  it('把同一个选项的多种破折号 / 下划线写法压成同一把键', () => {
    // CTS 实测出现过的三种写法。表单一改版就换一种，精确匹配必漏。
    expect(normaliseAnswerValue('still_deciding_-_show_me_all')).toBe('still_deciding_show_me_all')
    expect(normaliseAnswerValue('still_deciding_—_show_me_all')).toBe('still_deciding_show_me_all')
    expect(normaliseAnswerValue('Still Deciding - Show Me All')).toBe('still_deciding_show_me_all')
  })

  it('不做近似匹配 —— 两个圣诞团不能被认成同一个', () => {
    const akl = normaliseAnswerValue('christmas_in_china_-_from_auckland')
    const chc = normaliseAnswerValue('christmas_in_china_-_from_christchurch')
    expect(akl).not.toBe(chc)
  })
})

describe('formatLocalMinute', () => {
  it('UTC 时间按路线时区渲染（跨了日期线也要对）', () => {
    expect(formatLocalMinute('2026-09-23T21:52:24+00:00', 'Pacific/Auckland')).toBe('2026-09-24 09:52')
  })

  it('午夜不会写成 24 点', () => {
    expect(formatLocalMinute('2026-09-23T12:00:00+00:00', 'Pacific/Auckland')).toBe('2026-09-24 00:00')
  })

  it('时间串不合法就留空，不抛', () => {
    expect(formatLocalMinute('不是时间', 'Pacific/Auckland')).toBe('')
  })
})

describe('buildRow', () => {
  it('按配置的列顺序渲染，选项翻成中文', () => {
    const notes = emptyNotes()
    expect(buildRow(lead, route, notes)).toEqual([
      '2026-09-24 09:52',
      'Jamila Sahid',
      '+64221543231',
      '还在决定',
      '约$3000',
      '',
      '',
    ])
  })

  it('对照表里查不到的选项**原样输出**并点名，不留空', () => {
    const notes = emptyNotes()
    const cells = buildRow(
      { ...lead, answers: { ...lead.answers, 'whats_your_budget_per_person_nzd?': 'over_20000' } },
      route,
      notes,
    )
    expect(cells[4]).toBe('over_20000')
    expect(notes.unmappedValues).toContain('over_20000')
  })

  it('取不到值的列记进 blankedFields，但 blank 占位列不算', () => {
    const notes = emptyNotes()
    buildRow(lead, route, notes)
    expect(notes.blankedFields).toContain('adset_name')
    expect(notes.blankedFields).not.toContain('blank')
  })

  it('前缀只加在非空值上 —— 空格子不能变成一个孤零零的 "l:"', () => {
    const notes = emptyNotes()
    const r: LeadSheetRoute = {
      ...route,
      columns: [{ field: 'lead_id', prefix: 'l:' }, { field: 'form_name', prefix: 'f:' }],
      dedupColumns: [0],
  dedupIdColumn: null,
    }
    expect(buildRow(lead, r, notes)).toEqual(['l:1826850481833456', ''])
  })
})

describe('dedupKeys', () => {
  const cols = [0, 1]
  const ID = 2

  it('同一条线索算出同一把身份键（跟表里已有的行能对上）', () => {
    const notes = emptyNotes()
    const cells = buildRow(lead, route, notes)
    // 模拟表里已经有的一行（人手粘的，大小写和空格都可能不一样）
    const existing = ['2026-09-24 09:52 ', 'Jamila Sahid', ' +64221543231', '还在决定', '约$3000', '', '']
    expect(dedupKeys(cells, route.dedupColumns)).toEqual(dedupKeys(existing, route.dedupColumns))
  })

  it('短行（表格尾部没补齐）不会越界', () => {
    expect(() => dedupKeys(['只有一格'], [0, 2])).not.toThrow()
  })

  it('全空 → 一把键都算不出来，当成「不在表里」而不是「已存在」', () => {
    expect(dedupKeys(['', ''], [0, 1])).toEqual([])
  })

  it('🔴 身份键**缺任一段就不算数** —— 缺了还当数会丢线索', () => {
    // 反例：判重列是「时间 + 电话」，两个人同一分钟填表、其中一个没留电话。
    // 把这种键当数的话，两条算出同一把键 → 第二条被当成「表里已经有了」
    // 永远不写，而且在回执里跟真正的重复行分不开。
    expect(dedupKeys(['2026-09-24 09:52', ''], [0, 1])).toEqual([])
    expect(dedupKeys(['2026-09-24 09:52', '+6421'], [0, 1])).toHaveLength(1)
  })

  it('🔴 销售把电话规整一下格式，身份键不能变 —— 否则下一轮会再写一行', () => {
    const ours = ['2026-09-24 09:52', '+64211914575']
    const tidied = ['2026-09-24 09:52', '+64 21 191 4575'] // 销售手动排版过
    expect(dedupKeys(ours, [0, 1])).toEqual(dedupKeys(tidied, [0, 1]))
  })

  it('🔴 有机器键时**两把都出** —— 少了身份键就会把人手填的老行重写一遍', () => {
    // 这条锁死的是 2026-09-24 用生产数据试算时当场撞出来的回归：
    // 改成「只用机器键」之后，PM 手填的 3 行算不出机器键，
    // 「表里已有」从 3 掉到 0 —— 真跑就会把那 3 行重写。
    const ours = ['2026-09-24 09:52', '+64211914575', 'lead-123']
    const keys = dedupKeys(ours, cols, ID)
    expect(keys).toHaveLength(2)

    const legacy = ['2026-09-24 09:52', '+64211914575', ''] // PM 手填，没有编号列
    const legacyKeys = dedupKeys(legacy, cols, ID)
    expect(legacyKeys).toHaveLength(1)
    // 两边靠身份键对得上 —— 这才是「不重写 PM 手填的行」的依据
    expect(keys).toContain(legacyKeys[0])
  })

  it('人把别的格子改烂了，靠机器键还认得出是同一条', () => {
    const ours = ['2026-09-24 09:52', '+64211914575', 'lead-123']
    const edited = ['24/09/2026 9:52am', '021 191 4575', 'lead-123']
    const shared = dedupKeys(ours, cols, ID).filter((k) => dedupKeys(edited, cols, ID).includes(k))
    expect(shared).toHaveLength(1) // 身份键对不上了，但机器键还在
  })

  it('别的格子全空但有机器键 → 照样能判重', () => {
    expect(dedupKeys(['', '', 'lead-123'], cols, ID)).toHaveLength(1)
  })
})
