/**
 * Inngest 云端消费者：开投后「自动补排」读回（只读）。
 *
 * 为什么要有它：开投后 1 小时 / 24 小时的追踪读回（ads.tracking_postlaunch.requested）
 * 原本要靠人在点开投那一刻记得发事件——靠人记会漏。这个函数每小时看一眼：
 * 在客户配置的盯盘窗口里，本次投放的广告系列一旦开始花钱，就记下「第一次看到花费」的时刻；
 * 满 1 小时、又没做过 T+1h 读回，就自己发 T+1h（不在发现花费的当小时就读，那时候刚开投，数字说明不了什么）；
 * T+1h 做过且满 24 小时、没做过 T+24h，就自己发 T+24h。
 * 它发的是跟人手一样的事件（走同一个入口、同一套内容校验、同一个读回函数），
 * 人手先发了也行：读回过的就不会再补（读回的数全是空 = 没读到，不算做过）。
 *
 * 花费只按客户配置里的广告系列（campaign_ids）算，不是整个官方账户——账户里别的系列早就在花钱，
 * 按账户算会把「开投」误判在窗口第一天。
 *
 * 「开投时刻」说明：自动补排看不到点开投的真实时刻，T+1h 的开投时刻记为「第一次看到有花费的那次盯盘」
 * （误差不超过 1 小时）；人手带着真实开投时刻发的读回会被优先采用（取最早的开投时刻）。
 *
 * 第二件事（按目标盯盘，和上面互相独立）：客户配置里列了 objective_watch 的系列，每小时按目标读一遍——
 * 播放量系列看完整播放 / 触达 / 频次，WhatsApp 系列看开始聊天数 / 单个成本并核对 ME 有没有收到，
 * 表单留资系列看当天花费、线索、审核状态，并和 CRM 对账。
 * 所有系列都盯「最近一次改动后一直没花钱」。结论（含每条提醒的 什么 / 怎么办 / 链接）写进本函数的运行记录，
 * 今日待办只读这份记录翻成待办。系列停了就自动不盯。
 *
 * 🔴 播放量和 WhatsApp 仍然只读。表单留资只有三种故障命中时，才用服务密钥去调只暂停入口
 *    （POST /api/internal/meta-ads/pause-only）。入口没开、没部署、或密钥没配，只在回执里记原因，广告不动。
 *    本函数自己不改预算、不恢复、不删除。不发布，不扣费。唯一直接写的仍是 cron_run_logs。
 * 🔴 窗口外的整点也留一行运行记录（processed=0）——不留的话，这个函数自己哪天停了没人看得出来。
 * 🔴 新增函数必须有人去 Inngest 后台对 `/api/inngest` 重新 Sync 一次，不然「安静地不跑」。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { ADS_TRACKING_POSTLAUNCH_REQUESTED, type AdsTrackingPostLaunchRequestedData } from '../ads-events'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, failOpenCronRuns, startCronRunId } from '@/lib/cron/run-logger'
import { resolveMetaToken } from '@/lib/meta/token-selection'
import { APP_BASE } from '@/lib/pm-todo/binding-request-items'
import { getTrackingClientConfig, listTrackingClientIds } from '@/lib/ads-tracking-preflight/client-config'
import {
  LAUNCH_WATCH_JOB,
  decideLaunchWatch,
  firstSpendSeenFromRows,
  isWatchActive,
  postLaunchStatesFromRows,
  watchEventId,
  type PostLaunchReceiptState,
} from '@/lib/ads-tracking-preflight/launch-watch'
import { countMeWhatsappInbound } from '@/lib/ads-tracking-preflight/me-inbound-reader'
import {
  adsManagerCampaignUrl,
  crmUrl,
  judgeSeries,
  type MeInboundFact,
  type ObjectiveWatchSummary,
  type SeriesFacts,
  type SeriesUnread,
  type SeriesVerdict,
} from '@/lib/ads-tracking-preflight/objective-watch'
import { readSeriesFacts } from '@/lib/ads-tracking-preflight/objective-watch-read'
import { loadPreviousSurplusLive, readLeadFormExtraLive } from '@/lib/ads-tracking-preflight/lead-form-live'
import { reviewLeadFormSeries, type LeadFormWatchDeps } from '@/lib/ads-tracking-preflight/lead-form-watch'
import { requestServicePause as postServicePause } from '@/lib/ads-tracking-preflight/service-pause-client'
import type { PauseRequestReceipt, ServicePauseCall } from '@/lib/ads-tracking-preflight/lead-form-types'
import { readCampaignPresence, readPostLaunchFacts } from '@/lib/ads-tracking-preflight/post-launch'
import { TRACKING_PREFLIGHT_JOB } from '@/lib/ads-tracking-preflight/receipt'
import { sanitizeError } from '@/lib/ads-tracking-preflight/sanitize'
import type {
  LaunchWatchConfig,
  ObjectiveWatchConfig,
  ObjectiveWatchSeries,
  TrackingClientConfig,
} from '@/lib/ads-tracking-preflight/types'

// 任务名只在 launch-watch.ts 里定义一次（今日待办也要按它读盯盘自己的运行记录）
export { LAUNCH_WATCH_JOB }
/** 新西兰时间每小时的第 20 分钟。 */
export const LAUNCH_WATCH_CRON = '20 * * * *'
export const LAUNCH_WATCH_TZ = 'Pacific/Auckland'

