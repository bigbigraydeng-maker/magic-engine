/**
 * Inngest 云端消费者：广告开投前「追踪与环境就绪」检查（只读）。
 *
 * 设计稿：docs/specs/2026-10-19-ads-tracking-preflight-workflow.md §3。
 *
 * 触发：①每天新西兰早上 07:00 查所有配置了追踪检查的客户；
 *       ②事件 ads.tracking_preflight.requested（人手 / 开投前 T-24h、T-2h 叫醒；可指定一个客户）；
 *       ③事件 ads.tracking_postlaunch.requested（开投后 T+1h、T+24h 读回；开投时刻只有点开投那一刻才知道）。
 *
 * 一个客户一组步骤，各自 step.run、各自重试（函数级 retries: 2）：
 *   落地页 → Meta 数据集 → GA4 → CRM → 环境 → 预算 → 判灯 → 发回执事件。
 * 回执（机器可读）写 cron_run_logs.summary，并以事件 ads.tracking_preflight.checked 发出
 * （事件 id = 回执编号，重试时不会重复发）。今日待办（pm-todo/ads-tracking-preflight-items.ts）
 * 与推广计划看板（promo/gates.ts）读的都是这份回执，不自己现算。
 *
 * 🔴 本函数只读：读 Meta / GA4 / 官网 / 库，本模块自己唯一的写是 cron_run_logs 回执。
 *    不写 Meta、GA4、官网，不发布，不扣费。回执里 no_publish 恒为 true。
 *    例外（既有行为，不是本模块新增的写）：读 GA4 时如果 Google 授权令牌已过期，
 *    ga4/client 沿用的 OAuth 公共流程会换新令牌并写回库（platform_oauth_connections）；
 *    刷新失败时也会把那条连接标成出错。
 *    绿灯只是「该做的检查都过了」，不是发布 / 扣费授权。
 * 🔴 读不到不算函数失败：回执带原因，对应的门判灰；只有函数自己抛异常才写 failed（onFailure 收口）。
 * 🔴 新增函数必须有人去 Inngest 后台对 `/api/inngest` 重新 Sync 一次，不然「安静地不跑」。
 */

import { randomUUID } from 'node:crypto'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import {
  ADS_TRACKING_POSTLAUNCH_REQUESTED,
  ADS_TRACKING_PREFLIGHT_CHECKED,
  ADS_TRACKING_PREFLIGHT_REQUESTED,
} from '../ads-events'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, failOpenCronRuns, startCronRunId } from '@/lib/cron/run-logger'
import { fetchGa4EventCounts } from '@/lib/ga4/client'
import { MetaCapiWriter } from '@/lib/meta/capi/writer'
import { resolveMetaToken } from '@/lib/meta/token-selection'
import { APP_BASE } from '@/lib/pm-todo/binding-request-items'
import { getTrackingClientConfig, listTrackingClientIds } from '@/lib/ads-tracking-preflight/client-config'
import {
  assemblePostLaunchReceipt,
  assemblePreflightReceipt,
  collectBudgetFacts,
  collectCrmFacts,
  collectEnvFacts,
  collectGa4Facts,
  collectLandingFacts,
  collectMetaFacts,
  collectPostLaunchFacts,
  type CollectDeps,
} from '@/lib/ads-tracking-preflight/collect'
import { makeSupabasePropertyLoader } from '@/lib/ads-tracking-preflight/ga4-reader'
import { planRun, type RunPlan } from '@/lib/ads-tracking-preflight/plan-run'
import { TRACKING_PREFLIGHT_JOB, buildRunReceipt } from '@/lib/ads-tracking-preflight/receipt'
import { sanitizeError } from '@/lib/ads-tracking-preflight/sanitize'
import type {
  TrackingClientConfig,
  TrackingClientReceipt,
  TrackingRunReceipt,
} from '@/lib/ads-tracking-preflight/types'

/** 新西兰时间每天 07:00，比 07:10 的推广计划每日检查早十分钟，让它读到当天的回执。 */
export const TRACKING_PREFLIGHT_CRON = '0 7 * * *'
export const TRACKING_PREFLIGHT_TZ = 'Pacific/Auckland'

/** `step.run` 的最小形状 —— 单测注入假 step，不跑真 Inngest。 */
export interface TrackingStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
}

export interface TrackingEventLike {
  readonly name: string
  readonly data?: unknown
}

