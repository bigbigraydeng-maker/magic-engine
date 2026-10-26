/**
 * 开投后「自动补排」：每小时看一眼本次投放的广告系列有没有开始花钱，
 * 第一次看到花费后满 1 小时补排 T+1h，满 24 小时补排 T+24h 读回，不靠人记得发事件。
 *
 * 本文件是纯判定逻辑：不读网络、不读时钟、不读环境变量。
 * 窗口按广告账户自己的时区算日期（和 post-launch 读回一致）。
 *
 * 🔴 只读：这里只决定「要不要发读回事件」，不发布、不扣费。
 * 🔴 平台通用：不点名任何客户。
 */

import { dateInTimezone } from './post-launch'
import { isTrackingRunReceiptLike } from './receipt'
import type { LaunchWatchConfig } from './types'

/** 从运行记录里挑出来的、这个客户做过的一次开投后读回。 */
export interface PostLaunchReceiptState {
  phase: 'post_t1h' | 'post_t24h'
  checked_at: string
  launched_at: string | null
  /** 至少有一道门不是灰 = 真的读到了数；全灰 = 没读到，不算做过 */
  valid: boolean
}

/** 要补排的一次读回。 */
export interface WatchDecision {
  phase: 't1h' | 't24h'
  launched_at: string
}

/** 盯盘函数在 cron_run_logs 里的任务名（函数、待办都按它读自己的运行记录）。 */
export const LAUNCH_WATCH_JOB = 'ads-tracking-launch-watch'

const DAY_MS = 86_400_000

/**
 * 从「第一次见到本次系列有花费」起，自动补排最多盯这么久（96 小时）。
 * 盯盘窗口在开投日未定时会配得很长，所以必须有这条上限：不然一个一直读不到数的读回，会在整个窗口里每小时重发。
 */
export const WATCH_AFTER_FIRST_SPEND_MS = 96 * 3_600_000

/**
 * T+1h 要等「第一次看到花费」之后满这么久才读。每小时盯一次有几分钟的调度误差，
 * 所以差 5 分钟以内也算满 1 小时（55 分钟）。
 */
export const T1H_WAIT_MS = 55 * 60_000

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** YYYY-MM-DD 加 n 天，再格式化回 YYYY-MM-DD。读不懂就原样返回。 */
function addDays(date: string, days: number): string {
  const m = DATE_RE.exec(date)
  if (m === null) return date
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * DAY_MS
  return new Date(ms).toISOString().slice(0, 10)
}

/** 现在在不在盯的窗口里（按账户时区算日期）。 */
export function isWatchActive(watch: LaunchWatchConfig, now: Date): boolean {
  if (!Number.isFinite(watch.days) || watch.days < 1) return false
  const today = dateInTimezone(now, watch.timezone)
  const last = addDays(watch.from, watch.days - 1)
  return watch.from <= today && today <= last
}

function isPostPhase(phase: unknown): phase is 'post_t1h' | 'post_t24h' {
  return phase === 'post_t1h' || phase === 'post_t24h'
}

/** 一次读回「算数」的时刻：有开投时刻就用它，没有就退用检查时间。 */
function effectiveLaunch(state: PostLaunchReceiptState): string {
  return state.launched_at ?? state.checked_at
}

/** 两个时刻里更早的那个（读不懂的忽略）；都读不出来 = null。 */
function earlierMs(a: string | null, b: string | null): number | null {
  const times = [a, b].map(t => (t === null ? Number.NaN : Date.parse(t))).filter(Number.isFinite)
  return times.length === 0 ? null : Math.min(...times)
}

function earliestLaunch(states: readonly PostLaunchReceiptState[]): string | null {
  let best: string | null = null
  let bestMs = Number.POSITIVE_INFINITY
  for (const state of states) {
    const at = effectiveLaunch(state)
    const ms = Date.parse(at)
    if (Number.isNaN(ms)) continue
    if (ms < bestMs) {
      bestMs = ms
      best = at
    }
  }
  return best
}

