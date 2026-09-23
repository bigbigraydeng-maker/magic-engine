import { describe, it, expect } from 'vitest'
import { LeadSheetConfigError, parseRoute } from '../config'

function row(over: Record<string, unknown> = {}) {
  return {
    route_key: 'r',
    label: null,
    spreadsheet_id: 'sheet-1',
    tab_name: 'Tab',
    match_any_answer_fields: ['q'],
    priority: 10,
    columns: [{ field: 'lead_id' }, { field: 'contact_phone' }],
    value_labels: { a: '甲' },
    dedup_columns: [0],
    timezone: 'Pacific/Auckland',
    backfill_since: null,
    enabled: true,
    ...over,
  } as Parameters<typeof parseRoute>[0]
}

describe('parseRoute', () => {
  it('正常配置读得出来', () => {
    const r = parseRoute(row())
    expect(r.columns).toHaveLength(2)
    expect(r.valueLabels).toEqual({ a: '甲' })
  })

  // 下面每一条都是 fail-loud：宁可这个客户这轮不同步（并在待办里喊一声），
  // 也不能默默往客户和销售直接看的表里写一片错位或空白的行。
  it('列里写了不认识的字段名 → 当场报错，不静默写空列', () => {
    expect(() => parseRoute(row({ columns: [{ field: 'phone_numbr' }] }))).toThrow(LeadSheetConfigError)
  })

  it('answer 列没写问题名 → 报错', () => {
    expect(() => parseRoute(row({ columns: [{ field: 'answer' }] }))).toThrow(/没写 key/)
  })

  it('没有判重列 → 报错（没判重键就会写重复行）', () => {
    expect(() => parseRoute(row({ dedup_columns: [] }))).toThrow(/dedup_columns/)
  })

  it('判重列指到不存在的列 → 报错', () => {
    expect(() => parseRoute(row({ dedup_columns: [7] }))).toThrow(/超出列范围/)
  })

  it('时区拼错 → 报错（不然整列时间会悄悄变成别的时区）', () => {
    expect(() => parseRoute(row({ timezone: 'Pacific/Aukland' }))).toThrow(/时区/)
  })

  it('backfill_since 不是合法时间 → 报错', () => {
    expect(() => parseRoute(row({ backfill_since: '明天' }))).toThrow(/backfill_since/)
  })

  it('columns 空的 → 报错', () => {
    expect(() => parseRoute(row({ columns: [] }))).toThrow(/非空数组/)
  })

  it('value_labels 里有非字符串 → 报错', () => {
    expect(() => parseRoute(row({ value_labels: { a: 1 } }))).toThrow(/不是字符串/)
  })

  it('空的 match_any_answer_fields 是合法的 —— 那是兜底路线', () => {
    expect(parseRoute(row({ match_any_answer_fields: [] })).matchAnyAnswerFields).toEqual([])
  })
})
