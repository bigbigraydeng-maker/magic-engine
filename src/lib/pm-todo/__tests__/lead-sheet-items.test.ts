import { describe, it, expect } from 'vitest'
import { pushLeadSheetItems } from '../lead-sheet-items'
import type { ManualItem } from '../manual-item-types'

const NOW = new Date('2026-09-24T12:00:00Z')

/**
 * 假的 `cron_run_logs` 查询。
 *
 * 形状不是猜的：**已核实**生产侧 `pushLeadSheetItems`（../lead-sheet-items.ts）
 * 对 supabase 只用这一条链 —— `.from().select().eq().gte().order()`，返回
 * `{ data, error }`。多一个方法这个假对象都不需要，少一个测试会当场炸。
 * 形状一旦对不上，下面「读运行记录失败」那条用例会先失败（反例已跑，见文件末）。
 *
 * 这里的强转只是把「够用的假对象」对齐 `SupabaseClient` 的形参类型，
 * 不是拿它掩盖形状不符。
 */
function fakeSupabase(rows: unknown[], spy?: { gte?: string }) {
  const q: Record<string, unknown> = {}
  Object.assign(q, {
    select: () => q,
    eq: () => q,
    gte: (_col: string, v: string) => {
      if (spy) spy.gte = v
      return q
    },
    order: async () => ({ data: rows, error: null }),
  })
  return { from: () => q } as unknown as Parameters<typeof pushLeadSheetItems>[0]
}

function run(
  clientId: string,
  name: string,
  routes: unknown[],
  error: string | null = null,
  unrouted = 0,
) {
  return {
    job_name: 'lead-sheet-sync',
    status: 'completed',
    started_at: '2026-09-24T11:20:00Z',
    summary: { results: [{ clientId, clientName: name, routes, error, unrouted }] },
  }
}

