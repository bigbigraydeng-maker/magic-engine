/**
 * 开投后「自动补排」：每小时看一眼官方账户有没有开始花钱，花了就自己补排
 * T+1h / T+24h 读回，不靠人记得发事件。
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

/** 纯判定：这一小时要不要补排读回。结果最多一条，不会同时给两个阶段。 */
export function decideLaunchWatch(input: {
  watch: LaunchWatchConfig
  now: Date
  spendSeen: boolean
  receipts: readonly PostLaunchReceiptState[]
}): WatchDecision[] {
  const { watch, now, spendSeen, receipts } = input
  if (!isWatchActive(watch, now)) return []
  if (!spendSeen) return []

  const validT1h = receipts.filter(r => r.phase === 'post_t1h' && r.valid)
  const validT24h = receipts.filter(r => r.phase === 'post_t24h' && r.valid)

  if (validT1h.length === 0) {
    return [{ phase: 't1h', launched_at: now.toISOString() }]
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

/** 自动补排发出的事件编号：同一小时同一客户同一阶段相同（去重），换小时就换编号（重试）。 */
export function watchEventId(clientId: string, phase: 't1h' | 't24h', now: Date): string {
  const bucket = now.toISOString().slice(0, 13).replace(/\D/g, '')
  return `postlaunch-auto-${clientId}-${phase}-${bucket}`
}
