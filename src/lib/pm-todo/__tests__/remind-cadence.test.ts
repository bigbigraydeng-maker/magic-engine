/**
 * 提醒节奏：既不能天天刷屏，也不能因为节奏跟调度对不上而**永远不响**。
 *
 * 第二条是这组测试真正在守的东西 —— 它比刷屏难发现得多。
 */

import { describe, expect, it } from 'vitest'
import { DAILY_REMIND_UNTIL_STREAK, shouldRemindToday, streakPhrase } from '../remind-cadence'

/** 2026-09-23 是星期三（UTC）。往后推几天就能拿到任意星期几。 */
const WED = new Date('2026-09-23T19:00:00Z')
const day = (offset: number) => new Date(WED.getTime() + offset * 86_400_000)
const SUN = day(4) // 2026-09-27，UTC 星期日
const FRI = day(2) // 2026-09-25，UTC 星期五

describe('shouldRemindToday', () => {
  it('没在坏就不提醒', () => {
    expect(shouldRemindToday(0, WED)).toBe(false)
    expect(shouldRemindToday(-1, WED)).toBe(false)
  })

  it('刚坏的头几天每天都提醒 —— 首报绝不能被吞掉', () => {
    for (let s = 1; s <= DAILY_REMIND_UNTIL_STREAK; s++) {
      expect(shouldRemindToday(s, WED), `第 ${s} 天`).toBe(true)
    }
  })

  it('🔴 故障从周五开始（那天待办不跑），周日跑到时已经是第 3 天 —— 必须还报得出来', () => {
    // pm-daily-todo 的调度是 `0 19 * * 0-4`，周五周六不跑。
    // 只报「第 1 天」的话，凡是周五开始的故障首报会被整段吞掉。
    expect(shouldRemindToday(3, SUN)).toBe(true)
  })

  it('过了头几天就不再天天刷屏', () => {
    expect(shouldRemindToday(4, WED)).toBe(false)
    expect(shouldRemindToday(5, FRI)).toBe(false)
    expect(shouldRemindToday(60, WED)).toBe(false)
  })

  it('长期故障每周在周日提醒一次', () => {
    expect(shouldRemindToday(4, SUN)).toBe(true)
    expect(shouldRemindToday(505, SUN)).toBe(true)
  })

  it('🔴 回归：不许用「每 7 天」—— 7 的倍数永远落在同一个星期几，撞上不跑的日子就永远不响', () => {
    // 这正是原方案的坑：第 7/14/21/28 天全是同一个星期几。
    // 如果那天恰好是周五（待办不跑），这条提醒一次都不会再响。
    // 现在的判据挂在「周日」这个**一定会跑**的锚点上，所以周五永远不是提醒日，
    // 而周日无论 streak 是 7、14 还是 3000 都会提醒。
    for (const streak of [7, 14, 21, 28]) {
      expect(shouldRemindToday(streak, FRI), `周五 streak=${streak}`).toBe(false)
      expect(shouldRemindToday(streak, SUN), `周日 streak=${streak}`).toBe(true)
    }
  })
})

describe('streakPhrase', () => {
  it('第一天说「今天」，之后说连续几天', () => {
    expect(streakPhrase(1)).toBe('今天')
    expect(streakPhrase(3)).toBe('已经连续 3 天')
  })

  it('🔴 只说天数，绝不说次数 —— 次数那个数永远是偏低的（写入带节流 + 多进程）', () => {
    expect(streakPhrase(5)).not.toMatch(/次/)
  })
})
