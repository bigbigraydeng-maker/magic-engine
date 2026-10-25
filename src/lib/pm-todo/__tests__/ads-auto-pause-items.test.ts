/**
 * D3 暂停待批准 → 今日待办。
 *
 * 🔴 验收「一条等批准的暂停，今日待办里只出现一条」必须**两个来源一起测**：
 *    通用 handoff（`fetchKernelHandoffTodos`，manual-items 的 pushKernelItems 调它）
 *    和专属待办（`pushAdsAutoPauseItems`）分开测都绿、合起来却一条都没有 / 出两条，
 *    正是魏征 2026-09-26 指出的「两边对不上照样全绿」。所以这里在**同一个假库**上
 *    跑两个来源，再过一遍坏链接过滤。
 *    （不直接调 `loadManualItems`：它会查二十多张别的表，假库对没建模的表一律抛错，
 *     测试会变成在给无关的表凑数据。manual-items 里这两路只是原样 push，没有别的加工。）
 */

import { describe, it, expect } from 'vitest'
import { createFakeSupabase, type Row, type FakeSupabaseOptions } from '@/lib/kernel/__tests__/fake-supabase'
import { fetchKernelHandoffTodos } from '@/lib/kernel/handoff'
import { dropBrokenLinks, type ManualItem } from '../manual-item-types'
import { pushAdsAutoPauseItems } from '../ads-auto-pause-items'

const D3 = 'ads.auto_pause_on_d3'
const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const RUN = '00000000-0000-4000-8000-000000000001'
const DEC = '00000000-0000-4000-8000-000000000002'
const NOW = new Date('2026-09-26T09:00:00.000Z')

function tables(opts: { decisionMatches?: boolean } = {}) {
  const runs: Row[] = [{
    id: RUN, client_id: CLIENT, action_key: D3, action_version: 1, idempotency_key: 'k1',
    status: 'pending_approval', needs_human: true, authorization_decision_id: DEC, last_error: null,
    input: { ad_account_id: 'act_1', adset_id: 'adset-9', diagnosis_code: 'D3', insight_date: '2026-09-25' },
    rationale: '「圣诞团」连续 3 天花钱没结果', created_at: '2026-09-25T20:00:00Z', updated_at: '2026-09-25T20:00:00Z',
  }]
  const decisions: Row[] = [{
    id: DEC, action_run_id: opts.decisionMatches === false ? 'someone-else' : RUN, client_id: CLIENT,
    action_key: D3, action_version: 1, idempotency_key: 'k1', verdict: 'require_approval',
  }]
  // 🔴 账表一行都没有 —— 「提交成功、写账失败」的孤儿形状
  return { action_runs: runs, authorization_decisions: decisions, flywheel_actions: [] as Row[] }
}

const okFetch: typeof fetch = async () => new Response(null, { status: 200 })

async function bothSources(t = tables()): Promise<ManualItem[]> {
  const sb = createFakeSupabase(t)
  const items: ManualItem[] = []
  await pushAdsAutoPauseItems(sb, items, () => 'CTS Tours NZ')
  for (const todo of await fetchKernelHandoffTodos(sb, NOW)) {
    items.push({ kind: 'kernel_needs_human', client_id: todo.client_id, client_name: 'CTS Tours NZ', what: todo.what, how: todo.how, href: todo.href })
  }
  return (await dropBrokenLinks(items, okFetch)).kept
}

describe('🔴 一条等批准的暂停，今日待办里恰好一条', () => {
  it('账表漏记的孤儿 run → 恰好一条专属待办，链接来自登记表，过完坏链接过滤还在', async () => {
    const kept = await bothSources()
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({
      kind: 'ads_auto_pause_pending',
      client_id: CLIENT,
      href: `https://app.magicengine.com.au/dashboard/clients/${CLIENT}/ads-health?tab=approvals`,
    })
    expect(kept[0].what).toContain('圣诞团')
    expect(`${kept[0].what}${kept[0].how}`).not.toContain('还没上线')
  })

  it('🔴 审批记录对不上的 run → 仍是恰好一条，待办说「回我一句」，不说「点批准」', async () => {
    const kept = await bothSources(tables({ decisionMatches: false }))
    expect(kept).toHaveLength(1)
    expect(kept[0].how).toContain('回我一句')
    expect(kept[0].how).not.toContain('点「批准」')
  })
})

describe('🔴 专属待办读失败也要下发，不只打日志', () => {
  it('读 action_runs 失败 → 一条「读不出来」', async () => {
    const opts: FakeSupabaseOptions = { failOn: [{ table: 'action_runs', op: 'select', message: 'boom' }] }
    const sb = createFakeSupabase(tables(), opts)
    const items: ManualItem[] = []
    await pushAdsAutoPauseItems(sb, items, () => 'x')
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('读不出来')
    expect(items[0].how).toContain('回我一句')
  })
})

describe('🔴 积压超过上限要说出来，不静默截掉', () => {
  it('101 条等批准 → 100 条待办 + 1 条「超过 100 条」', async () => {
    const runs: Row[] = []
    const decisions: Row[] = []
    for (let i = 0; i < 101; i++) {
      const id = `00000000-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`
      const dec = `00000000-0000-4000-9000-${String(1000 + i).padStart(12, '0')}`
      runs.push({
        id, client_id: CLIENT, action_key: D3, action_version: 1, idempotency_key: `k${i}`,
        status: 'pending_approval', needs_human: true, authorization_decision_id: dec, last_error: null,
        input: { adset_id: `adset-${i}` }, rationale: '花钱没结果',
        created_at: new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString(),
      })
      decisions.push({
        id: dec, action_run_id: id, client_id: CLIENT, action_key: D3, action_version: 1,
        idempotency_key: `k${i}`, verdict: 'require_approval',
      })
    }
    const sb = createFakeSupabase({ action_runs: runs, authorization_decisions: decisions, flywheel_actions: [] })
    const items: ManualItem[] = []
    await pushAdsAutoPauseItems(sb, items, () => 'x')
    expect(items).toHaveLength(101)
    expect(items.at(-1)!.what).toContain('超过 100 条')
    expect(items.at(-1)!.how).toContain('回我一句')
  })
})
