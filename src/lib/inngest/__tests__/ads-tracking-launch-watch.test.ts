/**
 * 开投后「自动补排」的每小时盯盘函数 · 装配与编排测试。
 *
 * 它不自己判灯，只做一件事：窗口里每小时看一眼本次投放的广告系列有没有开始花钱，
 * 第一次看到花费后满 1 小时、且还没做过开投后读回，就自己发 ads.tracking_postlaunch.requested
 * （跟人手发的是同一个入口，用同一套事件内容校验），所以不依赖人记得发。
 * 不测决策本身（launch-watch.test.ts）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const startCronRunId = vi.fn<(job: string) => Promise<string>>(async () => 'run-1')
const finish = vi.fn<(opts: Record<string, unknown>) => Promise<void>>(async () => {})
const failOpenCronRuns = vi.fn<(job: string, msg: string, opts: unknown) => Promise<number>>(async () => 1)
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRunId: (job: string) => startCronRunId(job),
  cronRunHandle: () => ({ finish: (o: Record<string, unknown>) => finish(o) }),
  startCronRun: vi.fn(),
  failOpenCronRuns: (job: string, msg: string, opts: unknown) => failOpenCronRuns(job, msg, opts),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/meta/token-selection', () => ({
  resolveMetaToken: async () => ({ token: 'FAKE_TOKEN_VALUE_123', source: 'test' }),
}))

import {
  LAUNCH_WATCH_CRON,
  LAUNCH_WATCH_JOB,
  LAUNCH_WATCH_TZ,
  adsTrackingLaunchWatch,
  createAdsTrackingLaunchWatchFunction,
  postLaunchEvent,
  readLaunchSpend,
  runLaunchWatch,
  type LaunchWatchDeps,
  type LaunchWatchStep,
} from '../functions/ads-tracking-launch-watch'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX } from '../client'
import { ADS_TRACKING_POSTLAUNCH_REQUESTED } from '../ads-events'
import { CRON_REGISTRY } from '@/lib/cron/registry'
import { watchEventId, type PostLaunchReceiptState } from '@/lib/ads-tracking-preflight/launch-watch'
import type { TrackingClientConfig } from '@/lib/ads-tracking-preflight/types'

const NOW = new Date('2026-10-22T20:30:00.000Z') // 新西兰 10-23 09:30
const hoursBefore = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString()

const CONFIG: TrackingClientConfig = {
  ad_account_id: 'act_1111111111',
  site_url: 'https://www.example-shop.test',
  landing_targets: [{ label: '落地页 A', url: 'https://www.example-shop.test/p?utm_content=a' }],
  ga4_lead_events: ['generate_lead'],
  web_form_to_crm: true,
  planned_daily_budget_cents: 10100,
  official_daily_cap_cents: 11000,
  currency: 'NZD',
  launch_watch: { from: '2026-10-22', days: 4, timezone: 'Pacific/Auckland', campaign_ids: ['123456789012'] },
}

// ─── 装配 ───────────────────────────────────────────────────────────────────

type Fn = typeof adsTrackingLaunchWatch
interface FnOpts {
  retries?: number
  concurrency?: { limit: number }
  triggers?: { cron?: string; event?: string }[]
  onFailure?: (ctx: { event: { ts?: number; data: unknown }; error: Error }) => Promise<void>
}
const optsOf = (fn: Fn): FnOpts => (fn as Fn & { opts: FnOpts }).opts

describe('装配', () => {
  it('id 带 cloud- 前缀、每小时一次（新西兰时区）、串行、失败重试 2 次', () => {
    expect(adsTrackingLaunchWatch.id()).toBe(`${CLOUD_FN_PREFIX}ads-tracking-launch-watch`)
    expect(optsOf(adsTrackingLaunchWatch).triggers).toEqual([{ cron: `TZ=${LAUNCH_WATCH_TZ} ${LAUNCH_WATCH_CRON}` }])
    expect(LAUNCH_WATCH_TZ).toBe('Pacific/Auckland')
    expect(LAUNCH_WATCH_CRON).toMatch(/^\d+ \* \* \* \*$/)
    expect(optsOf(adsTrackingLaunchWatch).retries).toBe(2)
    expect(optsOf(adsTrackingLaunchWatch).concurrency?.limit).toBe(1)
  })

  it('注册进了 cloudFunctions；cron 登记表里有它，schedule 跟函数里的常量是同一个', () => {
    expect(cloudFunctions).toContain(adsTrackingLaunchWatch)
    const entry = CRON_REGISTRY.find(e => e.jobName === LAUNCH_WATCH_JOB)
    expect(entry).toMatchObject({ scheduler: 'inngest', logsRuns: true, schedule: LAUNCH_WATCH_CRON })
    expect(entry?.addedAt).toBeTruthy()
  })

  it('重试耗尽 → onFailure 把还停在「在跑」的运行记录收成失败，不静默', async () => {
    failOpenCronRuns.mockClear()
    await optsOf(adsTrackingLaunchWatch).onFailure?.({ event: { ts: NOW.getTime(), data: {} }, error: new Error('炸了') })
    expect(failOpenCronRuns).toHaveBeenCalledTimes(1)
    expect(failOpenCronRuns.mock.calls[0][0]).toBe(LAUNCH_WATCH_JOB)
  })

  // 🔴 审查整改：写进运行记录的失败原因要过 sanitizeError——报错文字里可能回显令牌
  it('onFailure 写进运行记录的原因里不能带令牌：access_token=… 和 40 位以上的长串都要被抹掉', async () => {
    failOpenCronRuns.mockClear()
    const leaked = 'EAAB' + 'x'.repeat(60)
    await optsOf(adsTrackingLaunchWatch).onFailure?.({
      event: { ts: NOW.getTime(), data: {} },
      error: new Error(`Meta 400 access_token=SECRETVALUE123 bearer ${leaked}`),
    })
    const written = String(failOpenCronRuns.mock.calls[0][1])
    expect(written).not.toContain('SECRETVALUE123')
    expect(written).not.toContain(leaked)
    expect(written).toContain('重试耗尽后仍失败')
  })

  it('可以用假依赖造一个函数（单测入口）', () => {
    expect(createAdsTrackingLaunchWatchFunction(makeDeps().deps).id()).toBe(`${CLOUD_FN_PREFIX}ads-tracking-launch-watch`)
  })
})

// ─── 编排 ───────────────────────────────────────────────────────────────────

interface World {
  config?: TrackingClientConfig | null
  spend?: { read: boolean; spend_cents: number; error: string | null }
  states?: PostLaunchReceiptState[]
  /** 之前的盯盘记录里「第一次看到花费」的时刻；不给 = 这是第一次看到 */
  firstSeen?: string | null
}

