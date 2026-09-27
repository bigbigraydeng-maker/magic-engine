/**
 * 「广告回拉读不出广告配置」→ 今日待办系统欠账栏（2026-09-25 事故）。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushAdsConfigReadItems } from '../manual-monitoring-items'
import type { ManualItem } from '../manual-item-types'

const NOW = new Date('2026-09-26T09:00:00Z')

/** 记下查询条件，证明查的是这个任务而不是随便哪条运行记录。 */
function fakeLastRun(row: { finished_at: string; summary: unknown } | null, queryError: string | null = null) {
  const calls: Array<[string, unknown[]]> = []
  const chain = {
    select: (...a: unknown[]) => { calls.push(['select', a]); return chain },
    eq: (...a: unknown[]) => { calls.push(['eq', a]); return chain },
    not: (...a: unknown[]) => { calls.push(['not', a]); return chain },
    in: (...a: unknown[]) => { calls.push(['in', a]); return chain },
    order: (...a: unknown[]) => { calls.push(['order', a]); return chain },
    limit: async () => ({ data: row ? [row] : [], error: queryError ? { message: queryError } : null }),
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
          { client_id: 'c1', source: 'ad_config', error: 'column does not exist' },
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
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'ads_config_unreadable', client_id: 'infra' })
    expect(items[0].what).toContain('3 个客户')
    expect(items[0].href.startsWith('https://')).toBe(true)
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
