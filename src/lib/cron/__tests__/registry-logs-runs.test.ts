/**
 * CRON_REGISTRY 完整性守卫（2026-09-07）：每条登记的接口都必须调
 * `startCronRun` 写运行记录，即 `logsRuns: true`。
 *
 * 为什么这条测试要存在（背景）：
 *   `logsRuns=false` 的语义是「代码里没接 run-logger，跑没跑查不出来」——
 *   也就是它在 `cron_run_logs` 里永远查不到，`checkCronHealth` 就把它归类为
 *   `blind`。原先这类会以 `cron_blind` 的形式写进 PM 每日待办的「🙋 需要你
 *   动手」栏（`src/lib/pm-todo/manual-items.ts:807-816`），how 字段自己写着
 *   「这条不用你动手 —— 是我们代码里的欠账」—— 但 PM 每天早上照样看得到。
 *   本该是 dev 修的 bug，被硬塞到 PM 的动手栏。
 *
 * 2026-09-07 治理：`cron_blind` 挪进开发车道（现为 `five-kinds.ts` 的 LANE_OF_KIND）
 * （`src/lib/pm-todo/daily-todo.ts`），不再进 PM 动手栏。这条 CI 守卫是双保险：
 * 在源头阻止 `logsRuns: false` 进 registry —— 有人 PR 新登记忘接
 * `startCronRun` 时，CI 立刻红，不用等到明早 PM 收到邮件才发现。
 *
 * 例外条款：如果将来真有一个 cron 因为技术原因无法接 run-logger（比如三方
 * 平台调度且我们只暴露 webhook），必须在 registry 里显式加注释解释原因 + 单独
 * 加白名单条目，别偷懒把 `logsRuns: false` 悄悄摸回来。
 */

import { describe, it, expect } from 'vitest'
import { CRON_REGISTRY } from '@/lib/cron/registry'

describe('CRON_REGISTRY · logs-runs 完整性守卫', () => {
  it('每条登记必须 logsRuns=true —— 否则该任务在监控里就是隐形的', () => {
    const blind = CRON_REGISTRY.filter((e) => !e.logsRuns)
    if (blind.length === 0) {
      expect(blind).toEqual([])
      return
    }
    // 报错时把名字直接列出来，让人一眼看到该去补哪几个 startCronRun 调用
    const names = blind.map((e) => `${e.service} (job=${e.jobName})`).join('\n  - ')
    throw new Error(
      `${blind.length} 条 CRON_REGISTRY 登记没接运行记录，会以 cron_blind 形式\n` +
      `进 dev 欠账栏；请在对应路由里加 startCronRun('${blind[0]?.jobName}') 调用\n` +
      `再把 logsRuns 改成 true。当前 blind 名单：\n  - ${names}\n\n` +
      `例外流程见本测试文件头注。`,
    )
  })

  it('sanity: registry 不为空（防止某天全被误删）', () => {
    expect(CRON_REGISTRY.length).toBeGreaterThan(20)
  })
})
