/**
 * 「本周方案已更新」这条待办的报数。
 *
 * 🔴 为什么单开一个文件锁这几个数：**三轮复审里有三次缺陷落在同一个函数、
 *    同一个类型上**，每次都靠人读出来，测试一次都没帮上忙 ——
 *      第二轮：作废条数用时间窗数 → 同一份方案周二说 0 个、周日说 60 个
 *      第三轮：被诸葛亮的看板卡污染 → 报「收起了 9 个」而实际一条没收
 *      第四轮：动作总数缺同一个过滤 → 同一个日期、数字却一天比一天大
 *    根子是**写侧（清理逻辑）和读侧（报数）必须口径一致**，而这正是最容易在
 *    后续改动里悄悄分家的耦合。这里只锁这一件事，不测文案。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/seo/url-kind', () => ({ isHtmlPageUrl: () => true }))

import { loadManualItems } from '../manual-items'
import { AUTO_LANDED_AGENT } from '@/lib/diagnostic/auto-prescribe'

const NOW = new Date('2026-08-11T00:00:00Z')

interface Row {
  id: string
  initiative_id?: string | null
  steps_json?: Record<string, unknown> | null
  status?: string
}

/** 记录每一次对 execution_items 发出的查询条件。 */
function fakeSupabase(opts: {
  items?: Row[]
  droppedItems?: Row[]
  goalTitle?: string | null
  supersedesId?: string | null
}) {
  const itemQueries: Array<Record<string, unknown>> = []

  const from = (table: string) => {
    const filters: Record<string, unknown> = {}
    const chain: Record<string, unknown> = {}
    const rec = (k: unknown, v: unknown) => {
      filters[String(k)] = v
      return chain
    }
    chain.select = () => chain
    chain.eq = (k: unknown, v: unknown) => rec(k, v)
    chain.in = (k: unknown, v: unknown) => rec(k, v)
    chain.not = (k: unknown, _op: unknown, v: unknown) => rec(k, v)
    chain.gte = (k: unknown, v: unknown) => rec(k, v)
    chain.order = () => chain
    // fetchAll pages the clients query now — without this the chain never resolves.
    chain.range = () => chain
    chain.limit = () => chain
    chain.maybeSingle = () =>
      Promise.resolve({
        data: table === 'goals' ? { title: opts.goalTitle ?? '目标一号' } : null,
        error: null,
      })
    chain.then = (res: (v: { data: unknown; error: null }) => unknown) => {
      if (table === 'execution_items') {
        itemQueries.push({ ...filters })
        // 按 prescription_id 分辨：查的是这份新方案的动作，还是上一版被收起的
        const isDropped = filters.status === 'superseded'
        return res({ data: isDropped ? (opts.droppedItems ?? []) : (opts.items ?? []), error: null })
      }
      if (table === 'prescriptions') {
        return res({
          data: [
            {
              id: 'p-new',
              client_id: 'c1',
              goal_id: opts.goalTitle === null ? null : 'g1',
              approved_at: '2026-08-11T08:10:00.000Z',
              agent_name: AUTO_LANDED_AGENT,
              supersedes_id: opts.supersedesId ?? null,
            },
          ],
          error: null,
        })
      }
      if (table === 'clients') {
        return res({ data: [{ id: 'c1', name: 'CTS Tours NZ', domain: 'ctstours.co.nz' }], error: null })
      }
      return res({ data: [], error: null })
    }
    return chain
  }
  return { supabase: { from } as never, itemQueries }
}

async function runAndGetItem(opts: Parameters<typeof fakeSupabase>[0]) {
  const { supabase, itemQueries } = fakeSupabase(opts)
  const items = await loadManualItems(supabase, NOW)
  return { item: items.find((i) => i.kind === 'prescription_updated'), itemQueries }
}

beforeEach(() => vi.clearAllMocks())

