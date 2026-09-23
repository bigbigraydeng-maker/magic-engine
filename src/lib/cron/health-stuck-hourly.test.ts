/**
 * 卡死判定**对小时级任务结构性失效**这个盲点 —— 2026-09-23 事故的「看不见」那一半。
 *
 * `isStuck` 本身是对的（见 health-stuck.test.ts），坏的是**喂给它哪一行**：
 * 旧版只取「最新一条」运行记录，而每小时任务每小时都会新插一行 `running`，
 * 所以那条永远不满 60 分钟 —— 判定永远不成立。
 *
 * 实测代价（生产库 glbdnayojixmexgofbsd，2026-09-23 查）：
 * `messenger-brief-hourly` 自 2026-09-20 19:11 起每小时留下一行永远停在 `running`
 * 的记录，攒到约 50 行、客户需求卡停产 3 天，而体检报告上 `stuck` 一条都没有。
 *
 * 改法：把视线往回退 60 分钟，只判那条线之前最新的一条。
 * 这份测试锁的就是「视线退没退」—— 变异检验：把 `checkStuckRuns` 里的 cutoff 去掉
 * （改成 `read(e.jobName, null)`），第一个用例必红。
 */

import { describe, expect, it } from 'vitest'
import { checkStuckRuns, type LastOutcome, type OutcomeReader } from './health'

const NOW = new Date('2026-09-23T04:33:00Z')
const ENTRIES = [{ service: 'inngest:cloud-messenger-brief-after-sync', jobName: 'messenger-brief-hourly' }]

/**
 * 假的运行记录读取器：给一串真实运行记录，按 `startedBefore` 返回那之前最新的一条 ——
 * 跟生产那条 `.lt('started_at', …).order(desc).limit(1)` 同样的语义。
 */
function readerOf(rows: LastOutcome[]): OutcomeReader {
  const sorted = [...rows].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  return async (_job, startedBefore) => {
    const cut = startedBefore?.toISOString()
    return sorted.find((r) => !cut || r.startedAt < cut) ?? null
  }
}

const running = (startedAt: string): LastOutcome => ({ status: 'running', error: null, startedAt, finishedAt: null })
const completed = (startedAt: string, finishedAt: string): LastOutcome => ({ status: 'completed', error: null, startedAt, finishedAt })

describe('checkStuckRuns：每小时任务的卡死必须报出来', () => {
  it('🔴 复刻生产：每小时都新插一行 running，旧判据被最新那行挡住 —— 现在必须报卡死', async () => {
    // 04:11 那行刚开跑 22 分钟（完全正常），它前面每一行都永远停在 running。
    const rows = [
      running('2026-09-23T04:11:55Z'),
      running('2026-09-23T03:12:03Z'),
      running('2026-09-23T02:11:54Z'),
      running('2026-09-23T01:12:12Z'),
    ]

    const stuck = await checkStuckRuns(readerOf(rows), NOW, ENTRIES)

    expect(stuck).toHaveLength(1)
    // 判的是 03:12 那行（回退 60 分钟之后最新的一条），不是 04:11 那行
    expect(stuck[0].startedAt).toBe('2026-09-23T03:12:03Z')
    expect(stuck[0].minutesRunning).toBe(81)
    expect(stuck[0].service).toBe('inngest:cloud-messenger-brief-after-sync')
  })

  it('🔴 链路健康时不许误报：最新那行正在正常跑，它前面那行已经跑完了', async () => {
    const rows = [
      running('2026-09-23T04:11:55Z'),
      completed('2026-09-23T03:12:03Z', '2026-09-23T03:15:14Z'),
    ]

    expect(await checkStuckRuns(readerOf(rows), NOW, ENTRIES)).toEqual([])
  })

  it('🔴 只有一行、而且正在正常跑 → 视线之内没有记录，不报（首次上线那一轮不许被当成卡死）', async () => {
    expect(await checkStuckRuns(readerOf([running('2026-09-23T04:11:55Z')]), NOW, ENTRIES)).toEqual([])
  })

  it('修好之后应当自动转绿：视线之内最新那条是 failed（onFailure 把它收口了）', async () => {
    const rows = [
      running('2026-09-23T04:11:55Z'),
      { status: 'failed', error: 'AI 服务账户余额/额度用光了', startedAt: '2026-09-23T03:12:03Z', finishedAt: '2026-09-23T03:14:40Z' },
    ]

    expect(await checkStuckRuns(readerOf(rows), NOW, ENTRIES)).toEqual([])
  })

  it('一行记录都没有的任务不报卡死（那是 never_ran / overdue 的活，不是这道判定的）', async () => {
    expect(await checkStuckRuns(readerOf([]), NOW, ENTRIES)).toEqual([])
  })
})
