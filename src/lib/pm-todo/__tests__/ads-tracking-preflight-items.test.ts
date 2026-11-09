/**
 * 今日待办里的「开投前追踪检查」：读每日函数留下的回执，不自己现算。
 * 假的 cron_run_logs；只读（假库没有任何写方法，调用就会抛错）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// 配置可以按用例换：默认没有盯盘窗口（null），要测「系列一直找不到」的用例自己放一份
const clientConfig = vi.hoisted(() => ({ get: vi.fn((_id: string): unknown => null) }))
vi.mock('@/lib/ads-tracking-preflight/client-config', () => ({
  listTrackingClientIds: () => ['c1'],
  getTrackingClientConfig: (id: string) => clientConfig.get(id),
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
const WATCH_JOB = 'ads-tracking-launch-watch'
function fakeSupabase(rows: Row[] | null, queryError: string | null = null, watchRows: Row[] = []): SupabaseClient {
  const chain = (): Record<string, unknown> => {
    let job = ''
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.eq = (column: string, value: unknown) => { if (column === 'job_name') job = String(value); return c }
    c.gte = () => c
    c.order = () => c
    c.limit = async () => {
      if (job === WATCH_JOB) return { data: watchRows, error: null }
      return queryError ? { data: null, error: { message: queryError } } : { data: rows, error: null }
    }
    return c
  }
  // 假库只实现被测代码真会调用的链式方法（已跑：每条用例都走过它），和 promo-plan-watch-items.test.ts 同款写法
  return { from: (t: string) => { if (t !== 'cron_run_logs') throw new Error(`不该读这张表：${t}`); return chain() } } as unknown as SupabaseClient
}

beforeEach(() => { clientConfig.get.mockReset(); clientConfig.get.mockReturnValue(null) })

const run = async (rows: Row[] | null, err: string | null = null, watchRows: Row[] = []): Promise<ManualItem[]> => {
  const items: ManualItem[] = []
  await pushAdsTrackingPreflightItems(fakeSupabase(rows, err, watchRows), items, nameOf, NOW)
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

// ─── 第二轮审查整改 ─────────────────────────────────────────────────────────────

describe('开投后读回的红灯 / 黄灯也要出待办（不能只落日志）', () => {
  const postReceipt = (clientId: string, phase: 'post_t1h' | 'post_t24h', status: TrackingGateReceipt['status'], checkedAt: string, reason = '原因-读回') =>
    buildClientReceipt({
      requestId: `post-${clientId}-${phase}`, clientId, checkedAt, trigger: 'postlaunch', phase, launchedAt: '2026-10-18T10:00:00Z',
      gates: [{ ...gate(phase === 'post_t1h' ? 'post.t1h' : 'post.t24h', status), reason }], readErrors: [], links: LINKS,
    })
  const postRow = (receipt: TrackingClientReceipt): Row =>
    okRow(buildRunReceipt({ requestId: 'run-post', checkedAt: receipt.checked_at, trigger: 'postlaunch', clients: [receipt] }), receipt.checked_at)
  const preRow = (gates: TrackingGateReceipt[], checkedAt = '2026-10-19T18:00:00Z'): Row =>
    okRow(runReceipt([clientReceipt('c1', gates, checkedAt)], checkedAt), checkedAt)

  it('最新一份开投后读回是红灯 → 一条待办（问题和影响 / 怎么做 / 链接），归开发欠账那一类', async () => {
    const red = postReceipt('c1', 'post_t24h', 'red', '2026-10-19T19:00:00Z', '点击 40 次但落地页浏览为 0')
    const out = await run([postRow(red), preRow([gate('tracking.pixel_alive', 'green')])])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'ads_tracking_preflight_fix', client_id: 'c1', client_name: '客户甲' })
    expect(out[0].what).toContain('开投后 24 小时读回')
    expect(out[0].what).toContain('落地页浏览为 0')
    expect(out[0].how).toBeTruthy()
    expect(out[0].href).toBeTruthy()
  })

  it('最新一份开投后读回是黄灯（样本不足）→ 同样出待办', async () => {
    const yellow = postReceipt('c1', 'post_t1h', 'yellow', '2026-10-19T19:00:00Z', '样本不足：点击只有 3 次')
    const out = await run([postRow(yellow), preRow([gate('tracking.pixel_alive', 'green')])])
    expect(out).toHaveLength(1)
    expect(out[0].what).toContain('样本不足')
  })

  it('更新的一份读回是绿灯 → 旧读回的黄灯不再出（只看每个客户最新的一份）', async () => {
    const early = postReceipt('c1', 'post_t1h', 'yellow', '2026-10-19T09:00:00Z', '样本不足：点击只有 3 次')
    const late = postReceipt('c1', 'post_t24h', 'green', '2026-10-19T19:00:00Z')
    const out = await run([postRow(late), postRow(early), preRow([gate('tracking.pixel_alive', 'green')])])
    expect(out).toEqual([])
  })

  it('读回已经是 3 天（72 小时）以前的 → 不再出待办，免得开投那一次的黄灯永远挂着', async () => {
    const old = postReceipt('c1', 'post_t24h', 'red', '2026-10-16T19:00:00Z')
    const preFresh = preRow([gate('tracking.pixel_alive', 'green')])
    expect(await run([preFresh, postRow(old)])).toEqual([])
    const justInside = postReceipt('c1', 'post_t24h', 'red', '2026-10-16T20:00:00Z') // 刚好 72 小时
    expect(await run([preFresh, postRow(justInside)])).toHaveLength(1)
  })

  it('开投前红灯和开投后红灯同时存在 → 两条都出', async () => {
    const red = postReceipt('c1', 'post_t24h', 'red', '2026-10-19T19:00:00Z')
    const out = await run([postRow(red), preRow([gate('tracking.pixel_alive', 'red')])])
    expect(out.map(i => i.what).join('|')).toContain('像素在线')
    expect(out.map(i => i.what).join('|')).toContain('开投后 24 小时读回')
    expect(out).toHaveLength(2)
  })

  it('开投后读回是灰灯、因为还没花钱（读取没报错，没数据可判）→ 不出待办', async () => {
    const gray = postReceipt('c1', 'post_t1h', 'gray', '2026-10-19T19:00:00Z', '还没开始花钱，没法判断')
    expect(await run([postRow(gray), preRow([gate('tracking.pixel_alive', 'green')])])).toEqual([])
  })

  // 🔴 第三轮整改：读回「没读到」（令牌失效 / 接口出错 / 范围被拒）= 检查自己没做成，要出一条开发欠账，不能静默
  describe('读回没读到（灰灯 + 读取报错）→ 一条开发欠账；最新一份灰灯不得盖住更早的真红 / 黄灯', () => {
    const unreadReceipt = (phase: 'post_t1h' | 'post_t24h', checkedAt: string, error = '令牌失效') =>
      buildClientReceipt({
        requestId: `unread-${phase}`, clientId: 'c1', checkedAt, trigger: 'postlaunch', phase, launchedAt: '2026-10-18T10:00:00Z',
        gates: [{ ...gate(phase === 'post_t1h' ? 'post.t1h' : 'post.t24h', 'gray'), reason: `开投后读回没读到：${error}` }],
        readErrors: [{ source: 'insights', error }], links: LINKS,
      })
    const greenPre = () => preRow([gate('tracking.pixel_alive', 'green')])

    it('最新（也是唯一）一份读回没读到 → 一条开发待办：说清没读到、原因、怎么办、链接', async () => {
      const out = await run([postRow(unreadReceipt('post_t1h', '2026-10-19T19:00:00Z', '令牌失效')), greenPre()])
      expect(out).toHaveLength(1)
      expect(out[0]).toMatchObject({ kind: 'ads_tracking_preflight_fix', client_id: 'c1', client_name: '客户甲' })
      expect(out[0].what).toContain('开投后 1 小时读回')
      expect(out[0].what).toContain('没读到')
      expect(out[0].what).toContain('令牌失效')
      expect(out[0].how).toBeTruthy()
      expect(out[0].href).toBeTruthy()
    })

    it('最新一份没读到、更早的一份是红灯 → 两条都出：更早的真红灯不被盖住，读不到的欠账也不被盖住', async () => {
      const older = postReceipt('c1', 'post_t1h', 'red', '2026-10-19T09:00:00Z', '点击 40 次但落地页浏览为 0')
      const out = await run([postRow(unreadReceipt('post_t24h', '2026-10-19T19:00:00Z')), postRow(older), greenPre()])
      expect(out).toHaveLength(2)
      expect(out.some(i => i.what.includes('落地页浏览为 0'))).toBe(true)
      expect(out.some(i => i.what.includes('没读到'))).toBe(true)
    })

    it('最新一份没读到、更早的一份是黄灯 → 同样两条都出', async () => {
      const older = postReceipt('c1', 'post_t1h', 'yellow', '2026-10-19T09:00:00Z', '样本不足：点击只有 3 次')
      const out = await run([postRow(unreadReceipt('post_t24h', '2026-10-19T19:00:00Z')), postRow(older), greenPre()])
      expect(out.map(i => i.what).join('|')).toContain('样本不足')
      expect(out.map(i => i.what).join('|')).toContain('没读到')
      expect(out).toHaveLength(2)
    })

    it('最新一份只是「还没花钱」的灰灯（读取没报错）、更早的一份是红灯 → 只出更早的红灯，不额外喊', async () => {
      const older = postReceipt('c1', 'post_t1h', 'red', '2026-10-19T09:00:00Z', '点击 40 次但落地页浏览为 0')
      const noSpend = postReceipt('c1', 'post_t24h', 'gray', '2026-10-19T19:00:00Z', '还没开始花钱，没法判断')
      const out = await run([postRow(noSpend), postRow(older), greenPre()])
      expect(out).toHaveLength(1)
      expect(out[0].what).toContain('落地页浏览为 0')
    })

    it('更新的一份读回已经读到了（绿灯）→ 更早那份没读到的欠账不再出（只看最新的一份）', async () => {
      const older = unreadReceipt('post_t1h', '2026-10-19T09:00:00Z')
      const newer = postReceipt('c1', 'post_t1h', 'green', '2026-10-19T19:00:00Z')
      expect(await run([postRow(newer), postRow(older), greenPre()])).toEqual([])
    })

    it('更早的真红灯已经超过 72 小时、最新一份没读到仍在 72 小时内 → 只出没读到的欠账', async () => {
      const oldRed = postReceipt('c1', 'post_t1h', 'red', '2026-10-15T09:00:00Z', '点击 40 次但落地页浏览为 0')
      const out = await run([postRow(unreadReceipt('post_t24h', '2026-10-19T19:00:00Z')), postRow(oldRed), greenPre()])
      expect(out).toHaveLength(1)
      expect(out[0].what).toContain('没读到')
    })

    it('没读到的读回已经超过 72 小时 → 不再挂', async () => {
      // 行是新的在前：最新一轮是今天的开投前体检（全绿），没读到的读回在它后面
      expect(await run([greenPre(), postRow(unreadReceipt('post_t1h', '2026-10-15T19:00:00Z'))])).toEqual([])
      expect(await run([greenPre(), postRow(unreadReceipt('post_t1h', '2026-10-16T20:00:00Z'))])).toHaveLength(1) // 刚好 72 小时还挂
    })

    it('更早的真红灯和最新一份没读到的读回都已经超过 72 小时 → 一条都不挂', async () => {
      const oldRed = postReceipt('c1', 'post_t1h', 'red', '2026-10-14T09:00:00Z', '点击 40 次但落地页浏览为 0')
      const out = await run([greenPre(), postRow(unreadReceipt('post_t24h', '2026-10-15T19:00:00Z')), postRow(oldRed)])
      expect(out).toEqual([])
    })

    it('连续两份都没读到 → 只出最新那份的一条欠账（不叠）', async () => {
      const out = await run([
        postRow(unreadReceipt('post_t24h', '2026-10-19T19:00:00Z', '接口报错')),
        postRow(unreadReceipt('post_t1h', '2026-10-19T09:00:00Z', '令牌失效')),
        greenPre(),
      ])
      expect(out).toHaveLength(1)
      expect(out[0].what).toContain('接口报错')
    })
  })
})

describe('最新一轮是失败 / 卡住 / 在跑的读回或手动轮时，不得把客户开投前的红灯整份跳过', () => {
  const red = (): Row => okRow(runReceipt([clientReceipt('c1', [gate('tracking.pixel_alive', 'red')])]), '2026-10-19T18:00:00Z')

  it('最新一轮是失败的 → 出「没跑成」欠账，同时客户开投前的红灯照样在', async () => {
    const out = await run([
      { status: 'failed', started_at: '2026-10-19T19:30:00Z', error_message: '重试耗尽后仍失败：炸了', summary: null },
      red(),
    ])
    expect(out.some(i => i.kind === 'ads_tracking_preflight_broken' && i.what.includes('炸了'))).toBe(true)
    expect(out.some(i => i.kind === 'ads_tracking_preflight_fix' && i.what.includes('像素在线'))).toBe(true)
  })

  it('最新一轮卡在「在跑」超过 2 小时 → 出欠账，客户开投前的红灯照样在', async () => {
    const out = await run([okRow(null, '2026-10-19T17:00:00Z', 'running'), red()])
    expect(out.some(i => i.kind === 'ads_tracking_preflight_broken')).toBe(true)
    expect(out.some(i => i.kind === 'ads_tracking_preflight_fix')).toBe(true)
  })

  it('最新一轮还在跑（2 小时内）→ 不吵，客户开投前的红灯照样在', async () => {
    const out = await run([okRow(null, '2026-10-19T19:30:00Z', 'running'), red()])
    expect(out.filter(i => i.kind === 'ads_tracking_preflight_broken')).toEqual([])
    expect(out.filter(i => i.kind === 'ads_tracking_preflight_fix')).toHaveLength(1)
  })

  it('最新一轮的回执读不懂 → 出欠账，客户开投前的红灯照样在', async () => {
    const out = await run([okRow({ nonsense: true }, '2026-10-19T19:30:00Z'), red()])
    expect(out.some(i => i.kind === 'ads_tracking_preflight_broken')).toBe(true)
    expect(out.some(i => i.kind === 'ads_tracking_preflight_fix')).toBe(true)
  })

  it('最新一轮已经超过一天（最近一次运行就是 36 小时前）→ 一条「超过一天没跑」欠账，不再叠一条客户级的过期欠账', async () => {
    const old = '2026-10-18T05:00:00Z'
    const out = await run([okRow(runReceipt([clientReceipt('c1', [gate('tracking.pixel_alive', 'red')], old)], old), old)])
    expect(out.filter(i => i.kind === 'ads_tracking_preflight_broken')).toHaveLength(1)
    expect(out[0].what).toContain('超过一天')
  })
})

describe('盯盘一直找不到本次投放的系列（series_not_found）：只有设了预计开投日、且已过 24 小时才出开发待办', () => {
  const WATCH = {
    from: '2026-10-01', days: 60, timezone: 'Pacific/Auckland', campaign_ids: ['123456789012'],
  }
  const config = (over: Record<string, unknown> = {}) => ({
    ad_account_id: 'act_1111111111', launch_watch: { ...WATCH, ...over },
  })
  const tick = (iso: string, found: boolean | null, spendSeen: boolean | null = null): Row => ({
    status: 'completed', started_at: iso, error_message: null,
    summary: {
      checked_at: iso, no_publish: true,
      clients: [{ client_id: 'c1', active: true, spend_seen: spendSeen, series_found: found, sent: [], error: null }],
    },
  })
  /** 最近 30 个小时，每小时一次盯盘，最新一次是 NOW 之前 40 分钟；都找不到 */
  const notFoundTicks = (): Row[] =>
    Array.from({ length: 30 }, (_, i) => tick(new Date(NOW.getTime() - (40 + i * 60) * 60_000).toISOString(), false))
  const okPre = (): Row => okRow(runReceipt([clientReceipt('c1', [gate('tracking.pixel_alive', 'green')])]), '2026-10-19T18:00:00Z')

  it('设了预计开投日（NZ 10-18）、早已过去 24 小时、盯盘一直找不到系列 → 一条开发待办，说清「没发布就是正常的」和怎么改配置', async () => {
    clientConfig.get.mockReturnValue(config({ expected_launch_on: '2026-10-18' }))
    const out = await run([okPre()], null, notFoundTicks())
    const item = out.find(i => i.what.includes('没找到本次投放的系列'))
    expect(item).toMatchObject({ kind: 'ads_tracking_preflight_fix', client_id: 'c1', client_name: '客户甲' })
    expect(item?.what).toContain('2026-10-18')
    expect(item?.what).toContain('还没发布')
    expect(item?.how).toContain('client-config')
    expect(item?.href).toContain('1111111111')
  })

  it('没设预计开投日 → 不出待办（只记灰回执）', async () => {
    clientConfig.get.mockReturnValue(config())
    expect(await run([okPre()], null, notFoundTicks())).toEqual([])
  })

  it('预计开投日还没过 24 小时（今天还是预计开投日当天）→ 不出', async () => {
    clientConfig.get.mockReturnValue(config({ expected_launch_on: '2026-10-20' })) // NOW = NZ 10-20
    expect(await run([okPre()], null, notFoundTicks())).toEqual([])
  })

  it('这期间哪怕只有一次找到过系列（或见到过花费）→ 不出', async () => {
    clientConfig.get.mockReturnValue(config({ expected_launch_on: '2026-10-18' }))
    const rows = notFoundTicks()
    rows[10] = tick(new Date(NOW.getTime() - 650 * 60_000).toISOString(), true, false)
    expect(await run([okPre()], null, rows)).toEqual([])
  })

  it('最新一次盯盘已经找到系列 → 不出', async () => {
    clientConfig.get.mockReturnValue(config({ expected_launch_on: '2026-10-18' }))
    const rows = [tick(new Date(NOW.getTime() - 40 * 60_000).toISOString(), true, true), ...notFoundTicks().slice(1)]
    expect(await run([okPre()], null, rows)).toEqual([])
  })

  it('盯盘记录太少（不到一天的量）→ 不出，免得刚部署就喊', async () => {
    clientConfig.get.mockReturnValue(config({ expected_launch_on: '2026-10-18' }))
    expect(await run([okPre()], null, notFoundTicks().slice(0, 5))).toEqual([])
  })

  it('最新一次盯盘已经过了 3 小时（盯盘函数自己没在跑）→ 不在这里喊，免得把「函数没跑」说成「系列找不到」', async () => {
    clientConfig.get.mockReturnValue(config({ expected_launch_on: '2026-10-18' }))
    const stale = Array.from({ length: 30 }, (_, i) => tick(new Date(NOW.getTime() - (200 + i * 60) * 60_000).toISOString(), false))
    expect(await run([okPre()], null, stale)).toEqual([])
  })

  it('读不出系列有没有（series_found 为 null）算「不知道」，不当成找不到', async () => {
    clientConfig.get.mockReturnValue(config({ expected_launch_on: '2026-10-18' }))
    const unknown = Array.from({ length: 30 }, (_, i) => tick(new Date(NOW.getTime() - (40 + i * 60) * 60_000).toISOString(), null))
    expect(await run([okPre()], null, unknown)).toEqual([])
  })

  // 🔴 第三轮整改：读不出来的盯盘不是「找不到」，不能凑进「≥ 20 次」的次数里
  it('一半的盯盘读不出来（series_found 为 null），明确找不到的只有 15 次 → 不够 20 次，不出', async () => {
    clientConfig.get.mockReturnValue(config({ expected_launch_on: '2026-10-18' }))
    // 30 次盯盘，最新一次在 40 分钟前且明确找不到；奇数位读不出来 → 明确找不到的 15 次
    const mixed = Array.from({ length: 30 }, (_, i) =>
      tick(new Date(NOW.getTime() - (40 + i * 60) * 60_000).toISOString(), i % 2 === 0 ? false : null))
    expect(await run([okPre()], null, mixed)).toEqual([])
  })

  it('明确找不到的盯盘够 20 次、中间夹着几次读不出来 → 照样出（读不出来的只是不算数）', async () => {
    clientConfig.get.mockReturnValue(config({ expected_launch_on: '2026-10-18' }))
    // 30 次盯盘里 7 次读不出来（i = 3, 7, …, 27）→ 明确找不到的 23 次
    const mixed = Array.from({ length: 30 }, (_, i) =>
      tick(new Date(NOW.getTime() - (40 + i * 60) * 60_000).toISOString(), i % 4 === 3 ? null : false))
    const out = await run([okPre()], null, mixed)
    expect(out.some(i => i.what.includes('没找到本次投放的系列'))).toBe(true)
  })

  it('最新一次盯盘读不出来，但 1 小时前那次明确找不到、前面也一直找不到 → 照样出（以最近一次读得出结果的为准）', async () => {
    clientConfig.get.mockReturnValue(config({ expected_launch_on: '2026-10-18' }))
    const rows = [tick(new Date(NOW.getTime() - 10 * 60_000).toISOString(), null), ...notFoundTicks()]
    const out = await run([okPre()], null, rows)
    expect(out.some(i => i.what.includes('没找到本次投放的系列'))).toBe(true)
  })

  it('最近读得出结果的盯盘已经是 3 小时以前（后面全是读不出来）→ 不出：读不出来既不是找得到也不是找不到', async () => {
    clientConfig.get.mockReturnValue(config({ expected_launch_on: '2026-10-18' }))
    const recentUnknown = [0, 1, 2, 3].map(i => tick(new Date(NOW.getTime() - (10 + i * 60) * 60_000).toISOString(), null))
    const olderNotFound = Array.from({ length: 30 }, (_, i) => tick(new Date(NOW.getTime() - (250 + i * 60) * 60_000).toISOString(), false))
    expect(await run([okPre()], null, [...recentUnknown, ...olderNotFound])).toEqual([])
  })

  it('盯盘记录读不出来（库报错 / 格式不对）→ 不出这条（也不抛错）', async () => {
    clientConfig.get.mockReturnValue(config({ expected_launch_on: '2026-10-18' }))
    const garbage: Row[] = [{ status: 'completed', started_at: '2026-10-19T19:00:00Z', error_message: null, summary: { nonsense: true } }]
    expect(await run([okPre()], null, garbage)).toEqual([])
  })
})

