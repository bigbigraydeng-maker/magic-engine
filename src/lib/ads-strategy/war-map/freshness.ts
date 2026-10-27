/**
 * 表头的「数据日 / 已 N 天没更新」怎么算（纯函数）。
 *
 * 🔴 只看「现在在投」的账户：近 2 天有花费，或现在有 ACTIVE 广告组。全停账户没有新数据是正常的，
 *    不拖累表头，只在表头注明（2026-10-28 作战地图误报「数据已 3 天没更新」）。
 * 🔴 取数有没有断看最近一次取数时间（fetched_at），不看最近花费日期：没花钱 ≠ 取数挂了。
 *    读不到取数时间才退回看数据日（旧行为）。
 * 🔴 没有任何账户能证明「在投」时退回看全部在用账户，保持旧行为，不放过取数断了的账户。
 */

import { DATA_STALE_DAYS } from './frequency'
import { diffDays, nzDay } from './util'
import type { WarMapInput } from './types'

export interface Freshness {
  dataDay: string | null
  staleDays: number | null
  /** 被排除在新鲜度之外的全停账户 id */
  idleIds: Set<string>
  idleNote: string | null
}

function isActive(input: WarMapInput, id: string, today: string): boolean {
  const hasActiveAdset = input.adsets.some(s => s.adAccountId === id && s.effectiveStatus === 'ACTIVE')
  const spentRecently = input.campaigns.some(
    c => c.adAccountId === id && c.lastSpendDay != null && diffDays(c.lastSpendDay, today) <= DATA_STALE_DAYS,
  )
  return hasActiveAdset || spentRecently
}

/** 这个账户的数据落后几天：有取数时间看取数时间，没有才看数据日 */
function lagDays(input: WarMapInput, id: string, today: string): number | null {
  const fetched = input.accountFetchedAts?.[id]
  if (fetched) return diffDays(nzDay(fetched), today)
  const day = input.accountDataDays[id]
  return day ? diffDays(day, today) : null
}

export function computeFreshness(input: WarMapInput, usable: Set<string>, today: string): Freshness {
  const active = [...usable].filter(id => isActive(input, id, today))
  const watched = active.length > 0 ? active : [...usable]
  const idle = active.length > 0 ? [...usable].filter(id => !active.includes(id)) : []
  const days = watched.map(id => input.accountDataDays[id] ?? null)
  if (active.length === 0) days.push(input.clocks.dataDay)
  const known = days.filter((d): d is string => d !== null)
  const dataDay = known.length > 0
    ? known.reduce((a, b) => (b < a ? b : a))
    : input.clocks.dataDay
  const lags = watched.map(id => lagDays(input, id, today)).filter((n): n is number => n !== null)
  const staleDays = lags.length > 0
    ? Math.max(...lags)
    : (dataDay ? diffDays(dataDay, today) : null)
  const names = idle.map(id => input.accounts.find(a => a.adAccountId === id)?.name ?? id)
  return {
    dataDay,
    staleDays,
    idleIds: new Set(idle),
    idleNote: names.length > 0 ? `${names.join('、')} 没在投，没有新数据是正常的` : null,
  }
}