describe('pushLeadSheetItems', () => {
  it('🔴 fan-out 一客户一行记录 —— 每个客户都要被看见，不能只看最新那一行', async () => {
    // 这条锁死的是：接进第二个客户之后，另一个客户的失败不会再静默消失。
    const items: ManualItem[] = []
    await pushLeadSheetItems(
      fakeSupabase([
        run('c1', '客户甲', [{ routeKey: 'r', tabName: 'T', error: '写表格失败：boom' }]),
        run('c2', '客户乙', [{ routeKey: 'r', tabName: 'T', error: '写表格失败：bang' }]),
      ]),
      items,
      NOW,
    )
    expect(items.map((i) => i.client_id).sort()).toEqual(['c1', 'c2'])
  })

  it('同一个客户有多轮时只取最近那一轮', async () => {
    const items: ManualItem[] = []
    await pushLeadSheetItems(
      fakeSupabase([
        // 已按时间倒序：第一条是最近的，它没问题
        run('c1', '客户甲', [{ routeKey: 'r', tabName: 'T', error: null }]),
        run('c1', '客户甲', [{ routeKey: 'r', tabName: 'T', error: '上一轮的旧错' }]),
      ]),
      items,
      NOW,
    )
    expect(items).toHaveLength(0)
  })

  it('只回看最近 2 小时，不把昨天已经好了的问题重新摆出来', async () => {
    const spy: { gte?: string } = {}
    await pushLeadSheetItems(fakeSupabase([], spy), [], NOW)
    expect(spy.gte).toBe('2026-09-24T10:00:00.000Z')
  })

  it('🔴 被跳过的线索必须下发 —— 这些人是真的没到销售手里', async () => {
    // 这条路径上 error 是 null、任务记的是 completed、日报是绿的。
    // 不在这里喊一声就没有任何地方会喊。
    const items: ManualItem[] = []
    await pushLeadSheetItems(
      fakeSupabase([
        run('c1', '客户甲', [
          { routeKey: 'r', tabName: 'T', error: null, skippedNoIdentity: 2, skippedLeadIds: ['x1', 'x2'] },
        ]),
      ]),
      items,
      NOW,
    )
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('lead_sheet_lead_skipped')
    expect(items[0].what).toContain('2 条')
    expect(items[0].how).toContain('x1')
  })

  it('授权不够（403）跟表格坏了给的是两套不同的动手说明', async () => {
    const items: ManualItem[] = []
    await pushLeadSheetItems(
      fakeSupabase([
        run('c1', '甲', [{ routeKey: 'r', tabName: 'T', error: '写目标表格失败：Sheets API 追加失败 (403)' }]),
        run('c2', '乙', [{ routeKey: 'r', tabName: 'T', error: '读目标表格失败：表格不存在' }]),
      ]),
      items,
      NOW,
    )
    expect(items.find((i) => i.client_id === 'c1')?.how).toContain('重新授权')
    expect(items.find((i) => i.client_id === 'c2')?.how).not.toContain('重新授权')
  })

  it('一切正常时一条待办都不出', async () => {
    const items: ManualItem[] = []
    await pushLeadSheetItems(
      fakeSupabase([run('c1', '甲', [{ routeKey: 'r', tabName: 'T', appended: 3, error: null }])]),
      items,
      NOW,
    )
    expect(items).toHaveLength(0)
  })

  it('读运行记录本身失败 → 也要出一条「检查没跑成」，不许静默', async () => {
    // 这条同时是上面那个假对象的**反例校验**：它按真实调用链逐层返回，
    // 链路一旦跟生产侧对不上，这里会抛而不是走进 catch，用例当场红。
    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({
            gte: () => ({ order: async () => ({ data: null, error: { message: '连不上' } }) }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof pushLeadSheetItems>[0]

    const items: ManualItem[] = []
    await pushLeadSheetItems(broken, items, NOW)
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('连不上')
  })
})

/**
 * PM 2026-09-24 拍板「所有表单汇总进一张表」之后，同一个客户的几条路线指向
 * 同一张表是常态。待办必须按**表**说话，不按路线。
 */
describe('几条路线写同一张表时的待办', () => {
  const sheet = 'sheet-1'

  it('🔴 同一张表上两条路线报同一句错 → 只下发一条待办，不让人看见两遍一模一样的话', async () => {
    const items: ManualItem[] = []
    const err = '读目标表格失败，本轮一行都没写：Sheets API 读取失败 (403)'
    await pushLeadSheetItems(
      fakeSupabase([
        run('c1', 'CTS', [
          { routeKey: 'v4', spreadsheetId: sheet, tabName: 'Untitled', error: err },
          { routeKey: 'default', spreadsheetId: sheet, tabName: 'Untitled', error: err },
        ]),
      ]),
      items,
      NOW,
    )
    const failed = items.filter((i) => i.kind === 'lead_sheet_sync_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0].how).toContain('重新授权')
  })

  it('同一张表上两条路线报的错不一样 → 各说各的，不能合并掉', async () => {
    const items: ManualItem[] = []
    await pushLeadSheetItems(
      fakeSupabase([
        run('c1', 'CTS', [
          { routeKey: 'v4', spreadsheetId: sheet, tabName: 'Untitled', error: '读目标表格失败：403' },
          { routeKey: 'default', spreadsheetId: sheet, tabName: 'Untitled', error: '写目标表格失败：500' },
        ]),
      ]),
      items,
      NOW,
    )
    expect(items.filter((i) => i.kind === 'lead_sheet_sync_failed')).toHaveLength(2)
  })

  it('跳过的线索按表加总、编号合在一起 —— 不是两条各报各的半截数', async () => {
    const items: ManualItem[] = []
    await pushLeadSheetItems(
      fakeSupabase([
        run('c1', 'CTS', [
          {
            routeKey: 'v4',
            spreadsheetId: sheet,
            tabName: 'Untitled',
            skippedNoIdentity: 2,
            skippedLeadIds: ['l1', 'l2'],
          },
          {
            routeKey: 'default',
            spreadsheetId: sheet,
            tabName: 'Untitled',
            skippedNoIdentity: 1,
            skippedLeadIds: ['l3'],
          },
        ]),
      ]),
      items,
      NOW,
    )
    const skipped = items.filter((i) => i.kind === 'lead_sheet_lead_skipped')
    expect(skipped).toHaveLength(1)
    expect(skipped[0].what).toContain('3 条线索')
    expect(skipped[0].how).toContain('l3')
  })

  it('没见过的选项按表合并去重 —— 两条路线都报同一个值只说一遍', async () => {
    const items: ManualItem[] = []
    await pushLeadSheetItems(
      fakeSupabase([
        run('c1', 'CTS', [
          { routeKey: 'v4', spreadsheetId: sheet, tabName: 'Untitled', unmappedValues: ['x_tour'] },
          {
            routeKey: 'default',
            spreadsheetId: sheet,
            tabName: 'Untitled',
            unmappedValues: ['x_tour', 'y_tour'],
          },
        ]),
      ]),
      items,
      NOW,
    )
    const unmapped = items.filter((i) => i.kind === 'lead_sheet_value_unmapped')
    expect(unmapped).toHaveLength(1)
    expect(unmapped[0].what).toContain('x_tour、y_tour')
  })

  it('指向两张不同的表 → 还是各下发各的', async () => {
    const items: ManualItem[] = []
    await pushLeadSheetItems(
      fakeSupabase([
        run('c1', 'CTS', [
          { routeKey: 'a', spreadsheetId: 'sheet-1', tabName: 'T1', error: '读目标表格失败：403' },
          { routeKey: 'b', spreadsheetId: 'sheet-2', tabName: 'T2', error: '读目标表格失败：403' },
        ]),
      ]),
      items,
      NOW,
    )
    expect(items.filter((i) => i.kind === 'lead_sheet_sync_failed')).toHaveLength(2)
  })
})

describe('待办里说的是哪张表', () => {
  it('🔴 有人话名字就用人话名字 —— 汇总进一张表之后 tabName 就是个 Untitled', async () => {
    const items: ManualItem[] = []
    await pushLeadSheetItems(
      fakeSupabase([
        run('c1', 'CTS', [
          {
            routeKey: 'v4',
            label: 'CTS 留资汇总 · 问了预算与出发时间的表单',
            spreadsheetId: 'sheet-1',
            tabName: 'Untitled',
            error: '写目标表格失败：500',
          },
        ]),
      ]),
      items,
      NOW,
    )
    expect(items[0].what).toContain('CTS 留资汇总')
    expect(items[0].what).not.toContain('Untitled')
  })

  it('老回执没有 label 时退回 tabName，不要因此炸掉', async () => {
    const items: ManualItem[] = []
    await pushLeadSheetItems(
      fakeSupabase([
        run('c1', 'CTS', [
          { routeKey: 'v4', spreadsheetId: 'sheet-1', tabName: 'Sheet1', error: '写目标表格失败：500' },
        ]),
      ]),
      items,
      NOW,
    )
    expect(items[0].what).toContain('Sheet1')
  })
})

/**
 * 这两个数字以前只在运行记录里躺着涨，没有任何读者 —— 典型的「发现死在日志里」。
 */
describe('算出来但以前没人读的两个数字', () => {
  it('🔴 还有历史线索没补 → 下发一条待办，别让 703 条只在日志里涨', async () => {
    const items: ManualItem[] = []
    await pushLeadSheetItems(
      fakeSupabase([
        run('c1', 'CTS', [
          {
            routeKey: 'v4',
            label: 'CTS 留资汇总',
            spreadsheetId: 'sheet-1',
            tabName: 'Untitled',
            outsideWindow: 400,
          },
          {
            routeKey: 'default',
            label: 'CTS 留资汇总',
            spreadsheetId: 'sheet-1',
            tabName: 'Untitled',
            outsideWindow: 303,
          },
        ]),
      ]),
      items,
      NOW,
    )
    const pending = items.filter((i) => i.kind === 'lead_sheet_backfill_pending')
    expect(pending).toHaveLength(1)
    expect(pending[0].what).toContain('703 条')
    /**
     * 🔴 不许说成「这些人没进表」。窗口外的线索这一轮压根没读、也没跟表格比对过；
     *    目标表格常常有别的管道也在写（CTS 就是），断言「销售看不到」= 每天一条假警。
     */
    expect(pending[0].what).toContain('可能早就在表里')
    expect(pending[0].what).not.toContain('销售在表上看不到')
  })

  it('历史都补完了（0 条）就别再提醒', async () => {
    const items: ManualItem[] = []
    await pushLeadSheetItems(
      fakeSupabase([
        run('c1', 'CTS', [
          { routeKey: 'v4', spreadsheetId: 'sheet-1', tabName: 'Untitled', outsideWindow: 0 },
        ]),
      ]),
      items,
      NOW,
    )
    expect(items.filter((i) => i.kind === 'lead_sheet_backfill_pending')).toHaveLength(0)
  })

  it('🔴 有线索一条路线都没匹配上 → 下发待办（这些人一行都没写进任何表）', async () => {
    const items: ManualItem[] = []
    await pushLeadSheetItems(fakeSupabase([run('c1', 'CTS', [], null, 12)]), items, NOW)
    const unrouted = items.filter((i) => i.kind === 'lead_sheet_unrouted')
    expect(unrouted).toHaveLength(1)
    expect(unrouted[0].what).toContain('12 条')
  })
})