export interface TrackingCollectors {
  landing: typeof collectLandingFacts
  meta: typeof collectMetaFacts
  ga4: typeof collectGa4Facts
  crm: typeof collectCrmFacts
  env: typeof collectEnvFacts
  budget: typeof collectBudgetFacts
  postLaunch: typeof collectPostLaunchFacts
}

export interface TrackingRunDeps {
  readonly now: () => Date
  readonly newId: () => string
  readonly appBase: string
  readonly configuredClientIds: () => string[]
  readonly getConfig: (clientId: string) => TrackingClientConfig | null
  readonly collectDeps: (now: Date) => CollectDeps
  readonly collectors: TrackingCollectors
  readonly startRun: () => Promise<string>
  readonly finishRun: (runId: string, startedAt: number, run: TrackingRunReceipt) => Promise<void>
  readonly sendReceipt: (receipt: TrackingClientReceipt) => Promise<void>
}

/** 回执事件：编号 = 回执编号（步骤重试时同一份回执不会被重复发出），内容就是回执本身。 */
export function receiptEvent(receipt: TrackingClientReceipt): { id: string; name: string; data: TrackingClientReceipt } {
  return { id: receipt.request_id, name: ADS_TRACKING_PREFLIGHT_CHECKED, data: receipt }
}

const REAL_COLLECTORS: TrackingCollectors = {
  landing: collectLandingFacts,
  meta: collectMetaFacts,
  ga4: collectGa4Facts,
  crm: collectCrmFacts,
  env: collectEnvFacts,
  budget: collectBudgetFacts,
  postLaunch: collectPostLaunchFacts,
}

/** 真依赖。SDK / 数据库客户端都在步骤里现用，不在模块顶层建（构建期没有环境变量）。 */
function realCollectDeps(now: Date): CollectDeps {
  return {
    now,
    fetcher: fetch,
    supabase: supabaseAdmin,
    env: process.env,
    resolveMetaToken: async clientId => (await resolveMetaToken(supabaseAdmin, clientId, process.env))?.token ?? null,
    capiPreflight: clientId =>
      new MetaCapiWriter().preflight({ clientId, defaultPhoneCountry: null, facebookPageId: null }, { fetcher: fetch }),
    ga4: { loadPropertyId: makeSupabasePropertyLoader(supabaseAdmin), fetchEventCounts: fetchGa4EventCounts },
  }
}

function realDeps(): TrackingRunDeps {
  return {
    now: () => new Date(),
    newId: () => randomUUID(),
    appBase: APP_BASE,
    configuredClientIds: listTrackingClientIds,
    getConfig: getTrackingClientConfig,
    collectDeps: realCollectDeps,
    collectors: REAL_COLLECTORS,
    startRun: () => startCronRunId(TRACKING_PREFLIGHT_JOB),
    finishRun: async (runId, startedAt, run) => {
      const failed = run.clients.filter(c => c.read_errors.length > 0).length
      await cronRunHandle(TRACKING_PREFLIGHT_JOB, runId, startedAt).finish({
        processed: run.clients.length,
        completed: run.clients.length - failed,
        failed,
        summary: { ...run },
      })
    },
    sendReceipt: async receipt => {
      await inngest.send(receiptEvent(receipt))
    },
  }
}

// ─── 一个客户的步骤 ─────────────────────────────────────────────────────────

async function preflightOneClient(
  step: TrackingStep,
  deps: TrackingRunDeps,
  args: { runId: string; clientId: string; cfg: TrackingClientConfig; plan: RunPlan; now: Date },
): Promise<TrackingClientReceipt> {
  const { runId, clientId, cfg, plan, now } = args
  const collect = deps.collectors
  const collectDeps = deps.collectDeps(now)

  const landing = await step.run(`landing:${clientId}`, () => collect.landing(cfg, collectDeps))
  const focus = Array.from(new Set(landing.facts.probes.flatMap(p => p.pixel_ids)))
  const meta = await step.run(`meta:${clientId}`, () => collect.meta(clientId, cfg, focus, collectDeps))
  const ga4 = await step.run(`ga4:${clientId}`, () => collect.ga4(clientId, cfg, collectDeps))
  const crm = await step.run(`crm:${clientId}`, () => collect.crm(clientId, cfg, collectDeps))
  const env = await step.run(`env:${clientId}`, () => collect.env(clientId, collectDeps))
  const budget = await step.run(`budget:${clientId}`, () => collect.budget(clientId, cfg, collectDeps))

  return step.run(`judge:${clientId}`, async () =>
    assemblePreflightReceipt({
      requestId: `${runId}:${clientId}`, clientId, cfg, trigger: plan.trigger, appBase: deps.appBase, now,
      landing, meta, ga4, crm, env, budget,
    }),
  )
}