describe('按目标盯盘的提醒：盯盘函数最近一次回执里的提醒，原样翻成开发待办', () => {
  const CAMPAIGN_ID = '111111111111'
  const config = () => ({
    ad_account_id: 'act_1111111111',
    objective_watch: { series: [{ campaign_id: CAMPAIGN_ID, kind: 'awareness', label: '播放量系列' }] },
  })
  const okPre = (): Row => okRow(runReceipt([clientReceipt('c1', [gate('tracking.pixel_alive', 'green')])]), '2026-10-19T18:00:00Z')
  const alert = (tag: string, level: 'yellow' | 'red', code = 'zero_spend') => ({
    code, level, what: `什么-${tag}`, how: `怎么办-${tag}`, href: `https://ads.example.test/${tag}`,
  })
  const iso = (minutesAgo: number): string => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString()
  const objTick = (minutesAgo: number, alerts: unknown[], status: string | null = 'completed', clientId = 'c1'): Row => ({
    status, started_at: iso(minutesAgo), error_message: null,
    summary: {
      checked_at: iso(minutesAgo), no_publish: true,
      clients: [{
        client_id: clientId, active: false, spend_seen: null, series_found: null, sent: [], error: null,
        objective_watch: { as_of: iso(minutesAgo), series: [{ campaign_id: CAMPAIGN_ID, label: '播放量系列', alerts }] },
      }],
    },
  })

  it('最新一次盯盘有提醒 → 每条一个待办：什么 / 怎么办 / 链接原样，什么前面标灯号；kind 是开发待办那一种', async () => {
    clientConfig.get.mockReturnValue(config())
    const out = await run([okPre()], null, [objTick(30, [alert('甲', 'red'), alert('乙', 'yellow', 'frequency')])])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({
      kind: 'ads_tracking_preflight_fix', client_id: 'c1', client_name: '客户甲',
      what: '🔴 什么-甲', how: '怎么办-甲', href: 'https://ads.example.test/甲',
    })
    expect(out[1]).toMatchObject({ what: '🟡 什么-乙', how: '怎么办-乙', href: 'https://ads.example.test/乙' })
    expect(LANE_OF_KIND.ads_tracking_preflight_fix).toBe('dev')
    expect(NEVER_DROP_KINDS.has('ads_tracking_preflight_fix')).toBe(true)
  })

  it('只看最新一次：更早那次有提醒、最新这次没有 → 不出（问题已经消了）', async () => {
    clientConfig.get.mockReturnValue(config())
    expect(await run([okPre()], null, [objTick(20, []), objTick(80, [alert('甲', 'red')])])).toEqual([])
  })

  it('最新一次盯盘已经超过 3 小时（盯盘函数自己没在跑）→ 不出，免得把「函数没跑」说成「系列有事」', async () => {
    clientConfig.get.mockReturnValue(config())
    expect(await run([okPre()], null, [objTick(181, [alert('甲', 'red')])])).toEqual([])
    expect(await run([okPre()], null, [objTick(179, [alert('甲', 'red')])])).toHaveLength(1)
  })

  it('还在跑的那一行不算；别的客户的提醒不算', async () => {
    clientConfig.get.mockReturnValue(config())
    expect(await run([okPre()], null, [objTick(5, [alert('甲', 'red')], 'running')])).toEqual([])
    expect(await run([okPre()], null, [objTick(30, [alert('甲', 'red')], 'completed', 'other')])).toEqual([])
  })

  it('这个客户没配按目标盯盘 → 盯盘回执里即使带着提醒也不出', async () => {
    clientConfig.get.mockReturnValue({ ad_account_id: 'act_1111111111' })
    expect(await run([okPre()], null, [objTick(30, [alert('甲', 'red')])])).toEqual([])
  })

  it('盯盘记录读不出来（格式不对）→ 不出这条，也不抛错', async () => {
    clientConfig.get.mockReturnValue(config())
    const garbage: Row[] = [{ status: 'completed', started_at: iso(10), error_message: null, summary: { nonsense: true } }]
    expect(await run([okPre()], null, garbage)).toEqual([])
  })

  it('读盯盘记录时库报错 → 不出这条，也不抛错；开投前体检那边不受影响', async () => {
    clientConfig.get.mockReturnValue(config())
    const preRows = [okPre()]
    const chain = (): Record<string, unknown> => {
      let job = ''
      const c: Record<string, unknown> = {}
      c.select = () => c
      c.eq = (column: string, value: unknown) => { if (column === 'job_name') job = String(value); return c }
      c.gte = () => c
      c.order = () => c
      c.limit = async () => (job === WATCH_JOB ? { data: null, error: { message: '库炸了' } } : { data: preRows, error: null })
      return c
    }
    const failing = { from: () => chain() } as unknown as SupabaseClient
    const items: ManualItem[] = []
    await expect(pushAdsTrackingPreflightItems(failing, items, nameOf, NOW)).resolves.toBeUndefined()
    expect(items).toEqual([])
  })

  it('开投前体检一轮都没跑过（两周内没有运行记录）时，按目标盯盘的提醒照样出，不被提前返回漏掉', async () => {
    clientConfig.get.mockReturnValue(config())
    const out = await run([], null, [objTick(30, [alert('甲', 'red')])])
    expect(out.some(i => i.what === '🔴 什么-甲')).toBe(true)
    expect(out.some(i => i.kind === 'ads_tracking_preflight_broken')).toBe(true)
  })
})

