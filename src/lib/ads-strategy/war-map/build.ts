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
import { buildFrequency, dataStaleDays, DATA_STALE_DAYS } from './frequency'
import { buildAccountSummaries, buildPools, unusableAccountNote } from './pools'
import { diffDays, hoursSince, nzDay, shortDay } from './util'
import type {
  AccountView, CountdownView, DataSourceState, GoalNote, PlanPhaseInput, StaleAccountEntry,
  WarMapInput, WarMapView,
} from './types'

/** 取数链路「最近成功过一次」要多近。超过这个阈值视作链路挂了（cron 每天跑一次，36h 够留一次宽限） */
const CHAIN_SUCCESS_FRESH_HOURS = 36

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
    return {
      planStatus: null, phaseName: null, launchDate: null, targetDate: null, daysToLaunch: null, daysToTarget: null,
      actualLaunchDay: null, planStale: false,
    }
  }
  // 🔴 「计划过时」＝计划写完**之后**才有广告开始跑，而且比计划写的开投日更早。
  //    只比「开投日」会把「一直在跑的常驻广告 + 未来的新阶段计划」误判成「已开投」；
  //    所以实际起跑日必须晚于计划记录最后更新的那天（读不到更新日才退回只比开投日）。
  const updated = input.plan.recordUpdatedDay
  const stale = input.runningSince !== null
    && phase.startDate > input.runningSince
    && (updated === null || input.runningSince > updated)
  return {
    planStatus: input.plan.status,
    phaseName: phase.name,
    launchDate: phase.startDate,
    targetDate: phase.endDate,
    daysToLaunch: diffDays(today, phase.startDate),
    daysToTarget: diffDays(today, phase.endDate),
    actualLaunchDay: stale ? input.runningSince : null,
    planStale: stale,
  }
}