async function postLaunchOneClient(
  step: TrackingStep,
  deps: TrackingRunDeps,
  args: { runId: string; clientId: string; cfg: TrackingClientConfig; plan: RunPlan; now: Date },
): Promise<TrackingClientReceipt> {
  const { runId, clientId, cfg, plan, now } = args
  const phase = plan.phase === 'post_t24h' ? 'post_t24h' : 'post_t1h'
  const launchedAt = plan.launchedAt ?? now.toISOString()
  const insights = await step.run(`insights:${clientId}`, () =>
    deps.collectors.postLaunch(clientId, cfg, launchedAt, deps.collectDeps(now)),
  )
  return step.run(`judge:${clientId}`, async () =>
    assemblePostLaunchReceipt({ requestId: `${runId}:${clientId}`, clientId, cfg, phase, appBase: deps.appBase, now, launchedAt, insights }),
  )
}

// ─── 整轮 ───────────────────────────────────────────────────────────────────

/** 整轮编排。导出给单测用（注入假 step 和假依赖）；真函数只是把真 step 和真依赖接进来。 */
export async function runTrackingPreflight(
  step: TrackingStep,
  event: TrackingEventLike,
  deps: TrackingRunDeps,
): Promise<TrackingRunReceipt> {
  // 🔴 时刻和编号必须在步骤里取：步骤外的代码每次重放都会重跑。
  const started = await step.run('start-run', async () => ({
    runId: await deps.startRun(),
    requestId: deps.newId(),
    startedAt: deps.now().getTime(),
  }))
  const now = new Date(started.startedAt)
  const plan = planRun({ eventName: event.name, data: event.data, configuredClientIds: deps.configuredClientIds(), now })

  const clients: TrackingClientReceipt[] = []
  for (const clientId of plan.clientIds) {
    const cfg = deps.getConfig(clientId)
    if (!cfg) continue
    const args = { runId: started.requestId, clientId, cfg, plan, now }
    const receipt = plan.trigger === 'postlaunch'
      ? await postLaunchOneClient(step, deps, args)
      : await preflightOneClient(step, deps, args)
    await step.run(`emit:${clientId}`, () => deps.sendReceipt(receipt))
    clients.push(receipt)
  }

  const base = buildRunReceipt({
    requestId: started.requestId,
    checkedAt: now.toISOString(),
    trigger: plan.trigger,
    clients,
  })
  // 事件内容有问题（缺东西 / 客户没配置）不静默：记进回执，由今日待办读出来
  const run: TrackingRunReceipt = plan.error ? { ...base, status: 'partial', error: plan.error } : base

  await step.run('finish-run', () => deps.finishRun(started.runId, started.startedAt, run))
  return run
}

export function createAdsTrackingPreflightFunction(deps: TrackingRunDeps = realDeps()) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}ads-tracking-preflight`,
      name: 'Ads tracking preflight: read pixel/GA4/landing/env, judge gates, write receipt',
      concurrency: { limit: 1 },
      retries: 2,
      onFailure: async ({ event, error }) => {
        const message =
          error?.message ||
          (event.data as { error?: { message?: string } } | undefined)?.error?.message ||
          '未知错误'
        const ts = (event as { ts?: number }).ts
        const startedBefore = new Date(typeof ts === 'number' ? ts : Date.now())
        // 🔴 报错文字里可能回显令牌，写进运行记录前先过 sanitizeError
        await failOpenCronRuns(TRACKING_PREFLIGHT_JOB, `重试耗尽后仍失败：${sanitizeError(message)}`, { startedBefore })
      },
    },
    [
      { cron: `TZ=${TRACKING_PREFLIGHT_TZ} ${TRACKING_PREFLIGHT_CRON}` },
      { event: ADS_TRACKING_PREFLIGHT_REQUESTED },
      { event: ADS_TRACKING_POSTLAUNCH_REQUESTED },
    ],
    async ({ event, step }): Promise<TrackingRunReceipt> =>
      runTrackingPreflight(
        {
          // Inngest 把记忆化结果标成 Jsonify<T>；本函数每个 step 的返回值都是纯数据（没有 Date / 函数），
          // 序列化前后同形，这里按 T 用。
          run: <T,>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T>,
        },
        { name: event.name, data: event.data },
        deps,
      ),
  )
}

export const adsTrackingPreflight = createAdsTrackingPreflightFunction()
