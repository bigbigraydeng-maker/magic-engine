/**
 * `pushInterruptedCronRunItems()` 的测试（2026-09-23）。
 *
 * 背景：9/22 03:01 开跑的 `blog-weekly` 正在逐个客户生成博客草稿，一次上线把机器换掉，
 * 跑到一半的那个容器被杀，CTS Tours NZ 那篇一个字都没生成。运行记录永远停在 `running`。
 *
 * ⚠️ 口径更正：**不是「没有任何告警」**。`health.ts` 的 `stuck` 判据命中了，也进了当天的信
 * （9/22 19:01 实测 `total_items=170`）。问题是那条写的是「N 个自动任务开跑了但一直没结束，
 * 去 Render 看日志」—— 点不出是哪个客户的什么东西丢了。这条待办要解决的是「报得没法用」。
 *
 * 拉模式：直接读 `cron_run_logs`，不经过 health.ts。
 */
import { describe, expect, it, vi } from 'vitest'
import { pushInterruptedCronRunItems, type ManualItem } from '../manual-items'

type Row = Record<string, unknown>
const NOW = new Date('2026-09-23T04:00:00.000Z')
const CUT = { interrupted_by: 'deploy_shutdown', signal: 'SIGTERM' }
/** 事后清扫写的标记 —— 死因不明那一种，同样要出待办。 */
const GONE = { interrupted_by: 'process_gone' }

/**
 * 实测核实（对着 manual-items.ts 源码查过）：两段查询分别是
 *   failed 那段：  select → eq('status','failed') → gte('started_at') → order → range → await（分页到取完）
 *   跑成那段（每个任务各一次）：select → eq('job_name') → eq('status','completed') → gt('started_at') → order → limit(1) → await
 *
 * 假件按真语义执行 eq / gte / gt / order / range / limit，**不按调用次序建模** ——
 * 按次序录的假件只能证明「代码调了这些方法」，证明不了「筛出来的行对了」。
 */
function fakeSupabase(rows: Row[], opts: { failOn?: 'failed' | 'completed' } = {}) {
  return {
    from(table: string) {
      if (table !== 'cron_run_logs') throw new Error(`假件只建模了 cron_run_logs，收到 ${table}`)
      const filters: Array<(r: Row) => boolean> = []
      let wantStatus: string | null = null
      let range: [number, number] | null = null
      let cap: number | null = null
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => {
          if (c === 'status') wantStatus = String(v)
          filters.push((r) => r[c] === v)
          return b
        },
        gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), b),
        gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), b),
        order: () => b,
        range: (from: number, to: number) => ((range = [from, to]), b),
        limit: (n: number) => ((cap = n), b),
        then: (resolve: (v: { data: Row[] | null; error: { message: string } | null }) => unknown) => {
          if (opts.failOn && opts.failOn === wantStatus) {
            return resolve({ data: null, error: { message: '假的读库失败' } })
          }
          // 真库按 started_at 倒序返回
          let hits = rows.filter((r) => filters.every((f) => f(r)))
          hits = [...hits].sort((a, z) => String(z.started_at).localeCompare(String(a.started_at)))
          if (range) hits = hits.slice(range[0], range[1] + 1)
          if (cap !== null) hits = hits.slice(0, cap)
          return resolve({ data: hits, error: null })
        },
      }
      return b
    },
  }
}

function run(job: string, status: string, startedAt: string, summary: Row | null = null): Row {
  return { job_name: job, status, started_at: startedAt, summary }
}

const call = (rows: Row[], items: ManualItem[], opts: { failOn?: 'failed' | 'completed' } = {}, now = NOW) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pushInterruptedCronRunItems(fakeSupabase(rows, opts) as any, items, now)

