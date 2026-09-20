/**
 * 「留资同步卡在授权上」的人工待办。
 *
 * 🔴 这条通道是铁律 3 下半的出口：2026-09-20 起定时任务**不再**为这类卡点整体
 *    判失败，所以它不下发 = 这件事彻底没人知道（连那行红记录都没有了）。
 */

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildLeadsSyncBlockedTodo,
  fetchLeadsSyncBlockedTodos,
} from '../leads-sync-blocked-items'

const NOW = new Date('2026-09-20T02:00:00Z')

/** 2026-09-20 生产 `cron_run_logs` 最新一轮的真实形状。 */
const REAL_RESULTS = [
  {
    clientId: '377468af-b103-45f0-984a-b353febb56a1',
    clientName: 'Magic Lab Class',
    blocked: 'token_rejected',
    error: 'leadgen_forms HTTP 400: {"error":{"message":"Any of the pages_read_engagement, ... permission(s) must be granted before impersonating a user\'s page.","code":190}}',
  },
  {
    clientId: '4ae76381-cd45-43bd-85cd-98cfd7604007',
    clientName: 'New Asian Logistics',
    blocked: 'token_rejected',
    error: 'leadgen_forms HTTP 400: {"error":{"code":190}}',
  },
  { clientId: 'c0000000-0000-0000-0000-000000000000', clientName: 'CTS Tours NZ' },
  { clientId: 'e7465ac7-4f3d-4d6a-afbe-d036ab419708', clientName: 'Roman HU' },
  {
    clientId: '3f3617f5-2124-475d-9212-6f8c14f0b0e2',
    clientName: 'NZCPE 2026',
    blocked: 'page_binding_unverified',
    error: '主页绑定没核实，线索同步已暂停（unverified_shared_token）',
  },
]

/** 只答一条 cron_run_logs 查询的假库。 */
function fakeDb(run: { finished_at: string | null; summary: unknown } | null): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: run ? [run] : [], error: null }),
  }
  return { from: () => chain } as unknown as SupabaseClient
}

describe('buildLeadsSyncBlockedTodo', () => {
  it('令牌被拒 → 一条待办，what 说清「客人进不了 CRM」而不是只报个错误码', () => {
    const t = buildLeadsSyncBlockedTodo(REAL_RESULTS[0])!
    expect(t.kind).toBe('leads_sync_authorization_blocked')
    expect(t.client_name).toBe('Magic Lab Class')
    expect(t.what).toContain('进不了 CRM')
    // Meta 的原话要带上，否则查起来只能靠猜
    expect(t.what).toContain('Meta 的原话')
  })

  it('三件套齐全：what / how / href，href 必须是绝对网址（相对路径会被链接闸丢掉）', () => {
    const t = buildLeadsSyncBlockedTodo(REAL_RESULTS[0])!
    expect(t.what.length).toBeGreaterThan(20)
    expect(t.how).toContain('连接 Meta')
    expect(t.href).toMatch(/^https:\/\//)
    // FacebookPagePanel 只在设置抽屉的 platform 页签里，链到 /settings 会让人白跑
    expect(t.href).toContain('?settings=platform')
    expect(t.href).toContain(REAL_RESULTS[0].clientId)
  })

  it('缺权限那一类也下发，话术换成「少了读表单要的权限」', () => {
    const t = buildLeadsSyncBlockedTodo({
      clientId: 'x', clientName: 'X', blocked: 'missing_permission', error: '(#200)',
    })!
    expect(t.what).toContain('leads_retrieval')
  })

  it('🔴 绑定没核实那一类不在这里下发 —— page-binding-items.ts 已经在管，重复=待办里出现两次', () => {
    expect(buildLeadsSyncBlockedTodo(REAL_RESULTS[4])).toBeNull()
  })

  it('跑通的客户不下发', () => {
    expect(buildLeadsSyncBlockedTodo(REAL_RESULTS[2])).toBeNull()
  })

  it('认不出来的 blocked 值（历史记录 / 以后新加的）不下发，不拿看不懂的话占 PM 时间', () => {
    expect(buildLeadsSyncBlockedTodo({ clientId: 'x', blocked: 'something_new' })).toBeNull()
  })

  it('没有 clientId 的脏行不下发 —— 这是落库的旧数据，当外部输入处理', () => {
    expect(buildLeadsSyncBlockedTodo({ clientName: 'X', blocked: 'token_rejected' })).toBeNull()
  })
})

describe('fetchLeadsSyncBlockedTodos', () => {
  it('🔴 2026-09-20 那一轮：卡住的两家各出一条，跑通的两家不出', async () => {
    const todos = await fetchLeadsSyncBlockedTodos(
      fakeDb({ finished_at: '2026-09-20T00:25:36Z', summary: { results: REAL_RESULTS } }),
      NOW,
    )
    expect(todos.map((t) => t.client_name)).toEqual(['Magic Lab Class', 'New Asian Logistics'])
  })

  it('运行记录太旧就不说话 —— 「该跑没跑」有 cron 健康检查在管，这里不重复报', async () => {
    const todos = await fetchLeadsSyncBlockedTodos(
      fakeDb({ finished_at: '2026-09-19T00:25:36Z', summary: { results: REAL_RESULTS } }),
      NOW,
    )
    expect(todos).toEqual([])
  })

  it('一条运行记录都没有 → 不报（不是「一切正常」，是这里说不了话）', async () => {
    expect(await fetchLeadsSyncBlockedTodos(fakeDb(null), NOW)).toEqual([])
  })

  it('跑到一半没写完 finished_at 的记录不用', async () => {
    const todos = await fetchLeadsSyncBlockedTodos(
      fakeDb({ finished_at: null, summary: { results: REAL_RESULTS } }),
      NOW,
    )
    expect(todos).toEqual([])
  })
})
