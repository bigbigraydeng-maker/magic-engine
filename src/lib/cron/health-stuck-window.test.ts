/**
 * 卡死判据从「只看最后一条」改成「看 48 小时窗口」之后，必须同时守住两件事：
 *
 *   1. 后一轮成功**不能**再把前一轮的卡死掩埋掉
 *      （attribution-cron 2026-09-22 卡死两轮，18:00 那轮成功，19:01 体检只看见成功）
 *   2. 报出去的数字**不能骗人**
 *      —— 一个任务 4 条孤儿行是「1 个任务卡了 4 轮」，不是「4 个任务卡死」
 */

import { describe, expect, it } from 'vitest'
import { collapseStuckRuns, type StuckRunRow } from './health'

const NOW = new Date('2026-09-23T19:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

const running = (startedAt: string): StuckRunRow => ({ status: 'running', startedAt, finishedAt: null })

describe('collapseStuckRuns', () => {
  it('窗口里一条卡死都没有 → null', () => {
    expect(collapseStuckRuns('attribution-cron', [], NOW)).toBeNull()
  })

  it('🔴 一个任务的多条孤儿行压成一条，rounds 说清卡了几轮（不许报成「4 个任务」）', () => {
    const out = collapseStuckRuns(
      'attribution-cron',
      [running(hoursAgo(20)), running(hoursAgo(14)), running(hoursAgo(8)), running(hoursAgo(3))],
      NOW,
    )
    expect(out).not.toBeNull()
    expect(out?.rounds).toBe(4)
    // 取最早那轮 —— 卡最久的那轮最值得看
    expect(out?.startedAt).toBe(hoursAgo(20))
    expect(out?.minutesRunning).toBe(20 * 60)
  })

  it('🔴 后一轮成功不再掩埋前一轮的卡死 —— 这正是「只看最后一条」的盲点', () => {
    // 复刻 attribution-cron 2026-09-22：卡死两轮之后 18:00 那轮成功了。
    // 查询本身只捞 running+未结束的行，所以成功那轮压根不在输入里 ——
    // 关键是它**不再有能力**把前面两条盖掉。
    const out = collapseStuckRuns('attribution-cron', [running(hoursAgo(25)), running(hoursAgo(24))], NOW)
    expect(out?.rounds).toBe(2)
  })

  it('🔴 正在正常跑的那一次不许报成卡死 —— 体检常常就在某个任务的执行窗口里跑', () => {
    expect(collapseStuckRuns('messenger-sync-hourly', [running(hoursAgo(0.5))], NOW)).toBeNull()
  })

  it('正在跑的那一次混在几条真卡死里时，只数真卡死的', () => {
    const out = collapseStuckRuns(
      'messenger-sync-hourly',
      [running(hoursAgo(10)), running(hoursAgo(5)), running(hoursAgo(0.2))],
      NOW,
    )
    expect(out?.rounds).toBe(2)
  })

  it('已经结束的行不算，哪怕状态还写着 running（状态跟时间打架时以时间为准）', () => {
    const rows: StuckRunRow[] = [
      { status: 'running', startedAt: hoursAgo(10), finishedAt: hoursAgo(9) },
    ]
    expect(collapseStuckRuns('blog-weekly', rows, NOW)).toBeNull()
  })

  it('开跑时间读不出来时不猜 —— 宁可不报，也不制造误报', () => {
    expect(collapseStuckRuns('blog-weekly', [running('not-a-date')], NOW)).toBeNull()
  })

  it('只卡了一轮时不画蛇添足地说「卡了 1 轮」的场面话 —— rounds 就是 1，文案层自己判', () => {
    const out = collapseStuckRuns('attribution-cron', [running(hoursAgo(5))], NOW)
    expect(out?.rounds).toBe(1)
  })
})
