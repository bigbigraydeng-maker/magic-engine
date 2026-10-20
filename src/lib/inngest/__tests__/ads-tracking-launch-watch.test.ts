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
  readObjectiveSeries,
  runLaunchWatch,
  summarizeRunCounts,
  type LaunchWatchDeps,
  type LaunchWatchStep,
  type LaunchWatchSummary,
} from '../functions/ads-tracking-launch-watch'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX } from '../client'
import { ADS_TRACKING_POSTLAUNCH_REQUESTED } from '../ads-events'
import { CRON_REGISTRY } from '@/lib/cron/registry'
import { watchEventId, type PostLaunchReceiptState } from '@/lib/ads-tracking-preflight/launch-watch'
import type { MeInboundFact, MetricsRow, SeriesFacts, SeriesUnread } from '@/lib/ads-tracking-preflight/objective-watch'
import type { ObjectiveWatchSeries, TrackingClientConfig } from '@/lib/ads-tracking-preflight/types'

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
  spend?: { read: boolean; spend_cents: number; error: string | null; series_found?: boolean | null }
  states?: PostLaunchReceiptState[]
  /** 之前的盯盘记录里「第一次看到花费」的时刻；不给 = 这是第一次看到 */
  firstSeen?: string | null
  /** 按目标盯盘：每个系列读到的结构和数字（按系列编号）；不给 = 一个还没花钱的普通系列 */
  objectiveFacts?: Record<string, SeriesFacts | SeriesUnread>
  /** 按目标盯盘：ME 收到的 WhatsApp 会话数；不给 = 读到 0 个 */
  me?: MeInboundFact
}