function makeDeps(world: World = {}) {
  const sent: { id: string; data: { client_id: string; phase: 't1h' | 't24h'; launched_at: string } }[] = []
  const finished: { runId: string; startedAt: number; summary: unknown }[] = []
  const calls = { readSpend: 0, loadStates: 0, loadFirstSeen: 0 }
  const deps: LaunchWatchDeps = {
    now: () => NOW,
    configuredClientIds: () => ['c1'],
    getConfig: () => (world.config === undefined ? CONFIG : world.config),
    readSpend: async () => { calls.readSpend += 1; return world.spend ?? { read: true, spend_cents: 2500, error: null } },
    loadReceiptStates: async () => { calls.loadStates += 1; return world.states ?? [] },
    loadFirstSpendSeenAt: async () => { calls.loadFirstSeen += 1; return world.firstSeen ?? null },
    sendEvent: async event => { sent.push(event) },
    startRun: async () => 'run-1',
    finishRun: async (runId, startedAt, summary) => { finished.push({ runId, startedAt, summary }) },
  }
  return { deps, sent, finished, calls }
}

function fakeStep() {
  const ids: string[] = []
  const step: LaunchWatchStep = {
    run: async <T,>(id: string, fn: () => Promise<T>): Promise<T> => {
      ids.push(id)
      const out = await fn()
      return out === undefined ? out : (JSON.parse(JSON.stringify(out)) as T)
    },
  }
  return { ids, step }
}

beforeEach(() => {
  startCronRunId.mockClear()
  finish.mockClear()
})

describe('发出去的事件', () => {
  it('事件名就是人手入口用的那个，编号用盯盘算出来的（同一小时去重），内容原样', () => {
    const data = { client_id: 'c1', phase: 't1h' as const, launched_at: NOW.toISOString() }
    expect(postLaunchEvent({ id: 'eid-1', data })).toEqual({ id: 'eid-1', name: ADS_TRACKING_POSTLAUNCH_REQUESTED, data })
  })
})

