/**
 * ① 观众池怎么样。
 *
 * 🔴 「长没长」用 D11 诊断同一把尺（`dailyCounts` / `poolFlat` / `D11_MAX_WEEKLY_SHRINK`），
 *    不另写一套：两套口径并存，同一屏上会一边绿灯「在长」、一边黄色「池子断供」（子牙 2026-10-16 M1）。
 * 🔴 「够用」不能只看最大的那个池子：在用的池子判不了、或掉到显示下限，不许说够用（魏征 2026-10-16）。
 */

import { D4_AUDIENCE_FLOOR, D11_POOL_WINDOW_DAYS } from '../portfolio/diagnostics/thresholds'
import { windowDays } from '../portfolio/diagnostics/context'
import { toLocalDate } from '../portfolio/diagnostics/d2-d10-ad-rules'
import { D11_MAX_WEEKLY_SHRINK, dailyCounts, poolFlat } from '../portfolio/diagnostics/d11-audience-pool-starved'
import type { AudienceCountPoint } from '../portfolio/diagnostics/types'
import { fmtInt, hoursSince, shortDay } from './util'
import type { AudienceInput, Headline, Light, PoolRow, PoolTrend, WarMapInput } from './types'

export const MAX_POOL_ROWS = 8
/** 人数记录超过这么多小时没更新，就不能再说「至少 N 人」 */
export const POOL_STALE_HOURS = 72

interface Trend { trend: PoolTrend; note: string; light?: Light }

const UNKNOWN_TREND: Trend = { trend: 'unknown', note: '近 7 天的人数记录不够，长没长判不了' }

function accountTimezone(input: WarMapInput, adAccountId: string): string | null {
  return input.accounts.find(a => a.adAccountId === adAccountId)?.timezoneName ?? null
}

function pointsOf(input: WarMapInput, audienceId: string): AudienceCountPoint[] {
  return input.audienceHistory
    .filter(p => p.audienceId === audienceId)
    .map(p => ({ entity_id: p.audienceId, captured_at: p.capturedAt, audience_count_lower: p.countLower }))
}

/** 近 7 天里曾经超过显示下限、现在却掉到了下限以下 = 池子塌了，不能当成「判不了」 */
function collapsedFrom(points: AudienceCountPoint[], days: string[], tz: string | null): number | null {
  let peak = 0
  for (const p of points) {
    if (p.audience_count_lower === null || p.audience_count_lower <= D4_AUDIENCE_FLOOR) continue
    if (days.includes(toLocalDate(p.captured_at, tz)) && p.audience_count_lower > peak) peak = p.audience_count_lower
  }
  return peak > 0 ? peak : null
}

function computeTrend(a: AudienceInput, input: WarMapInput, size: Size): Trend {
  const tz = accountTimezone(input, a.adAccountId)
  const today = toLocalDate(input.now, tz)
  const days = windowDays(today, D11_POOL_WINDOW_DAYS)
  const points = pointsOf(input, a.id)

  if (!size.reliable) {
    // 🔴 「塌了」只能在「现在这一轮读到了、而且就是 ≤ 1,000」时说；读不到、过期都只是判不了（子牙 N1）。
    if (!size.atFloor) return { trend: 'unknown', note: '人数判不了，长没长也判不了' }
    const peak = collapsedFrom(points, days, tz)
    if (peak === null) return { trend: 'unknown', note: '人数判不了，长没长也判不了' }
    return { trend: 'shrinking', note: `近 7 天从至少 ${fmtInt(peak)} 人掉到显示下限`, light: 'red' }
  }
  const counts = dailyCounts(points, a.id, days, tz)
  const flat = poolFlat(counts, a.countLower ?? 0)
  if (!flat) return UNKNOWN_TREND
  const change = (flat.last - flat.first) / flat.first
  if (change < -D11_MAX_WEEKLY_SHRINK) return { trend: 'shrinking', note: `近 7 天缩了 ${Math.round(-change * 100)}%` }
  if (!flat.flat) return { trend: 'growing', note: `近 7 天在长（+${Math.round(change * 100)}%）` }
  return { trend: 'flat', note: '近 7 天基本没变' }
}

interface Size { sizeLower: number | null; note: string; reliable: boolean; atFloor: boolean }