/** `step.run` 的最小形状 —— 单测注入假 step，不跑真 Inngest。 */
export interface LaunchWatchStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
}

export interface LaunchWatchSpend {
  read: boolean
  spend_cents: number
  error: string | null
  /**
   * 本次投放的系列在不在账户里（不管花没花钱）。花了钱 = true；没读到 / 读不出 = null（不是「找不到」）。
   * false = 编号和名字都对不上（比如还是未发布的草稿，线上读不到）：记灰，不是安静的 0。
   */
  series_found: boolean | null
}

export interface LaunchWatchDeps {
  readonly now: () => Date
  readonly configuredClientIds: () => string[]
  readonly getConfig: (clientId: string) => TrackingClientConfig | null
  /** 盯盘窗口开始以来、本次投放的广告系列的累计花费；读不到返回 read=false，永不 reject。 */
  readonly readSpend: (clientId: string, cfg: TrackingClientConfig, watch: LaunchWatchConfig, now: Date) => Promise<LaunchWatchSpend>
  readonly loadReceiptStates: (clientId: string, sinceIso: string) => Promise<PostLaunchReceiptState[]>
  /** 盯盘自己的运行记录里「第一次看到花费」的那次盯盘时刻；没有 = null。读库出错会抛错（由步骤重试）。 */
  readonly loadFirstSpendSeenAt: (clientId: string, sinceIso: string) => Promise<string | null>
  readonly sendEvent: (event: { id: string; data: AdsTrackingPostLaunchRequestedData }) => Promise<void>
  /** 按目标盯盘：读一个系列的结构和三层洞察；读不到返回 read=false，永不 reject。 */
  readonly readObjectiveSeries: (clientId: string, cfg: TrackingClientConfig, series: ObjectiveWatchSeries, now: Date) => Promise<SeriesFacts | SeriesUnread>
  /** 按目标盯盘：数 ME 自某时刻起收到的 WhatsApp 会话；读不到返回 read=false，永不 reject。 */
  readonly countMeInbound: (clientId: string, sinceIso: string) => Promise<MeInboundFact>
  /** 表单留资：当天花费、上限、CRM、同步连续失败。其它类型不会调用。 */
  readonly readLeadFormExtra: LeadFormWatchDeps['readLeadFormExtra']
  /** 上一小时回执里，Meta 线索多于 CRM 是从什么时候开始的。 */
  readonly loadPreviousSurplus: (clientId: string, campaignId: string) => Promise<string | null>
  /** 命中故障后去调只暂停入口。入口没开只返回原因，不抛错。 */
  readonly requestServicePause: (call: ServicePauseCall) => Promise<PauseRequestReceipt>
  /** 后台网址前缀（提醒里的 CRM 链接用）。 */
  readonly appBase: string
  readonly startRun: () => Promise<string>
  readonly finishRun: (runId: string, startedAt: number, summary: LaunchWatchSummary) => Promise<void>
}

