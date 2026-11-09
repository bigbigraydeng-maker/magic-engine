/**
 * 「广告回拉读不出广告配置」→ 今日待办系统欠账栏（2026-09-25 事故）。
 */

import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/seo/url-kind', () => ({ isHtmlPageUrl: () => true }))

import { pushAdsConfigReadItems, pushAdsAutoPauseConfigReadItems } from '../manual-monitoring-items'
import { loadManualItems } from '../manual-items'
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
    // 按参数截断，「拿几轮」才真的被测到（子牙复审：假库不管 limit，只拿 1 轮的变异没被抓）
    limit: async (n: number) => ({ data: (row === null ? [] : Array.isArray(row) ? row : [row]).slice(0, n), error: queryError ? { message: queryError } : null }),
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

/**
 * 接线：走完整的今日待办构建，这一条必须出现。
 * 🔴 子牙 / 魏征复审：把 manual-items.ts 里调用新检查那一行换成空操作，pm-todo 全部测试照样绿 ——
 *    「声明了没接上」。这条钉住接线本身。
 */
describe('loadManualItems 接上了 pushAdsConfigReadItems', () => {
  function wholeDbFake(withAutoPause = false) {
    const from = (table: string) => {
      const filters: Record<string, unknown> = {}
      const chain: Record<string, unknown> = {}
      const rec = (k: unknown, v: unknown) => { filters[String(k)] = v; return chain }
      chain.select = () => chain
      chain.eq = (k: unknown, v: unknown) => rec(k, v)
      chain.in = (k: unknown, v: unknown) => rec(k, v)
      chain.not = () => chain
      chain.is = () => chain
      chain.gte = () => chain
      chain.lte = () => chain
      chain.lt = () => chain
      chain.contains = () => chain
      chain.order = () => chain
      chain.range = () => chain
      chain.limit = () => chain
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null })
      chain.single = () => Promise.resolve({ data: null, error: null })
      chain.then = (res: (v: { data: unknown; error: null }) => unknown) => {
        if (table === 'cron_run_logs' && filters.job_name === 'google-data-pullback-daily') {
          return res({
            data: [{
              finished_at: '2026-09-25T17:30:00Z',
              summary: { errors: [{ client_id: 'c1', source: 'ad_config', error: 'column ad_strategy_configs.autopilot_enabled does not exist' }] },
            }],
            error: null,
          })
        }
        if (withAutoPause && table === 'flywheel_actions' && filters.action_type === 'ads.auto_pause_on_d3') {
          return res({ data: [{ client_id: 'c2', payload: { config_read_error: 'timeout' } }], error: null })
        }
        return res({ data: [], error: null })
      }
      return chain
    }
    return { from } as unknown as SupabaseClient
  }

  it('一轮带配置读失败的运行记录 → 完整构建出来的今日待办里有这一条', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const items = await loadManualItems(wholeDbFake(), NOW)
    const hit = items.filter((i) => i.kind === 'ads_config_unreadable')
    expect(hit).toHaveLength(1)
    expect(hit[0].what).toContain('1 个客户')
    vi.restoreAllMocks()
  })

  it('自动暂停自己读失败的回执 → 完整构建出来的今日待办里也有一条', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const items = await loadManualItems(wholeDbFake(true), NOW)
    const hit = items.filter((i) => i.kind === 'ads_config_unreadable' && i.what.includes('坏广告自动暂停有'))
    expect(hit).toHaveLength(1)
    vi.restoreAllMocks()
  })
})

describe('pushAdsAutoPauseConfigReadItems', () => {
  function fakeReceipts(rows: Array<{ client_id: string; payload: unknown }>, queryError: string | null = null) {
    const calls: Array<[string, unknown[]]> = []
    const chain = {
      select: (...a: unknown[]) => { calls.push(['select', a]); return chain },
      eq: (...a: unknown[]) => { calls.push(['eq', a]); return chain },
      gte: (...a: unknown[]) => { calls.push(['gte', a]); return chain },
      not: (...a: unknown[]) => { calls.push(['not', a]); return chain },
      limit: async () => ({ data: rows, error: queryError ? { message: queryError } : null }),
    }
    const client = { from: (t: string) => { calls.push(['from', [t]]); return chain } } as unknown as SupabaseClient
    return { client, calls }
  }

  it('30 小时内有读设置失败的回执 → 一条系统欠账，按客户去重，客户 id 不进邮件', async () => {
    const { client, calls } = fakeReceipts([
      { client_id: 'c1', payload: { config_read_error: 'canceling statement due to timeout (c0000000-0000-0000-0000-000000000000)' } },
      { client_id: 'c1', payload: { config_read_error: 'timeout' } },
      { client_id: 'c2', payload: { config_read_error: 'timeout' } },
    ])
    const items: ManualItem[] = []
    await pushAdsAutoPauseConfigReadItems(client, items, NOW)

    expect(calls).toContainEqual(['from', ['flywheel_actions']])
    expect(calls).toContainEqual(['eq', ['action_type', 'ads.auto_pause_on_d3']])
    expect(calls).toContainEqual(['gte', ['created_at', '2026-09-25T03:00:00.000Z']])
    expect(calls).toContainEqual(['not', ['payload->>config_read_error', 'is', null]])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'ads_config_unreadable', client_id: 'infra' })
    expect(items[0].what).toContain('2 个客户')
    expect(items[0].what).toContain('canceling statement due to timeout')
    expect(items[0].what).not.toContain('c0000000-0000-0000-0000-000000000000')
  })

  it('没有这类回执 → 不下发', async () => {
    const { client } = fakeReceipts([])
    const items: ManualItem[] = []
    await pushAdsAutoPauseConfigReadItems(client, items, NOW)
    expect(items).toEqual([])
  })

  it('查询本身出错 → 抛出（不能当成「没问题」）', async () => {
    const { client } = fakeReceipts([], 'permission denied')
    await expect(pushAdsAutoPauseConfigReadItems(client, [], NOW)).rejects.toThrow('permission denied')
  })
})
