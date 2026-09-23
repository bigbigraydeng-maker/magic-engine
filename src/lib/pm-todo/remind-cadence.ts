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
 * 周五周六不跑，所以周日那一轮要能往回补几天 —— 不然周四晚/周五发生、
 * 而且**已经自愈**的那种短断电（9/20 就是这一型）会整段掉进空档里没人知道。
 */
const GAP_CATCHUP_DAYS = 3

/**
 * @param streak            连续断了几个日历天（0 = 记录里根本没有）
 * @param daysSinceLatest   最近一次断电距今几天（0 = 今天；null = 没有记录）
 * @param now               用来判今天是不是每周那个锚点日
 *
 * 两个问题必须分开问，缺一个都会漏报：
 *   · **还新鲜吗** —— 决定这件事今天值不值得说（自愈的短断电只有这一维是活的）
 *   · **连续多久** —— 决定要不要天天说（长期故障靠它降噪）
 */
export function shouldRemindToday(
  streak: number,
  daysSinceLatest: number | null,
  now: Date,
): boolean {
  if (streak <= 0 || daysSinceLatest === null) return false
  const isAnchorDay = now.getUTCDay() === WEEKLY_ANCHOR_UTC_DAY

  // 还新鲜吗：正常每天跑的情况看「今天或昨天」；周日那轮额外往回补周五周六
  const fresh = daysSinceLatest <= 1 || (isAnchorDay && daysSinceLatest <= GAP_CATCHUP_DAYS)
  if (!fresh) return false

  if (streak <= DAILY_REMIND_UNTIL_STREAK) return true
  return isAnchorDay
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
