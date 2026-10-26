/**
 * 按目标盯盘 · 纯判定逻辑：每小时盯盘函数的第二件事（第一件是开投后自动补排读回，见 launch-watch.ts）。
 *
 * 为什么要有它：开投后读回判的是「点击 / 落地页浏览 / 留资」，播放量系列和点广告进 WhatsApp 的系列
 * 这些数都不是它们该看的。这里按目标分开看：
 *   · 播放量系列（awareness）：完整播放（ThruPlay）/ 触达 / 平均看到几次（频次），按视频（广告）拆开；
 *   · WhatsApp 系列（whatsapp）：开始聊天数 / 单个成本，按受众（广告组）和视频（广告）拆开，
 *     再和 ME 里实际收到的 WhatsApp 会话比一比，防止「Meta 说有人聊了、ME 一条没收到」；
 *   · 表单留资系列（lead_form）：当天花费、线索、审核状态，以及和 CRM 对不上时的故障
 *     （故障判据在 lead-form-faults.ts；命中后由盯盘函数去调只暂停入口）；
 *   · 所有系列：改动后一直没花钱要提醒。
 * 系列整个停了、或里面没有在投的广告，就自动不盯。
 *
 * 本文件是纯判定逻辑：不读网络、不读库、不读时钟（时刻由调用方给）。
 * 🔴 只读：只产出回执和提醒，从不动广告、不发布、不扣费。
 * 🔴 平台通用：不点名任何客户；阈值有通用默认值，客户差异只进 client-config.ts。
 */

import {
  awarenessHeadline,
  frequencyText,
  meNotReceivingText,
  readFailedText,
  scheduledHeadline,
  stoppedHeadline,
  leadFormWatchHeadline,
  unreadHeadline,
  waitingHeadline,
  whatsappHeadline,
  zeroSpendText,
} from './objective-watch-text'
import type { LeadFormStopFault, PauseRequestReceipt } from './lead-form-types'
import type { ObjectiveWatchConfig, ObjectiveWatchKind, ObjectiveWatchSeries } from './types'

// ─── 阈值（通用默认值；客户在 client-config.ts 里按系列覆盖）─────────────────────

/** 频次（同一个人平均看到几次）严格大于这个数 = 黄灯 / 红灯。 */
export const DEFAULT_FREQUENCY_YELLOW = 3
export const DEFAULT_FREQUENCY_RED = 4
/** 触达不到这么多人，频次是小样本噪声（刚开投几个人就能刷出 5 次），不判。 */
export const FREQUENCY_MIN_REACH = 100
/** 改动后一直没花钱：满多少小时黄灯 / 红灯（含等号）。 */
export const DEFAULT_ZERO_SPEND_YELLOW_HOURS = 6
export const DEFAULT_ZERO_SPEND_RED_HOURS = 24
/** 今日待办只认最近 3 小时内的盯盘结论；更旧 = 盯盘自己没在跑，那是另一件事。 */
export const OBJECTIVE_ALERT_MAX_TICK_AGE_MS = 3 * 3_600_000

const HOUR_MS = 3_600_000

// ─── 状态 ───────────────────────────────────────────────────────────────────

/** 这些状态 = 已经停了，不盯。其余（含审核中、被拒登、没见过的新状态）都算还在投，宁可多盯。 */
const STOPPED_STATUSES: ReadonlySet<string> = new Set(['PAUSED', 'ADSET_PAUSED', 'CAMPAIGN_PAUSED', 'ARCHIVED', 'DELETED'])

export function isInPlay(effectiveStatus: string | null): boolean {
  return effectiveStatus === null || !STOPPED_STATUSES.has(effectiveStatus)
}

// ─── 事实（读取器的输出，也是判定函数的输入）──────────────────────────────────

export interface CampaignFact {
  id: string
  name: string
  objective: string | null
  status: string | null
  effective_status: string | null
  /** ISO（UTC）；读不出 = null */
  created_at: string | null
  updated_at: string | null
  /** 系列日预算（分）。没设、或这轮读数里没有这个字段 = 缺省，不当成 0。 */
  daily_budget_cents?: number | null
}

/** 广告组或广告。广告的 parent_id 是它所在的广告组编号。 */
export interface EntityFact {
  id: string
  name: string
  parent_id: string | null
  status: string | null
  effective_status: string | null
  updated_at: string | null
  /** 广告组：定时开始 / 结束时间（ISO，UTC）；没设或读不出 = 缺省 */
  start_at?: string | null
  end_at?: string | null
  /** 广告组：投放目的地（WHATSAPP / MESSENGER …）；读不出 = 缺省 */
  destination_type?: string | null
}