/**
 * 纯判定：这一小时要不要补排读回。结果最多一条，不会同时给两个阶段。
 *
 * firstSpendSeenAt：盯盘函数自己的运行记录里「第一次看到花费」的那一次盯盘时刻（取不到 = null，
 * 也就是这一小时是第一次看到）。T+1h 要等它之后满 1 小时才读——不能在发现花费的当小时就读，
 * 那时候刚开投，数字什么都说明不了。
 */
export function decideLaunchWatch(input: {
  watch: LaunchWatchConfig
  now: Date
  spendSeen: boolean
  receipts: readonly PostLaunchReceiptState[]
  firstSpendSeenAt: string | null
}): WatchDecision[] {
  const { watch, now, spendSeen, receipts, firstSpendSeenAt } = input
  if (!isWatchActive(watch, now)) return []
  if (!spendSeen) return []

  const validT1h = receipts.filter(r => r.phase === 'post_t1h' && r.valid)
  const validT24h = receipts.filter(r => r.phase === 'post_t24h' && r.valid)

  // 🔴 盯满 96 小时就停：以「第一次见到花费」和已有 T+1h 回执里的开投时刻里更早的那个为准
  const anchorMs = earlierMs(firstSpendSeenAt, validT1h.length > 0 ? earliestLaunch(validT1h) : null)
  if (anchorMs !== null && now.getTime() - anchorMs > WATCH_AFTER_FIRST_SPEND_MS) return []

  if (validT1h.length === 0) {
    if (firstSpendSeenAt === null) return []
    const seenMs = Date.parse(firstSpendSeenAt)
    if (Number.isNaN(seenMs)) return []
    if (now.getTime() - seenMs < T1H_WAIT_MS) return []
    return [{ phase: 't1h', launched_at: firstSpendSeenAt }]
  }

  const launch = earliestLaunch(validT1h)
  if (launch === null) return []
  if (validT24h.length > 0) return []

  const launchMs = Date.parse(launch)
  if (now.getTime() - launchMs >= DAY_MS) {
    return [{ phase: 't24h', launched_at: launch }]
  }
  return []
}

function stateFromClient(client: {
  phase: unknown
  checked_at: string
  launched_at: string | null
  gates: readonly { status: string }[]
}): PostLaunchReceiptState | null {
  if (!isPostPhase(client.phase)) return null
  return {
    phase: client.phase,
    checked_at: client.checked_at,
    launched_at: typeof client.launched_at === 'string' ? client.launched_at : null,
    valid: client.gates.some(g => g.status !== 'gray'),
  }
}

/** 从运行记录里挑出这个客户做过的开投后读回（保持遇到顺序）。 */
export function postLaunchStatesFromRows(
  rows: readonly { status: string | null; started_at: string; summary: unknown }[],
  clientId: string,
  sinceIso: string,
): PostLaunchReceiptState[] {
  const sinceMs = Date.parse(sinceIso)
  const out: PostLaunchReceiptState[] = []
  for (const row of rows) {
    if (row.status === 'running') continue
    if (!isTrackingRunReceiptLike(row.summary)) continue
    for (const client of row.summary.clients) {
      if (client.client_id !== clientId) continue
      if (Date.parse(client.checked_at) < sinceMs) continue
      const state = stateFromClient(client)
      if (state !== null) out.push(state)
    }
  }
  return out
}

interface WatchSummaryLike {
  checked_at: string
  clients: readonly unknown[]
}

function asWatchSummary(summary: unknown): WatchSummaryLike | null {
  if (typeof summary !== 'object' || summary === null) return null
  const s = summary as Record<string, unknown>
  if (typeof s.checked_at !== 'string' || !Array.isArray(s.clients)) return null
  return { checked_at: s.checked_at, clients: s.clients }
}

function sawSpend(clients: readonly unknown[], clientId: string): boolean {
  return clients.some(c => {
    if (typeof c !== 'object' || c === null) return false
    const entry = c as Record<string, unknown>
    return entry.client_id === clientId && entry.spend_seen === true
  })
}

