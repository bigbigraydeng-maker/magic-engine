/**
 * `pushInterruptedCronRunItems()` 的测试（2026-09-23）。
 *
 * 背景：9/22 03:01 开跑的 `blog-weekly` 正在逐个客户生成博客草稿，一次上线把机器换掉，
 * 跑到一半的那个容器被杀，CTS Tours NZ 那篇一个字都没生成。`finish()` 没机会执行，
 * 运行记录永远停在 `running` —— 既不报错也不逾期，健康检查两边都接不住。
 *
 * 现在 SIGTERM 会把这一行收成 `failed` 并打上 `interrupted_by` 标记。但 `failed`
 * 目前**没有接进今日待办**（`health.ts` 的 `r.failing` 只到 /dashboard/workflows-health
 * 页面为止），所以必须由这条自己把话说出来 —— 否则这次修复反而会把唯一那条告警弄没。
 *
 * 拉模式：直接读 `cron_run_logs`，不经过 health.ts。
 */
import { describe, expect, it } from 'vitest'
import { pushInterruptedCronRunItems, type ManualItem } from '../manual-items'

type Row = Record<string, unknown>
const NOW = new Date('2026-09-23T04:00:00.000Z')
const CUT = { interrupted_by: 'deploy_shutdown', signal: 'SIGTERM' }

/**
 * 实测核实（对着 manual-items.ts 源码查过）：两段查询分别是
 *   failed 那段：  select → eq('status','failed') → gte('started_at') → order → limit → await
 *   completed 那段：select → in('job_name') → eq('status','completed') → gte → limit → await
 * 假件把 eq / gte / in 按真语义执行，不按调用次序建模。
 */
function fakeSupabase(rows: Row[]) {
  return {
    from(table: string) {
      if (table !== 'cron_run_logs') throw new Error(`假件只建模了 cron_run_logs，收到 ${table}`)
      const filters: Array<(r: Row) => boolean> = []
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
        gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), b),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), b),
        order: () => b,
        limit: () => b,
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
          resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null }),
      }
      return b
    },
  }
}

function run(job: string, status: string, startedAt: string, summary: Row | null = null): Row {
  return { job_name: job, status, started_at: startedAt, summary }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (rows: Row[], items: ManualItem[], now = NOW) =>
  pushInterruptedCronRunItems(fakeSupabase(rows) as any, items, now)

describe('pushInterruptedCronRunItems', () => {
  it('🔴 被掐断之后一直没跑成：出一条待办，点名是哪个任务', async () => {
    const items: ManualItem[] = []
    await call([run('blog-weekly', 'failed', '2026-09-22T03:01:04.084Z', CUT)], items)

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('cron_interrupted_by_deploy')
    expect(items[0].what).toContain('blog-weekly')        // 点名，不是「1 个任务」
    expect(items[0].what).toContain('换机器')              // 原因已知，别让人去查
    expect(items[0].how).toContain('Trigger Run')          // 具体点哪里
    expect(items[0].href).toMatch(/^https:\/\//)           // 直达链接
  })

  it('🔴 被掐断之后又跑成了：不再提 —— 周更下一轮在一周后，只能按「后来跑成没有」判，不能按日期过期', async () => {
    const items: ManualItem[] = []
    await call(
      [
        run('blog-weekly', 'failed', '2026-09-22T03:01:04.084Z', CUT),
        run('blog-weekly', 'completed', '2026-09-22T09:00:00.000Z'),
      ],
      items,
    )
    expect(items).toHaveLength(0)
  })

  it('🔴 补跑发生在被掐断之前的，不算补上', async () => {
    const items: ManualItem[] = []
    await call(
      [
        run('blog-weekly', 'failed', '2026-09-22T03:01:04.084Z', CUT),
        run('blog-weekly', 'completed', '2026-09-15T03:01:00.349Z'),
      ],
      items,
    )
    expect(items).toHaveLength(1)
  })

  it('普通业务失败（没有掐断标记）不归这条管 —— 那是「去看日志」，不是「补跑一次」', async () => {
    const items: ManualItem[] = []
    await call([run('attribution-cron', 'failed', '2026-09-22T12:01:07.438Z', { error: 'DataForSEO 超时' })], items)
    expect(items).toHaveLength(0)
  })

  it('7 天以前的不再提 —— 那时候补跑已经没有意义，只会刷屏', async () => {
    const items: ManualItem[] = []
    await call([run('blog-weekly', 'failed', '2026-09-01T03:01:04.084Z', CUT)], items)
    expect(items).toHaveLength(0)
  })

  it('多个任务被掐断：合成一条，别把待办刷屏', async () => {
    const items: ManualItem[] = []
    await call(
      [
        run('blog-weekly', 'failed', '2026-09-22T03:01:04.084Z', CUT),
        run('industry-ai-visibility-daily', 'failed', '2026-09-21T16:30:47.725Z', CUT),
      ],
      items,
    )
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('blog-weekly')
    expect(items[0].what).toContain('industry-ai-visibility-daily')
  })
})
