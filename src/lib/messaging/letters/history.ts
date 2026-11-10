/**
 * 「已过发信日的信」：发信日已经过了，并且系统里有它的痕迹（提案或发送记录，含演练）的信。纯函数，不读数据库。
 *
 * 痕迹 = 提案（等你放行的或已放行的）或发送记录（含演练）；撤回的提案不算。
 *
 * 为什么只列有痕迹的：历史上的批次日是按「现在的订单」重新算出来的，系统上线之前的日子也会算出一堆信，
 * 它们从来没人打算发，列出来全是「该发没发」的噪音。有痕迹的才是真的排过、提过、发过的信——
 * 其中发信日已过却还是草稿 / 等你放行的，正说明「这一批没有发出去」，要如实显示。
 *
 * 回看多久：一个还没出发的团，第一封信最早在出发前 (firstMonth + 0.5) 个月；回看天数照这个算，
 * 这样每个团的「已发几封」不会少算。最多列最近几个批次日（PAST_BATCHES_SHOWN），更早的不列。
 */

import type { CountdownCadence } from './cadence'
import type { LetterRow, NzDate, PlannedLetter } from './types'

/** 列表里「已过发信日的信」最多列最近几个批次日。 */
export const PAST_BATCHES_SHOWN = 4

/** 计划里的一封信 + 它现在的一行 + 系统里有没有它的痕迹（提案或发送记录）。 */
export interface LetterEntry {
  letter: PlannedLetter
  row: LetterRow
  traced: boolean
}

/** 回看多少天的计划：够把一个还没出发的团的全部信都装进来（现在的节奏算出 199 天）。 */
export function lookbackDaysFor(cadence: CountdownCadence): number {
  return Math.ceil((cadence.firstMonth + 0.5) * cadence.daysPerMonth) + 1
}

function compareNewestFirst(a: LetterEntry, b: LetterEntry): number {
  return (
    b.letter.sendDate.localeCompare(a.letter.sendDate) ||
    a.letter.departOn.localeCompare(b.letter.departOn) ||
    a.letter.tourName.localeCompare(b.letter.tourName) ||
    a.letter.letterKey.localeCompare(b.letter.letterKey)
  )
}

/** 发信日早于今天、有痕迹的信，只留最近 PAST_BATCHES_SHOWN 个批次日的；新的在前。 */
export function pastLetterEntries(entries: readonly LetterEntry[], today: NzDate): LetterEntry[] {
  const traced = entries.filter((entry) => entry.letter.sendDate < today && entry.traced)
  const days = Array.from(new Set(traced.map((entry) => entry.letter.sendDate)))
    .sort()
    .reverse()
    .slice(0, PAST_BATCHES_SHOWN)
  const shown = new Set(days)
  return traced.filter((entry) => shown.has(entry.letter.sendDate)).sort(compareNewestFirst)
}