export interface LaunchWatchClientSummary {
  client_id: string
  active: boolean
  /** 窗口里读到的是否有花费；没读到、或本次系列一个都没找到 = null（灰，不是 false） */
  spend_seen: boolean | null
  /** 本次系列在不在账户里；读不出 = null；false = 一个都没找到（记灰） */
  series_found: boolean | null
  sent: { phase: 't1h' | 't24h'; launched_at: string; event_id: string }[]
  error: string | null
  /** 按目标盯盘的逐系列结论（含每条提醒的 什么 / 怎么办 / 链接）；客户没配按目标盯盘 = 没有这个字段 */
  objective_watch?: ObjectiveWatchSummary
}

export interface LaunchWatchSummary {
  checked_at: string
  no_publish: true
  clients: LaunchWatchClientSummary[]
}

const DAY_MS = 86_400_000

/** 窗口开始前一天的 UTC 零点：只认这之后的读回回执，免得把上一次开投的回执算进来。 */
function sinceIsoOf(watch: LaunchWatchConfig): string {
  return new Date(Date.parse(`${watch.from}T00:00:00.000Z`) - DAY_MS).toISOString()
}

// ─── 真依赖 ─────────────────────────────────────────────────────────────────

/**
 * 真读花费：只按配置里本次投放的广告系列（编号或名字）算（导出给单测用）。
 * 🔴 配了盯盘却没配系列 → 拒绝（read=false），绝不退回整个账户的口径。
 * 没花钱时再多读一次系列列表，分清「系列在、还没花钱」和「一个系列都没找到」。
 */
export async function readLaunchSpend(clientId: string, cfg: TrackingClientConfig, watch: LaunchWatchConfig, now: Date): Promise<LaunchWatchSpend> {
  const token = (await resolveMetaToken(supabaseAdmin, clientId, process.env))?.token ?? null
  if (!token) return { read: false, spend_cents: 0, error: '没有可用的 Meta 令牌', series_found: null }
  const scope = { campaignIds: watch.campaign_ids, campaignNameContains: watch.campaign_name_contains }
  const out = await readPostLaunchFacts({
    adAccountId: cfg.ad_account_id,
    token,
    fetcher: fetch,
    now,
    launchedAt: now.toISOString(),
    sinceDate: watch.from,
    ...scope,
  })
  if (!out.facts.read) return { read: false, spend_cents: 0, error: out.facts.error, series_found: null }
  if (out.facts.spend_cents > 0) return { read: true, spend_cents: out.facts.spend_cents, error: null, series_found: true }
  const presence = await readCampaignPresence({ adAccountId: cfg.ad_account_id, token, fetcher: fetch, ...scope })
  return { read: true, spend_cents: 0, error: null, series_found: presence.found }
}

/** 按目标盯盘：真读一个系列（永不 reject；没有可用令牌 = 读不到）。导出给单测用。 */
export async function readObjectiveSeries(clientId: string, cfg: TrackingClientConfig, series: ObjectiveWatchSeries, now: Date): Promise<SeriesFacts | SeriesUnread> {
  const token = (await resolveMetaToken(supabaseAdmin, clientId, process.env))?.token ?? null
  if (!token) return { read: false, error: '没有可用的 Meta 令牌' }
  return readSeriesFacts({ adAccountId: cfg.ad_account_id, campaignId: series.campaign_id, token, fetcher: fetch, now })
}

