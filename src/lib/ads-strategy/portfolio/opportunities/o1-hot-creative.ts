/**
 * O1 · 潜在爆款（spec 2026-09-24 §3 G3）。只读，不出动作。
 *
 * 连续 N 天点击率明显高于账户中位数、但预算低于账户均值的广告组 —— 值得加投的信号。
 * 问题类诊断找"哪里不对"，这条找"哪里还有空间"。
 * 实验中的广告组不判（§14 M7）；曝光太薄的天不算数，避免小样本噪音。
 */

import type { AccountContext } from '../diagnostics/context'
import { adsetRows, sumSpend, unitOf } from '../diagnostics/context'
import type { Diagnosis } from '../diagnostics/types'

export const O1_CTR_MULTIPLE = 1.5
export const O1_MIN_DAYS = 3
export const O1_MIN_IMPRESSIONS_PER_DAY = 500

const round4 = (n: number) => Math.round(n * 10000) / 10000
const round2 = (n: number) => Math.round(n * 100) / 100

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

interface DayStat {
  day: string
  impressions: number
  clicks: number
  spend: number
  ctr: number
  counts: boolean
}

/** 某广告组某天的曝光/点击/花费；曝光不足 O1_MIN_IMPRESSIONS_PER_DAY 的天不算数。 */
function dayStats(ctx: AccountContext, adsetId: string, day: string): DayStat {
  const rows = adsetRows(ctx, [adsetId], [day])
  const impressions = rows.reduce((s, r) => s + r.impressions, 0)
  const clicks = rows.reduce((s, r) => s + r.clicks, 0)
  return {
    day, impressions, clicks, spend: sumSpend(rows),
    ctr: impressions > 0 ? clicks / impressions : 0,
    counts: impressions >= O1_MIN_IMPRESSIONS_PER_DAY,
  }
}

/** 每天账户中位数 CTR：只拿当天算数的广告组比。不足 2 条的那天没有可用中位数。 */
function accountMedians(stats: Map<string, DayStat[]>, days: string[]): Map<string, number> {
  const medians = new Map<string, number>()
  for (const day of days) {
    const ctrs = Array.from(stats.values())
      .map(list => list.find(s => s.day === day))
      .filter((s): s is DayStat => !!s && s.counts)
      .map(s => s.ctr)
    if (ctrs.length >= 2) medians.set(day, median(ctrs))
  }
  return medians
}

/** 单条广告组的判定：全达标 + 花费低于账户均值 → hit；曝光不够但本可能达标 → not_comparable。 */
function judgeAdset(
  ctx: AccountContext,
  id: string,
  stats: DayStat[],
  medians: Map<string, number>,
  meanSpend: number,
): Diagnosis | null {
  const unit = unitOf(ctx, 'adset', id)
  const spend = round2(stats.reduce((s, d) => s + d.spend, 0))
  const evidence = {
    window_start: ctx.window[0],
    window_end: ctx.date,
    days: stats.map(d => d.day).join('|'),
    ctr_by_day: stats.map(d => round4(d.ctr)).join('|'),
    median_by_day: stats.map(d => round4(medians.get(d.day) ?? 0)).join('|'),
    spend_3d: spend,
    account_mean_spend_3d: round2(meanSpend),
  }
  const above = stats.filter(d => d.counts && d.ctr > O1_CTR_MULTIPLE * (medians.get(d.day) ?? Infinity))
  if (above.length === 0) return null
  if (stats.some(d => !d.counts)) {
    return {
      code: 'O1', status: 'not_comparable', notComparableReason: 'below_min_sample',
      title: `潜在爆款这条判不了：曝光不足 ${O1_MIN_IMPRESSIONS_PER_DAY} 的天数太多，样本太薄`,
      units: [unit], evidence,
      sample: [{ label: '曝光不足的天数', value: stats.filter(d => !d.counts).length }],
      reasons: [`每天至少 ${O1_MIN_IMPRESSIONS_PER_DAY} 次曝光才算数，避免小样本噪音`],
      clientVisible: false,
    }
  }
  // 🔴 必须每天都超标；只有一天超标不算潜在爆款（否则波动一天就命中）
  if (above.length !== stats.length) return null
  if (spend >= meanSpend) return null
  return {
    code: 'O1', status: 'hit',
    title: `这条广告组连续 ${O1_MIN_DAYS} 天点击率是账户中位数的 ${O1_CTR_MULTIPLE} 倍以上，但预算低于账户平均，可能是潜在爆款`,
    units: [unit], evidence,
    sample: [{ label: '连续达标天数', value: O1_MIN_DAYS }, { label: '账户参与比较的广告组', value: medians.size > 0 ? stats.length : 0 }],
    reasons: ['建议加预算（ads.scale_unit_budget，+≤20%）——本阶段只发现，不出动作'],
    clientVisible: false,
  }
}

export function findHotCreatives(ctx: AccountContext): Diagnosis[] {
  const days = ctx.window.slice(-O1_MIN_DAYS)
  const candidates = Array.from(ctx.adsets.keys()).filter(id => !ctx.experimentIds.has(id))
  const stats = new Map<string, DayStat[]>(
    candidates.map(id => [id, days.map(day => dayStats(ctx, id, day))]),
  )
  const medians = accountMedians(stats, days)
  if (medians.size < O1_MIN_DAYS) return []

  const spends = candidates.map(id => stats.get(id)!.reduce((s, d) => s + d.spend, 0))
  const meanSpend = spends.length > 0 ? spends.reduce((a, b) => a + b, 0) / spends.length : 0

  const out: Diagnosis[] = []
  for (const id of candidates) {
    const hit = judgeAdset(ctx, id, stats.get(id)!, medians, meanSpend)
    if (hit) out.push(hit)
  }
  return out
}
