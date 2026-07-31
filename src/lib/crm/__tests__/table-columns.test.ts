import { describe, it, expect } from 'vitest'
import {
  extractCustomColumns,
  visibleCustomColumns,
  CUSTOM_COLUMNS,
  type TouchpointForColumn,
} from '@/lib/crm/table-columns'

/** 造一条触点。默认 phone / 空 metadata，测试只覆盖它关心的字段。 */
function tp(over: Partial<TouchpointForColumn>): TouchpointForColumn {
  return {
    channel: 'phone',
    occurredAt: '2026-07-01T00:00:00.000Z',
    metadata: null,
    ...over,
  }
}

describe('extractCustomColumns · tour_interest', () => {
  it('优先取 meta_lead_form 的 tour_interest_raw（客户 FB 下拉选的）', () => {
    const tps = [
      tp({ channel: 'meta_lead_form', occurredAt: '2026-07-01T00:00:00Z', metadata: { tour_interest_raw: 'Best of China' } }),
      tp({ channel: 'phone', occurredAt: '2026-07-05T00:00:00Z', metadata: { tour_interest: 'Silk Road' } }),
    ]
    expect(extractCustomColumns(tps).tour_interest).toBe('Best of China')
  })

  it('没有 raw 时退回手工笔记解析出的 tour_interest', () => {
    const tps = [
      tp({ channel: 'meta_lead_form', occurredAt: '2026-07-01T00:00:00Z', metadata: { ad_name: 'x' } }),
      tp({ channel: 'phone', occurredAt: '2026-07-05T00:00:00Z', metadata: { tour_interest: 'Tale of Two Cities' } }),
    ]
    expect(extractCustomColumns(tps).tour_interest).toBe('Tale of Two Cities')
  })

  it('多条 raw 取最近一条非空', () => {
    const tps = [
      tp({ channel: 'meta_lead_form', occurredAt: '2026-06-01T00:00:00Z', metadata: { tour_interest_raw: 'Silk Road' } }),
      tp({ channel: 'meta_lead_form', occurredAt: '2026-07-20T00:00:00Z', metadata: { tour_interest_raw: 'China Panorama' } }),
    ]
    expect(extractCustomColumns(tps).tour_interest).toBe('China Panorama')
  })

  it('meta_lead_form 的 raw 空、只有旧笔记有值时退回笔记', () => {
    const tps = [
      tp({ channel: 'meta_lead_form', occurredAt: '2026-07-20T00:00:00Z', metadata: { tour_interest_raw: null } }),
      tp({ channel: 'phone', occurredAt: '2026-07-05T00:00:00Z', metadata: { tour_interest: 'Legacy' } }),
    ]
    expect(extractCustomColumns(tps).tour_interest).toBe('Legacy')
  })

  it('把 "null"/"none"/"—"/空串 当没有值', () => {
    for (const junk of ['null', 'none', 'N/A', '—', '-', '   ']) {
      const tps = [tp({ channel: 'meta_lead_form', metadata: { tour_interest_raw: junk } })]
      expect(extractCustomColumns(tps).tour_interest).toBeNull()
    }
  })

  it('零触点 / metadata 为 null 时安全返回 null', () => {
    expect(extractCustomColumns([]).tour_interest).toBeNull()
    expect(extractCustomColumns([tp({ metadata: null })]).tour_interest).toBeNull()
  })

  it('非 meta_lead_form 渠道的 tour_interest_raw 不算数（只信笔记的 tour_interest）', () => {
    // web_form / messenger 上若混入 tour_interest_raw，不走①级；②级只看 tour_interest。
    const tps = [tp({ channel: 'messenger', metadata: { tour_interest_raw: 'Ghost Tour' } })]
    expect(extractCustomColumns(tps).tour_interest).toBeNull()
  })
})

describe('visibleCustomColumns · 数据驱动', () => {
  it('任一联系人有值 → 显示这列', () => {
    const per = [
      { tour_interest: null },
      { tour_interest: 'Best of China' },
      { tour_interest: null },
    ]
    const cols = visibleCustomColumns(per)
    expect(cols.map((c) => c.key)).toContain('tour_interest')
    expect(cols.find((c) => c.key === 'tour_interest')?.label).toBe('感兴趣的团')
  })

  it('全客户都没值 → 这列隐藏（别的客户默认不显示）', () => {
    const per = [{ tour_interest: null }, { tour_interest: null }]
    expect(visibleCustomColumns(per)).toEqual([])
  })

  it('空客户（0 联系人）→ 无自定义列', () => {
    expect(visibleCustomColumns([])).toEqual([])
  })

  it('注册表当前只有 tour_interest（改动需同步测试）', () => {
    expect(CUSTOM_COLUMNS.map((c) => c.key)).toEqual(['tour_interest'])
  })
})
