/**
 * Tests for src/lib/huatuo/seasonal-calendar.ts
 *
 * 覆盖：全年日历构建、未来 90 天窗口过滤（含跨年）、AU/NZ 市场差异、
 * prompt 格式化输出。
 */

import { describe, it, expect } from 'vitest'
import {
  getSeasonalCalendar,
  formatSeasonalCalendarForPrompt,
} from '../seasonal-calendar'

const YEAR = new Date().getFullYear()

// ---------------------------------------------------------------------------
// 1. 全年日历（无 current_month）
// ---------------------------------------------------------------------------

describe('getSeasonalCalendar — 全年日历', () => {
  it('AU 默认返回 12 个月的完整日历', () => {
    const cal = getSeasonalCalendar('AU')
    expect(cal.market).toBe('AU')
    expect(cal.year).toBe(YEAR)
    expect(cal.entries).toHaveLength(12)
  })

  it('NZ 返回 12 个月的完整日历', () => {
    const cal = getSeasonalCalendar('NZ')
    expect(cal.market).toBe('NZ')
    expect(cal.entries).toHaveLength(12)
  })

  it('默认市场为 AU', () => {
    expect(getSeasonalCalendar().market).toBe('AU')
  })

  it('每个月份条目都至少包含 1 个事件', () => {
    for (const entry of getSeasonalCalendar('AU').entries) {
      expect(entry.events.length).toBeGreaterThan(0)
    }
  })

  it('AU 与 NZ 在 2 月有不同的国家节点（Australia Day vs Waitangi Day）', () => {
    const auFeb = getSeasonalCalendar('AU').entries.find(e => e.month === `${YEAR}-02`)
    const nzFeb = getSeasonalCalendar('NZ').entries.find(e => e.month === `${YEAR}-02`)
    expect(auFeb?.events.some(ev => ev.name.includes('情人节'))).toBe(true)
    expect(nzFeb?.events.some(ev => ev.name.includes('Waitangi'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. 未来 90 天窗口过滤
// ---------------------------------------------------------------------------

describe('getSeasonalCalendar — 未来 90 天窗口', () => {
  it('指定当前月时只返回该月起约 4 个月的条目', () => {
    const cal = getSeasonalCalendar('AU', `${YEAR}-05`)
    const months = cal.entries.map(e => e.month)
    expect(months).toEqual([
      `${YEAR}-05`,
      `${YEAR}-06`,
      `${YEAR}-07`,
      `${YEAR}-08`,
    ])
  })

  it('不包含当前月之前的条目', () => {
    const cal = getSeasonalCalendar('AU', `${YEAR}-05`)
    expect(cal.entries.some(e => e.month === `${YEAR}-04`)).toBe(false)
    expect(cal.entries.some(e => e.month === `${YEAR}-01`)).toBe(false)
  })

  it('跨年窗口正确返回次年的月份', () => {
    const cal = getSeasonalCalendar('AU', `${YEAR}-11`)
    const months = cal.entries.map(e => e.month)
    expect(months).toEqual([
      `${YEAR}-11`,
      `${YEAR}-12`,
      `${YEAR + 1}-01`,
      `${YEAR + 1}-02`,
    ])
  })

  it('跨年窗口包含次年的事件（如次年 1 月元日）', () => {
    const cal = getSeasonalCalendar('AU', `${YEAR}-12`)
    const janNext = cal.entries.find(e => e.month === `${YEAR + 1}-01`)
    expect(janNext).toBeDefined()
    expect(janNext?.events.some(ev => ev.date.startsWith(`${YEAR + 1}-01`))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. 事件数据结构完整性
// ---------------------------------------------------------------------------

describe('SeasonalEvent — 数据结构', () => {
  it('所有事件 relevance 落在 0-1 区间', () => {
    for (const entry of getSeasonalCalendar('AU').entries) {
      for (const ev of entry.events) {
        expect(ev.relevance).toBeGreaterThanOrEqual(0)
        expect(ev.relevance).toBeLessThanOrEqual(1)
      }
    }
  })

  it('所有事件 scope 为 national 或 regional', () => {
    for (const entry of getSeasonalCalendar('NZ').entries) {
      for (const ev of entry.events) {
        expect(['national', 'regional']).toContain(ev.scope)
      }
    }
  })

  it('黑五（Black Friday）为高关联度全行业节点', () => {
    const nov = getSeasonalCalendar('AU').entries.find(e => e.month === `${YEAR}-11`)
    const blackFriday = nov?.events.find(ev => ev.name.includes('黑五'))
    expect(blackFriday?.relevance).toBeGreaterThanOrEqual(0.9)
    expect(blackFriday?.industries).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4. prompt 格式化
// ---------------------------------------------------------------------------

describe('formatSeasonalCalendarForPrompt', () => {
  it('输出含市场标题与月份小节', () => {
    const text = formatSeasonalCalendarForPrompt(getSeasonalCalendar('AU', `${YEAR}-05`))
    expect(text).toContain('未来 90 天本地营销节点（AU 季节日历）')
    expect(text).toContain(`### ${YEAR}-05`)
  })

  it('输出含事件名称、关联度与营销建议', () => {
    const text = formatSeasonalCalendarForPrompt(getSeasonalCalendar('AU', `${YEAR}-06`))
    expect(text).toContain('EOFY')
    expect(text).toContain('关联度')
    expect(text).toContain('建议:')
  })

  it('输出含使用建议尾注', () => {
    const text = formatSeasonalCalendarForPrompt(getSeasonalCalendar('NZ'))
    expect(text).toContain('使用建议')
    expect(text).toContain('Black Friday')
  })

  it('全行业事件标注为「全行业」', () => {
    const text = formatSeasonalCalendarForPrompt(getSeasonalCalendar('AU', `${YEAR}-11`))
    expect(text).toContain('全行业')
  })
})