function makeDeps(world: World = {}) {
  const sent: { id: string; data: { client_id: string; phase: 't1h' | 't24h'; launched_at: string } }[] = []
  const finished: { runId: string; startedAt: number; summary: unknown }[] = []
  const calls = { readSpend: 0, loadStates: 0, loadFirstSeen: 0 }
  const objectiveCalls = { read: [] as string[], me: [] as { clientId: string; since: string }[] }
  const deps: LaunchWatchDeps = {
    now: () => NOW,
    configuredClientIds: () => ['c1'],
    getConfig: () => (world.config === undefined ? CONFIG : world.config),
    readSpend: async () => {
      calls.readSpend += 1
      return { series_found: true, ...(world.spend ?? { read: true, spend_cents: 2500, error: null }) }
    },
    loadReceiptStates: async () => { calls.loadStates += 1; return world.states ?? [] },
    loadFirstSpendSeenAt: async () => { calls.loadFirstSeen += 1; return world.firstSeen ?? null },
    sendEvent: async event => { sent.push(event) },
    readObjectiveSeries: async (_clientId, _cfg, series) => {
      objectiveCalls.read.push(series.campaign_id)
      return world.objectiveFacts?.[series.campaign_id] ?? seriesFacts(series.campaign_id)
    },
    countMeInbound: async (clientId, since) => {
      objectiveCalls.me.push({ clientId, since })
      return world.me ?? { read: true, count: 0, since }
    },
    appBase: 'https://app.example.test',
    startRun: async () => 'run-1',
    finishRun: async (runId, startedAt, summary) => { finished.push({ runId, startedAt, summary }) },
  }
  return { deps, sent, finished, calls, objectiveCalls }
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
    expect(out.clients).toEqual([{ client_id: 'c1', active: false, spend_seen: null, series_found: null, sent: [], error: null }])
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

  // 🔴 第二轮审查整改：「读到了、没花钱」和「一个系列都没找到」是两回事，后者记灰，不是安静的 0
  it('读到了、系列在、没花钱 → spend_seen=false，series_found=true', async () => {
    const { deps, sent } = makeDeps({ spend: { read: true, spend_cents: 0, error: null, series_found: true } })
    const out = await runLaunchWatch(fakeStep().step, deps)
    expect(sent).toEqual([])
    expect(out.clients[0]).toMatchObject({ spend_seen: false, series_found: true, error: null })
  })

  it('本次投放的系列一个都没找到（编号和名字都对不上，比如还是未发布的草稿）→ 记灰：spend_seen=null、series_found=false；不发，也不去翻「第一次看到花费」', async () => {
    const { deps, sent, calls } = makeDeps({ spend: { read: true, spend_cents: 0, error: null, series_found: false } })
    const { ids, step } = fakeStep()
    const out = await runLaunchWatch(step, deps)
    expect(sent).toEqual([])
    expect(calls.loadFirstSeen).toBe(0)
    expect(ids).toEqual(['start-run', 'spend:c1', 'state:c1', 'finish-run'])
    expect(out.clients[0]).toMatchObject({ active: true, spend_seen: null, series_found: false, error: null })
  })

  it('系列有没有读不出来（series_found 为 null）、花费读到是 0 → spend_seen=false，series_found=null（不当成找不到）', async () => {
    const { deps } = makeDeps({ spend: { read: true, spend_cents: 0, error: null, series_found: null } })
    const out = await runLaunchWatch(fakeStep().step, deps)
    expect(out.clients[0]).toMatchObject({ spend_seen: false, series_found: null })
  })

  it('花了钱 → series_found=true（花钱就说明系列在）', async () => {
    const { deps } = makeDeps()
    const out = await runLaunchWatch(fakeStep().step, deps)
    expect(out.clients[0]).toMatchObject({ spend_seen: true, series_found: true })
  })

  it('花费读不到 → 不发，原因记进摘要（不当成「没花钱」）', async () => {
    const { deps, sent } = makeDeps({ spend: { read: false, spend_cents: 0, error: '没有可用的 Meta 令牌' } })
    const out = await runLaunchWatch(fakeStep().step, deps)
    expect(sent).toEqual([])
    expect(out.clients[0]).toMatchObject({ active: true, spend_seen: null, series_found: null, error: '没有可用的 Meta 令牌' })
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

// ─── 按目标盯盘 ──────────────────────────────────────────────────────────────

const AWARENESS_ID = '111111111111'
const WHATSAPP_ID = '222222222222'
const OBJECTIVE_WATCH = {
  series: [
    { campaign_id: AWARENESS_ID, kind: 'awareness', label: '播放量系列' },
    { campaign_id: WHATSAPP_ID, kind: 'whatsapp', label: '聊天系列' },
  ],
} satisfies { series: ObjectiveWatchSeries[] }
const OBJECTIVE_CONFIG: TrackingClientConfig = { ...CONFIG, launch_watch: undefined, objective_watch: OBJECTIVE_WATCH }

/** 一个刚改过 2 小时、在投、还没花钱的系列（默认读到的样子）。 */
function seriesFacts(campaignId: string, over: Partial<SeriesFacts> = {}): SeriesFacts {
  const updated = hoursBefore(2)
  return {
    read: true,
    as_of: NOW.toISOString(),
    campaign: { id: campaignId, name: '系列', objective: null, status: 'ACTIVE', effective_status: 'ACTIVE', created_at: hoursBefore(30), updated_at: updated },
    adsets: [{ id: 's1', name: '广告组', parent_id: null, status: 'ACTIVE', effective_status: 'ACTIVE', updated_at: updated }],
    ads: [{ id: 'a1', name: '广告', parent_id: 's1', status: 'ACTIVE', effective_status: 'ACTIVE', updated_at: updated }],
    total: null,
    by_adset: [],
    by_ad: [],
    ...over,
  }
}

const spendRow = (id: string, over: Partial<MetricsRow> = {}): MetricsRow => ({
  id, name: id, spend_cents: 5000, impressions: 4000, reach: 1000, frequency: 1.2,
  thruplays: 0, cost_per_thruplay: null, conversations: 0, cost_per_conversation: null, ...over,
})

describe('按目标盯盘', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('配了按目标盯盘、没配开投后盯盘：每个系列各读一遍，汇总里带逐系列结论；开投后那一套不动（不读花费、不发事件）', async () => {
    const { deps, sent, calls, objectiveCalls } = makeDeps({ config: OBJECTIVE_CONFIG })
    const { ids, step } = fakeStep()
    const out = await runLaunchWatch(step, deps)
    expect(ids).toEqual(['start-run', `objective:c1:${AWARENESS_ID}`, `objective:c1:${WHATSAPP_ID}`, 'finish-run'])
    expect(objectiveCalls.read).toEqual([AWARENESS_ID, WHATSAPP_ID])
    expect(calls).toEqual({ readSpend: 0, loadStates: 0, loadFirstSeen: 0 })
    expect(sent).toEqual([])
    expect(out.clients[0]).toMatchObject({ client_id: 'c1', active: false, error: null })
    expect(out.clients[0].objective_watch?.as_of).toBe(NOW.toISOString())
    expect(out.clients[0].objective_watch?.series.map(s => [s.campaign_id, s.kind, s.state])).toEqual([
      [AWARENESS_ID, 'awareness', 'waiting_first_spend'],
      [WHATSAPP_ID, 'whatsapp', 'waiting_first_spend'],
    ])
    expect(out.no_publish).toBe(true)
  })

  it('没配按目标盯盘的客户：汇总里没有 objective_watch 这个字段（老格式不变）', async () => {
    const { deps } = makeDeps()
    const out = await runLaunchWatch(fakeStep().step, deps)
    expect('objective_watch' in out.clients[0]).toBe(false)
  })

  it('两件事都配了：开投后补排照旧发事件，按目标盯盘同时出结论，互不影响', async () => {
    const seen = new Date(NOW.getTime() - 3_600_000).toISOString()
    const { deps, sent, objectiveCalls } = makeDeps({ config: { ...CONFIG, objective_watch: OBJECTIVE_WATCH }, firstSeen: seen })
    const { ids, step } = fakeStep()
    const out = await runLaunchWatch(step, deps)
    expect(ids).toEqual([
      'start-run', 'spend:c1', 'state:c1', 'first-seen:c1', 'send:c1:t1h',
      `objective:c1:${AWARENESS_ID}`, `objective:c1:${WHATSAPP_ID}`, 'finish-run',
    ])
    expect(sent).toHaveLength(1)
    expect(objectiveCalls.read).toEqual([AWARENESS_ID, WHATSAPP_ID])
    expect(out.clients[0]).toMatchObject({ active: true, spend_seen: true })
    expect(out.clients[0].objective_watch?.series).toHaveLength(2)
  })

  it('WhatsApp 系列：Meta 报了聊天数才去数 ME 收到几个（起点 = 系列创建时刻）；ME 一个都没收到 → 红灯，链接指向 CRM', async () => {
    const created = hoursBefore(30)
    const { deps, objectiveCalls } = makeDeps({
      config: OBJECTIVE_CONFIG,
      objectiveFacts: { [WHATSAPP_ID]: seriesFacts(WHATSAPP_ID, { total: spendRow(WHATSAPP_ID, { conversations: 5, cost_per_conversation: 3.2 }) }) },
      me: { read: true, count: 0, since: created },
    })
    const { ids, step } = fakeStep()
    const out = await runLaunchWatch(step, deps)
    expect(ids).toContain(`me-inbound:c1:${WHATSAPP_ID}`)
    expect(objectiveCalls.me).toEqual([{ clientId: 'c1', since: created }])
    const whatsapp = out.clients[0].objective_watch?.series.find(s => s.campaign_id === WHATSAPP_ID)
    expect(whatsapp?.alerts.map(a => [a.code, a.level])).toEqual([['me_not_receiving', 'red']])
    expect(whatsapp?.alerts[0].href).toBe('https://app.example.test/dashboard/clients/c1/crm')
    expect(whatsapp?.me).toMatchObject({ read: true, count: 0, meta_conversations: 5 })
  })

  it('Meta 还没有聊天数、或是播放量系列 → 不去数 ME（用不上）', async () => {
    const { deps, objectiveCalls } = makeDeps({
      config: OBJECTIVE_CONFIG,
      objectiveFacts: { [AWARENESS_ID]: seriesFacts(AWARENESS_ID, { total: spendRow(AWARENESS_ID, { conversations: 7 }) }) },
    })
    const { ids, step } = fakeStep()
    await runLaunchWatch(step, deps)
    expect(objectiveCalls.me).toEqual([])
    expect(ids.some(id => id.startsWith('me-inbound'))).toBe(false)
  })

  it('读到了聊天数、但读不出系列创建时刻 → 不去数，记「读不到」，不当成 ME 没收到', async () => {
    const facts = seriesFacts(WHATSAPP_ID, { total: spendRow(WHATSAPP_ID, { conversations: 4 }) })
    facts.campaign.created_at = null
    const { deps, objectiveCalls } = makeDeps({ config: OBJECTIVE_CONFIG, objectiveFacts: { [WHATSAPP_ID]: facts } })
    const out = await runLaunchWatch(fakeStep().step, deps)
    const whatsapp = out.clients[0].objective_watch?.series.find(s => s.campaign_id === WHATSAPP_ID)
    expect(objectiveCalls.me).toEqual([])
    expect(whatsapp?.alerts).toEqual([])
    expect(whatsapp?.me).toMatchObject({ read: false, count: null, meta_conversations: 4 })
  })

  it('系列读不到 → 该系列 state=unread 并出一条「读不到」提醒；这一轮在运行记录里算失败，不静默', async () => {
    const { deps } = makeDeps({ config: OBJECTIVE_CONFIG, objectiveFacts: { [AWARENESS_ID]: { read: false, error: '令牌过期' } } })
    const out = await runLaunchWatch(fakeStep().step, deps)
    const awareness = out.clients[0].objective_watch?.series[0]
    expect(awareness).toMatchObject({ state: 'unread', error: '令牌过期' })
    expect(awareness?.alerts.map(a => a.code)).toEqual(['read_failed'])
    expect(summarizeRunCounts(out)).toEqual({ processed: 1, completed: 0, failed: 1 })
  })

  it('按目标盯盘的结论过一遍记忆化（JSON 来回）也不丢', async () => {
    const { deps } = makeDeps({ config: OBJECTIVE_CONFIG })
    const out = await runLaunchWatch(fakeStep().step, deps)
    expect(JSON.parse(JSON.stringify(out))).toEqual(out)
  })
})

describe('summarizeRunCounts · 运行记录里的 processed / completed / failed', () => {
  const entry = (over: Partial<LaunchWatchSummary['clients'][number]>): LaunchWatchSummary['clients'][number] => ({
    client_id: 'c1', active: false, spend_seen: null, series_found: null, sent: [], error: null, ...over,
  })
  const summary = (clients: LaunchWatchSummary['clients']): LaunchWatchSummary => ({ checked_at: NOW.toISOString(), no_publish: true, clients })
  const objective = (state: 'delivering' | 'unread') => ({
    as_of: NOW.toISOString(),
    series: [{ campaign_id: AWARENESS_ID, label: 'x', kind: 'awareness' as const, state, objective: null, anchor_at: null, hours_since_anchor: null, total: null, by_adset: [], by_ad: [], ad_status_counts: {}, me: null, headline: '', alerts: [], error: null }],
  })

  it('盯盘窗口里的客户算干了活；窗口外又没配按目标盯盘的不算', () => {
    expect(summarizeRunCounts(summary([entry({ active: true }), entry({ client_id: 'c2' })]))).toEqual({ processed: 1, completed: 1, failed: 0 })
  })

  it('花费没读到算失败', () => {
    expect(summarizeRunCounts(summary([entry({ active: true, error: '没有可用的 Meta 令牌' })]))).toEqual({ processed: 1, completed: 0, failed: 1 })
  })

  it('配了按目标盯盘的客户即使窗口外也算干了活；有系列读不到算失败', () => {
    expect(summarizeRunCounts(summary([entry({ objective_watch: objective('delivering') })]))).toEqual({ processed: 1, completed: 1, failed: 0 })
    expect(summarizeRunCounts(summary([entry({ objective_watch: objective('unread') })]))).toEqual({ processed: 1, completed: 0, failed: 1 })
  })
})

describe('readObjectiveSeries · 真读（假 fetch）', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('用配置里的广告账户和系列编号，令牌只进 Authorization 头；读不到的东西不抛错', async () => {
    const calls: { path: string; auth: string | null }[] = []
    const node = { id: AWARENESS_ID, name: '系列', objective: 'OUTCOME_AWARENESS', status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '2026-10-21T10:00:00+0000', updated_time: '2026-10-21T11:00:00+0000' }
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input))
      const path = url.pathname.replace(/^\/v\d+\.\d+\//, '')
      calls.push({ path, auth: new Headers(init?.headers).get('authorization') })
      if (path === 'act_1111111111') return new Response(JSON.stringify({ timezone_name: 'Pacific/Auckland' }), { status: 200 })
      if (path === AWARENESS_ID) return new Response(JSON.stringify(node), { status: 200 })
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const series = OBJECTIVE_WATCH.series[0] as ObjectiveWatchSeries
    const out = await readObjectiveSeries('c1', OBJECTIVE_CONFIG, series, NOW)
    expect(out.read).toBe(true)
    expect(calls.map(c => c.path)).toContain(`${AWARENESS_ID}/insights`)
    expect(calls.every(c => c.auth === 'Bearer FAKE_TOKEN_VALUE_123')).toBe(true)

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'boom', code: 100 } }), { status: 400 })))
    const failed = await readObjectiveSeries('c1', OBJECTIVE_CONFIG, series, NOW)
    expect(failed.read).toBe(false)
  })
})

