/**
 * 广告开投前追踪检查 · Inngest 装配与编排测试。
 *
 * 测两件事：
 *   · 装配：函数 id、触发器（带时区的定时 + 两个事件）、retries、并发、onFailure、注册进 cloudFunctions、
 *     cron 登记表里有且 schedule 与函数里的常量一致、事件名不撞本机 worker
 *   · 编排：步骤顺序和命名、时刻 / 编号只在 start-run 里取、每个客户一份回执一个事件、
 *     事件内容有问题不静默、开投后读回走另一条路、整轮回执写进运行记录
 * 不测判灯本身（judge.test.ts）和读取器（各自的测试）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import {
  TRACKING_PREFLIGHT_CRON,
  TRACKING_PREFLIGHT_TZ,
  adsTrackingPreflight,
  createAdsTrackingPreflightFunction,
  receiptEvent,
  runTrackingPreflight,
  type TrackingCollectors,
  type TrackingRunDeps,
  type TrackingStep,
} from '../functions/ads-tracking-preflight'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../client'
import {
  ADS_TRACKING_POSTLAUNCH_REQUESTED,
  ADS_TRACKING_PREFLIGHT_CHECKED,
  ADS_TRACKING_PREFLIGHT_REQUESTED,
} from '../ads-events'
import { CRON_REGISTRY } from '@/lib/cron/registry'
import { TRACKING_PREFLIGHT_JOB } from '@/lib/ads-tracking-preflight/receipt'
import type { Collected } from '@/lib/ads-tracking-preflight/collect'
import type {
  BudgetFacts, CrmFacts, EnvFacts, Ga4Facts, LandingFacts, MetaFacts, PostLaunchFacts,
  TrackingClientConfig, TrackingClientReceipt, TrackingRunReceipt,
} from '@/lib/ads-tracking-preflight/types'

const NOW = new Date('2026-10-19T10:30:00.000Z')
const AS_OF = NOW.toISOString()
const OFFICIAL = '2000000000000001'

const CONFIG: TrackingClientConfig = {
  ad_account_id: 'act_1111111111',
  site_url: 'https://www.example-shop.test',
  landing_targets: [{ label: '落地页 A', url: 'https://www.example-shop.test/p?utm_content=a' }],
  ga4_lead_events: ['generate_lead'],
  web_form_to_crm: true,
  // 预算数字不再写死：上限读库、在投预算读 Meta（这里的收集函数是替身）
  planned_daily_budget_cents: null,
  official_daily_cap_cents: null,
  currency: 'NZD',
}

// ─── 装配 ───────────────────────────────────────────────────────────────────

type Fn = typeof adsTrackingPreflight
interface FnOpts {
  id?: string
  retries?: number
  concurrency?: { limit: number }
  triggers?: { cron?: string; event?: string }[]
  onFailure?: (ctx: { event: { ts?: number; data: unknown }; error: Error }) => Promise<void>
}
const optsOf = (fn: Fn): FnOpts => (fn as Fn & { opts: FnOpts }).opts

describe('装配', () => {
  it('id 带 cloud- 前缀、串行跑（concurrency 1）、失败重试 2 次', () => {
    expect(adsTrackingPreflight.id()).toBe(`${CLOUD_FN_PREFIX}ads-tracking-preflight`)
    expect(optsOf(adsTrackingPreflight).retries).toBe(2)
    expect(optsOf(adsTrackingPreflight).concurrency?.limit).toBe(1)
  })

  it('三个触发器：新西兰时区的每日定时 + 两个事件', () => {
    const triggers = optsOf(adsTrackingPreflight).triggers ?? []
    expect(triggers.map(t => t.cron).filter(Boolean)).toEqual([`TZ=${TRACKING_PREFLIGHT_TZ} ${TRACKING_PREFLIGHT_CRON}`])
    expect(triggers.map(t => t.event).filter(Boolean)).toEqual([ADS_TRACKING_PREFLIGHT_REQUESTED, ADS_TRACKING_POSTLAUNCH_REQUESTED])
    expect(TRACKING_PREFLIGHT_TZ).toBe('Pacific/Auckland')
  })

  it('事件名业务可读，且不撞本机 worker 已经消费的事件（一事件一主）', () => {
    for (const name of [ADS_TRACKING_PREFLIGHT_REQUESTED, ADS_TRACKING_PREFLIGHT_CHECKED, ADS_TRACKING_POSTLAUNCH_REQUESTED]) {
      expect(name).toMatch(/^ads\.[a-z_]+\.[a-z_]+$/)
      expect((WORKER_OWNED_EVENTS as readonly string[]).includes(name)).toBe(false)
    }
  })

  it('注册进了 cloudFunctions', () => {
    expect(cloudFunctions).toContain(adsTrackingPreflight)
  })

  it('cron 登记表里有它，schedule 跟函数里的常量是同一个、由 Inngest 调度、写运行记录', () => {
    const entry = CRON_REGISTRY.find(e => e.jobName === TRACKING_PREFLIGHT_JOB)
    expect(entry).toMatchObject({ scheduler: 'inngest', logsRuns: true, schedule: TRACKING_PREFLIGHT_CRON })
    expect(entry?.addedAt).toBeTruthy()
  })

  it('重试耗尽 → onFailure 把还停在「在跑」的运行记录收成失败，不静默', async () => {
    failOpenCronRuns.mockClear()
    await optsOf(adsTrackingPreflight).onFailure?.({ event: { ts: NOW.getTime(), data: {} }, error: new Error('炸了') })
    expect(failOpenCronRuns).toHaveBeenCalledTimes(1)
    expect(failOpenCronRuns.mock.calls[0][0]).toBe(TRACKING_PREFLIGHT_JOB)
    expect(failOpenCronRuns.mock.calls[0][1]).toContain('炸了')
  })

  // 🔴 审查整改：写进运行记录的失败原因要过 sanitizeError——报错文字里可能回显令牌
  it('onFailure 写进运行记录的原因里不能带令牌：access_token=… 和 40 位以上的长串都要被抹掉', async () => {
    failOpenCronRuns.mockClear()
    const leaked = 'EAAB' + 'x'.repeat(60)
    await optsOf(adsTrackingPreflight).onFailure?.({
      event: { ts: NOW.getTime(), data: {} },
      error: new Error(`Meta 400 access_token=SECRETVALUE123 bearer ${leaked}`),
    })
    const written = String(failOpenCronRuns.mock.calls[0][1])
    expect(written).not.toContain('SECRETVALUE123')
    expect(written).not.toContain(leaked)
    expect(written).toContain('重试耗尽后仍失败')
  })

  it('可以用假依赖造一个函数（单测入口）', () => {
    expect(createAdsTrackingPreflightFunction(makeDeps().deps).id()).toBe(`${CLOUD_FN_PREFIX}ads-tracking-preflight`)
  })
})

// ─── 编排 ───────────────────────────────────────────────────────────────────

const landing: Collected<LandingFacts> = {
  facts: {
    as_of: AS_OF,
    probes: [{ label: '落地页 A', url: CONFIG.landing_targets[0].url, http_status: 200, final_url: CONFIG.landing_targets[0].url, redirects: 0, utm_preserved: true, pixel_ids: [OFFICIAL], error: null }],
  },
  errors: [],
}
const meta: Collected<MetaFacts> = {
  facts: {
    read: true, as_of: AS_OF, account_dataset_ids: [OFFICIAL],
    datasets: [{ id: OFFICIAL, name: 'Main', last_fired_at: '2026-10-19T08:00:00.000Z', events_24h: { PageView: 50 }, events_7d: { PageView: 300, Lead: 6 }, match_quality: { Lead: 9.3 } }],
    account: { status: 1, disable_reason: 0, has_funding_source: true, spend_cap_minor: 0, amount_spent_minor: 0, currency: 'NZD' },
  },
  errors: [],
}
const ga4: Collected<Ga4Facts> = { facts: { read: true, error: null, events_7d: { generate_lead: 8 }, as_of: AS_OF }, errors: [] }
const crm: Collected<CrmFacts> = { facts: { read: true, error: null, web_form_touchpoints_7d: 3, latest_web_form_at: '2026-10-19T05:00:00Z', as_of: AS_OF }, errors: [] }
const env: Collected<EnvFacts> = {
  facts: {
    capi_target: { status: 'configured', pixel_id: OFFICIAL },
    capi_preflight: { ok: true, stage: null, token_valid: true, pixel_visible: true },
    capi_events_7d: { confirmed: 1, in_doubt: 0, failed: 0 },
    meta_token_resolved: true,
    conversion_stage: null,
    jobs: [{ job: 'meta-leads-sync', max_age_hours: 3, last_finished_at: '2026-10-19T09:30:00.000Z', last_status: 'completed' }],
    as_of: AS_OF,
  },
  errors: [],
}
const budget: Collected<BudgetFacts> = {
  facts: {
    read: true, error: null, as_of: AS_OF,
    account_cap_cents: 15000, client_cap_cents: 15000, registered_account_count: 1,
    live_daily_budget_cents: 13400, live_lifetime_budget_count: 0, live_entity_count: 3,
    other_accounts: null, other_accounts_error: null,
  },
  errors: [],
}
const insights: Collected<PostLaunchFacts> = {
  facts: { read: true, error: null, as_of: AS_OF, spend_cents: 2500, link_clicks: 40, landing_page_views: 32, leads: 1 },
  errors: [],
}

function makeDeps(over: Partial<TrackingRunDeps> = {}) {
  const sent: TrackingClientReceipt[] = []
  const finished: { runId: string; startedAt: number; run: TrackingRunReceipt }[] = []
  const collectorCalls: string[] = []
  const collectors: TrackingCollectors = {
    landing: vi.fn(async () => { collectorCalls.push('landing'); return landing }),
    meta: vi.fn(async (_c, _cfg, focus) => { collectorCalls.push(`meta(${focus.join(',')})`); return meta }),
    ga4: vi.fn(async () => { collectorCalls.push('ga4'); return ga4 }),
    crm: vi.fn(async () => { collectorCalls.push('crm'); return crm }),
    env: vi.fn(async () => { collectorCalls.push('env'); return env }),
    budget: vi.fn(async () => { collectorCalls.push('budget'); return budget }),
    postLaunch: vi.fn(async (_c, _cfg, launchedAt) => { collectorCalls.push(`postLaunch(${launchedAt})`); return insights }),
  }
  const now = vi.fn(() => NOW)
  const deps: TrackingRunDeps = {
    now,
    newId: () => 'req-1',
    appBase: 'https://app.example.test',
    configuredClientIds: () => ['c1'],
    getConfig: id => (id === 'c1' ? CONFIG : null),
    collectDeps: () => { throw new Error('编排测试用不到真依赖：收集函数都被替换了，不会真去读') },
    collectors,
    startRun: async () => 'run-1',
    finishRun: async (runId, startedAt, run) => { finished.push({ runId, startedAt, run }) },
    sendReceipt: async receipt => { sent.push(receipt) },
    ...over,
  }
  // collectDeps 被收集函数的替身忽略；给个无害的空壳，别让替身调用时炸
  const safeDeps: TrackingRunDeps = { ...deps, collectDeps: over.collectDeps ?? (() => ({}) as ReturnType<TrackingRunDeps['collectDeps']>) }
  return { deps: safeDeps, sent, finished, collectorCalls, now }
}

/** 假 step：记 id 顺序，返回值走一遍 JSON —— 跟 Inngest 记忆化一样（Date / undefined 会露馅）。 */
function fakeStep() {
  const ids: string[] = []
  const step: TrackingStep = {
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

describe('回执事件', () => {
  it('事件编号就是回执编号（步骤重试时同一份回执不会被重复发出），事件名业务可读，内容就是回执本身', () => {
    const receipt = { request_id: 'req-1:c1', client_id: 'c1' } as TrackingClientReceipt
    expect(receiptEvent(receipt)).toEqual({ id: 'req-1:c1', name: ADS_TRACKING_PREFLIGHT_CHECKED, data: receipt })
  })
})

describe('编排 · 每日定时', () => {
  it('一个客户：落地页 → Meta（只读页面上出现的数据集）→ GA4 → CRM → 环境 → 预算 → 判灯 → 发回执事件 → 收尾', async () => {
    const { deps, sent, finished, collectorCalls } = makeDeps()
    const { ids, step } = fakeStep()

    const run = await runTrackingPreflight(step, { name: 'inngest/scheduled.timer' }, deps)

    expect(ids).toEqual(['start-run', 'landing:c1', 'meta:c1', 'ga4:c1', 'crm:c1', 'env:c1', 'budget:c1', 'judge:c1', 'emit:c1', 'finish-run'])
    expect(collectorCalls).toEqual([`landing`, `meta(${OFFICIAL})`, 'ga4', 'crm', 'env', 'budget'])
    expect(run).toMatchObject({ request_id: 'req-1', checked_at: AS_OF, status: 'ok', error: null, no_publish: true, trigger: 'cron' })
    expect(run.clients).toHaveLength(1)
    expect(run.clients[0]).toMatchObject({ client_id: 'c1', request_id: 'req-1:c1', overall: 'green', phase: 'preflight', trigger: 'cron' })
    expect(sent).toEqual(run.clients)
    expect(finished).toEqual([{ runId: 'run-1', startedAt: NOW.getTime(), run }])
  })

  it('时刻只取一次（在 start-run 里），所有判断都用这一个时刻', async () => {
    const { deps, now } = makeDeps()
    const { step } = fakeStep()
    await runTrackingPreflight(step, { name: 'inngest/scheduled.timer' }, deps)
    expect(now).toHaveBeenCalledTimes(1)
  })

  it('没有任何客户配置了追踪检查 → 照样收尾，回执写明 not_configured（不静默）', async () => {
    const { deps, sent, finished } = makeDeps({ configuredClientIds: () => [] })
    const { ids, step } = fakeStep()
    const run = await runTrackingPreflight(step, { name: 'inngest/scheduled.timer' }, deps)
    expect(ids).toEqual(['start-run', 'finish-run'])
    expect(run.status).toBe('not_configured')
    expect(sent).toEqual([])
    expect(finished).toHaveLength(1)
  })
})

describe('编排 · 事件叫醒', () => {
  it('指定了客户 → 只查那一个，类型 requested', async () => {
    const { deps } = makeDeps({ configuredClientIds: () => ['c1', 'c2'], getConfig: () => CONFIG })
    const { ids, step } = fakeStep()
    const run = await runTrackingPreflight(step, { name: ADS_TRACKING_PREFLIGHT_REQUESTED, data: { client_id: 'c2', reason: 'T-24h' } }, deps)
    expect(run.trigger).toBe('requested')
    expect(run.clients.map(c => c.client_id)).toEqual(['c2'])
    expect(ids.filter(i => i.startsWith('meta:'))).toEqual(['meta:c2'])
  })

  it('指定的客户没配置 → 一个客户都不查，回执 partial 并写明原因；不抛错、不发事件', async () => {
    const { deps, sent } = makeDeps()
    const { ids, step } = fakeStep()
    const run = await runTrackingPreflight(step, { name: ADS_TRACKING_PREFLIGHT_REQUESTED, data: { client_id: 'stranger' } }, deps)
    expect(ids).toEqual(['start-run', 'finish-run'])
    expect(run.status).toBe('partial')
    expect(run.error).toContain('配置')
    expect(sent).toEqual([])
  })
})

describe('编排 · 开投后读回', () => {
  it('走另一条路：只读开投后的洞察、判一道门；开投时刻原样传给收集函数', async () => {
    const { deps, sent, collectorCalls } = makeDeps()
    const { ids, step } = fakeStep()
    const data = { client_id: 'c1', phase: 't24h', launched_at: '2026-10-18T10:00:00Z' }
    const run = await runTrackingPreflight(step, { name: ADS_TRACKING_POSTLAUNCH_REQUESTED, data }, deps)

    expect(ids).toEqual(['start-run', 'insights:c1', 'judge:c1', 'emit:c1', 'finish-run'])
    expect(collectorCalls).toEqual(['postLaunch(2026-10-18T10:00:00Z)'])
    expect(run.trigger).toBe('postlaunch')
    expect(run.clients[0]).toMatchObject({ phase: 'post_t24h', trigger: 'postlaunch', overall: 'green', launched_at: '2026-10-18T10:00:00Z' })
    expect(run.clients[0].gates.map(g => g.key)).toEqual(['post.t24h'])
    expect(sent).toHaveLength(1)
  })

  it('开投时间不合理（晚于现在 / 早于 7 天前）→ 不读，回执 partial 写明原因', async () => {
    for (const launched_at of ['2026-10-19T12:00:00Z', '2026-10-01T00:00:00Z']) {
      const { deps, collectorCalls } = makeDeps()
      const { ids, step } = fakeStep()
      const run = await runTrackingPreflight(step, { name: ADS_TRACKING_POSTLAUNCH_REQUESTED, data: { client_id: 'c1', phase: 't1h', launched_at } }, deps)
      expect(ids, launched_at).toEqual(['start-run', 'finish-run'])
      expect(collectorCalls, launched_at).toEqual([])
      expect(run, launched_at).toMatchObject({ status: 'partial', trigger: 'postlaunch' })
      expect(run.error, launched_at).toBeTruthy()
    }
  })

  it('事件内容不对（阶段写错）→ 不读，回执 partial 写明原因', async () => {
    const { deps } = makeDeps()
    const { ids, step } = fakeStep()
    const run = await runTrackingPreflight(step, { name: ADS_TRACKING_POSTLAUNCH_REQUESTED, data: { client_id: 'c1', phase: 't9h', launched_at: '2026-10-18T10:00:00Z' } }, deps)
    expect(ids).toEqual(['start-run', 'finish-run'])
    expect(run).toMatchObject({ status: 'partial', trigger: 'postlaunch' })
    expect(run.error).toBeTruthy()
  })
})
