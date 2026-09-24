import { describe, it, expect, vi } from 'vitest'
import { syncOneRoute } from '../sync'
import type { LeadRecord, LeadSheetRoute } from '../types'

/**
 * 显式声明形参签名 —— `vi.fn(async () => ...)` 推断出的 `mock.calls` 是空元组，
 * 按下标取参数会被 TS 判成越界（TS2493）。测试跑得过，但 type-check 是红的。
 */
type AppendMock = (
  clientId: string,
  spreadsheetId: string,
  range: string,
  rows: readonly (readonly string[])[],
) => Promise<number>

const route: LeadSheetRoute = {
  routeKey: 'v4',
  label: null,
  spreadsheetId: 'sheet-1',
  tabName: 'Untitled',
  matchAnyAnswerFields: ['whats_your_budget_per_person_nzd?'],
  priority: 10,
  columns: [
    { field: 'occurred_at', format: 'local' },
    { field: 'contact_name' },
    { field: 'contact_phone' },
  ],
  valueLabels: {},
  dedupColumns: [0, 2],
  timezone: 'Pacific/Auckland',
  backfillSince: null,
  enabled: true,
}

function lead(over: Partial<LeadRecord>): LeadRecord {
  return {
    leadId: 'lead-1',
    occurredAt: '2026-09-23T21:52:24Z',
    name: 'Jamila Sahid',
    email: null,
    phone: '+64221543231',
    adId: null, adName: null, adsetId: null, adsetName: null,
    campaignId: null, campaignName: null, formId: null, formName: null,
    platform: null, isOrganic: null, answers: {},
    ...over,
  }
}

const HEADER = ['留资时间', '姓名', '电话']

describe('syncOneRoute', () => {
  it('表里已经有的行跳过，只追加缺的那条', async () => {
    const appendSheet = vi.fn<AppendMock>(async () => 1)
    const readSheet = vi.fn(async () => [
      HEADER,
      ['2026-09-24 09:52', 'Jamila Sahid', '+64221543231'], // 人手先填进去的
    ])

    const r = await syncOneRoute(
      'c1',
      route,
      [lead({}), lead({ leadId: 'lead-2', occurredAt: '2026-09-23T22:15:00Z', name: 'Neil', phone: '+64211914575' })],
      { readSheet, appendSheet },
    )

    expect(r.alreadyPresent).toBe(1)
    expect(r.appended).toBe(1)
    expect(r.appendedLeadIds).toEqual(['lead-2'])
    expect(appendSheet.mock.calls[0][3]).toEqual([['2026-09-24 10:15', 'Neil', '+64211914575']])
  })

  it('读不到表就一行都不写 —— 看不见表里有什么却照写 = 写一堆重复行', async () => {
    const appendSheet = vi.fn<AppendMock>(async () => 1)
    const readSheet = vi.fn(async () => {
      throw new Error('403 insufficient scope')
    })

    const r = await syncOneRoute('c1', route, [lead({})], { readSheet, appendSheet })

    expect(appendSheet).not.toHaveBeenCalled()
    expect(r.appended).toBe(0)
    expect(r.error).toContain('403')
  })

  it('同一轮里两条线索算出同一把键也只写一条', async () => {
    const appendSheet = vi.fn<AppendMock>(async () => 1)
    const readSheet = vi.fn(async () => [HEADER])

    const r = await syncOneRoute(
      'c1',
      route,
      [lead({ leadId: 'a' }), lead({ leadId: 'b' })],
      { readSheet, appendSheet },
    )

    expect(r.appended).toBe(1)
    expect(appendSheet.mock.calls[0][3]).toHaveLength(1)
  })

  it('Sheets 只认了一部分行 → 回执如实报数并记错，不拿「打算写几行」充数', async () => {
    const appendSheet = vi.fn<AppendMock>(async () => 1) // 打算写 2，只回 1
    const readSheet = vi.fn(async () => [HEADER])

    const r = await syncOneRoute(
      'c1',
      route,
      [
        lead({ leadId: 'a' }),
        lead({ leadId: 'b', occurredAt: '2026-09-23T23:00:00Z', phone: '+6421000000' }),
      ],
      { readSheet, appendSheet },
    )

    expect(r.appended).toBe(1)
    expect(r.error).toContain('只认了 1 行')
  })

  it('判重键拼不出来的线索跳过，不往表里塞一条认不出是谁的行', async () => {
    const appendSheet = vi.fn<AppendMock>(async () => 0)
    const readSheet = vi.fn(async () => [HEADER])

    const r = await syncOneRoute(
      'c1',
      route,
      [lead({ occurredAt: '不是时间', phone: null })],
      { readSheet, appendSheet },
    )

    expect(appendSheet).not.toHaveBeenCalled()
    expect(r.blankedFields).toContain('dedup_key')
  })

  it('backfill 窗口之外的不碰，但要在回执里报数', async () => {
    const appendSheet = vi.fn<AppendMock>(async () => 0)
    const readSheet = vi.fn(async () => [HEADER])

    const r = await syncOneRoute(
      'c1',
      { ...route, backfillSince: '2026-09-24T00:00:00Z' },
      [lead({ occurredAt: '2026-07-01T00:00:00Z' })],
      { readSheet, appendSheet },
    )

    expect(r.outsideWindow).toBe(1)
    expect(r.matched).toBe(0)
    expect(readSheet).not.toHaveBeenCalled()
  })

  it('试算模式只算不写，且不把试算报成写成功了', async () => {
    const appendSheet = vi.fn<AppendMock>(async () => 1)
    const readSheet = vi.fn(async () => [HEADER])

    const r = await syncOneRoute('c1', route, [lead({})], { readSheet, appendSheet, dryRun: true })

    expect(appendSheet).not.toHaveBeenCalled()
    expect(r.appended).toBe(0)
    expect(r.appendedLeadIds).toEqual(['lead-1'])
  })
})