async function realLoadReceiptStates(clientId: string, sinceIso: string): Promise<PostLaunchReceiptState[]> {
  const { data, error } = await supabaseAdmin
    .from('cron_run_logs')
    .select('status, started_at, summary')
    .eq('job_name', TRACKING_PREFLIGHT_JOB)
    .gte('started_at', sinceIso)
    .order('started_at', { ascending: false })
    .limit(60)
  if (error) throw new Error(`读不到运行记录：${error.message}`.slice(0, 160))
  return postLaunchStatesFromRows((data ?? []) as { status: string | null; started_at: string; summary: unknown }[], clientId, sinceIso)
}

/** 盯盘自己的运行记录（每小时一行）里找「第一次看到花费」的时刻。回看 120 行 ≈ 5 天，够盖住 4 天的窗口。 */
async function realLoadFirstSpendSeenAt(clientId: string, sinceIso: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('cron_run_logs')
    .select('status, started_at, summary')
    .eq('job_name', LAUNCH_WATCH_JOB)
    .gte('started_at', sinceIso)
    .order('started_at', { ascending: false })
    .limit(120)
  if (error) throw new Error(`读不到盯盘自己的运行记录：${error.message}`.slice(0, 160))
  return firstSpendSeenFromRows((data ?? []) as { status: string | null; started_at: string; summary: unknown }[], clientId, sinceIso)
}

/** 自动补排发出的事件：事件名就是人手入口用的那个，编号由盯盘按小时算好（同一小时重复触发只算一次）。 */
export function postLaunchEvent(event: { id: string; data: AdsTrackingPostLaunchRequestedData }) {
  return { id: event.id, name: ADS_TRACKING_POSTLAUNCH_REQUESTED, data: { ...event.data } }
}

function realDeps(): LaunchWatchDeps {
  return {
    now: () => new Date(),
    configuredClientIds: listTrackingClientIds,
    getConfig: getTrackingClientConfig,
    readSpend: readLaunchSpend,
    loadReceiptStates: realLoadReceiptStates,
    loadFirstSpendSeenAt: realLoadFirstSpendSeenAt,
    sendEvent: async event => {
      await inngest.send(postLaunchEvent(event))
    },
    readObjectiveSeries,
    readLeadFormExtra: readLeadFormExtraLive,
    loadPreviousSurplus: loadPreviousSurplusLive,
    requestServicePause: call => postServicePause({
      call,
      fetchImpl: fetch,
      appBase: APP_BASE,
      serviceKey: process.env.CRON_SECRET ?? null,
    }),
    countMeInbound: (clientId, sinceIso) => countMeWhatsappInbound(supabaseAdmin, clientId, sinceIso),
    appBase: APP_BASE,
    startRun: () => startCronRunId(LAUNCH_WATCH_JOB),
    finishRun: async (runId, startedAt, summary) => {
      const counts = summarizeRunCounts(summary)
      await cronRunHandle(LAUNCH_WATCH_JOB, runId, startedAt).finish({ ...counts, summary: { ...summary } })
    },
  }
}

/**
 * 运行记录里的 processed / completed / failed：开投后盯盘窗口里的客户 + 配了按目标盯盘的客户都算「干了活」；
 * 花费没读到、或有系列读不到（state=unread）算失败——失败要让运行记录看得出来，不能静默。导出给单测用。
 */
export function summarizeRunCounts(summary: LaunchWatchSummary): { processed: number; completed: number; failed: number } {
  const worked = summary.clients.filter(c => c.active || c.objective_watch !== undefined)
  const failed = worked.filter(c => c.error !== null || (c.objective_watch?.series.some(s => s.state === 'unread') ?? false)).length
  return { processed: worked.length, completed: worked.length - failed, failed }
}

// ─── 编排 ───────────────────────────────────────────────────────────────────

