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

const DAY_MS = 86_400_000

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

/** 自动补排发出的事件编号：同一小时同一客户同一阶段相同（去重），换小时就换编号（重试）。 */
export function watchEventId(clientId: string, phase: 't1h' | 't24h', now: Date): string {
  const bucket = now.toISOString().slice(0, 13).replace(/\D/g, '')
  return `postlaunch-auto-${clientId}-${phase}-${bucket}`
}