describe('方案更新通知的报数 —— 读侧口径必须跟清理侧一致', () => {
  it('🔴 每一个查执行项的请求都必须带 source=diagnostic —— 诸葛亮的看板卡也挂同一个方案号', async () => {
    const { itemQueries } = await runAndGetItem({
      items: [{ id: 'a', initiative_id: 'i1' }],
      supersedesId: 'p-old',
      droppedItems: [{ id: 'x', status: 'superseded' }],
    })
    // ⚠️ 只看**报数这条链**发出的查询 —— 判据是「按方案号查动作」。
    //    同一张表上另有别的功能在查（自动执行循环要看全部来源的待办动作），
    //    那些不归这条口径管；一刀切成「所有查询都必须带 source」会把它们误伤。
    const reportQueries = itemQueries.filter((q) => q.prescription_id !== undefined)
    expect(reportQueries.length).toBeGreaterThan(0)
    for (const q of reportQueries) {
      expect(q.source).toBe('diagnostic')
    }
  })

  it('🔴 FDE 手工加的活不计进「新增 N 个动作」—— 它的来源列也是 diagnostic，只有正文里认得出', async () => {
    const { item } = await runAndGetItem({
      items: [
        { id: 'auto1', initiative_id: 'i1' },
        { id: 'auto2', initiative_id: 'i1' },
        { id: 'byhand', initiative_id: null, steps_json: { source: 'fde_manual_add' } },
      ],
    })
    expect(item!.what).toContain('新增 2 个动作')
    expect(item!.what).not.toContain('新增 3 个动作')
  })

  it('🔴 手工加的也不算进「还没归类」—— 否则请 PM 切到「全部」，他看到的是自己昨天加的东西', async () => {
    const { item } = await runAndGetItem({
      items: [
        { id: 'auto1', initiative_id: 'i1' },
        { id: 'byhand', initiative_id: null, steps_json: { source: 'fde_manual_add' } },
      ],
    })
    expect(item!.what).toContain('全部排在目标')
    expect(item!.what).not.toContain('还没归类')
  })

  it('🔴 挂上目标的和没挂上的要分开数 —— 「其余 M 个还没归类」是 PM 判断要不要找我修的唯一信号', async () => {
    const { item } = await runAndGetItem({
      items: [
        { id: 'a', initiative_id: 'i1' },
        { id: 'b', initiative_id: 'i1' },
        { id: 'c', initiative_id: null },
        { id: 'd', initiative_id: null },
      ],
    })
    expect(item!.what).toContain('新增 4 个动作')
    expect(item!.what).toContain('其中 2 个排在目标')
    expect(item!.what).toContain('其余 2 个还没归类')
  })

  it('🔴 一个都没挂上时要明说「按目标筛看板会看不到」，不能含糊过去', async () => {
    const { item } = await runAndGetItem({
      items: [{ id: 'a', initiative_id: null }, { id: 'b', initiative_id: null }],
    })
    expect(item!.what).toContain('一个都没归类上')
    expect(item!.how).toContain('全部')
  })

  it('🔴 「收起了 N 个」同样排掉手工加的', async () => {
    const { item } = await runAndGetItem({
      items: [{ id: 'auto1', initiative_id: 'i1' }],
      supersedesId: 'p-old',
      droppedItems: [
        { id: 'old1', status: 'superseded' },
        { id: 'oldhand', status: 'superseded', steps_json: { source: 'fde_manual_add' } },
      ],
    })
    expect(item!.what).toContain('还没开始做的 1 个已经收起来了')
  })

  it('没有上一版时，不提「收起来」这件事', async () => {
    const { item } = await runAndGetItem({
      items: [{ id: 'auto1', initiative_id: 'i1' }],
      supersedesId: null,
    })
    expect(item!.what).not.toContain('收起来')
  })

  it('🔴 steps_json 里没有 source 这个键的照常计入 —— 库里 116 条有 113 条是这样', async () => {
    // 这条防的是「在 SQL 里写 NOT (steps_json->>source = 'x')」那种修法：
    // 缺失的键比出来是 NULL 不是 true，会把绝大多数行全过滤掉、数字恒等于 0
    const { item } = await runAndGetItem({
      items: [
        { id: 'a', initiative_id: 'i1', steps_json: null },
        { id: 'b', initiative_id: 'i1', steps_json: {} },
        { id: 'c', initiative_id: 'i1', steps_json: { note: '别的东西' } },
      ],
    })
    expect(item!.what).toContain('新增 3 个动作')
  })

  it('一个动作都没排出来 → 说这周没往前推，并且自己抢眼', async () => {
    const { item } = await runAndGetItem({ items: [] })
    expect(item!.what).toContain('⚠️')
    expect(item!.what).toContain('等于这周没往前推')
  })
})