function computeSize(a: AudienceInput, nowIso: string): Size {
  const count = a.countLower
  if (count === null || count < 0) return { sizeLower: null, note: '人数读不到', reliable: false, atFloor: false }
  const age = hoursSince(a.capturedAt, nowIso)
  if (age !== null && age > POOL_STALE_HOURS) {
    const day = a.capturedAt ? shortDay(a.capturedAt.slice(0, 10)) : '更早'
    return { sizeLower: count, note: `人数是 ${day} 的，已经过期，判不了`, reliable: false, atFloor: false }
  }
  if (count <= D4_AUDIENCE_FLOOR) {
    return { sizeLower: count, note: '显示下限 1,000，真实人数判不了', reliable: false, atFloor: true }
  }
  return { sizeLower: count, note: `至少 ${fmtInt(count)} 人`, reliable: true, atFloor: false }
}

function usedByAdsets(audienceId: string, input: WarMapInput): number {
  return input.adsets.filter(s => s.effectiveStatus === 'ACTIVE' && s.includedAudienceIds.includes(audienceId)).length
}

function buildRow(a: AudienceInput, input: WarMapInput, names: Map<string, string>): PoolRow {
  const size = computeSize(a, input.now)
  const trend = computeTrend(a, input, size)
  let light: Light = size.reliable ? 'green' : 'unknown'
  if (trend.light) light = trend.light
  else if (trend.trend === 'shrinking') light = 'yellow'
  return {
    id: a.id,
    name: a.name ?? a.id,
    accountName: names.get(a.adAccountId) ?? a.adAccountId,
    sizeLower: size.sizeLower,
    sizeNote: size.note,
    trend: trend.trend,
    trendNote: trend.note,
    usedByAdsets: usedByAdsets(a.id, input),
    light,
  }
}

function isReliable(r: PoolRow): boolean {
  return r.light !== 'unknown' && r.sizeLower !== null && r.sizeLower > D4_AUDIENCE_FLOOR
}

export function poolsHeadline(rows: PoolRow[]): Headline {
  const collapsed = rows.filter(r => r.light === 'red')
  if (collapsed.length > 0) {
    return { light: 'red', sentence: `有 ${collapsed.length} 个池子近 7 天从大池子掉到了显示下限，要查有没有人在补` }
  }
  const reliable = rows.filter(isReliable)
  if (reliable.length === 0) return { light: 'unknown', sentence: '观众池现在判不了：读不到，或者只有显示下限，或者数据过期了' }
  const inUse = rows.filter(r => r.usedByAdsets > 0)
  if (inUse.length > 0 && !inUse.some(isReliable)) {
    return { light: 'unknown', sentence: `设置里在用的 ${inUse.length} 个池子，人数都判不了；别的池子最大的至少 ${fmtInt(Math.max(...reliable.map(r => r.sizeLower ?? 0)))} 人` }
  }
  const biggest = Math.max(...reliable.map(r => r.sizeLower ?? 0))
  const shrinking = rows.filter(r => r.trend === 'shrinking').length
  if (shrinking > 0) return { light: 'yellow', sentence: `有 ${shrinking} 个池子近 7 天在缩，最大的池子至少 ${fmtInt(biggest)} 人` }
  const unknownCount = rows.length - reliable.length
  const trendTail = reliable.every(r => r.trend === 'unknown') ? '，近 7 天长没长暂时判不了' : '，没有在缩'
  const unknownTail = unknownCount > 0 ? `；另有 ${unknownCount} 个池子判不了` : ''
  return { light: 'green', sentence: `池子够用：最大的至少 ${fmtInt(biggest)} 人${trendTail}${unknownTail}` }
}

export function buildPools(
  input: WarMapInput,
  names: Map<string, string>,
): { headline: Headline; rows: PoolRow[]; hiddenCount: number; allRows: PoolRow[] } {
  const allRows = input.audiences.map(a => buildRow(a, input, names))
  const sorted = [...allRows].sort((a, b) => {
    if (a.sizeLower === null && b.sizeLower === null) return 0
    if (a.sizeLower === null) return 1
    if (b.sizeLower === null) return -1
    return b.sizeLower - a.sizeLower
  })
  const rows = sorted.slice(0, MAX_POOL_ROWS)
  return { headline: poolsHeadline(allRows), rows, hiddenCount: sorted.length - rows.length, allRows }
}