const SERIES_ACCOUNT_RE = /^act_\d{6,20}$/

/** 系列写了广告账户就用那一个。写了但格式不对 = null，这一小时不读、也不暂停。 */
function configForSeries(cfg: TrackingClientConfig, series: ObjectiveWatchSeries): TrackingClientConfig | null {
  if (series.ad_account_id === undefined) return cfg
  if (!SERIES_ACCOUNT_RE.test(series.ad_account_id)) return null
  return { ...cfg, ad_account_id: series.ad_account_id }
}

/**
 * 按目标盯盘：一个客户配置里的每个系列读一遍、判一遍。
 * WhatsApp 系列只有在 Meta 报了聊天数时，才去数 ME 自系列创建起收到几个会话（没聊天数没什么可比）。
 * 表单留资在判定之后，命中故障才去调只暂停入口；调失败不把这个系列改成「没读到」。
 */
async function watchObjectives(
  step: LaunchWatchStep,
  deps: LaunchWatchDeps,
  clientId: string,
  cfg: TrackingClientConfig,
  watch: ObjectiveWatchConfig,
  now: Date,
): Promise<ObjectiveWatchSummary> {
  const series: SeriesVerdict[] = []
  for (const s of watch.series) series.push(await watchOneSeries(step, deps, clientId, cfg, watch, s, now))
  return { as_of: now.toISOString(), series }
}

async function watchOneSeries(
  step: LaunchWatchStep,
  deps: LaunchWatchDeps,
  clientId: string,
  cfg: TrackingClientConfig,
  watch: ObjectiveWatchConfig,
  series: ObjectiveWatchSeries,
  now: Date,
): Promise<SeriesVerdict> {
  const seriesCfg = configForSeries(cfg, series)
  const links = {
    ads_manager: adsManagerCampaignUrl((seriesCfg ?? cfg).ad_account_id, series.campaign_id),
    crm: crmUrl(deps.appBase, clientId),
  }
  if (seriesCfg === null) {
    return judgeSeries({
      watch, series, now, currency: cfg.currency, links, me: null,
      facts: { read: false, error: '系列配置的广告账户编号不对，这一小时不读、也不暂停' },
    })
  }
  const facts = await step.run(`objective:${clientId}:${series.campaign_id}`, () => deps.readObjectiveSeries(clientId, seriesCfg, series, now))
  const me = await meInboundFor(step, deps, clientId, series, facts)
  const verdict = judgeSeries({ watch, series, facts, me, now, currency: seriesCfg.currency, links })
  const partial = await reviewLeadFormSeries({
    step,
    deps,
    clientId,
    cfg: seriesCfg,
    series,
    facts,
    verdict,
    now,
  })
  return partial === null ? verdict : { ...verdict, ...partial }
}

async function meInboundFor(
  step: LaunchWatchStep,
  deps: LaunchWatchDeps,
  clientId: string,
  series: ObjectiveWatchSeries,
  facts: SeriesFacts | SeriesUnread,
): Promise<MeInboundFact | null> {
  if (series.kind !== 'whatsapp' || !facts.read || (facts.total?.conversations ?? 0) <= 0) return null
  const since = facts.campaign.created_at
  if (since === null) return { read: false, error: '读不到系列创建时间，没法数 ME 收到的会话' }
  return step.run(`me-inbound:${clientId}:${series.campaign_id}`, () => deps.countMeInbound(clientId, since))
}