describe('pushInterruptedCronRunItems', () => {
  it('🔴 被掐断之后一直没跑成：出一条待办，点名是哪个任务', async () => {
    const items: ManualItem[] = []
    await call([run('blog-weekly', 'failed', '2026-09-22T03:01:04.084272+00:00', CUT)], items)

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('cron_interrupted_by_deploy')
    expect(items[0].what).toContain('blog-weekly')        // 点名，不是「1 个任务」
    expect(items[0].what).toContain('补跑要趁下一轮之前')  // 说清补晚了等于没补
    expect(items[0].href).toMatch(/^https:\/\//)
  })

  it('🔴 事后清扫写的「死因不明」也要出待办 —— SIGKILL / OOM 不会留下 SIGTERM 那一手', async () => {
    const items: ManualItem[] = []
    await call([run('blog-weekly', 'failed', '2026-09-22T03:01:04.084272+00:00', GONE)], items)
    expect(items).toHaveLength(1)
  })

  it('🔴 绝不对全部任务说「重复跑是安全的」—— 名单里有会发帖 / 发邮件 / 发成片的', async () => {
    const items: ManualItem[] = []
    await call([run('blog-weekly', 'failed', '2026-09-22T03:01:04.084272+00:00', CUT)], items)
    expect(items[0].how).not.toContain('安全')
    expect(items[0].how).toContain('这条能不能重跑')      // 先问一句，别照着点就发第二遍
  })

  it('🔴 Render 上显示的是**服务名**，任务名跟它经常不一样 —— 照任务名去搜是搜不到的', async () => {
    const items: ManualItem[] = []
    // registry.ts:214 —— jobName `meta-leads-sync` 的服务叫 `meta-leads-hourly`
    await call([run('meta-leads-sync', 'failed', '2026-09-22T13:25:00.000000+00:00', CUT)], items)
    expect(items[0].what).toContain('meta-leads-hourly')
    expect(items[0].what).toContain('meta-leads-sync')     // 两个都给，PM 和日志能对上
  })

  it('🔴 不是 Render 调度的，不许把人支到 Render 去找一个不存在的服务', async () => {
    const items: ManualItem[] = []
    // registry.ts:251 —— goals-expiry-check 由 GitHub Actions 调度
    await call([run('goals-expiry-check', 'failed', '2026-09-22T03:30:00.000000+00:00', CUT)], items)
    expect(items).toHaveLength(1)
    expect(items[0].href).toContain('github.com')
    expect(items[0].href).not.toBe('https://dashboard.render.com')
  })

  it('🔴 两种调度方混在一起：拆成两条，各给各的指引', async () => {
    const items: ManualItem[] = []
    await call(
      [
        run('blog-weekly', 'failed', '2026-09-22T03:01:04.084272+00:00', CUT),
        run('goals-expiry-check', 'failed', '2026-09-22T03:30:00.000000+00:00', CUT),
      ],
      items,
    )
    expect(items).toHaveLength(2)
    expect(new Set(items.map((i) => i.href)).size).toBe(2)
  })

  it('🔴 被掐断之后又跑成了：不再提', async () => {
    const items: ManualItem[] = []
    await call(
      [
        run('blog-weekly', 'failed', '2026-09-22T03:01:04.084272+00:00', CUT),
        run('blog-weekly', 'completed', '2026-09-22T09:00:00.000000+00:00'),
      ],
      items,
    )
    expect(items).toHaveLength(0)
  })

  it('🔴 补跑发生在被掐断之前的，不算补上', async () => {
    const items: ManualItem[] = []
    await call(
      [
        run('blog-weekly', 'failed', '2026-09-22T03:01:04.084272+00:00', CUT),
        run('blog-weekly', 'completed', '2026-09-15T03:01:00.349000+00:00'),
      ],
      items,
    )
    expect(items).toHaveLength(1)
  })

  it('🔴 「后来有没有跑成」必须按任务各查一次 —— 高频任务一周就能自己撑爆一次查询的行数上限', async () => {
    const items: ManualItem[] = []
    const noise: Row[] = []
    // 每 10 分钟一轮的任务，一周 1008 行。掺在前面，挤掉真正要找的那一行。
    for (let i = 0; i < 1200; i++) {
      noise.push(run('viral-analyzer-worker', 'completed', `2026-09-${10 + (i % 12)}T00:${String(i % 60).padStart(2, '0')}:00.000000+00:00`))
    }
    await call(
      [
        ...noise,
        run('blog-weekly', 'failed', '2026-09-22T03:01:04.084272+00:00', CUT),
        run('blog-weekly', 'completed', '2026-09-22T09:00:00.000000+00:00'),
      ],
      items,
    )
    expect(items).toHaveLength(0)  // 补上了就该消失，不该被别的任务的行数挤得看不见
  })

  it('🔴 failed 那段超过一页也要扫完 —— 截断在这里的表现就是告警消失', async () => {
    const items: ManualItem[] = []
    const noise: Row[] = []
    for (let i = 0; i < 700; i++) {
      noise.push(run(`noisy-job-${i}`, 'failed', `2026-09-23T0${i % 10}:00:00.000000+00:00`, { error: '普通失败' }))
    }
    // 被掐断那行时间最早，排在最后一页
    await call([...noise, run('blog-weekly', 'failed', '2026-09-18T03:01:04.084272+00:00', CUT)], items)
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('blog-weekly')
  })

  it('普通业务失败（没有掐断标记）不归这条管 —— 那是「去看日志」，不是「补跑一次」', async () => {
    const items: ManualItem[] = []
    await call([run('attribution-cron', 'failed', '2026-09-22T12:01:07.438983+00:00', { error: 'DataForSEO 超时' })], items)
    expect(items).toHaveLength(0)
  })

  it('🔴 14 天窗口：周更任务的周期正好 7 天，7 天的窗口会让出事那轮在下一轮之前就掉出去', async () => {
    const items: ManualItem[] = []
    // 10 天前 —— 7 天窗口会漏掉，14 天窗口接得住
    await call([run('blog-weekly', 'failed', '2026-09-13T03:01:04.084272+00:00', CUT)], items)
    expect(items).toHaveLength(1)
    // 20 天前 —— 两个窗口都不该再提
    const old: ManualItem[] = []
    await call([run('blog-weekly', 'failed', '2026-09-03T03:01:04.084272+00:00', CUT)], old)
    expect(old).toHaveLength(0)
  })

  it('🔴 读库失败必须喊出来，不许静默返空 —— 静默返空在这里就是「告警消失」', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const items: ManualItem[] = []
    await call([run('blog-weekly', 'failed', '2026-09-22T03:01:04.084272+00:00', CUT)], items, { failOn: 'failed' })
    expect(items).toHaveLength(0)
    expect(spy).toHaveBeenCalled()
    expect(spy.mock.calls.map((c) => c.map(String).join(' ')).join('\n')).toContain('cron_run_logs')
    spy.mockRestore()
  })

  it('🔴 查「后来跑成没有」失败时，当成没补上照样出待办 —— 宁可多提一次，不能漏', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const items: ManualItem[] = []
    await call(
      [
        run('blog-weekly', 'failed', '2026-09-22T03:01:04.084272+00:00', CUT),
        run('blog-weekly', 'completed', '2026-09-22T09:00:00.000000+00:00'),
      ],
      items,
      { failOn: 'completed' },
    )
    expect(items).toHaveLength(1)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
