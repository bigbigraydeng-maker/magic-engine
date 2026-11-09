/**
 * 倒计时信的节奏参数（只有数字，没有逻辑）。单独放一个文件，是为了让页面这边只要显示「几个月」之类的字样时，
 * 不必把整个批次计划函数（plan.ts）打进浏览器。
 *
 * 层级：旅游版（按出发日倒计时）的行业层默认值；某个客户节奏不同，走客户配置传给 planCountdownIssue，不改这里。
 */

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