/** 一行洞察数字。钱：spend_cents 是分；cost_* 是币种单位（元），Meta 报什么就是什么，没报 = null（不是 0）。 */
export interface MetricsRow {
  id: string
  name: string
  spend_cents: number
  impressions: number
  reach: number | null
  frequency: number | null
  thruplays: number
  cost_per_thruplay: number | null
  conversations: number
  cost_per_conversation: number | null
}

export interface SeriesFacts {
  read: true
  as_of: string
  campaign: CampaignFact
  adsets: EntityFact[]
  ads: EntityFact[]
  /** 整个系列的洞察行；null = Meta 没返回行 = 还没花钱（不是读失败） */
  total: MetricsRow | null
  by_adset: MetricsRow[]
  by_ad: MetricsRow[]
}

export interface SeriesUnread {
  read: false
  error: string
}

/** ME 里实际收到的 WhatsApp 会话数（自系列创建起）；读不到 = read:false，不当成 0。 */
export type MeInboundFact = { read: true; count: number; since: string } | { read: false; error: string }

// ─── 判定结果（也是写进盯盘运行记录的回执）──────────────────────────────────────

export type AlertCode = 'zero_spend' | 'frequency' | 'me_not_receiving' | 'read_failed'
export type AlertLevel = 'yellow' | 'red'

export interface ObjectiveAlert {
  code: AlertCode
  level: AlertLevel
  /** 什么问题、有什么影响（大白话） */
  what: string
  /** 怎么办 */
  how: string
  /** 直达链接 */
  href: string
}

export type SeriesState = 'stopped' | 'scheduled' | 'waiting_first_spend' | 'delivering' | 'unread'

/** 按广告组 / 广告拆开的一行：在投的都列（没数据也列），停掉的只在有花费时列。 */
export interface SplitView extends MetricsRow {
  effective_status: string | null
  in_play: boolean
}

export interface SeriesVerdict {
  campaign_id: string
  label: string
  kind: ObjectiveWatchKind
  state: SeriesState
  objective: string | null
  /** 最近一次改动（在投的东西里最晚的修改时间）；「没花钱多久了」从它起算 */
  anchor_at: string | null
  hours_since_anchor: number | null
  total: MetricsRow | null
  by_adset: SplitView[]
  by_ad: SplitView[]
  /** 在投的广告按状态数个数（审核中几个、投放中几个……） */
  ad_status_counts: Record<string, number>
  /** WhatsApp 系列：Meta 报的聊天数 vs ME 收到的会话数；播放量系列 = null */
  me: { read: boolean; count: number | null; meta_conversations: number | null; since: string | null; error: string | null } | null
  headline: string
  alerts: ObjectiveAlert[]
  error: string | null
  /** 表单留资系列的故障（会拿去调只暂停入口）。其它类型不写这个字段。 */
  stop_faults?: LeadFormStopFault[]
  /** 故障为什么没判（读不到 / 没配）。不是故障本身。 */
  stop_notes?: string[]
  /** Meta 线索多于 CRM 的这一段是从什么时候开始的；对上了就是 null。 */
  crm_surplus_since?: string | null
  /** 这一小时有没有去调只暂停入口，以及入口回了什么。没调用 = null。 */
  pause_request?: PauseRequestReceipt | null
}

/** 写进盯盘运行记录的按目标盯盘回执。单个系列读不到记在各自的 verdict 里（state=unread）。 */
export interface ObjectiveWatchSummary {
  as_of: string
  series: SeriesVerdict[]
}

export interface JudgeSeriesInput {
  watch: ObjectiveWatchConfig
  series: ObjectiveWatchSeries
  facts: SeriesFacts | SeriesUnread
  /** 只有 WhatsApp 系列、且 Meta 报了聊天数时才会读；其它情况 null */
  me: MeInboundFact | null
  now: Date
  currency: string
  links: { ads_manager: string; crm: string }
}

// ─── 链接 ───────────────────────────────────────────────────────────────────

