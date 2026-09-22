/**
 * D1 · 投放被卡住（设计 §3.3 + §14 M5）。按**单个账户**看，只读。
 *
 * 命中要同时满足：
 *   ① 预筛：当天花费 < 前 3 天中位数 × 0.75（小时数据只在预筛命中后才需要）
 *   ② 当天有预算剩余（按评估日有效设置的日预算合计）
 *   ③ 连续 ≥3 小时零投放（账户时区）
 *   ④ 缺口结束距评估时刻 ≥2 小时（避开报表延迟）
 *   ⑤ 昨天同时段在投（≥一半小时有花费）
 *   ⑥ 非排期投放（没有用总预算/排期的在投单位）
 * 返回 not_comparable：没拿到小时数据、缺口全在夜间低谷、排期投放、报表延迟窗口内。
 * M5：另看前 2 天是否在同一时刻（±1 小时）也停投——是则多半是账户单日花费上限。
 * 检测时延（detection_lag_hours）写进证据：cron 一天一次，最快隔天发现。
 *
 * D1 是账户级「钱花不出去」的判断，**不排除** Meta 实验中的单位（§14 M7 只要求排除出 D2/D5/处方/止损/素材同步；
 * 排除后实验期间账户花费会被低估，D1 基本失明——2026-09-14 子牙复审）。实验单位在别的诊断里照样被排除。
 * 预算只算评估日结束时仍在投的单位；暂停的单位（哪怕当天花过钱）不算。
 * 已知检测时延：cron 一天一次评估前一天，当天正在进行的卡住要到次日才报（证据里写 detection_lag_hours）。
 */

import type { AccountContext } from './context'
import { isDelivering, minorToMajor, money, shiftDate } from './context'
import type { Diagnosis, HourlyRow } from './types'
import {
  D1_MIN_STALL_HOURS,
  D1_NIGHT_END_HOUR,
  D1_NIGHT_START_HOUR,
  D1_PRESCREEN_DROP_RATIO,
  D1_REPEAT_HOUR_TOLERANCE,
  D1_REPEAT_LOOKBACK_DAYS,
  D1_REPORT_LAG_HOURS,
  D1_YESTERDAY_ACTIVE_HOUR_RATIO,
} from './thresholds'

const round2 = (n: number) => Math.round(n * 100) / 100

function daySpend(ctx: AccountContext, day: string): number {
  return round2(ctx.account.daily
    .filter(r => r.level === 'adset' && r.insight_date === day)
    .reduce((s, r) => s + r.spend, 0))
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** 某天 24 小时花费（缺的小时 = 0）。没有这天的小时数据 → null。 */
export function hourlySeries(ctx: AccountContext, day: string): number[] | null {
  const rows: HourlyRow[] | undefined = ctx.account.hourly[day]
  if (!rows) return null
  const out = Array.from({ length: 24 }, () => 0)
  for (const r of rows) {
    if (r.hour >= 0 && r.hour < 24) out[r.hour] += r.spend
  }
  return out.map(round2)
}

/** 全部连续零花费小时段 [start, endExclusive)，按出现顺序。 */
export function zeroRuns(series: number[]): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = []
  let start = -1
  for (let h = 0; h <= 24; h++) {
    const zero = h < 24 && series[h] <= 0
    if (zero && start < 0) start = h
    if (!zero && start >= 0) {
      out.push({ start, end: h })
      start = -1
    }
  }
  return out
}

/** 最长连续零花费小时段。 */
export function longestZeroRun(series: number[]): { start: number; end: number } | null {
  return zeroRuns(series).reduce<{ start: number; end: number } | null>((best, r) => (!best || r.end - r.start > best.end - best.start ? r : best), null)
}

function localDayHour(iso: string, tz: string | null): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00'
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
}

