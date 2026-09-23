import { describe, it, expect } from 'vitest'
import { buildRow, dedupKey, emptyNotes, formatLocalMinute, isUsableDedupKey, normaliseAnswerValue } from '../row'
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
    }
    expect(buildRow(lead, r, notes)).toEqual(['l:1826850481833456', ''])
  })
})

describe('dedupKey', () => {
  it('同一条线索算出同一把键（跟表里已有的行能对上）', () => {
    const notes = emptyNotes()
    const cells = buildRow(lead, route, notes)
    // 模拟表里已经有的一行（人手粘的，大小写和空格都可能不一样）
    const existing = ['2026-09-24 09:52 ', 'Jamila Sahid', ' +64221543231', '还在决定', '约$3000', '', '']
    expect(dedupKey(cells, route.dedupColumns)).toBe(dedupKey(existing, route.dedupColumns))
  })

  it('短行（表格尾部没补齐）不会越界', () => {
    expect(() => dedupKey(['只有一格'], [0, 2])).not.toThrow()
  })

  it('全空的键不可用 —— 当成「不在表里」而不是「已存在」', () => {
    expect(isUsableDedupKey(dedupKey(['', ''], [0, 1]))).toBe(false)
    expect(isUsableDedupKey(dedupKey(['x', ''], [0, 1]))).toBe(true)
  })
})