describe('编排', () => {
  it('没有任何客户在盯盘窗口里 → 什么都不读不发，但照样留一行运行记录（盯盘函数自己死了要能被发现）', async () => {
    const { deps, sent, finished, calls } = makeDeps({ config: { ...CONFIG, launch_watch: undefined } })
    const { ids, step } = fakeStep()
    const out = await runLaunchWatch(step, deps)
    expect(ids).toEqual(['start-run', 'finish-run'])
    expect(calls).toEqual({ readSpend: 0, loadStates: 0, loadFirstSeen: 0 })
    expect(sent).toEqual([])
    expect(out).toMatchObject({ no_publish: true, checked_at: NOW.toISOString() })
    expect(out.clients).toEqual([{ client_id: 'c1', active: false, spend_seen: null, sent: [], error: null }])
    expect(finished).toHaveLength(1)
  })

  it('窗口外（开投日之前 / 盯满天数之后）→ 同样不读不发', async () => {
    const early = makeDeps({ config: { ...CONFIG, launch_watch: { from: '2026-10-30', days: 4, timezone: 'Pacific/Auckland', campaign_ids: ['123456789012'] } } })
    await runLaunchWatch(fakeStep().step, early.deps)
    expect(early.calls.readSpend).toBe(0)
  })

  it('窗口里还没花钱 → 读了花费，没发任何事件', async () => {
    const { deps, sent } = makeDeps({ spend: { read: true, spend_cents: 0, error: null } })
    const { ids, step } = fakeStep()
    const out = await runLaunchWatch(step, deps)
    expect(ids).toEqual(['start-run', 'spend:c1', 'state:c1', 'finish-run'])
    expect(sent).toEqual([])
    expect(out.clients[0]).toMatchObject({ active: true, spend_seen: false, sent: [], error: null })
  })

  it('花费读不到 → 不发，原因记进摘要（不当成「没花钱」）', async () => {
    const { deps, sent } = makeDeps({ spend: { read: false, spend_cents: 0, error: '没有可用的 Meta 令牌' } })
    const out = await runLaunchWatch(fakeStep().step, deps)
    expect(sent).toEqual([])
    expect(out.clients[0]).toMatchObject({ active: true, spend_seen: null, error: '没有可用的 Meta 令牌' })
  })

  // 🔴 审查整改：T+1h 要在「第一次看到花费」之后满 1 小时才读，不能在发现花费的当小时就读
  it('第一次看到花费（之前的盯盘记录里没有）→ 不发：摘要里记下 spend_seen=true，下一小时才有得算', async () => {
    const { deps, sent, calls } = makeDeps()
    const { ids, step } = fakeStep()
    const out = await runLaunchWatch(step, deps)
    expect(ids).toEqual(['start-run', 'spend:c1', 'state:c1', 'first-seen:c1', 'finish-run'])
    expect(calls.loadFirstSeen).toBe(1)
    expect(sent).toEqual([])
    expect(out.clients[0]).toMatchObject({ active: true, spend_seen: true, sent: [], error: null })
  })

  it('第一次看到花费已过 1 小时、一次读回都没做过 → 自己补排 T+1h：开投时刻 = 第一次看到花费的时刻，事件内容跟人手发的一样，编号按小时去重', async () => {
    const seen = new Date(NOW.getTime() - 3_600_000).toISOString()
    const { deps, sent, finished } = makeDeps({ firstSeen: seen })
    const { ids, step } = fakeStep()
    const out = await runLaunchWatch(step, deps)
    expect(ids).toEqual(['start-run', 'spend:c1', 'state:c1', 'first-seen:c1', 'send:c1:t1h', 'finish-run'])
    expect(sent).toEqual([{
      id: watchEventId('c1', 't1h', NOW),
      data: { client_id: 'c1', phase: 't1h', launched_at: seen },
    }])
    expect(out.clients[0]).toMatchObject({ active: true, spend_seen: true, error: null })
    expect(out.clients[0].sent).toEqual([{ phase: 't1h', launched_at: seen, event_id: watchEventId('c1', 't1h', NOW) }])
    expect(finished[0]).toMatchObject({ runId: 'run-1', startedAt: NOW.getTime() })
  })

  it('没看到花费 / 花费没读到时，不去翻「第一次看到花费」的记录（用不上）', async () => {
    const none = makeDeps({ spend: { read: true, spend_cents: 0, error: null } })
    await runLaunchWatch(fakeStep().step, none.deps)
    expect(none.calls.loadFirstSeen).toBe(0)
    const unread = makeDeps({ spend: { read: false, spend_cents: 0, error: '没有可用的 Meta 令牌' } })
    await runLaunchWatch(fakeStep().step, unread.deps)
    expect(unread.calls.loadFirstSeen).toBe(0)
  })

  it('T+1h 已做过且满 24 小时 → 补排 T+24h，开投时刻沿用 T+1h 那份', async () => {
    const launched = hoursBefore(25)
    const states: PostLaunchReceiptState[] = [{ phase: 'post_t1h', checked_at: launched, launched_at: launched, valid: true }]
    const { deps, sent } = makeDeps({ states })
    await runLaunchWatch(fakeStep().step, deps)
    expect(sent.map(e => e.data)).toEqual([{ client_id: 'c1', phase: 't24h', launched_at: launched }])
  })

  it('两个读回都做过 → 不再发', async () => {
    const launched = hoursBefore(30)
    const states: PostLaunchReceiptState[] = [
      { phase: 'post_t1h', checked_at: launched, launched_at: launched, valid: true },
      { phase: 'post_t24h', checked_at: hoursBefore(2), launched_at: launched, valid: true },
    ]
    const { deps, sent } = makeDeps({ states })
    await runLaunchWatch(fakeStep().step, deps)
    expect(sent).toEqual([])
  })

  it('步骤返回值都是纯数据（Date / undefined 过一遍记忆化会露馅）', async () => {
    const { deps } = makeDeps()
    await expect(runLaunchWatch(fakeStep().step, deps)).resolves.toBeTruthy()
  })

  it('发给的事件名就是人手入口用的那个', () => {
    expect(ADS_TRACKING_POSTLAUNCH_REQUESTED).toBe('ads.tracking_postlaunch.requested')
  })
})