async function watchOneClient(
  step: LaunchWatchStep,
  deps: LaunchWatchDeps,
  clientId: string,
  cfg: TrackingClientConfig,
  watch: LaunchWatchConfig,
  now: Date,
): Promise<LaunchWatchClientSummary> {
  const spend = await step.run(`spend:${clientId}`, () => deps.readSpend(clientId, cfg, watch, now))
  const receipts = await step.run(`state:${clientId}`, () => deps.loadReceiptStates(clientId, sinceIsoOf(watch)))
  // 读到了：系列在 → 花没花钱；系列一个都没找到 → 记灰（null），不能当成「没花钱」
  let spendSeen: boolean | null = null
  if (spend.read) spendSeen = spend.series_found === false ? null : spend.spend_cents > 0
  // 只有看到花费时才需要知道「第一次看到是什么时候」（T+1h 要等它之后满 1 小时）
  const firstSpendSeenAt = spendSeen === true
    ? await step.run(`first-seen:${clientId}`, () => deps.loadFirstSpendSeenAt(clientId, sinceIsoOf(watch)))
    : null

  const decisions = decideLaunchWatch({ watch, now, spendSeen: spendSeen === true, receipts, firstSpendSeenAt })
  const sent: LaunchWatchClientSummary['sent'] = []
  for (const d of decisions) {
    const eventId = watchEventId(clientId, d.phase, now)
    await step.run(`send:${clientId}:${d.phase}`, () =>
      deps.sendEvent({ id: eventId, data: { client_id: clientId, phase: d.phase, launched_at: d.launched_at } }),
    )
    sent.push({ phase: d.phase, launched_at: d.launched_at, event_id: eventId })
  }
  return {
    client_id: clientId,
    active: true,
    spend_seen: spendSeen,
    series_found: spend.read ? spend.series_found : null,
    sent,
    error: spend.read ? null : spend.error ?? '花费没读到',
  }
}

/** 整轮编排。导出给单测用（注入假 step 和假依赖）。 */
export async function runLaunchWatch(step: LaunchWatchStep, deps: LaunchWatchDeps): Promise<LaunchWatchSummary> {
  // 🔴 时刻必须在步骤里取：步骤外的代码每次重放都会重跑。
  const started = await step.run('start-run', async () => ({ runId: await deps.startRun(), startedAt: deps.now().getTime() }))
  const now = new Date(started.startedAt)

  const clients: LaunchWatchClientSummary[] = []
  for (const clientId of deps.configuredClientIds()) {
    const cfg = deps.getConfig(clientId)
    const watch = cfg?.launch_watch
    const entry: LaunchWatchClientSummary = !cfg || !watch || !isWatchActive(watch, now)
      ? { client_id: clientId, active: false, spend_seen: null, series_found: null, sent: [], error: null }
      : await watchOneClient(step, deps, clientId, cfg, watch, now)
    // 按目标盯盘和开投后自动补排互相独立：只要客户配了，窗口外也照盯
    if (cfg?.objective_watch) entry.objective_watch = await watchObjectives(step, deps, clientId, cfg, cfg.objective_watch, now)
    clients.push(entry)
  }

  const summary: LaunchWatchSummary = { checked_at: now.toISOString(), no_publish: true, clients }
  await step.run('finish-run', () => deps.finishRun(started.runId, started.startedAt, summary))
  return summary
}

export function createAdsTrackingLaunchWatchFunction(deps: LaunchWatchDeps = realDeps()) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}ads-tracking-launch-watch`,
      name: 'Ads tracking launch watch: hourly, auto-schedule the post-launch T+1h / T+24h reads',
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
        await failOpenCronRuns(LAUNCH_WATCH_JOB, `重试耗尽后仍失败：${sanitizeError(message)}`, { startedBefore })
      },
    },
    [{ cron: `TZ=${LAUNCH_WATCH_TZ} ${LAUNCH_WATCH_CRON}` }],
    async ({ step }): Promise<LaunchWatchSummary> =>
      runLaunchWatch(
        {
          // Inngest 把记忆化结果标成 Jsonify<T>；本函数每个 step 的返回值都是纯数据（没有 Date / 函数），
          // 序列化前后同形，这里按 T 用。
          run: <T,>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T>,
        },
        deps,
      ),
  )
}

export const adsTrackingLaunchWatch = createAdsTrackingLaunchWatchFunction()
