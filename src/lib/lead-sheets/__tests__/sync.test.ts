import { describe, it, expect, vi } from 'vitest'
import { describeHeaderProblem, newDestinationSnapshot, syncOneRoute, syncRoutes } from '../sync'
import type { LeadRecord, LeadSheetRoute } from '../types'

/**
 * 显式声明形参签名 —— `vi.fn(async () => ...)` 推断出的 `mock.calls` 是空元组，
 * 按下标取参数会被 TS 判成越界（TS2493）。测试跑得过，但 type-check 是红的。
 */
type ReadMock = (
  clientId: string,
  spreadsheetId: string,
  range: string,
  deps?: { render?: 'unformatted' | 'formatted' },
) => Promise<string[][]>

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
  dedupIdColumn: null,
  headerRow: null,
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
    const readSheet = vi.fn<ReadMock>(async () => [
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
    const readSheet = vi.fn<ReadMock>(async () => {
      throw new Error('403 insufficient scope')
    })

    const r = await syncOneRoute('c1', route, [lead({})], { readSheet, appendSheet })

    expect(appendSheet).not.toHaveBeenCalled()
    expect(r.appended).toBe(0)
    expect(r.error).toContain('403')
  })

  it('同一轮里两条线索算出同一把键也只写一条', async () => {
    const appendSheet = vi.fn<AppendMock>(async () => 1)
    const readSheet = vi.fn<ReadMock>(async () => [HEADER])

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
    const readSheet = vi.fn<ReadMock>(async () => [HEADER])

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

  it('判重键拼不出来的线索跳过，且**按条计数 + 记下 lead id**（不能去重成一个词）', async () => {
    const appendSheet = vi.fn<AppendMock>(async () => 0)
    const readSheet = vi.fn<ReadMock>(async () => [HEADER])

    const r = await syncOneRoute(
      'c1',
      route,
      [
        lead({ leadId: 'x1', occurredAt: '不是时间', phone: null }),
        lead({ leadId: 'x2', occurredAt: '也不是时间', phone: null }),
      ],
      { readSheet, appendSheet },
    )

    expect(appendSheet).not.toHaveBeenCalled()
    // 这些人是真的没进销售手里，条数和是哪几条都必须留下来
    expect(r.skippedNoIdentity).toBe(2)
    expect(r.skippedLeadIds).toEqual(['x1', 'x2'])
  })

  it('🔴 同一分钟、其中一个没电话的两条线索，不能被判成同一条而丢掉一条', async () => {
    const appendSheet = vi.fn<AppendMock>(async () => 1)
    const readSheet = vi.fn<ReadMock>(async () => [HEADER])

    const r = await syncOneRoute(
      'c1',
      route,
      [
        lead({ leadId: 'a', phone: '+64211111111' }),
        lead({ leadId: 'b', phone: null }), // 同一分钟，但拿不到电话
      ],
      { readSheet, appendSheet },
    )

    // 有电话那条照写；没电话那条走「跳过并点名」，**不是**被当成「表里已经有了」
    expect(r.appendedLeadIds).toEqual(['a'])
    expect(r.alreadyPresent).toBe(0)
    expect(r.skippedLeadIds).toEqual(['b'])
  })

  it('🔴 表里是 PM 手填的老行（没有编号列）→ 靠身份键认出来，不重写', async () => {
    // 2026-09-24 用生产数据试算时撞出来的回归：只用机器键的话这 3 行会被重写。
    const withId: LeadSheetRoute = {
      ...route,
      columns: [...route.columns, { field: 'lead_id' }],
      dedupIdColumn: 3,
    }
    const appendSheet = vi.fn<AppendMock>(async () => 0)
    const readSheet = vi.fn<ReadMock>(async () => [
      [...HEADER, '线索ID'],
      ['2026-09-24 09:52', 'Jamila Sahid', '+64221543231'], // 人手填的，只有 3 格
    ])

    const r = await syncOneRoute('c1', withId, [lead({})], { readSheet, appendSheet })

    expect(appendSheet).not.toHaveBeenCalled()
    expect(r.alreadyPresent).toBe(1)
  })

  it('🔴 机器键在时，销售改过电话格式也不会被重写一行', async () => {
    const withId: LeadSheetRoute = {
      ...route,
      columns: [...route.columns, { field: 'lead_id' }],
      dedupIdColumn: 3,
    }
    const appendSheet = vi.fn<AppendMock>(async () => 0)
    // 表里那行是我们上一轮写的，销售之后把电话排版过
    const readSheet = vi.fn<ReadMock>(async () => [
      [...HEADER, '线索ID'],
      ['2026-09-24 09:52', 'Jamila Sahid', '+64 22 154 3231', 'lead-1'],
    ])

    const r = await syncOneRoute('c1', withId, [lead({})], { readSheet, appendSheet })

    expect(appendSheet).not.toHaveBeenCalled()
    expect(r.alreadyPresent).toBe(1)
  })

  it('部分写成时**不报 lead id** —— 不知道是哪几行成了就别撒谎', async () => {
    const appendSheet = vi.fn<AppendMock>(async () => 1)
    const readSheet = vi.fn<ReadMock>(async () => [HEADER])

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
    expect(r.appendedLeadIds).toEqual([])
    expect(r.error).toContain('只认了 1 行')
  })

  it('tab 名带空格要按 A1 记法加引号，否则 Sheets 直接回 400', async () => {
    const appendSheet = vi.fn<AppendMock>(async () => 1)
    const readSheet = vi.fn<ReadMock>(async () => [HEADER])

    await syncOneRoute('c1', { ...route, tabName: 'FB 表单 2026' }, [lead({})], {
      readSheet,
      appendSheet,
    })

    expect(readSheet.mock.calls[0][2]).toBe("'FB 表单 2026'!A:ZZ")
  })

  it('backfill 窗口之外的不碰，但要在回执里报数', async () => {
    const appendSheet = vi.fn<AppendMock>(async () => 0)
    const readSheet = vi.fn<ReadMock>(async () => [HEADER])

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

  it('🔴 取数查询本身已经截断掉的历史条数要算进 outsideWindow，不能从 0 起算', async () => {
    // `loadLeadsSince` 按 backfillSince 截断查询之后，更早的线索根本不在 `leads`
    // 参数里——几条路线共用同一个 backfillSince 时，逐条比对永远数不出这些人。
    // 调用方（`syncClientLeadSheets`）用 `countLeadsBefore` 数出「查询截断掉多少条」，
    // 当成起点传进来；这里连一条落在窗口内的线索都没有，起点原样透出。
    const appendSheet = vi.fn<AppendMock>(async () => 0)
    const readSheet = vi.fn<ReadMock>(async () => [HEADER])

    const r = await syncOneRoute(
      'c1',
      { ...route, backfillSince: '2026-09-24T00:00:00Z' },
      [lead({ occurredAt: '2026-09-24T01:00:00Z' })],
      { readSheet, appendSheet },
      newDestinationSnapshot(),
      703,
    )

    expect(r.outsideWindow).toBe(703)
    expect(r.matched).toBe(1)
  })

  it('试算模式只算不写，且不把试算报成写成功了', async () => {
    const appendSheet = vi.fn<AppendMock>(async () => 1)
    const readSheet = vi.fn<ReadMock>(async () => [HEADER])

    const r = await syncOneRoute('c1', route, [lead({})], { readSheet, appendSheet, dryRun: true })

    expect(appendSheet).not.toHaveBeenCalled()
    expect(r.appended).toBe(0)
    expect(r.appendedLeadIds).toEqual(['lead-1'])
  })
})

/**
 * PM 2026-09-24 拍板「所有表单的线索汇总进一张表，用一列来源表单区分」之后，
 * 几条路线写同一张表成了常态。这一组盯的就是那个新常态。
 */
describe('同一张表上的几条路线共用一份快照', () => {
  /** 跟线上一样的两条路线：列定义一模一样，只有「来源表单」那一列的固定文本不同。 */
  function routeWithLabel(routeKey: string, label: string): LeadSheetRoute {
    return {
      ...route,
      routeKey,
      matchAnyAnswerFields: routeKey === 'fallback' ? [] : route.matchAnyAnswerFields,
      priority: routeKey === 'fallback' ? 900 : 10,
      columns: [
        { field: 'occurred_at', format: 'local' },
        { field: 'contact_name' },
        { field: 'contact_phone' },
        { field: 'literal', value: label },
      ],
    }
  }

  const routeA = routeWithLabel('v4', '含预算与出发时间')
  const routeB = routeWithLabel('fallback', '基础表单')

  it('只读一次表 —— 第二条路线不再去读一遍', async () => {
    const readSheet = vi.fn<ReadMock>(async () => [HEADER])
    const appendSheet = vi.fn<AppendMock>(async (_c, _s, _r, rows) => rows.length)
    const snapshot = newDestinationSnapshot()

    await syncOneRoute('c1', routeA, [lead({ leadId: 'a' })], { readSheet, appendSheet }, snapshot)
    await syncOneRoute(
      'c1',
      routeB,
      [lead({ leadId: 'b', phone: '+64220000000' })],
      { readSheet, appendSheet },
      snapshot,
    )

    expect(readSheet).toHaveBeenCalledTimes(1)
    expect(appendSheet).toHaveBeenCalledTimes(2)
  })

  it('来源表单那一列按路线写不同的标签，其余列一模一样', async () => {
    const readSheet = vi.fn<ReadMock>(async () => [HEADER])
    const appendSheet = vi.fn<AppendMock>(async (_c, _s, _r, rows) => rows.length)
    const snapshot = newDestinationSnapshot()

    await syncOneRoute('c1', routeA, [lead({ leadId: 'a' })], { readSheet, appendSheet }, snapshot)
    await syncOneRoute(
      'c1',
      routeB,
      [lead({ leadId: 'b', phone: '+64220000000' })],
      { readSheet, appendSheet },
      snapshot,
    )

    expect(appendSheet.mock.calls[0][3][0][3]).toBe('含预算与出发时间')
    expect(appendSheet.mock.calls[1][3][0][3]).toBe('基础表单')
  })

  it('🔴 试算模式下，第二条路线看得见第一条已经排进队列的人 —— 不重复报', async () => {
    // 同一个人同一分钟在两张表单上各留了一次。真跑时第二条路线会读到第一条写进去的
    // 那行；试算时读不到，所以必须靠共享的键集合挡住，否则试算跟真跑对不上。
    const readSheet = vi.fn<ReadMock>(async () => [HEADER])
    const snapshot = newDestinationSnapshot()
    const same = { occurredAt: '2026-09-23T21:52:24Z', phone: '+64221543231' }

    const a = await syncOneRoute(
      'c1',
      routeA,
      [lead({ leadId: 'a', ...same })],
      { readSheet, dryRun: true },
      snapshot,
    )
    const b = await syncOneRoute(
      'c1',
      routeB,
      [lead({ leadId: 'b', ...same })],
      { readSheet, dryRun: true },
      snapshot,
    )

    expect(a.appendedLeadIds).toEqual(['a'])
    expect(b.appendedLeadIds).toEqual([])
    expect(b.alreadyPresent).toBe(1)
  })

  it('🔴 读表失败时，同一张表上的每条路线都要在自己的回执里说 —— 不能只记在第一条', async () => {
    const readSheet = vi.fn<ReadMock>(async () => {
      throw new Error('403 insufficient scope')
    })
    const appendSheet = vi.fn<AppendMock>(async () => 0)
    const snapshot = newDestinationSnapshot()

    const a = await syncOneRoute('c1', routeA, [lead({ leadId: 'a' })], { readSheet, appendSheet }, snapshot)
    const b = await syncOneRoute('c1', routeB, [lead({ leadId: 'b' })], { readSheet, appendSheet }, snapshot)

    expect(a.error).toContain('403')
    expect(b.error).toContain('403')
    // 读失败不重试第二遍，也一行都不写。
    expect(readSheet).toHaveBeenCalledTimes(1)
    expect(appendSheet).not.toHaveBeenCalled()
  })

  it('一条线索都没分到的路线不去读表 —— 让真正有活的那条去读', async () => {
    const readSheet = vi.fn<ReadMock>(async () => [HEADER])
    const snapshot = newDestinationSnapshot()

    const empty = await syncOneRoute('c1', routeA, [], { readSheet, dryRun: true }, snapshot)
    expect(readSheet).not.toHaveBeenCalled()
    expect(empty.matched).toBe(0)

    await syncOneRoute('c1', routeB, [lead({ leadId: 'b' })], { readSheet, dryRun: true }, snapshot)
    expect(readSheet).toHaveBeenCalledTimes(1)
  })
})

/**
 * 🔴 这一组盯的是**编排层**，不是 syncOneRoute。
 *
 * 上面那组测试是自己手工把 snapshot 传进去的 —— 把 `syncRoutes` 里的分组改成
 * 「每条路线各建一个快照」，这个 PR 的全部立论当场失效，而上面那组一个都不会红。
 * 所以必须有人直接调 `syncRoutes`。
 */
describe('syncRoutes —— 真正按目标表分组的那一层', () => {
  function routeAt(routeKey: string, sheet: string, tab: string, label: string): LeadSheetRoute {
    return {
      ...route,
      routeKey,
      spreadsheetId: sheet,
      tabName: tab,
      columns: [
        { field: 'occurred_at', format: 'local' },
        { field: 'contact_name' },
        { field: 'contact_phone' },
        { field: 'literal', value: label },
      ],
    }
  }

  it('🔴 两条路线写同一张表 → 整个编排里这张表只读一次', async () => {
    const readSheet = vi.fn<ReadMock>(async () => [HEADER])
    const appendSheet = vi.fn<AppendMock>(async (_c, _s, _r, rows) => rows.length)
    const a = routeAt('v4', 'sheet-1', 'Untitled', '含预算与出发时间')
    const b = routeAt('fallback', 'sheet-1', 'Untitled', '基础表单')

    const receipts = await syncRoutes(
      'c1',
      [a, b],
      new Map([
        ['v4', [lead({ leadId: 'a' })]],
        ['fallback', [lead({ leadId: 'b', phone: '+64220000000' })]],
      ]),
      { readSheet, appendSheet },
    )

    expect(readSheet).toHaveBeenCalledTimes(1)
    expect(receipts.map((r) => r.appended)).toEqual([1, 1])
  })

  it('两条路线写不同的表 → 各读各的', async () => {
    const readSheet = vi.fn<ReadMock>(async () => [HEADER])
    const appendSheet = vi.fn<AppendMock>(async (_c, _s, _r, rows) => rows.length)

    await syncRoutes(
      'c1',
      [routeAt('a', 'sheet-1', 'T1', 'A'), routeAt('b', 'sheet-2', 'T2', 'B')],
      new Map([
        ['a', [lead({ leadId: 'a' })]],
        ['b', [lead({ leadId: 'b' })]],
      ]),
      { readSheet, appendSheet },
    )

    expect(readSheet).toHaveBeenCalledTimes(2)
  })

  it('🔴 同一张表上，第二条路线看得见第一条刚排进队列的人（试算也算）', async () => {
    const readSheet = vi.fn<ReadMock>(async () => [HEADER])
    const same = { occurredAt: '2026-09-23T21:52:24Z', phone: '+64221543231' }

    const receipts = await syncRoutes(
      'c1',
      [routeAt('v4', 'sheet-1', 'Untitled', 'A'), routeAt('fallback', 'sheet-1', 'Untitled', 'B')],
      new Map([
        ['v4', [lead({ leadId: 'a', ...same })]],
        ['fallback', [lead({ leadId: 'b', ...same })]],
      ]),
      { readSheet, dryRun: true },
    )

    expect(receipts[0].appendedLeadIds).toEqual(['a'])
    expect(receipts[1].appendedLeadIds).toEqual([])
    expect(receipts[1].alreadyPresent).toBe(1)
  })

  it('没分到线索的路线也出一条回执 ——「今天 0 条」和「没跑」要分得开', async () => {
    const readSheet = vi.fn<ReadMock>(async () => [HEADER])
    const receipts = await syncRoutes(
      'c1',
      [routeAt('a', 'sheet-1', 'T1', 'A'), routeAt('b', 'sheet-1', 'T1', 'B')],
      new Map([['a', [lead({ leadId: 'a' })]]]),
      { readSheet, dryRun: true },
    )
    expect(receipts).toHaveLength(2)
    expect(receipts[1].matched).toBe(0)
  })
})

describe('describeHeaderProblem —— 开工前对一次表头', () => {
  const withHeader = (header: string[] | null): LeadSheetRoute => ({
    ...route,
    columns: [{ field: 'occurred_at', format: 'local' }, { field: 'contact_name' }, { field: 'contact_phone' }],
    headerRow: header,
  })

  it('表头对得上 → 放行', () => {
    expect(describeHeaderProblem(withHeader(['留资时间', '姓名', '电话']), [['留资时间', '姓名', '电话']])).toBeNull()
  })

  it('🔴 有人在表中间插了一列 → 停手，并说清是第几列、应该是什么', () => {
    const problem = describeHeaderProblem(withHeader(['留资时间', '姓名', '电话']), [
      ['留资时间', '备注', '姓名', '电话'],
    ])
    expect(problem).toContain('第 2 列')
    expect(problem).toContain('姓名')
    expect(problem).toContain('备注')
  })

  it('表头右边多出人自己加的列 → 不管（不影响前几列的位置）', () => {
    expect(
      describeHeaderProblem(withHeader(['留资时间', '姓名', '电话']), [
        ['留资时间', '姓名', '电话', '我自己的草稿列'],
      ]),
    ).toBeNull()
  })

  it('表头那一格被人加了空格 → 不算问题', () => {
    expect(
      describeHeaderProblem(withHeader(['留资时间', '姓名', '电话']), [[' 留资时间 ', '姓名', '电话']]),
    ).toBeNull()
  })

  it('🔴 配了表头签名但表整个是空的 → fail-closed，不能把第一条线索当表头写进第 1 行', () => {
    const problem = describeHeaderProblem(withHeader(['留资时间', '姓名', '电话']), [])
    expect(problem).toContain('还是空的')
    expect(problem).toContain('留资时间、姓名、电话')
  })

  it('没配表头签名 → 完全不检查，行为跟以前一样', () => {
    expect(describeHeaderProblem(withHeader(null), [['随便', '什么', '都行']])).toBeNull()
  })

  it('🔴 表头对不上时，这张表上一行都不写', async () => {
    const readSheet = vi.fn<ReadMock>(async () => [['留资时间', '备注', '姓名']])
    const appendSheet = vi.fn<AppendMock>(async () => 1)
    const r = await syncOneRoute(
      'c1',
      { ...withHeader(['留资时间', '姓名', '电话']), dedupColumns: [0, 2] },
      [lead({ leadId: 'a' })],
      { readSheet, appendSheet },
    )
    expect(appendSheet).not.toHaveBeenCalled()
    expect(r.error).toContain('表头跟配置对不上')
  })
})