// ─── 真读花费：只看本次投放的广告系列 ──────────────────────────────────────────

describe('readLaunchSpend · 花费只按本次投放的广告系列算（不是整个官方账户）', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  function stubFetch(insights: unknown, campaigns: unknown = { data: [] }) {
    const urls: string[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      urls.push(url)
      const path = new URL(url).pathname.replace(/^\/v\d+\.\d+\//, '')
      if (path === 'act_1111111111') return new Response(JSON.stringify({ timezone_name: 'Pacific/Auckland' }), { status: 200 })
      if (path === 'act_1111111111/insights') return new Response(JSON.stringify(insights), { status: 200 })
      if (path === 'act_1111111111/campaigns') return new Response(JSON.stringify(campaigns), { status: 200 })
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
        { campaign_id: '555555555555', campaign_name: '换了编号的 官网点击 20260101', spend: '7.5', inline_link_clicks: '1' },
      ],
    })
    const watch = { ...(CONFIG.launch_watch ?? { from: '2026-10-22', days: 4, timezone: 'Pacific/Auckland', campaign_ids: [] }), campaign_name_contains: ['官网点击', '20260101'] }
    const out = await readLaunchSpend('c1', CONFIG, watch, NOW)
    expect(out).toEqual({ read: true, spend_cents: 2000, error: null, series_found: true })
    const url = new URL(urls.find(u => u.includes('/insights')) ?? '')
    expect(url.searchParams.get('level')).toBe('campaign')
    expect(JSON.parse(url.searchParams.get('time_range') ?? '{}').since).toBe('2026-10-22')
    // 已经花钱了，系列肯定在：不用再多发一次「系列列表」请求
    expect(urls.some(u => u.includes('/campaigns'))).toBe(false)
  })

  const OTHER_ROWS = { data: [{ campaign_id: '999999999999', campaign_name: '别的系列', spend: '300', inline_link_clicks: '900' }] }

  it('系列在账户里（已发布、没开始花钱）→ 读到了，花费为 0，series_found=true', async () => {
    stubFetch(OTHER_ROWS, { data: [{ id: '123456789012', name: '官网点击 A' }] })
    const watch = CONFIG.launch_watch
    if (!watch) throw new Error('测试配置里应有盯盘窗口')
    await expect(readLaunchSpend('c1', CONFIG, watch, NOW)).resolves.toEqual({ read: true, spend_cents: 0, error: null, series_found: true })
  })

  it('系列不在账户里（编号和名字都对不上，比如还是未发布的草稿）→ 读到了，花费为 0，series_found=false（记灰，不是安静的 0）', async () => {
    stubFetch(OTHER_ROWS, { data: [{ id: '999999999999', name: '别的系列' }] })
    const watch = CONFIG.launch_watch
    if (!watch) throw new Error('测试配置里应有盯盘窗口')
    await expect(readLaunchSpend('c1', CONFIG, watch, NOW)).resolves.toEqual({ read: true, spend_cents: 0, error: null, series_found: false })
  })

  it('系列列表读不出来 → 花费照样读到，series_found 为 null（不当成找不到）', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const path = new URL(String(input)).pathname.replace(/^\/v\d+\.\d+\//, '')
      if (path === 'act_1111111111') return new Response(JSON.stringify({ timezone_name: 'Pacific/Auckland' }), { status: 200 })
      if (path === 'act_1111111111/insights') return new Response(JSON.stringify(OTHER_ROWS), { status: 200 })
      return new Response(JSON.stringify({ error: { message: 'nope', code: 100 } }), { status: 400 })
    })
    vi.stubGlobal('fetch', fetcher)
    const watch = CONFIG.launch_watch
    if (!watch) throw new Error('测试配置里应有盯盘窗口')
    await expect(readLaunchSpend('c1', CONFIG, watch, NOW)).resolves.toEqual({ read: true, spend_cents: 0, error: null, series_found: null })
  })

  // 🔴 第二轮审查整改：配了盯盘却没配系列 → 运行时拒绝，不退回整个账户
  it('盯盘窗口没配系列（编号和名字关键词都没有）→ 拒绝：read false、写明原因，一个请求都不发', async () => {
    const { fetcher } = stubFetch(OTHER_ROWS)
    const watch = { from: '2026-10-22', days: 4, timezone: 'Pacific/Auckland', campaign_ids: [] as string[], campaign_name_contains: [] as string[] }
    const out = await readLaunchSpend('c1', CONFIG, watch, NOW)
    expect(out).toMatchObject({ read: false, spend_cents: 0, series_found: null })
    expect(out.error).toContain('广告系列')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