describe('「广告账户与付款」黄灯：其它账户里有在投预算 → 下发', () => {
  const billing = (status: TrackingGateReceipt['status'], evidence: TrackingGateReceipt['evidence']): TrackingGateReceipt => ({
    ...gate('env.account_billing', status), reason: '另一个账户尾号 7274 欠款，里面开着 4 个系列、日预算合计 NZ$115', evidence,
  })
  const runWith = (g: TrackingGateReceipt) => run([okRow(runReceipt([clientReceipt('c1', [g])]))])

  it('黄灯 + 其它账户在投预算 > 0 → 一条带原因的待办', async () => {
    const out = await runWith(billing('yellow', { other_live_daily_budget_cents: 11500 }))
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('ads_tracking_preflight_fix')
    expect(out[0].what).toContain('尾号 7274')
    expect(out[0].client_id).toBe('c1')
  })

  it('黄灯 + 其它账户没有在投预算 / 没读到 → 不下发', async () => {
    expect(await runWith(billing('yellow', { other_live_daily_budget_cents: 0 }))).toEqual([])
    expect(await runWith(billing('yellow', { other_live_daily_budget_cents: null }))).toEqual([])
  })

  it('红灯不重复下发：只有回执 items 里原来那一条', async () => {
    const out = await runWith(billing('red', { other_live_daily_budget_cents: 11500 }))
    expect(out).toHaveLength(1)
  })

  it('回执过期 → 不下发黄灯（只有「回执没更新」的欠账）', async () => {
    const old = '2026-10-18T05:00:00Z'
    const r = clientReceipt('c1', [billing('yellow', { other_live_daily_budget_cents: 11500 })], old)
    const out = await run([okRow(runReceipt([r], '2026-10-19T18:00:00Z'))])
    expect(out.every(i => i.kind === 'ads_tracking_preflight_broken')).toBe(true)
  })
})