function accountView(a: WarMapInput['accounts'][number], nowIso: string): AccountView {
  const name = a.name ?? a.adAccountId
  const base = { adAccountId: a.adAccountId, name, statusCode: a.statusCode, capturedAt: a.capturedAt }
  if (a.statusCode === null && a.capturedAt === null) return { ...base, light: 'unknown', sentence: '已绑定，暂无数据' }
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

/** 在用账户（状态正常或读不到）的 id；欠款/关闭的账户不参与频率和新鲜度判断 */
function usableAccountIds(input: WarMapInput): Set<string> {
  return new Set(input.accounts.filter(a => unusableAccountNote(a.statusCode) === null).map(a => a.adAccountId))
}

/** 最旧的数据日：整体数据日和每个在用账户各自的数据日里取最早，避免一个新鲜账户把另一个停更的账户盖成绿灯 */
function oldestDataDay(input: WarMapInput, usable: Set<string>): string | null {
  const days = [input.clocks.dataDay, ...[...usable].map(id => input.accountDataDays[id] ?? null)]
  const known = days.filter((d): d is string => d !== null)
  return known.length > 0 ? known.reduce((a, b) => (b < a ? b : a)) : null
}

/**
 * 把「数据过期」分成两件事：源头没花钱 vs 取数链路挂了。
 *
 * 🔴 用 cron_run_logs 判链路、用 ad_daily_insights.insight_date 判上游，不能只看 fetched_at：
 *    syncCampaignDailyInsights 的 7 天滚动窗口在上游没新花费时会返 0 行、不 upsert，
 *    fetched_at 冻结在旧日期——跟「cron 挂了」长得一模一样，但原因不是。
 *
 * 🔴 「成功跑过」不是「cron 跑了」，而是「本客户走通到 upsert」—— cron 层面每天都在跑，
 *    但一次运行里对某个客户可以单独失败（token 过期、限流、权限），要靠 summary.errors[].client_id 判。
 */
export function deriveSourceState(
  cronHealth: WarMapInput['cronHealth'],
  staleDays: number | null,
  now: Date,
): DataSourceState {
  // 读不到 cron 日志 → 判不出来，就直说
  if (cronHealth === null) return 'unknown'
  // 48h 内一次都没跑 → 链路真的挂了（或者 schedule 掉了）
  if (cronHealth.lastRunAt === null) return 'fetch_chain_down'
  // 对本客户 48h 内一次都没成功 → 链路对这个客户是挂的
  if (cronHealth.lastClientSuccessAt === null) return 'fetch_chain_down'
  // 最近一次成功太久以前 → 链路一直在失败
  const hoursSinceSuccess = (now.getTime() - new Date(cronHealth.lastClientSuccessAt).getTime()) / 3600_000
  if (hoursSinceSuccess > CHAIN_SUCCESS_FRESH_HOURS) return 'fetch_chain_down'
  // 链路通了。数据够新 → fresh；否则就是上游真的没花钱
  if (staleDays === null || staleDays <= DATA_STALE_DAYS) return 'fresh'
  return 'no_spend_upstream'
}

/** 列出哪些在用账户的数据日已过期，给 no_spend_upstream 的 UI 用（已按最旧的在前排序） */
function buildStaleAccounts(
  input: WarMapInput,
  accounts: AccountView[],
  usable: Set<string>,
  today: string,
): StaleAccountEntry[] {
  const nameOf = new Map(accounts.map(a => [a.adAccountId, a.name]))
  const entries: StaleAccountEntry[] = []
  for (const id of usable) {
    const dataDay = input.accountDataDays[id] ?? null
    const stale = dataDay ? diffDays(dataDay, today) : null
    if (stale === null || stale > DATA_STALE_DAYS) {
      entries.push({ adAccountId: id, name: nameOf.get(id) ?? id, staleDays: stale })
    }
  }
  // 没有数据日的（null）排最后，有数据日的按落后天数倒序
  return entries.sort((a, b) => {
    if (a.staleDays === null && b.staleDays === null) return 0
    if (a.staleDays === null) return 1
    if (b.staleDays === null) return -1
    return b.staleDays - a.staleDays
  })
}

export function buildWarMap(input: WarMapInput): WarMapView {
  const today = nzDay(input.now)
  const accounts = input.accounts.map(a => accountView(a, input.now))
  const names = new Map(accounts.map(a => [a.adAccountId, a.name]))
  const usable = usableAccountIds(input)
  const oldestDay = oldestDataDay(input, usable)
  const staleDays = oldestDay ? diffDays(oldestDay, today) : dataStaleDays(input)
  const pools = buildPools(input, names, accounts, staleDays, oldestDay)
  const frequency = buildFrequency({ ...input, campaigns: input.campaigns.filter(c => usable.has(c.adAccountId)) }, names)
  const adjust = buildAdjust({
    input,
    accounts,
    poolRows: pools.allRows,
    videoPoolIds: videoPoolIds(input),
    frequencyRows: frequency.rows,
    upstream: [pools.headline, frequency.headline],
  })
  const sourceState = deriveSourceState(input.cronHealth, staleDays, new Date(input.now))
  const staleAccounts = sourceState === 'no_spend_upstream' ? buildStaleAccounts(input, accounts, usable, today) : []
  return {
    generatedAt: input.now,
    countdown: buildCountdown(input, today),
    // 表头的「数据日」和「已 N 天」必须同一口径：都取最旧的在用账户数据日
    clocks: {
      dataDay: oldestDay ?? input.clocks.dataDay,
      fetchedAt: input.clocks.fetchedAt,
      staleDays,
      sourceState,
      staleAccounts,
      recentFailureCount: input.cronHealth?.recentFailureCount ?? 0,
    },
    accounts,
    accountSummaries: buildAccountSummaries(input, accounts, pools.everyRow, today),
    pools: { headline: pools.headline, rows: pools.rows, hiddenCount: pools.hiddenCount, unusableRows: pools.unusableRows },
    frequency,
    adjust,
    goalNote: buildGoalNote(input),
    prescriptionLine: input.plan?.prescriptionLine ?? null,
  }
}
