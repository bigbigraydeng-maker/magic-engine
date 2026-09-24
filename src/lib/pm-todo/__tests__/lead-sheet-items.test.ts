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

function run(clientId: string, name: string, routes: unknown[], error: string | null = null) {
  return {
    job_name: 'lead-sheet-sync',
    status: 'completed',
    started_at: '2026-09-24T11:20:00Z',
    summary: { results: [{ clientId, clientName: name, routes, error }] },
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