/**
 * 从盯盘函数自己的运行记录（cron_run_logs，任务名 ads-tracking-launch-watch）里找：
 * 这个客户最早一次「看到花费」（摘要里 spend_seen 为 true）的盯盘时刻。
 * 没看到过 / 还在跑 / 读不懂 / 早于窗口开始的，都不算；记录的顺序不重要，取最早的。
 */
export function firstSpendSeenFromRows(
  rows: readonly { status: string | null; started_at: string; summary: unknown }[],
  clientId: string,
  sinceIso: string,
): string | null {
  const sinceMs = Date.parse(sinceIso)
  let best: string | null = null
  let bestMs = Number.POSITIVE_INFINITY
  for (const row of rows) {
    if (row.status === 'running') continue
    const summary = asWatchSummary(row.summary)
    if (summary === null || !sawSpend(summary.clients, clientId)) continue
    const ms = Date.parse(summary.checked_at)
    if (Number.isNaN(ms) || ms < sinceMs) continue
    if (ms < bestMs) {
      bestMs = ms
      best = summary.checked_at
    }
  }
  return best
}

export interface SeriesWatchStatus {
  /** 窗口里这个客户有多少次「读得出结论」的盯盘（找到了 / 明确找不到）；读不出来的不算 */
  ticks: number
  /** 最近一次读得出结论的盯盘的时刻；一次都没有 = null */
  latest_at: string | null
  /**
   * 这些读得出结论的盯盘里，有没有哪怕一次找到过系列或见到过花费。
   * false = 每一次读得出结论的盯盘都说「找不到」（所以最近一次自然也是「找不到」）。
   */
  ever_found: boolean
}

/**
 * 这一次盯盘读出的结论：见到花费 = 系列肯定在（true）；series_found 为 true / false 就是它；
 * 都没有（series_found 为 null / 缺失，也没见到花费）= 读不出来（null）。
 */
function seriesFoundOf(entry: Record<string, unknown>): boolean | null {
  if (entry.spend_seen === true) return true
  return typeof entry.series_found === 'boolean' ? entry.series_found : null
}

/**
 * 从盯盘自己的运行记录里看「本次系列找到过没有」：今日待办用它判断「预计开投日过了 24 小时还是找不到」。
 * 只数这个客户、窗口内（active=true）、已收尾、读得懂的盯盘；记录的顺序不重要。
 *
 * 🔴 读不出来的盯盘（令牌失效 / 接口出错 / 响应读不懂，series_found 为 null）既不是「找到」也不是「找不到」：
 *    不算进次数，也不当「最近一次」——否则一堆读不出来的盯盘会被凑成「一直找不到」，把读取故障说成系列没发布。
 */
export function seriesWatchStatusFromRows(
  rows: readonly { status: string | null; started_at: string; summary: unknown }[],
  clientId: string,
): SeriesWatchStatus {
  const out: SeriesWatchStatus = { ticks: 0, latest_at: null, ever_found: false }
  let latestMs = Number.NEGATIVE_INFINITY
  for (const row of rows) {
    if (row.status === 'running') continue
    const summary = asWatchSummary(row.summary)
    if (summary === null) continue
    const entry = summary.clients.find(c => typeof c === 'object' && c !== null && (c as Record<string, unknown>).client_id === clientId) as
      | Record<string, unknown>
      | undefined
    if (entry === undefined || entry.active !== true) continue
    const ms = Date.parse(summary.checked_at)
    if (Number.isNaN(ms)) continue
    const found = seriesFoundOf(entry)
    if (found === null) continue
    out.ticks += 1
    if (found) out.ever_found = true
    if (ms > latestMs) {
      latestMs = ms
      out.latest_at = summary.checked_at
    }
  }
  return out
}

/** 自动补排发出的事件编号：同一小时同一客户同一阶段相同（去重），换小时就换编号（重试）。 */
export function watchEventId(clientId: string, phase: 't1h' | 't24h', now: Date): string {
  const bucket = now.toISOString().slice(0, 13).replace(/\D/g, '')
  return `postlaunch-auto-${clientId}-${phase}-${bucket}`
}