// ─── 真读花费：只看本次投放的广告系列 ──────────────────────────────────────────

describe('readLaunchSpend · 花费只按本次投放的广告系列算（不是整个官方账户）', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  function stubFetch(insights: unknown) {
    const urls: string[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      urls.push(url)
      const path = new URL(url).pathname.replace(/^\/v\d+\.\d+\//, '')
      if (path === 'act_1111111111') return new Response(JSON.stringify({ timezone_name: 'Pacific/Auckland' }), { status: 200 })
      if (path === 'act_1111111111/insights') return new Response(JSON.stringify(insights), { status: 200 })
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetcher)
    return { urls, fetcher }
  }

  it('只把本次投放的广告系列（编号或名字对得上）的花费算进去，账户里别的系列的花费不算', async () => {
    const { urls } = stubFetch({
      data: [
        { campaign_id: '123456789012', campaign_name: '官网点击 A', spend: '12.5', inline_link_clicks: '3' },
        { campaign_id: '999999999999', campaign_name: '账户里本来就在花钱的别的系列', spend: '300', inline_link_clicks: '900' },
        { campaign_id: '555555555555', campaign_name: '换了编号的 官网点击 20261022', spend: '7.5', inline_link_clicks: '1' },
      ],
    })
    const watch = { ...(CONFIG.launch_watch ?? { from: '2026-10-22', days: 4, timezone: 'Pacific/Auckland', campaign_ids: [] }), campaign_name_contains: ['官网点击', '20261022'] }
    const out = await readLaunchSpend('c1', CONFIG, watch, NOW)
    expect(out).toEqual({ read: true, spend_cents: 2000, error: null })
    const url = new URL(urls.find(u => u.includes('/insights')) ?? '')
    expect(url.searchParams.get('level')).toBe('campaign')
    expect(JSON.parse(url.searchParams.get('time_range') ?? '{}').since).toBe('2026-10-22')
  })

  it('本次投放的系列一个都没在花钱（比如还是草稿）→ 读到了，花费为 0（不是读不到）', async () => {
    stubFetch({ data: [{ campaign_id: '999999999999', campaign_name: '别的系列', spend: '300', inline_link_clicks: '900' }] })
    const watch = CONFIG.launch_watch
    if (!watch) throw new Error('测试配置里应有盯盘窗口')
    await expect(readLaunchSpend('c1', CONFIG, watch, NOW)).resolves.toEqual({ read: true, spend_cents: 0, error: null })
  })
})
