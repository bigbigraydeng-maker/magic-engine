/**
 * 「跑到一半卡死」的判据 —— failing 和 overdue 之间那道缝。
 *
 * 两边都接不住它：`failing` 只认 `status='failed'`（路由自己的 catch 写的），
 * 可容器被杀时那行 catch 根本没机会执行，状态就永远停在 `running`；
 * `overdue` 看 `started_at`，而卡死的任务**开跑记录是有的**，所以也不算逾期。
 * 结果：跑死的任务在体检报告里等于健康。
 *
 * 真实规模（2026-09-06 查生产，60 天窗口）：9 个任务共 30 条卡死行 ——
 * messenger-brief-hourly 一家 15 条，attribution-cron 2026-09-02 18:00 那轮卡了 4 天。
 */

import { describe, expect, it } from 'vitest'
import { isStuck } from './health'

const NOW = new Date('2026-09-06T18:00:00Z')

describe('isStuck', () => {
  it('还挂着 running、没结束时间、开跑超过一小时 → 卡死', () => {
    // 复刻 attribution-cron 2026-09-02 18:00 那一轮
    expect(isStuck(
      { status: 'running', finishedAt: null, startedAt: '2026-09-02T18:00:53Z' },
      NOW,
    )).toBe(true)
  })

  it('🔴 正在正常跑的那一次不许报成卡死 —— 体检本身常常就在某个任务的执行窗口里跑', () => {
    expect(isStuck(
      { status: 'running', finishedAt: null, startedAt: '2026-09-06T17:58:00Z' },
      NOW,
    )).toBe(false)
  })

  it('跑完的一律不算，无论成败', () => {
    for (const st of ['completed', 'failed']) {
      expect(isStuck(
        { status: st, finishedAt: '2026-09-06T12:05:00Z', startedAt: '2026-09-06T12:00:00Z' },
        NOW,
      ), st).toBe(false)
    }
  })

  it('有结束时间就不算卡死，哪怕状态还写着 running（状态与时间打架时以时间为准）', () => {
    expect(isStuck(
      { status: 'running', finishedAt: '2026-09-02T18:05:00Z', startedAt: '2026-09-02T18:00:00Z' },
      NOW,
    )).toBe(false)
  })

  it('开跑时间读不出来时不猜 —— 宁可不报，也不制造误报', () => {
    expect(isStuck(
      { status: 'running', finishedAt: null, startedAt: 'not-a-date' },
      NOW,
    )).toBe(false)
  })

  it('阈值边界：59 分钟不报，61 分钟报', () => {
    const mk = (min: number) =>
      ({ status: 'running', finishedAt: null, startedAt: new Date(NOW.getTime() - min * 60000).toISOString() })
    expect(isStuck(mk(59), NOW)).toBe(false)
    expect(isStuck(mk(61), NOW)).toBe(true)
  })
})
