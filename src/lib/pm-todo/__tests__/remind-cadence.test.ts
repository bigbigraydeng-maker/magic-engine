/**
 * 提醒节奏：既不能天天刷屏，也不能因为节奏跟调度对不上而**永远不响**。
 *
 * 第二条是这组测试真正在守的东西 —— 它比刷屏难发现得多，
 * 而且这个 PR 的两轮复审里各栽了一次（一次是「每 7 天」，一次是「只回看一天」）。
 */

import { describe, expect, it } from 'vitest'
import { DAILY_REMIND_UNTIL_STREAK, shouldRemindToday, streakPhrase } from '../remind-cadence'

// 2026-09-23 是星期三（UTC）。pm-daily-todo 的调度是 `0 19 * * 0-4` —— 周五周六不跑。
const WED = new Date('2026-09-23T19:00:00Z')
const THU = new Date('2026-09-24T19:00:00Z')
const FRI = new Date('2026-09-25T19:00:00Z') // 不跑
const SUN = new Date('2026-09-27T19:00:00Z') // 跑，且是每周锚点

describe('shouldRemindToday —— 没在坏就别说话', () => {
  it('没有任何记录 → 不提醒', () => {
    expect(shouldRemindToday(0, null, WED)).toBe(false)
    expect(shouldRemindToday(0, 0, WED)).toBe(false)
  })

  it('陈年旧账不许再翻出来说 —— 最近一次已经是 5 天前', () => {
    expect(shouldRemindToday(1, 5, WED)).toBe(false)
  })
})

describe('shouldRemindToday —— 刚坏的必须当天说', () => {
  it('今天断的，头几天每天都提醒', () => {
    for (let s = 1; s <= DAILY_REMIND_UNTIL_STREAK; s++) {
      expect(shouldRemindToday(s, 0, WED), `第 ${s} 天`).toBe(true)
    }
  })

  it('昨天断的、今天已经恢复 —— 照样要说一声', () => {
    // 宁可多说一次「昨天断过」，也不能让一次真实断电悄悄过去
    expect(shouldRemindToday(1, 1, THU)).toBe(true)
  })
})

describe('🔴 回归：周五周六不跑，两种写法都在这里栽过', () => {
  it('坑一：不许用「每 7 天」—— 7 的倍数永远落在同一个星期几', () => {
    // 第 7/14/21/28 天全是同一个星期几。撞上周五（不跑）就**一次都不会再响**。
    // 现在挂在「周日」这个一定会跑的锚点上：周五永远不是提醒日，周日一定是。
    for (const streak of [7, 14, 21, 28]) {
      expect(shouldRemindToday(streak, 0, FRI), `周五 streak=${streak}`).toBe(false)
      expect(shouldRemindToday(streak, 0, SUN), `周日 streak=${streak}`).toBe(true)
    }
  })

  it('坑二：周四晚断了 70 分钟、自己好了 —— 周日跑到时必须还报得出来', () => {
    // 这是 2026-09-20 事故的**原型**：短、自愈、发生在待办不跑的那段空档边上。
    // 首版判据只肯从「今天或昨天」起数，周日跑到时往回一格是周六（没有记录）→ 算 0 → 一个字都不报。
    // 每周约 72 小时的窗口里，这一型断电会永远没人知道 —— 正是这套东西立项要消灭的那件事。
    expect(shouldRemindToday(1, 3, SUN)).toBe(true)
  })

  it('周五断的一次，周日（隔 2 天）也接得住', () => {
    expect(shouldRemindToday(1, 2, SUN)).toBe(true)
  })

  it('但补票只在周日那一轮补 —— 平日不会把 3 天前的事重新翻出来', () => {
    expect(shouldRemindToday(1, 3, WED)).toBe(false)
  })
})

describe('shouldRemindToday —— 长期故障不许天天刷屏', () => {
  it('还在坏、但已经过了头几天 → 平日不说', () => {
    expect(shouldRemindToday(4, 0, WED)).toBe(false)
    expect(shouldRemindToday(60, 0, THU)).toBe(false)
  })

  it('每周在周日说一次', () => {
    expect(shouldRemindToday(4, 0, SUN)).toBe(true)
    expect(shouldRemindToday(505, 0, SUN)).toBe(true)
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
