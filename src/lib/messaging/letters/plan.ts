/**
 * 倒计时信的批次计划（纯函数）：某一天，谁该收哪一封信。
 *
 * 只回答「谁该收哪封」：同意依据、别再联系、7 天 ≤ 2 封、退订、Mailchimp 状态都不归它管
 * （那是发信前的检查，不改变「谁该收哪封」；页面另显示被拦原因）。
 * 不读数据库、不看现在几点：订单事实和日期都从参数传进来（读订单的部分在 load.ts）。
 *
 * 规则（来自发信设计窗口的读数据接口约定 §8，测试向量见 __tests__/plan.test.ts）：
 *  - 批次日：每月第一个周三；最后一个月（离出发 ≤ 30 天）改成每周三。
 *  - 最后一封至少提前 3 天发（更近的由运营直接联系）。
 *  - 月数 = round(离出发天数 / 30.4)，只发 6、5、4、3、2、1 个月的信。
 *  - 不管哪天订，都进「离你最近」那一组；前面错过的不补（本函数只算指定那天往后，天然如此）。
 *  - 同一个团同一天只有一封信，同团的人收同一封。
 *
 * 层级：旅游版（按出发日倒计时）的行业层默认值。节奏参数集中在 COUNTDOWN_CADENCE，
 * 将来某个客户节奏不同，走客户配置传进来，不改这里；这里没有任何客户名、客户 ID、团名。
 */

import { dayOfMonth, daysBetween, fromDayNumber, toDayNumber, weekdayOf } from './dates'
import { buildLetterKey } from './keys'
import type { BookingFact, MonthsLeft, NzDate, PlannedLetter, PlannedRecipient } from './types'

export interface CountdownCadence {
  /** 批次日是周几（0 = 周日 … 3 = 周三）。 */
  batchWeekday: number
  /** 一个月折合多少天：月数 = round(离出发天数 / 这个数)。 */
  daysPerMonth: number
  /** 最先发几个月的信 / 最后发几个月的信。 */
  firstMonth: number
  lastMonth: number
  /** 离出发这么多天以内，改成每周一封。 */
  weeklyWithinDays: number
  /** 最后一封至少提前几天发。 */
  stopBeforeDays: number
}

export const COUNTDOWN_CADENCE: CountdownCadence = {
  batchWeekday: 3,
  daysPerMonth: 30.4,
  firstMonth: 6,
  lastMonth: 1,
  weeklyWithinDays: 30,
  stopBeforeDays: 3,
}

interface TourGroup {
  tourId: string
  tourName: string
  departOn: NzDate
  recipients: PlannedRecipient[]
}

interface RecipientAccumulator {
  contactId: string
  displayName: string | null
  seats: number
  seatsUnknown: boolean
}

function compareNames(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a.toLowerCase().localeCompare(b.toLowerCase())
}

function toRecipients(people: Map<string, RecipientAccumulator>): PlannedRecipient[] {
  return Array.from(people.values())
    .map((p) => ({
      contactId: p.contactId,
      displayName: p.displayName,
      seats: p.seatsUnknown ? null : p.seats,
    }))
    .sort((a, b) => compareNames(a.displayName, b.displayName) || a.contactId.localeCompare(b.contactId))
}

function addFact(people: Map<string, RecipientAccumulator>, fact: BookingFact): void {
  const existing = people.get(fact.contactId)
  if (!existing) {
    people.set(fact.contactId, {
      contactId: fact.contactId,
      displayName: fact.displayName,
      seats: fact.seats ?? 0,
      seatsUnknown: fact.seats === null,
    })
    return
  }
  if (existing.displayName === null) existing.displayName = fact.displayName
  if (fact.seats === null) existing.seatsUnknown = true
  else existing.seats += fact.seats
}

/** 把订单事实按「同一个团」归拢；同一个人在同一个团的多张订单合并成一位收件人。 */
function buildGroups(facts: readonly BookingFact[]): TourGroup[] {
  const groups = new Map<string, { group: Omit<TourGroup, 'recipients'>; people: Map<string, RecipientAccumulator> }>()
  for (const fact of facts) {
    if (toDayNumber(fact.departOn) === null) continue
    const key = `${fact.tourId}\u0000${fact.departOn}`
    let entry = groups.get(key)
    if (!entry) {
      entry = {
        group: { tourId: fact.tourId, tourName: fact.tourName, departOn: fact.departOn },
        people: new Map(),
      }
      groups.set(key, entry)
    }
    addFact(entry.people, fact)
  }
  return Array.from(groups.values())
    .map(({ group, people }) => ({ ...group, recipients: toRecipients(people) }))
    .sort(
      (a, b) =>
        a.departOn.localeCompare(b.departOn) || a.tourName.localeCompare(b.tourName) || a.tourId.localeCompare(b.tourId),
    )
}

/** 这一天对这个团该发哪种信；不该发 → null。 */
function monthsLeftFor(daysToDeparture: number, day: NzDate, cadence: CountdownCadence): MonthsLeft | null {
  if (daysToDeparture < cadence.stopBeforeDays) return null
  if (weekdayOf(day) !== cadence.batchWeekday) return null
  if (daysToDeparture <= cadence.weeklyWithinDays) return 'weekly'
  const dom = dayOfMonth(day)
  if (dom === null || dom > 7) return null // 每月只有第一个批次日发月信
  const months = Math.round(daysToDeparture / cadence.daysPerMonth)
  return months >= cadence.lastMonth && months <= cadence.firstMonth ? months : null
}

function planDay(groups: readonly TourGroup[], day: NzDate, cadence: CountdownCadence): PlannedLetter[] {
  const letters: PlannedLetter[] = []
  for (const group of groups) {
    const left = daysBetween(day, group.departOn)
    if (left === null) continue
    const monthsLeft = monthsLeftFor(left, day, cadence)
    if (monthsLeft === null) continue
    const letterKey = buildLetterKey({ sendDate: day, tourId: group.tourId, departOn: group.departOn, monthsLeft })
    if (letterKey === null) continue
    letters.push({
      letterKey,
      sendDate: day,
      tourId: group.tourId,
      tourName: group.tourName,
      departOn: group.departOn,
      monthsLeft,
      recipients: group.recipients,
    })
  }
  return letters
}

/** 某一天（新西兰日）：谁该收哪一封信。日期不真实 → 空。 */
export function planCountdownIssue(
  facts: readonly BookingFact[],
  day: NzDate,
  cadence: CountdownCadence = COUNTDOWN_CADENCE,
): PlannedLetter[] {
  if (toDayNumber(day) === null) return []
  return planDay(buildGroups(facts), day, cadence)
}

/** 从 `fromDay`（含）起，直到最后一个团出发前，每个批次日的全部信（按发信日、出发日排好）。 */
export function planCountdownCalendar(
  facts: readonly BookingFact[],
  fromDay: NzDate,
  cadence: CountdownCadence = COUNTDOWN_CADENCE,
): PlannedLetter[] {
  const start = toDayNumber(fromDay)
  if (start === null) return []
  const groups = buildGroups(facts)
  if (groups.length === 0) return []
  const lastDeparture = Math.max(...groups.map((g) => toDayNumber(g.departOn) ?? Number.NEGATIVE_INFINITY))
  const startWeekday = weekdayOf(fromDay)
  if (startWeekday === null) return []
  const letters: PlannedLetter[] = []
  for (let n = start + ((cadence.batchWeekday - startWeekday + 7) % 7); n <= lastDeparture; n += 7) {
    letters.push(...planDay(groups, fromDayNumber(n), cadence))
  }
  return letters
}