/** 广告管理工具里打开某个广告系列（选中它）。 */
export function adsManagerCampaignUrl(adAccountId: string, campaignId: string): string {
  const act = encodeURIComponent(adAccountId.replace(/^act_/, ''))
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act}&selected_campaign_ids=${encodeURIComponent(campaignId)}`
}

/** ME 后台这个客户的 CRM 页（看有没有新的 WhatsApp 会话）。 */
export function crmUrl(appBase: string, clientId: string): string {
  return `${appBase}/dashboard/clients/${encodeURIComponent(clientId)}/crm`
}

// ─── 内部小工具 ─────────────────────────────────────────────────────────────

function zeroRow(id: string, name: string): MetricsRow {
  return {
    id, name, spend_cents: 0, impressions: 0, reach: null, frequency: null,
    thruplays: 0, cost_per_thruplay: null, conversations: 0, cost_per_conversation: null,
  }
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * 黄线 / 红线成对解析：红线必须比黄线高。只配了黄线时（默认红线可能比它还低）、
 * 或配出来的红线不高于黄线时，红线取「黄线 + 1」——不会出现黄线 5、红线 4 这种红线反而更低的怪事。
 */
function resolvePair(yellow: number | undefined, red: number | undefined, defaults: { yellow: number; red: number }): { yellow: number; red: number } {
  const y = positiveOr(yellow, defaults.yellow)
  const r = positiveOr(red, defaults.red)
  return { yellow: y, red: r > y ? r : y + 1 }
}

function timeMs(iso: string | null): number {
  return iso === null ? Number.NaN : Date.parse(iso)
}

interface Live {
  stopped: boolean
  /** 在投的（含定时还没到点的）广告组 / 广告 */
  adsets: EntityFact[]
  ads: EntityFact[]
  /** 已经到点在跑的广告组 / 广告（定时还没到点的不算） */
  runningAdsets: EntityFact[]
  runningAds: EntityFact[]
}

type AdsetPhase = 'ended' | 'scheduled' | 'running'

/** 广告组的时间阶段：结束时间已过 = ended；开始时间还没到 = scheduled；其余 = running。 */
function adsetPhase(e: EntityFact, nowMs: number): AdsetPhase {
  const end = timeMs(e.end_at ?? null)
  if (!Number.isNaN(end) && end <= nowMs) return 'ended'
  const start = timeMs(e.start_at ?? null)
  if (!Number.isNaN(start) && start > nowMs) return 'scheduled'
  return 'running'
}

/**
 * 还在投的广告组和广告。系列停了、或没有在投的广告（广告组空着不会花钱）= stopped。
 * 广告组结束时间已过的当作已停；定时还没到点的算「在投」但不算「在跑」（不盯、不提醒）。
 * 广告挂的广告组读不到时（列表里没有）保守地算在投。
 */
function liveStructure(facts: SeriesFacts, nowMs: number): Live {
  const adsets = facts.adsets.filter(e => isInPlay(e.effective_status) && adsetPhase(e, nowMs) !== 'ended')
  const runningAdsets = adsets.filter(e => adsetPhase(e, nowMs) === 'running')
  const known = new Set(facts.adsets.map(e => e.id))
  const liveIds = new Set(adsets.map(e => e.id))
  const runningIds = new Set(runningAdsets.map(e => e.id))
  const orphan = (e: EntityFact): boolean => e.parent_id === null || !known.has(e.parent_id)
  const ads = facts.ads.filter(e => isInPlay(e.effective_status) && (orphan(e) || liveIds.has(e.parent_id as string)))
  const runningAds = ads.filter(e => orphan(e) || runningIds.has(e.parent_id as string))
  const campaignStopped = !isInPlay(facts.campaign.effective_status)
  return { stopped: campaignStopped || ads.length === 0, adsets, ads, runningAdsets, runningAds }
}

/**
 * 「现在在投的广告」累计花了多少钱（分）。按广告那一层的洞察算——旧版本花过钱不能替新版本证明「在花钱」。
 * 按广告读不到任何行（空）时退回整个系列的累计花费（没法区分，不冤枉）。
 */
function liveSpendCents(facts: SeriesFacts, live: Live): number {
  if (facts.by_ad.length === 0) return facts.total?.spend_cents ?? 0
  const ids = new Set(live.ads.map(a => a.id))
  return facts.by_ad.filter(r => ids.has(r.id)).reduce((sum, r) => sum + r.spend_cents, 0)
}

/** 「最近一次改动」：系列 + 在跑的广告组 + 在跑的广告里最晚的修改时间；都读不出才退用系列创建时间。 */
function anchorOf(facts: SeriesFacts, live: Live): string | null {
  const times = [facts.campaign.updated_at, ...live.runningAdsets.map(e => e.updated_at), ...live.runningAds.map(e => e.updated_at)]
  let best: string | null = null
  let bestMs = Number.NEGATIVE_INFINITY
  for (const t of times) {
    const ms = timeMs(t)
    if (Number.isNaN(ms) || ms <= bestMs) continue
    best = t
    bestMs = ms
  }
  if (best !== null) return best
  return Number.isNaN(timeMs(facts.campaign.created_at)) ? null : facts.campaign.created_at
}

function statusCounts(ads: readonly EntityFact[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const a of ads) {
    const key = a.effective_status ?? 'UNKNOWN'
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

function splitView(entity: EntityFact, row: MetricsRow | undefined, inPlay: boolean): SplitView {
  return { ...(row ?? zeroRow(entity.id, entity.name)), id: entity.id, name: entity.name, effective_status: entity.effective_status, in_play: inPlay }
}

/** 在投的都列（没数据 = 零行），停掉的只在有花费时列；洞察里有、实体列表里没有的有花费行也不丢。 */
function buildSplits(entities: readonly EntityFact[], rows: readonly MetricsRow[]): SplitView[] {
  const byId = new Map(rows.map(r => [r.id, r]))
  const out: SplitView[] = []
  const seen = new Set<string>()
  for (const e of entities) {
    if (!isInPlay(e.effective_status)) continue
    out.push(splitView(e, byId.get(e.id), true))
    seen.add(e.id)
  }
  for (const e of entities) {
    const row = byId.get(e.id)
    if (seen.has(e.id) || !row || row.spend_cents <= 0) continue
    out.push(splitView(e, row, false))
    seen.add(e.id)
  }
  for (const r of rows) {
    if (seen.has(r.id) || r.spend_cents <= 0) continue
    out.push({ ...r, effective_status: null, in_play: false })
  }
  return out
}

const ME_NOT_APPLICABLE = '系列里有非 WhatsApp 目的地的广告组，Meta 报的聊天数里含别的渠道，ME 收件比对不适用'

/** 在投的广告组里有明确标了非 WhatsApp 目的地（Messenger / Instagram 私信 …）的 → 比对不适用；没标 / 读不出按适用算。 */
function whatsappOnly(live: Live): boolean {
  return live.adsets.every(a => a.destination_type === undefined || a.destination_type === null || a.destination_type === 'WHATSAPP')
}

function meSummary(input: JudgeSeriesInput, metaConversations: number | null, applicable: boolean): SeriesVerdict['me'] {
  if (input.series.kind !== 'whatsapp' || input.me === null) return null
  if (!applicable) return { read: false, count: null, meta_conversations: metaConversations, since: null, error: ME_NOT_APPLICABLE }
  if (!input.me.read) return { read: false, count: null, meta_conversations: metaConversations, since: null, error: input.me.error }
  return { read: true, count: input.me.count, meta_conversations: metaConversations, since: input.me.since, error: null }
}

// ─── 提醒 ───────────────────────────────────────────────────────────────────

function alert(code: AlertCode, level: AlertLevel, text: { what: string; how: string }, href: string): ObjectiveAlert {
  return { code, level, what: text.what, how: text.how, href }
}

function zeroSpendAlert(input: JudgeSeriesInput, live: Live, hours: number): ObjectiveAlert | null {
  const { yellow, red } = resolvePair(input.watch.zero_spend_yellow_hours, input.watch.zero_spend_red_hours, {
    yellow: DEFAULT_ZERO_SPEND_YELLOW_HOURS,
    red: DEFAULT_ZERO_SPEND_RED_HOURS,
  })
  if (hours < yellow) return null
  const ads = live.runningAds.map(a => ({ name: a.name, effective_status: a.effective_status }))
  return alert('zero_spend', hours >= red ? 'red' : 'yellow', zeroSpendText({ label: input.series.label, hours, ads }), input.links.ads_manager)
}

function frequencyAlert(input: JudgeSeriesInput, facts: SeriesFacts, live: Live): ObjectiveAlert | null {
  const { yellow, red } = resolvePair(input.series.frequency_yellow, input.series.frequency_red, {
    yellow: DEFAULT_FREQUENCY_YELLOW,
    red: DEFAULT_FREQUENCY_RED,
  })
  const over = (r: MetricsRow): r is MetricsRow & { frequency: number } =>
    r.frequency !== null && r.reach !== null && r.reach >= FREQUENCY_MIN_REACH && r.frequency > yellow
  const offenders: { display: string; frequency: number }[] = []
  if (facts.total !== null && over(facts.total)) offenders.push({ display: '整个系列', frequency: facts.total.frequency })
  const liveAds = new Map(live.ads.map(a => [a.id, a]))
  for (const r of facts.by_ad) {
    const ad = liveAds.get(r.id)
    if (ad !== undefined && over(r)) offenders.push({ display: `「${ad.name}」`, frequency: r.frequency })
  }
  if (offenders.length === 0) return null
  const level: AlertLevel = offenders.some(o => o.frequency > red) ? 'red' : 'yellow'
  return alert('frequency', level, frequencyText({ label: input.series.label, offenders, yellow, red }), input.links.ads_manager)
}

function meAlert(input: JudgeSeriesInput, metaConversations: number): ObjectiveAlert | null {
  const me = input.me
  if (me === null || !me.read || metaConversations <= 0) return null
  const label = input.series.label
  if (me.count === 0) {
    return alert('me_not_receiving', 'red', meNotReceivingText({ label, meta: metaConversations, me: 0, level: 'red' }), input.links.crm)
  }
  // 收到不到一半才黄灯：个别人一天开两次聊天会让两边差一两个，那不算（Meta 只有 1～2 个时，ME 至少收到 1 个就不会触发）
  if (me.count < metaConversations / 2) {
    return alert('me_not_receiving', 'yellow', meNotReceivingText({ label, meta: metaConversations, me: me.count, level: 'yellow' }), input.links.crm)
  }
  return null
}

// ─── 判定 ───────────────────────────────────────────────────────────────────

function baseVerdict(input: JudgeSeriesInput, partial: Partial<SeriesVerdict> & Pick<SeriesVerdict, 'state' | 'headline'>): SeriesVerdict {
  return {
    campaign_id: input.series.campaign_id,
    label: input.series.label,
    kind: input.series.kind,
    objective: null,
    anchor_at: null,
    hours_since_anchor: null,
    total: null,
    by_adset: [],
    by_ad: [],
    ad_status_counts: {},
    me: null,
    alerts: [],
    error: null,
    ...partial,
  }
}

function unreadVerdict(input: JudgeSeriesInput, error: string, objective: string | null): SeriesVerdict {
  const { label } = input.series
  return baseVerdict(input, {
    state: 'unread',
    objective,
    error,
    headline: unreadHeadline(label, error),
    alerts: [alert('read_failed', 'yellow', readFailedText({ label, error }), input.links.ads_manager)],
  })
}

/** 定时还没到点：不盯、不提醒，回执里写还要多久开始。 */
function scheduledVerdict(input: JudgeSeriesInput, facts: SeriesFacts, live: Live, common: Partial<SeriesVerdict>): SeriesVerdict {
  const starts = live.adsets.map(a => timeMs(a.start_at ?? null)).filter(ms => !Number.isNaN(ms))
  const hoursToStart = starts.length === 0 ? null : (Math.min(...starts) - input.now.getTime()) / HOUR_MS
  return baseVerdict(input, {
    ...common, state: 'scheduled', objective: facts.campaign.objective,
    headline: scheduledHeadline({ label: input.series.label, hoursToStart }),
  })
}

/** 判一个系列。永不抛错。 */
export function judgeSeries(input: JudgeSeriesInput): SeriesVerdict {
  const { facts, series, now, currency } = input
  if (!facts.read) return unreadVerdict(input, facts.error, null)

  const live = liveStructure(facts, now.getTime())
  const common = {
    objective: facts.campaign.objective,
    by_adset: buildSplits(facts.adsets, facts.by_adset),
    by_ad: buildSplits(facts.ads, facts.by_ad),
    total: facts.total,
    ad_status_counts: statusCounts(live.ads),
  }
  if (live.stopped) return baseVerdict(input, { ...common, state: 'stopped', headline: stoppedHeadline(series.label) })
  if (live.runningAds.length === 0) return scheduledVerdict(input, facts, live, common)

  const total = facts.total
  const anchor = anchorOf(facts, live)
  const hours = anchor === null ? null : Math.max(0, (now.getTime() - Date.parse(anchor)) / HOUR_MS)
  const hoursRounded = hours === null ? null : Math.round(hours * 10) / 10
  const applicable = whatsappOnly(live)

  if (liveSpendCents(facts, live) <= 0) {
    if (anchor === null || hours === null) return unreadVerdict(input, '读不到系列的最后修改时间，没法算没花钱多久了', facts.campaign.objective)
    const zero = zeroSpendAlert(input, live, hours)
    const earlierSpend = total !== null && total.spend_cents > 0 ? total.spend_cents : null
    return baseVerdict(input, {
      ...common, state: 'waiting_first_spend', anchor_at: anchor, hours_since_anchor: hoursRounded,
      me: meSummary(input, total?.conversations ?? null, applicable),
      headline: waitingHeadline({ label: series.label, hours, statusCounts: common.ad_status_counts, earlierSpendCents: earlierSpend, currency }),
      alerts: zero === null ? [] : [zero],
    })
  }
  if (total === null) return unreadVerdict(input, '按广告读到了花费，但整个系列那一行没读到，数字对不上', facts.campaign.objective)

  const me = meSummary(input, total.conversations, applicable)
  const meFound = series.kind === 'whatsapp' && applicable ? meAlert(input, total.conversations) : null
  const found = series.kind === 'awareness' ? frequencyAlert(input, facts, live) : series.kind === 'whatsapp' ? meFound : null
  const headline = series.kind === 'awareness'
    ? awarenessHeadline({ label: series.label, total, currency })
    : series.kind === 'whatsapp'
      ? whatsappHeadline({ label: series.label, total, me, currency })
      : leadFormWatchHeadline(series.label)
  return baseVerdict(input, {
    ...common, state: 'delivering', anchor_at: anchor, hours_since_anchor: hoursRounded, me,
    headline,
    alerts: found === null ? [] : [found],
  })
}

// ─── 今日待办：从盯盘回执里取提醒 ─────────────────────────────────────────────

export interface WatchRowLike {
  status: string | null
  started_at: string
  summary: unknown
}

export interface ObjectiveAlertItem extends ObjectiveAlert {
  campaign_id: string
  label: string
}

const ALERT_CODES: ReadonlySet<string> = new Set(['zero_spend', 'frequency', 'me_not_receiving', 'read_failed'])

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function parseAlert(raw: unknown): ObjectiveAlert | null {
  if (!isRecord(raw)) return null
  const { code, level, what, how, href } = raw
  if (typeof code !== 'string' || !ALERT_CODES.has(code)) return null
  if (level !== 'yellow' && level !== 'red') return null
  if (typeof what !== 'string' || typeof how !== 'string' || typeof href !== 'string') return null
  return { code: code as AlertCode, level, what, how, href }
}

/** 最新一次读得懂的盯盘（已收尾、有 checked_at），连同它的时间。 */
function newestTick(rows: readonly WatchRowLike[]): { checkedAt: string; clients: unknown[] } | null {
  let best: { checkedAt: string; clients: unknown[]; ms: number } | null = null
  for (const row of rows) {
    if (row.status === 'running' || !isRecord(row.summary)) continue
    const { checked_at: checkedAt, clients } = row.summary
    if (typeof checkedAt !== 'string' || !Array.isArray(clients)) continue
    const ms = Date.parse(checkedAt)
    if (Number.isNaN(ms) || (best !== null && ms <= best.ms)) continue
    best = { checkedAt, clients, ms }
  }
  return best === null ? null : { checkedAt: best.checkedAt, clients: best.clients }
}

function alertsOfEntry(entry: unknown): ObjectiveAlertItem[] {
  if (!isRecord(entry) || !isRecord(entry.objective_watch) || !Array.isArray(entry.objective_watch.series)) return []
  const out: ObjectiveAlertItem[] = []
  for (const s of entry.objective_watch.series) {
    if (!isRecord(s) || !Array.isArray(s.alerts)) continue
    const campaignId = typeof s.campaign_id === 'string' ? s.campaign_id : ''
    const label = typeof s.label === 'string' ? s.label : ''
    for (const raw of s.alerts) {
      const parsed = parseAlert(raw)
      if (parsed !== null) out.push({ ...parsed, campaign_id: campaignId, label })
    }
  }
  return out
}

/**
 * 今日待办用：这个客户在最近一次盯盘里的提醒。
 * 只认最新一次（问题消了就没了，不需要谁去「关」）；最新一次超过 3 小时 = 盯盘自己没在跑，不在这里说成「系列有事」。
 */
export function latestObjectiveAlerts(rows: readonly WatchRowLike[], clientId: string, now: Date): ObjectiveAlertItem[] {
  const tick = newestTick(rows)
  if (tick === null || now.getTime() - Date.parse(tick.checkedAt) > OBJECTIVE_ALERT_MAX_TICK_AGE_MS) return []
  const entry = tick.clients.find(c => isRecord(c) && c.client_id === clientId)
  return alertsOfEntry(entry)
}
