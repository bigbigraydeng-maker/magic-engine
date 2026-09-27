/**
 * 「广告回拉读不出广告配置」→ 今日待办系统欠账栏（2026-09-25 事故）。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushAdsConfigReadItems } from '../manual-monitoring-items'
import type { ManualItem } from '../manual-item-types'

const NOW = new Date('2026-09-26T09:00:00Z')

/** 记下查询条件，证明查的是这个任务而不是随便哪条运行记录。 */
function fakeLastRun(row: { finished_at: string; summary: unknown } | Array<{ finished_at: string; summary: unknown }> | null, queryError: string | null = null) {
  const calls: Array<[string, unknown[]]> = []
  const chain = {
    select: (...a: unknown[]) => { calls.push(['select', a]); return chain },
    eq: (...a: unknown[]) => { calls.push(['eq', a]); return chain },
    not: (...a: unknown[]) => { calls.push(['not', a]); return chain },
    in: (...a: unknown[]) => { calls.push(['in', a]); return chain },
    order: (...a: unknown[]) => { calls.push(['order', a]); return chain },
    limit: async () => ({ data: row === null ? [] : Array.isArray(row) ? row : [row], error: queryError ? { message: queryError } : null }),
  }
  const client = { from: (t: string) => { calls.push(['from', [t]]); return chain } } as unknown as SupabaseClient
  return { client, calls }
}

describe('pushAdsConfigReadItems', () => {
  it('最近一轮有配置读失败 → 一条系统欠账，按客户去重计数；混在一起的 meta 报错不算', async () => {
    const { client, calls } = fakeLastRun({
      finished_at: '2026-09-25T17:30:00Z',
      summary: {
        errors: [
          { client_id: 'c1', source: 'meta', error: 'token expired' },
          { client_id: 'c1', source: 'ad_config', error: 'ad_strategy_configs read failed — diagnostics, growth state and digest skipped for this client: column ad_strategy_configs.autopilot_enabled does not exist (c0000000-0000-0000-0000-000000000000)' },
          { client_id: 'c2', source: 'ad_config', error: 'column does not exist' },
          { client_id: 'c3', source: 'ad_config', error: 'column does not exist' },
        ],
      },
    })
    const items: ManualItem[] = []
    await pushAdsConfigReadItems(client, items, NOW)

    expect(calls).toContainEqual(['from', ['cron_run_logs']])
    expect(calls).toContainEqual(['eq', ['job_name', 'google-data-pullback-daily']])
    // 这类错误会把那一轮标成 failed —— 只查 completed 就会永远看不见它
    expect(calls).toContainEqual(['in', ['status', ['completed', 'failed']]])
    // 还在跑的那一轮不能算（它的 summary 还没写）
    expect(calls).toContainEqual(['not', ['finished_at', 'is', null]])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'ads_config_unreadable', client_id: 'infra' })
    expect(items[0].what).toContain('3 个客户')
    // 最花钱的后果必须写出来：自动暂停也停了
    expect(items[0].what).toContain('自动暂停')
    // 报错原话带上（分得清「字段没加」还是「临时故障」），但路由拼的前缀和客户 id 不进 PM 邮件
    expect(items[0].what).toContain('autopilot_enabled does not exist')
    expect(items[0].what).not.toContain('for this client')
    expect(items[0].what).not.toContain('c0000000-0000-0000-0000-000000000000')
    expect(items[0].href.startsWith('https://')).toBe(true)
  })

  it('最新一轮是提前结束的空记录 → 往前找到有报错清单的那一轮，不被盖掉', async () => {
    const { client } = fakeLastRun([
      { finished_at: '2026-09-26T08:00:00Z', summary: {} },
      { finished_at: '2026-09-25T17:30:00Z', summary: { errors: [{ client_id: 'c1', source: 'ad_config', error: 'timeout' }] } },
    ])
    const items: ManualItem[] = []
    await pushAdsConfigReadItems(client, items, NOW)
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('1 个客户')
  })

  it('最新一轮有报错清单且没有配置读失败 → 以它为准，不翻旧账', async () => {
    const { client } = fakeLastRun([
      { finished_at: '2026-09-26T03:10:00Z', summary: { errors: [] } },
      { finished_at: '2026-09-25T17:30:00Z', summary: { errors: [{ client_id: 'c1', source: 'ad_config', error: 'timeout' }] } },
    ])
    const items: ManualItem[] = []
    await pushAdsConfigReadItems(client, items, NOW)
    expect(items).toEqual([])
  })

  it('只有别的报错 → 不下发', async () => {
    const { client } = fakeLastRun({
      finished_at: '2026-09-26T03:10:00Z',
      summary: { errors: [{ client_id: 'c1', source: 'meta', error: 'token expired' }] },
    })
    const items: ManualItem[] = []
    await pushAdsConfigReadItems(client, items, NOW)
    expect(items).toEqual([])
  })

  it('最近一轮超过 30 小时 → 旧账不再报（该跑没跑由任务体检那条管）', async () => {
    const { client } = fakeLastRun({
      finished_at: '2026-09-25T01:00:00Z',
      summary: { errors: [{ client_id: 'c1', source: 'ad_config', error: 'x' }] },
    })
    const items: ManualItem[] = []
    await pushAdsConfigReadItems(client, items, NOW)
    expect(items).toEqual([])
  })

  it('查询本身出错 → 抛出，由调用方记录（不能当成「没问题」）', async () => {
    const { client } = fakeLastRun(null, 'permission denied')
    await expect(pushAdsConfigReadItems(client, [], NOW)).rejects.toThrow('permission denied')
  })
})
