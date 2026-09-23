/**
 * 「同一件事连着坏了好多天，什么时候再提醒一次」—— 纯函数，可完全单测。
 *
 * WHY 不用「每 7 天提醒一次」
 * -------------------------
 * 🔴 魏征 2026-09-23 复审抓到的坑，而且比他说的更狠：
 *    `pm-daily-todo` 的调度是 `0 19 * * 0-4`（render.yaml:723），**周五周六不跑**。
 *    「第 7 天 / 第 14 天 / 第 21 天」全都是 7 的倍数 —— 它们**永远落在同一个星期几**。
 *    所以只要第 7 天恰好撞上周五，第 14、21、28 天也全是周五，
 *    这条提醒**一次都不会再响**，而不是偶尔漏一次。
 *
 * 改用两段式，两段都不可能被跳过：
 *   1. 连续第 1~3 天：每天都提醒。
 *      为什么要 3 天而不是只有第 1 天 —— 故障如果是周五开始的，那天没人跑待办，
 *      周日跑到时已经是连续第 3 天。只报「第 1 天」的话，**首报会被整段吞掉**。
 *   2. 之后：只在**周日**提醒（UTC 周日在 `0-4` 里，是一定会跑的一天）。
 *      长期故障因此每周最多刷一次屏，而不是天天占几十行。
 */

/** UTC 周日。选它是因为 `0 19 * * 0-4` 一定覆盖它 —— 挑一个不跑的日子等于把提醒扔了。 */
const WEEKLY_ANCHOR_UTC_DAY = 0

/** 头几天每天都报，不然首报会被周五周六那两天的空档整段吞掉。 */
export const DAILY_REMIND_UNTIL_STREAK = 3

/**
 * @param streak 连续出现了几个日历天（0 = 现在没在坏）
 * @param now    用来判今天是不是每周那个锚点日
 */
export function shouldRemindToday(streak: number, now: Date): boolean {
  if (streak <= 0) return false
  if (streak <= DAILY_REMIND_UNTIL_STREAK) return true
  return now.getUTCDay() === WEEKLY_ANCHOR_UTC_DAY
}

/**
 * 说人话的「坏了多久」。**只说天数，不说次数** ——
 * 次数那个数永远偏低（写入带节流、生产多进程），报出去就是骗人
 * （memory: never-report-sampled-estimate-as-a-number）。
 */
export function streakPhrase(streak: number): string {
  if (streak <= 1) return '今天'
  return `已经连续 ${streak} 天`
}
