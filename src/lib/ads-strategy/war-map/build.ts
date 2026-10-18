/**
 * 广告作战地图 S1 · 纯函数：把读出来的行变成「三句话 + 明细」。
 *
 * 设计稿：docs/specs/2026-10-16-ads-war-map-page-design-v0.1.md
 * 审查：子牙 + 魏征 2026-10-16（PR 2737）。判断分在同目录的小文件里，每个函数都 < 50 行：
 *   pools.ts（① 观众池，与 D11 同一把尺）· frequency.ts（② 频率，数据停了不许绿）· actions.ts（③ 今天调什么）。
 *
 * 🔴 共享代码里不写客户的团名、毛利、目标：这些只能来自输入。
 */

import { buildAdjust, ACCOUNT_STALE_HOURS } from './actions'
import { accountStatusHint, ACCOUNT_STATUS_ACTIVE, ACCOUNT_STATUS_UNSETTLED } from '@/lib/ads-strategy/account-status'
import { buildFrequency } from './frequency'
import { buildPools } from './pools'
import { diffDays, hoursSince, nzDay, shortDay } from './util'
import type {
  AccountView, CountdownView, GoalNote, PlanPhaseInput, WarMapInput, WarMapView,
} from './types'

export { MAX_POOL_ROWS } from './pools'

/** 倒计时看哪个阶段：今天还没结束的第一个阶段；都结束了就取最后一个 */
export function pickPhase(phases: PlanPhaseInput[], today: string): PlanPhaseInput | null {
  if (phases.length === 0) return null
  const sorted = [...phases].sort((a, b) => a.startDate.localeCompare(b.startDate))
  return sorted.find(p => p.endDate >= today) ?? sorted[sorted.length - 1]
}

function buildCountdown(input: WarMapInput, today: string): CountdownView {
  const phase = input.plan ? pickPhase(input.plan.phases, today) : null
  if (!input.plan || !phase) {
    return { planStatus: null, phaseName: null, launchDate: null, targetDate: null, daysToLaunch: null, daysToTarget: null }
  }
  return {
    planStatus: input.plan.status,
    phaseName: phase.name,
    launchDate: phase.startDate,
    targetDate: phase.endDate,
    daysToLaunch: diffDays(today, phase.startDate),
    daysToTarget: diffDays(today, phase.endDate),
  }
}

function accountView(a: WarMapInput['accounts'][number], nowIso: string): AccountView {
  const name = a.name ?? a.adAccountId
  const base = { adAccountId: a.adAccountId, name, statusCode: a.statusCode, capturedAt: a.capturedAt }
  if (a.statusCode === null) return { ...base, light: 'unknown', sentence: '读不到账户状态' }
  const age = hoursSince(a.capturedAt, nowIso)
  if (age === null || age > ACCOUNT_STALE_HOURS) {
    const day = a.capturedAt ? shortDay(nzDay(a.capturedAt)) : '更早'
    return { ...base, light: 'unknown', sentence: `状态是 ${day} 的，已经过期，判不了` }
  }
  if (a.statusCode === ACCOUNT_STATUS_ACTIVE) return { ...base, light: 'green', sentence: '正常' }
  if (a.statusCode === ACCOUNT_STATUS_UNSETTLED) {
    return { ...base, light: 'red', sentence: `状态码 ${a.statusCode}（${accountStatusHint(a.statusCode)}）` }
  }
  return { ...base, light: 'red', sentence: `状态码 ${a.statusCode}，广告可能被限制` }
}

/**
 * 目标进度那一行只陈述事实，不下断言：
 * 当前计划挂的目标和经营视图在追的目标是同一个就不提；不同就并排写出来；计划的目标读不到就如实说读不到。
 */
export function buildGoalNote(input: WarMapInput): GoalNote | null {
  const g = input.growth
  if (!g || !g.goalTitle) return null
  const planGoal = input.plan?.goalTitle ?? null
  if (planGoal !== null && planGoal === g.goalTitle) return null
  let tail: string
  if (planGoal !== null) tail = `当前推广计划挂的目标是《${planGoal}》，两件事不是同一个，别混着看。`
  else if (input.plan === null) tail = '现在没有推广计划，这条进度跟任何计划无关。'
  else tail = '当前推广计划挂的目标没读到，先别把两者当成同一件事。'
  return { title: g.goalTitle, paceReason: g.paceReason, warning: `这条进度对的是《${g.goalTitle}》。${tail}` }
}

function videoPoolIds(input: WarMapInput): Set<string> {
  const ids = input.audiences
    .filter(a => a.subtype === 'VIDEO' || a.ruleEvents.some(e => /video/i.test(e)))
    .map(a => a.id)
  return new Set(ids)
}

export function buildWarMap(input: WarMapInput): WarMapView {
  const today = nzDay(input.now)
  const accounts = input.accounts.map(a => accountView(a, input.now))
  const names = new Map(accounts.map(a => [a.adAccountId, a.name]))
  const pools = buildPools(input, names)
  const frequency = buildFrequency(input, names)
  const adjust = buildAdjust({
    input,
    accounts,
    poolRows: pools.allRows,
    videoPoolIds: videoPoolIds(input),
    frequencyRows: frequency.rows,
    upstream: [pools.headline, frequency.headline],
  })
  return {
    generatedAt: input.now,
    countdown: buildCountdown(input, today),
    clocks: input.clocks,
    accounts,
    pools: { headline: pools.headline, rows: pools.rows, hiddenCount: pools.hiddenCount },
    frequency,
    adjust,
    goalNote: buildGoalNote(input),
  }
}
