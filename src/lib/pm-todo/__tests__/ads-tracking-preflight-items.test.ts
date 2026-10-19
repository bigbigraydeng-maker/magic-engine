/**
 * 今日待办里的「开投前追踪检查」：读每日函数留下的回执，不自己现算。
 * 假的 cron_run_logs；只读（假库没有任何写方法，调用就会抛错）。
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/ads-tracking-preflight/client-config', () => ({
  listTrackingClientIds: () => ['c1'],
  getTrackingClientConfig: () => null,
}))

import type { ManualItem } from '../manual-item-types'
import { NEVER_DROP_KINDS } from '../manual-item-types'
import { pushAdsTrackingPreflightItems } from '../ads-tracking-preflight-items'
import { BLIND_SPOT_NOTE, LANE_OF_KIND } from '../five-kinds'
import { TRACKING_PREFLIGHT_JOB, buildClientReceipt, buildRunReceipt } from '@/lib/ads-tracking-preflight/receipt'
import { HARD_GATE, type TrackingClientReceipt, type TrackingGateKey, type TrackingGateReceipt, type TrackingRunReceipt } from '@/lib/ads-tracking-preflight/types'

const nameOf = (id: string) => (id === 'c1' ? '客户甲' : '未知客户')
const NOW = new Date('2026-10-19T20:00:00Z')
const LINKS = { fallback: 'https://app.example.test/plan' }

const gate = (key: TrackingGateKey, status: TrackingGateReceipt['status']): TrackingGateReceipt => ({
  key, status, reason: `原因-${key}`, how: `怎么办-${key}`, evidence: {}, as_of: null, hard: HARD_GATE[key],
})

function clientReceipt(clientId: string, gates: TrackingGateReceipt[], checkedAt = '2026-10-19T18:00:00Z'): TrackingClientReceipt {
  return buildClientReceipt({ requestId: `r-${clientId}`, clientId, checkedAt, trigger: 'cron', phase: 'preflight', gates, readErrors: [], links: LINKS })
}

function runReceipt(clients: TrackingClientReceipt[], checkedAt = '2026-10-19T18:00:00Z'): TrackingRunReceipt {
  return buildRunReceipt({ requestId: 'run', checkedAt, trigger: 'cron', clients })
}

interface Row { status: string | null; started_at: string; error_message: string | null; summary: unknown }
function fakeSupabase(rows: Row[] | null, queryError: string | null = null): SupabaseClient {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.gte = () => chain
  chain.order = () => chain
  chain.limit = async () => (queryError ? { data: null, error: { message: queryError } } : { data: rows, error: null })
  // 假库只实现被测代码真会调用的链式方法（已跑：每条用例都走过它），和 promo-plan-watch-items.test.ts 同款写法
  return { from: (t: string) => { if (t !== 'cron_run_logs') throw new Error(`不该读这张表：${t}`); return chain } } as unknown as SupabaseClient
}

const run = async (rows: Row[] | null, err: string | null = null): Promise<ManualItem[]> => {
  const items: ManualItem[] = []
  await pushAdsTrackingPreflightItems(fakeSupabase(rows, err), items, nameOf, NOW)
  return items
}
const run_ = run
const okRow = (summary: unknown, startedAt = '2026-10-19T18:00:00Z', status: string | null = 'completed'): Row => ({
  status, started_at: startedAt, error_message: null, summary,
})

describe('检查自己没跑成时，一定要出声（不能静默）', () => {
  it('读不到运行记录 → 一条开发欠账待办', async () => {
    const out = await run(null, '连不上库')
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('ads_tracking_preflight_broken')
    expect(out[0].what).toContain('连不上库')
  })

  it('两周内一条运行记录都没有 → 欠账，指向 Inngest 后台（多半没同步）', async () => {
    const out = await run([])
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('ads_tracking_preflight_broken')
    expect(out[0].what).toContain('没有任何运行记录')
    expect(out[0].href).toContain('inngest')
  })

  it('最近一轮停在「在跑」超过 2 小时 → 欠账；2 小时内不吵', async () => {
    expect(await run([okRow(null, '2026-10-19T17:00:00Z', 'running')])).toHaveLength(1)
    expect(await run([okRow(null, '2026-10-19T19:00:00Z', 'running')])).toEqual([])
  })

  it('最近一轮是失败 → 欠账，带原因', async () => {
    const out = await run([{ status: 'failed', started_at: '2026-10-19T18:00:00Z', error_message: '重试耗尽后仍失败：炸了', summary: null }])
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('ads_tracking_preflight_broken')
    expect(out[0].what).toContain('炸了')
  })

  it('最近一轮已经是 36 小时前 → 欠账（没人在每天查）', async () => {
    const old = '2026-10-18T05:00:00Z'
    const out = await run([okRow(runReceipt([clientReceipt('c1', [gate('tracking.pixel_alive', 'green')], old)], old), old)])
    expect(out.some(i => i.kind === 'ads_tracking_preflight_broken' && i.what.includes('超过一天'))).toBe(true)
  })

  it('回执读不懂（格式不对）→ 欠账', async () => {
    const out = await run([okRow({ nonsense: true })])
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('ads_tracking_preflight_broken')
  })

  it('整轮回执自己说有问题（比如叫醒事件里的客户没配置）→ 欠账，带原因', async () => {
    const partial: TrackingRunReceipt = { ...runReceipt([]), status: 'partial', error: '这个客户没有配置开投前追踪检查，不去猜' }
    const out = await run([okRow(partial)])
    expect(out.some(i => i.kind === 'ads_tracking_preflight_broken' && i.what.includes('没有配置'))).toBe(true)
  })

  it('只是某个客户的部分读取失败（比如 GA4 没连）→ 不再另出「这一轮报了问题」的欠账：看板上的灰灯和红灯待办已经说了', async () => {
    const withReadError: TrackingClientReceipt = {
      ...clientReceipt('c1', [gate('tracking.pixel_alive', 'green')]),
      read_errors: [{ source: 'ga4', error: '这个客户还没有可用的 Google 授权' }],
    }
    const run = { ...runReceipt([withReadError]), status: 'partial' as const, error: '1 个客户有一部分没读到，详见各客户回执' }
    expect(await run_([okRow(run)])).toEqual([])
  })

  it('配置了追踪检查的客户在最近几轮里一份回执都没有 → 这个客户一条欠账', async () => {
    const out = await run([okRow(runReceipt([clientReceipt('someone-else', [gate('tracking.pixel_alive', 'green')])]))])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'ads_tracking_preflight_broken', client_id: 'c1', client_name: '客户甲' })
  })

  it('这个客户的回执本身超过 36 小时没更新（哪怕有更新的一轮只查了别人）→ 欠账', async () => {
    const stale = '2026-10-18T05:00:00Z'
    const rows = [
      okRow(runReceipt([clientReceipt('someone-else', [gate('tracking.pixel_alive', 'green')])]), '2026-10-19T18:00:00Z'),
      okRow(runReceipt([clientReceipt('c1', [gate('tracking.pixel_alive', 'red')], stale)], stale), stale),
    ]
    const out = await run(rows)
    expect(out.filter(i => i.client_id === 'c1')).toHaveLength(1)
    expect(out.find(i => i.client_id === 'c1')?.kind).toBe('ads_tracking_preflight_broken')
  })
})

describe('红灯 → 待办三件套（问题和影响 / 怎么做 / 直达链接）', () => {
  it('回执里的红灯待办原样下发，归开发欠账，客户名取自名单', async () => {
    const receipt = clientReceipt('c1', [gate('tracking.pixel_alive', 'red'), gate('tracking.landing_ok', 'green')])
    const out = await run([okRow(runReceipt([receipt]))])
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      kind: 'ads_tracking_preflight_fix', client_id: 'c1', client_name: '客户甲',
      what: receipt.items[0].what, how: receipt.items[0].how, href: receipt.items[0].href,
    })
    expect(out[0].what).toContain('像素在线')
    expect(out[0].how).toBeTruthy()
    expect(out[0].href).toBeTruthy()
  })

  // 🔴 审查整改：开投后读回把早上的红灯待办顶掉、让 36 小时判据被读回刷新
  const postRow = (clientId: string, checkedAt: string): Row => {
    const post = buildClientReceipt({
      requestId: `post-${clientId}`, clientId, checkedAt, trigger: 'postlaunch', phase: 'post_t1h', launchedAt: checkedAt,
      gates: [gate('post.t1h', 'green')], readErrors: [], links: LINKS,
    })
    return okRow(buildRunReceipt({ requestId: 'run-post', checkedAt, trigger: 'postlaunch', clients: [post] }), checkedAt)
  }

  it('更新的一轮是开投后读回 → 早上那份回执里的红灯待办仍然在（不被读回顶掉）', async () => {
    const morning = clientReceipt('c1', [gate('tracking.pixel_alive', 'red')], '2026-10-19T18:00:00Z')
    const out = await run([postRow('c1', '2026-10-19T19:30:00Z'), okRow(runReceipt([morning]), '2026-10-19T18:00:00Z')])
    expect(out.filter(i => i.kind === 'ads_tracking_preflight_fix')).toHaveLength(1)
    expect(out.find(i => i.kind === 'ads_tracking_preflight_fix')?.what).toContain('像素在线')
  })

  it('开投前回执已经超过 36 小时，只有开投后读回是新的 → 照样报「回执没更新」（读回不能刷新这个判据）', async () => {
    const stale = '2026-10-18T05:00:00Z'
    const out = await run([
      postRow('c1', '2026-10-19T19:30:00Z'),
      okRow(runReceipt([clientReceipt('c1', [gate('tracking.pixel_alive', 'green')], stale)], stale), stale),
    ])
    expect(out.some(i => i.kind === 'ads_tracking_preflight_broken' && i.client_id === 'c1')).toBe(true)
  })

  it('全绿 → 一条待办都没有（没事就是空，不出「一切正常」）', async () => {
    const out = await run([okRow(runReceipt([clientReceipt('c1', [gate('tracking.pixel_alive', 'green')])]))])
    expect(out).toEqual([])
  })

  it('硬门灰（没读到）也下发；软门灰不下发', async () => {
    const receipt = clientReceipt('c1', [gate('tracking.pixel_alive', 'gray'), gate('tracking.ga4_events', 'gray')])
    const out = await run([okRow(runReceipt([receipt]))])
    expect(out.map(i => i.what).join('')).toContain('像素在线')
    expect(out).toHaveLength(1)
  })
})

describe('车道与登记', () => {
  it('两种待办都归开发欠账栏，不进 PM 的五类', () => {
    expect(LANE_OF_KIND.ads_tracking_preflight_fix).toBe('dev')
    expect(LANE_OF_KIND.ads_tracking_preflight_broken).toBe('dev')
  })

  it('链接是需要登录的后台页，探活多半判成坏链接——两种都不许被静默丢掉', () => {
    expect(NEVER_DROP_KINDS.has('ads_tracking_preflight_fix')).toBe(true)
    expect(NEVER_DROP_KINDS.has('ads_tracking_preflight_broken')).toBe(true)
  })

  it('检查自己没跑成时，PM 清单顶上要留一句「今天没查成」', () => {
    expect(BLIND_SPOT_NOTE.ads_tracking_preflight_broken).toContain('追踪')
  })

  it('读的就是这个任务名', () => {
    expect(TRACKING_PREFLIGHT_JOB).toBe('ads-tracking-preflight')
  })
})
