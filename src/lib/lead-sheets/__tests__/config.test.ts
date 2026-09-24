import { describe, it, expect } from 'vitest'
import { LeadSheetConfigError, loadClientRoutes, parseRoute } from '../config'

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
    dedup_id_column: null,
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

describe('loadClientRoutes — 跨路线校验', () => {
  function fakeSupabase(rows: unknown[]) {
    const q = {
      select: () => q,
      eq: () => q,
      order: async () => ({ data: rows, error: null }),
    }
    return { from: () => q } as unknown as Parameters<typeof loadClientRoutes>[0]
  }

  it('两条路线指到同一张表同一个 tab → 后一条判坏并剔掉', async () => {
    // 不拦的话：两边列定义不同，A 会去读 B 写的行的那几格来判重，
    // 而那几格在 B 的列定义里语义完全不同 → 误判成「已存在」→ 静默丢线索。
    const { routes, invalid } = await loadClientRoutes(
      fakeSupabase([
        { ...row(), route_key: 'a', priority: 1 },
        { ...row(), route_key: 'b', priority: 2 },
      ]),
      'c1',
    )
    expect(routes.map((r) => r.routeKey)).toEqual(['a'])
    expect(invalid).toHaveLength(1)
    expect(invalid[0].reason).toContain('同一张表的同一个 tab')
  })

  it('指到不同 tab 就都留着', async () => {
    const { routes, invalid } = await loadClientRoutes(
      fakeSupabase([
        { ...row(), route_key: 'a', tab_name: 'Tab1' },
        { ...row(), route_key: 'b', tab_name: 'Tab2' },
      ]),
      'c1',
    )
    expect(routes).toHaveLength(2)
    expect(invalid).toHaveLength(0)
  })
})

describe('parseRoute — 机器键列', () => {
  it('机器键列超出范围 → 报错', () => {
    expect(() => parseRoute(row({ dedup_id_column: 9 }))).toThrow(/dedup_id_column/)
  })

  it('不填机器键列是合法的（老表没有那一列）', () => {
    expect(parseRoute(row()).dedupIdColumn).toBeNull()
  })
})