function hoursFrom(day: string, hour: number, evalDay: string, evalHour: number): number {
  const days = (Date.parse(`${evalDay}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000
  return days * 24 + evalHour - hour
}

/** 预筛：当天花费明显低于前 3 天中位数才需要小时数据（加载器据此决定要不要调 Meta 拉小时花费）。 */
export function d1NeedsHourly(ctx: AccountContext): boolean {
  const spendD = daySpend(ctx, ctx.date)
  const prior = [1, 2, 3].map(i => daySpend(ctx, shiftDate(ctx.date, -i))).filter(v => v > 0)
  return prior.length > 0 && spendD < D1_PRESCREEN_DROP_RATIO * median(prior)
}

export function diagnoseDeliveryStall(ctx: AccountContext, evaluatedAt: string): Diagnosis | null {
  const D = ctx.date
  const spendD = daySpend(ctx, D)
  const prior = [1, 2, 3].map(i => daySpend(ctx, shiftDate(D, -i))).filter(v => v > 0)
  if (!d1NeedsHourly(ctx)) return null
  const priorMedian = round2(median(prior))

  // 只认评估日结束时仍在投的单位（2026-09-14 魏征复审：当天花过钱、后来被暂停的不算——那是主动停投不是卡住）
  const live = ctx.allBudgetUnits.filter(u => isDelivering(u.level === 'campaign' ? ctx.campaigns.get(u.id) : ctx.adsets.get(u.id)))
  const dailyBudget = round2(live.reduce((s, u) => s + (minorToMajor(u.dailyBudgetMinor) ?? 0), 0))
  // 「当天有预算剩余」是命中前提：没有在投单位 / 读不到任何日预算 → 不判
  if (live.length === 0) return null
  const unit = { level: 'account' as const, id: ctx.account.adAccountId, name: ctx.accountRow?.entity_name ?? null, adAccountId: ctx.account.adAccountId }
  const base = {
    code: 'D1' as const,
    units: [unit],
    clientVisible: true,
    evidence: { day: D, spend_day: spendD, prior_3d_median_spend: priorMedian, daily_budget: dailyBudget, account_status: ctx.accountRow?.account_status ?? null } as Diagnosis['evidence'],
  }
  const notComparable = (reason: Diagnosis['notComparableReason'], why: string, extra: Diagnosis['evidence'] = {}): Diagnosis => ({
    ...base, status: 'not_comparable', notComparableReason: reason, title: `投放可能卡住，但判不了：${why}`,
    evidence: { ...base.evidence, ...extra }, sample: [{ label: '前 3 天有花费的天数', value: prior.length }], reasons: [why],
  })

  if (live.some(u => u.lifetimeBudgetMinor !== null)) {
    return notComparable('scheduled_delivery', '有用总预算/排期投放的在投单位，零投放时段可能是排期')
  }
  if (dailyBudget <= 0 || spendD >= dailyBudget * 0.98) return null

  const today = hourlySeries(ctx, D)
  if (!today) return notComparable('no_hourly_data', `当天花费比前 3 天中位数低很多，但没拿到按小时数据${ctx.account.hourlyError ? `（${ctx.account.hourlyError}）` : ''}`)
  const runs = zeroRuns(today).filter(r => r.end - r.start >= D1_MIN_STALL_HOURS)
  if (runs.length === 0) return null
  const isNight = (r: { start: number; end: number }) => r.start >= D1_NIGHT_START_HOUR && r.end <= D1_NIGHT_END_HOUR
  // 夜间零投放和白天真卡住可能同时存在：优先看白天的最长段（魏征复审：只看最长段会被夜间段挡掉真问题）
  const daytime = runs.filter(r => !isNight(r)).sort((a, b) => (b.end - b.start) - (a.end - a.start))
  if (daytime.length === 0) {
    const night = runs[0]
    return notComparable('night_trough', `零投放时段 ${night.start}:00–${night.end}:00 全在夜间低谷`, { stall_start_hour: night.start, stall_hours: night.end - night.start })
  }
  const run = daytime[0]
  const runExtra = { stall_start_hour: run.start, stall_hours: run.end - run.start }
  const evalLocal = localDayHour(evaluatedAt, ctx.account.timezone)
  const sinceGapEnd = hoursFrom(D, run.end, evalLocal.day, evalLocal.hour)
  if (sinceGapEnd < D1_REPORT_LAG_HOURS) {
    return notComparable('report_lag', `缺口结束才 ${sinceGapEnd} 小时，报表可能还没到`, runExtra)
  }
  const yesterday = hourlySeries(ctx, shiftDate(D, -1))
  if (!yesterday) return notComparable('no_hourly_data', '没拿到昨天的按小时数据，无法确认昨天同时段在投', runExtra)
  const hours = Array.from({ length: run.end - run.start }, (_, i) => run.start + i)
  const yActive = hours.filter(h => yesterday[h] > 0).length
  if (yActive / hours.length < D1_YESTERDAY_ACTIVE_HOUR_RATIO) return null

  let repeatedDays = 0
  for (let i = 1; i <= D1_REPEAT_LOOKBACK_DAYS; i++) {
    const s = hourlySeries(ctx, shiftDate(D, -i))
    const r = s ? longestZeroRun(s) : null
    if (r && r.end - r.start >= D1_MIN_STALL_HOURS && Math.abs(r.start - run.start) <= D1_REPEAT_HOUR_TOLERANCE) repeatedDays++
  }
  const remaining = dailyBudget > 0 ? round2(dailyBudget - spendD) : null
  const status = ctx.accountRow?.account_status
  const reasons = [
    status === 1 ? '账户状态正常（没被封）' : `账户状态 account_status=${status ?? '读不到'}，需要人工确认`,
    `昨天同时段 ${yActive}/${hours.length} 小时在投`,
    repeatedDays > 0 ? `前 ${D1_REPEAT_LOOKBACK_DAYS} 天里有 ${repeatedDays} 天也在同一时刻停，多半是账户单日花费上限` : '前两天没有在同一时刻停',
  ]
  return {
    ...base,
    status: 'hit',
    title: `投放卡住：当天 ${run.start}:00 起（账户时区 ${ctx.account.timezone ?? 'UTC'}）连续 ${run.end - run.start} 小时零投放${remaining !== null ? `，日预算还剩 ${money(ctx, remaining)}` : ''}`,
    manualTask: {
      what: `广告账户 ${ctx.account.adAccountId} 在 ${D} ${run.start}:00 之后钱花不出去。`,
      how: '只看不改：打开广告后台看这个账户下午为什么没花钱（账户单日花费上限、付款方式、广告审核）；是单日上限就去账单页处理。',
      href: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${ctx.account.adAccountId.replace(/^act_/, '')}`,
    },
    evidence: {
      ...base.evidence,
      ...runExtra,
      budget_remaining: remaining,
      spend_before_stall: round2(today.slice(0, run.start).reduce((a, b) => a + b, 0)),
      yesterday_same_window_spend: round2(hours.reduce((a, h) => a + yesterday[h], 0)),
      repeated_same_hour_days: repeatedDays,
      detection_lag_hours: hoursFrom(D, run.start, evalLocal.day, evalLocal.hour),
    },
    sample: [
      { label: '当天有花费的小时', value: today.filter(v => v > 0).length },
      { label: '昨天同时段在投的小时', value: yActive },
    ],
    reasons,
  }
}
