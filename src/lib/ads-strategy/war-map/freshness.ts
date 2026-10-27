/**
 * 数据新不新：只看「真在投」的账户，并把「没花钱」和「取数挂了」分开。
 *
 * 🔴 全停的账户（最近 2 天没花费、设置里也没有 ACTIVE 广告组）没有新数据是正常的，不参与新鲜度；
 *    否则一个早就停掉的账户会让整张表头永远报「数据已 N 天没更新」，还把观众池一起挡住。
 * 🔴 「取数挂了」看最近一次取数时间（fetched_at），不看最近一次有花费的日期：
 *    在投账户取数正常但这几天没花钱，是「没花钱」，不是「取数挂了」。读不到取数时间时才退回用数据日。
 */

import { DATA_STALE_DAYS } from './frequency'
import { diffDays, nzDay, shortDay } from './util'
import type { WarMapInput } from './types'

export interface Freshness {
  /** 参与新鲜度判断的账户（在用且真在投） */
  activeIds: Set<string>
  /** 在用但全停的账户 */
  dormantIds: Set<string>
  /** 表头的数据日：在投账户里最旧的那个；一个在投账户都没有时退回整体数据日 */
  dataDay: string | null
  /** 取数断了几天（在投账户里最久没取数的那个）；null = 判不了 */
  staleDays: number | null
  /** 不算「取数挂了」但值得说一句的话 */
  note: string | null
}

/** 全停 = 有活动记录，但最近 2 天没花费、也没有 ACTIVE 广告组。没有活动记录（老调用方）一律当在投。 */
export function isDormant(input: WarMapInput, adAccountId: string, today: string): boolean {
  const act = input.accountActivity?.[adAccountId]
  if (!act || act.hasActiveAdset) return false
  return act.lastSpendDay === null || diffDays(act.lastSpendDay, today) > DATA_STALE_DAYS
}

/** 判断「取数断没断」用的那一天：优先最近一次取数的新西兰日期，读不到才用数据日 */
function fetchSignalDay(input: WarMapInput, id: string): string | null {
  const fetchedAt = input.accountFetchedAt?.[id] ?? null
  return fetchedAt ? nzDay(fetchedAt) : (input.accountDataDays[id] ?? null)
}

function earliest(days: Array<string | null>): string | null {
  const known = days.filter((d): d is string => d !== null)
  return known.length > 0 ? known.reduce((a, b) => (b < a ? b : a)) : null
}

function notesOf(input: WarMapInput, names: Map<string, string>, active: string[], dormant: string[], today: string): string | null {
  const notes: string[] = []
  if (dormant.length > 0) {
    notes.push(`${dormant.map(id => names.get(id) ?? id).join('、')} 没在投，没有新数据是正常的`)
  }
  if (input.accountFetchedAt) {
    for (const id of active) {
      const fetched = fetchSignalDay(input, id)
      const dataDay = input.accountDataDays[id] ?? null
      if (fetched === null || dataDay === null) continue
      if (diffDays(fetched, today) <= DATA_STALE_DAYS && diffDays(dataDay, today) > DATA_STALE_DAYS) {
        notes.push(`${names.get(id) ?? id} 取数正常，但数据只到 ${shortDay(dataDay)}（这几天没花钱，不是取数挂了）`)
      }
    }
  }
  return notes.length > 0 ? notes.join('；') : null
}

export function computeFreshness(input: WarMapInput, usable: Set<string>, names: Map<string, string>): Freshness {
  const today = nzDay(input.now)
  const ids = [...usable]
  const dormant = ids.filter(id => isDormant(input, id, today))
  const active = ids.filter(id => !dormant.includes(id))
  const note = notesOf(input, names, active, dormant, today)
  const activeIds = new Set(active)
  const dormantIds = new Set(dormant)
  if (ids.length > 0 && active.length === 0) {
    return { activeIds, dormantIds, dataDay: input.clocks.dataDay, staleDays: null, note }
  }
  const dataDay = earliest([input.clocks.dataDay, ...active.map(id => input.accountDataDays[id] ?? null)])
  const signal = earliest(active.map(id => fetchSignalDay(input, id)))
  const base = signal ?? dataDay
  return { activeIds, dormantIds, dataDay, staleDays: base ? diffDays(base, today) : null, note }
}
