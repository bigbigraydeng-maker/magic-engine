/**
 * cron_run_logs 写失败必须喊出来（#1428 的下一层问题），且不能靠「插不进去就再插一条」
 * 来兜底（#1434 review round 1 的下一层问题）。
 *
 * 背景一：首版 `startCronRun` 只取 `data` 不取 `error`。insert 一失败 runId 就是 null，
 * `finish()` 里 `if (!runId) return` 直接什么都不干 —— 任务照常跑完、HTTP 200，
 * 但 cron_run_logs 里一行都没有，健康检查反过来把它判成「从来没跑过」。
 * 生产实测：goals-expiry-check 在 GitHub Actions 里天天 success，运行记录却大面积缺失。
 *
 * 背景二：修完背景一之后，`finish()` 靠「runId 是不是 null」决定补插一条新记录 ——
 * 但 insert 报错既可能是真没插进去，也可能是插成功了、响应在回来的路上丢了。
 * 后一种情况下补插会跟第一次真正落库的那行**各自独立**，`started_at` 更早的孤儿行
 * 永远停在 running，一小时后被健康检查误报成卡死。现在改成 id 本地先生成、
 * 开跑收尾自始至终用同一个 id upsert，两种真实结果都收敛成一行。
 *
 * 假 Supabase 按**表**建模（含 job_name NOT NULL 与 status CHECK 两条真约束），
 * 不按调用次序建模 —— 按次序录制的假客户端只能证明「代码调了这些方法」，
 * 证明不了「写进去的行长对了」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
interface PgError { message: string; code?: string; details?: string | null; hint?: string | null }

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  failInsert: null as PgError | null,
  failUpdate: null as PgError | null,
  failUpsert: null as PgError | null,
  insertAttempts: 0,
  updateAttempts: 0,
  upsertAttempts: 0,
  seq: 0,
}))

vi.mock('@/lib/supabase', () => {
  const STATUSES = ['running', 'completed', 'failed']

  function from(table: string) {
    if (table !== 'cron_run_logs') throw new Error(`假件只建模了 cron_run_logs，收到 ${table}`)
    let mode: 'select' | 'insert' | 'update' | 'upsert' = 'select'
    let payload: Row = {}
    const eqs: Array<[string, unknown]> = []
    const ltes: Array<[string, string]> = []
    const lts: Array<[string, string]> = []
    const ins: Array<[string, unknown[]]> = []
    const iss: Array<[string, unknown]> = []
    const hits = () =>
      state.rows.filter(
        (r) =>
          eqs.every(([c, v]) => r[c] === v) &&
          ltes.every(([c, v]) => String(r[c] ?? '') <= v) &&
          lts.every(([c, v]) => String(r[c] ?? '') < v) &&
          ins.every(([c, v]) => v.includes(r[c])) &&
          iss.every(([c, v]) => (r[c] ?? null) === v),
      )
    // 真表上的两条约束 —— 少写 job_name 或写错 status，库里是会拒的。insert 和 upsert 都要过这一关。
    function checkConstraints(row: Row): PgError | null {
      if (!row.job_name) return { message: 'null value in column "job_name"', code: '23502' }
      if (!STATUSES.includes(String(row.status))) {
        return { message: 'violates check constraint "cron_run_logs_status_check"', code: '23514' }
      }
      return null
    }

    function run(): { data: Row[] | null; error: PgError | null } {
      if (mode === 'insert') {
        state.insertAttempts++
        if (state.failInsert) return { data: null, error: state.failInsert }
        // 默认值照 20260606000011_cron_run_logs.sql 的建表 DDL。
        const row: Row = {
          id: `run-${++state.seq}`,
          status: 'running',
          started_at: '2026-01-01T00:00:00.000Z',
          finished_at: null,
          duration_ms: null,
          processed: 0,
          completed_count: 0,
          failed_count: 0,
          summary: null,
          error_message: null,
          ...payload,
        }
        const constraintError = checkConstraints(row)
        if (constraintError) return { data: null, error: constraintError }
        state.rows.push(row)
        return { data: [{ ...row }], error: null }
      }

      if (mode === 'update') {
        state.updateAttempts++
        if (state.failUpdate) return { data: null, error: state.failUpdate }
        const found = hits()
        for (const r of found) Object.assign(r, payload)
        return { data: found.map((r) => ({ ...r })), error: null }
      }

      if (mode === 'upsert') {
        state.upsertAttempts++
        if (state.failUpsert) return { data: null, error: state.failUpsert }
        const constraintError = checkConstraints(payload)
        if (constraintError) return { data: null, error: constraintError }
        const existing = state.rows.find((r) => r.id === payload.id)
        if (existing) {
          Object.assign(existing, payload)
          return { data: [{ ...existing }], error: null }
        }
        state.rows.push({ ...payload })
        return { data: [{ ...payload }], error: null }
      }

      return { data: hits().map((r) => ({ ...r })), error: null }
    }

    const builder: Record<string, unknown> = {
      select() { return builder },
      insert(p: Row) { mode = 'insert'; payload = p; return builder },
      update(p: Row) { mode = 'update'; payload = p; return builder },
      upsert(p: Row, _opts?: { onConflict?: string }) { mode = 'upsert'; payload = p; return builder },
      eq(col: string, val: unknown) { eqs.push([col, val]); return builder },
      lte(col: string, val: string) { ltes.push([col, val]); return builder },
      lt(col: string, val: string) { lts.push([col, val]); return builder },
      in(col: string, vals: unknown[]) { ins.push([col, vals]); return builder },
      is(col: string, val: unknown) { iss.push([col, val]); return builder },
      single() { const { data, error } = run(); return Promise.resolve({ data: data?.[0] ?? null, error }) },
      then(resolve: (r: { data: Row[] | null; error: PgError | null }) => void) { resolve(run()) },
    }
    return builder
  }

  return { supabaseAdmin: { from } }
})

const {
  startCronRun,
  startCronRunId,
  cronRunHandle,
  failOpenCronRuns,
  closeInFlightCronRuns,
  reapAbandonedCronRuns,
  ABANDONED_AFTER_MS,
  INTERRUPTED_BY_PROCESS_GONE,
  __resetInFlightForTests,
  INTERRUPTED_BY_KEY,
  INTERRUPTED_BY_DEPLOY,
} = await import('../run-logger')

/** 把这次测试里 console.error 说过的所有话拼成一段，方便断言「喊了什么」。 */
function said(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
}

beforeEach(() => {
  state.rows = []
  state.failInsert = null
  state.failUpdate = null
  state.failUpsert = null
  state.insertAttempts = 0
  state.updateAttempts = 0
  state.upsertAttempts = 0
  state.seq = 0
  __resetInFlightForTests()
  vi.restoreAllMocks()
})

describe('startCronRun', () => {
  it('一切正常：一行记录从 running 变成 completed，并且一声不吭', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const run = await startCronRun('demo-job')
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0].job_name).toBe('demo-job')       // 锚点：假件确实被打中了
    expect(state.rows[0].status).toBe('running')

    await run.finish({ processed: 3, completed: 2, failed: 1 })

    expect(state.rows).toHaveLength(1)                     // 收尾是 update，不是再插一行
    expect(state.rows[0].status).toBe('completed')
    expect(state.rows[0].processed).toBe(3)
    expect(state.rows[0].completed_count).toBe(2)
    expect(state.rows[0].failed_count).toBe(1)
    expect(state.rows[0].finished_at).toEqual(expect.any(String))
    expect(spy).not.toHaveBeenCalled()                     // 顺路的时候不许刷屏
  })

  it('任务自己失败：记录落成 failed 并带上原因', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const run = await startCronRun('demo-job')
    await run.finish({ failed: 1, error: 'DataForSEO 超时' })
    expect(state.rows[0].status).toBe('failed')
    expect(state.rows[0].error_message).toBe('DataForSEO 超时')
  })

  it('🔴 开跑记录写不进去：必须喊出来，不许静默返回', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.failInsert = { message: 'permission denied for table cron_run_logs', code: '42501' }

    await startCronRun('goals-expiry-check')

    expect(state.insertAttempts).toBe(1)                   // 锚点：真去写了，不是压根没调
    expect(spy).toHaveBeenCalled()
    const text = said(spy)
    expect(text).toContain('goals-expiry-check')           // 哪个任务
    expect(text).toContain('permission denied for table cron_run_logs') // 错在哪
    expect(text).toContain('42501')
  })

  it('🔴 开跑记录写不进去：finish() 必须用同一个 id 把终态记录落地，发现不许只死在日志里', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    state.failInsert = { message: 'timeout', code: '57014' }

    const run = await startCronRun('goals-expiry-check')
    expect(state.rows).toHaveLength(0)

    await run.finish({ processed: 7, completed: 7 })

    expect(state.rows).toHaveLength(1)
    expect(state.rows[0].job_name).toBe('goals-expiry-check')
    expect(state.rows[0].status).toBe('completed')         // 不是永远停在 running
    expect(state.rows[0].processed).toBe(7)
    expect(state.rows[0].started_at).toEqual(expect.any(String))
    expect(state.rows[0].finished_at).toEqual(expect.any(String))
  })

  it('开跑和收尾都插不进去：再喊一次，并且绝不把正在跑的任务弄挂', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.failInsert = { message: 'permission denied for table cron_run_logs', code: '42501' }
    state.failUpsert = { message: 'permission denied for table cron_run_logs', code: '42501' }

    const run = await startCronRun('goals-expiry-check')
    await expect(run.finish({ processed: 1 })).resolves.toBeUndefined()

    expect(state.insertAttempts).toBe(1)                   // 开跑一次
    expect(state.upsertAttempts).toBe(1)                   // 收尾一次
    expect(state.rows).toHaveLength(0)
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(said(spy)).toContain('彻底没有痕迹')
  })

  it('🔴 收尾写不进去：必须喊，并点明这行可能停在 running', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const run = await startCronRun('demo-job')
    state.failUpsert = { message: 'could not serialize access due to concurrent update', code: '40001' }
    await run.finish({ processed: 5 })

    expect(state.upsertAttempts).toBe(1)                   // 锚点：真去写了
    expect(state.rows[0].status).toBe('running')           // 库里确实没被改动
    const text = said(spy)
    expect(text).toContain('demo-job')
    expect(text).toContain('running')
    expect(text).toContain('could not serialize access due to concurrent update')
  })
})

describe('cronRunHandle（工作流跨步骤用的那条路）', () => {
  it('🔴 开跑那步真的没写成：收尾一样要把终态记录落地，不能因为走的是 Inngest 就漏掉', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    state.failInsert = { message: 'timeout', code: '57014' }

    // 模拟工作流里「一个步骤开记录拿 id，另一个步骤按 id 收尾」
    const runId = await startCronRunId('flywheel-seo-weekly')
    expect(runId).toEqual(expect.any(String))     // id 本地生成，插没插成都拿得到
    expect(state.insertAttempts).toBe(1)          // 锚点：真去写了
    expect(state.rows).toHaveLength(0)             // 而且这次是真没插进去

    await cronRunHandle('flywheel-seo-weekly', runId, Date.now()).finish({ processed: 2 })

    expect(state.rows).toHaveLength(1)
    expect(state.rows[0].id).toBe(runId)           // 落地用的是开跑时那个 id
    expect(state.rows[0].job_name).toBe('flywheel-seo-weekly')
    expect(state.rows[0].status).toBe('completed')
    expect(state.rows[0].processed).toBe(2)
  })

  it('🔴 开跑那步其实提交成功、只是响应丢了：收尾用同一个 id upsert，不会多出一条孤儿记录', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    state.failInsert = { message: 'ECONNRESET', code: 'network' }

    const runId = await startCronRunId('flywheel-seo-weekly')
    expect(state.rows).toHaveLength(0)             // 假件里这次 insert 判定为失败……

    // ……但真实场景里，插入很可能已经在数据库提交、只是响应在回来的路上丢了。
    // 手工把「本该在」的那一行放回假库，且 started_at 比收尾晚发生的 startedAtIso 更早，
    // 复刻生产上「health.ts 按 started_at DESC 挑中孤儿行」的排序关系。
    state.rows.push({
      id: runId,
      job_name: 'flywheel-seo-weekly',
      status: 'running',
      started_at: '2020-01-01T00:00:00.000Z',
      finished_at: null,
      duration_ms: null,
      processed: 0,
      completed_count: 0,
      failed_count: 0,
      summary: null,
      error_message: null,
    })

    await cronRunHandle('flywheel-seo-weekly', runId, Date.now()).finish({ processed: 9 })

    expect(state.rows).toHaveLength(1)             // 没有变成两行 —— 不会再留孤儿记录
    expect(state.rows[0].id).toBe(runId)
    expect(state.rows[0].status).toBe('completed') // 那条「已提交」的行被收敛成了终态
    expect(state.rows[0].processed).toBe(9)
  })

  it('开跑那步写成了：收尾走 upsert 收敛到同一行，不会多插一行', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const runId = await startCronRunId('flywheel-seo-weekly')
    expect(runId).toEqual(expect.any(String))
    expect(state.rows).toHaveLength(1)

    await cronRunHandle('flywheel-seo-weekly', runId, Date.now()).finish({ processed: 4 })

    expect(state.rows).toHaveLength(1)
    expect(state.rows[0].status).toBe('completed')
    expect(state.rows[0].processed).toBe(4)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('failOpenCronRuns（Inngest onFailure 收口）', () => {
  const T0 = '2026-09-22T18:00:00.000Z'
  const T1 = '2026-09-22T18:30:00.000Z'
  function running(id: string, startedAt: string, job = 'conversion-daily-pipeline'): Row {
    return { id, job_name: job, status: 'running', started_at: startedAt, finished_at: null, error_message: null }
  }

  it('只把「同名 + 还在跑 + 在失败事件之前开跑」的行写成 failed，带上错误信息', async () => {
    state.rows.push(
      running('a', T0),
      running('b', '2026-09-22T19:00:00.000Z'), // 失败事件之后才开跑（人点了 Replay）——不能误伤
      running('c', T0, 'other-job'), // 别的任务——不碰
      { ...running('d', T0), status: 'completed' }, // 已经收尾的——不碰
    )
    const closed = await failOpenCronRuns('conversion-daily-pipeline', '步骤被强杀', { startedBefore: new Date(T1) })
    expect(closed).toBe(1)
    const a = state.rows.find((r) => r.id === 'a')!
    expect(a.status).toBe('failed')
    expect(a.finished_at).toBeTruthy()
    expect(a.error_message).toBe('步骤被强杀')
    expect(state.rows.find((r) => r.id === 'b')!.status).toBe('running')
    expect(state.rows.find((r) => r.id === 'c')!.status).toBe('running')
    expect(state.rows.find((r) => r.id === 'd')!.status).toBe('completed')
    expect(state.rows).toHaveLength(4) // 没有另插兜底行
  })

  it('一行 running 都没有（log-start 自己就被掐死）→ 仍然落一条 failed，不能没痕迹', async () => {
    const closed = await failOpenCronRuns('conversion-daily-pipeline', '开跑那步就超时', { startedBefore: new Date(T1) })
    expect(closed).toBe(0)
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0]).toMatchObject({ job_name: 'conversion-daily-pipeline', status: 'failed', error_message: '开跑那步就超时' })
  })

  it('写失败不抛、要喊出来', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.rows.push(running('a', T0))
    state.failUpdate = { message: '模拟断网' }
    const closed = await failOpenCronRuns('conversion-daily-pipeline', 'x', { startedBefore: new Date(T1) })
    expect(closed).toBe(0)
    expect(said(spy)).toContain('模拟断网')
  })
})

/**
 * 部署换机把在途请求杀掉这一类死法（2026-09-23 CTS 周更博客草稿丢失）。
 *
 * 实测现场：`blog-weekly` 9/22 03:01:04 开跑，新实例 03:02:12.695 上线，
 * 跑着这一轮的旧实例日志停在 03:02:38.501（oztop 那篇写进库的前 0.5 秒），
 * 排在后面的 CTS Tours NZ 一个字都没生成。`finish()` 没机会执行，
 * 运行记录永远停在 running —— 既不报错、也不逾期，等于一次静默的客户交付损失。
 */
describe('被 SIGTERM 掐断时的收口', () => {
  it('🔴 还没收尾的那一轮：收成 failed，并留下「是被掐断的」这个标记', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await startCronRun('blog-weekly')
    expect(state.rows[0].status).toBe('running')           // 锚点：确实是在跑的状态被打断的

    const closed = await closeInFlightCronRuns('SIGTERM')

    expect(closed).toBe(1)
    expect(state.rows).toHaveLength(1)                     // 不许另插一条孤儿记录
    expect(state.rows[0].status).toBe('failed')
    expect(state.rows[0].finished_at).toEqual(expect.any(String))
    expect(String(state.rows[0].error_message)).toContain('SIGTERM')
    expect(state.rows[0].summary).toMatchObject({ [INTERRUPTED_BY_KEY]: INTERRUPTED_BY_DEPLOY })
  })

  it('🔴 已经正常跑完的那一轮：SIGTERM 不许把它改写成失败', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const run = await startCronRun('blog-weekly')
    await run.finish({ processed: 2, completed: 2 })
    expect(state.rows[0].status).toBe('completed')

    const closed = await closeInFlightCronRuns('SIGTERM')

    expect(closed).toBe(0)
    expect(state.rows[0].status).toBe('completed')         // 没被反向改写
    expect(state.rows[0].summary).toBeNull()
  })

  it('🔴 Inngest 那条路（startCronRunId）不登记：它的步骤可能跑在别的机器上，按本进程的记忆收就是误伤', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await startCronRunId('cloud-seo-meta-cycle-fanout')
    expect(state.rows[0].status).toBe('running')           // 锚点：记录确实开出来了

    const closed = await closeInFlightCronRuns('SIGTERM')

    expect(closed).toBe(0)
    expect(state.rows[0].status).toBe('running')           // 留给 onFailure → failOpenCronRuns 收
  })

  it('一个在跑的都没有时不去写库 —— 每次部署都跑这段，不能白发请求', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const before = state.updateAttempts
    expect(await closeInFlightCronRuns('SIGTERM')).toBe(0)
    expect(state.updateAttempts).toBe(before)
  })
})

/**
 * 🔴 这条补的是复审查出来的一个「测试在自欺」：上面那条「已经跑完的不许被反写」
 *    之所以是 0，是因为 `finish()` 把条目从 inFlight 里摘掉了 ——
 *    走的根本不是 `.eq('status','running')` 那道守卫。
 *    这里造出注释里真正声称要防的场景：**条目还挂在 inFlight，库里这一行已经是 completed**。
 */
describe('带条件 update 这道守卫本身', () => {
  it('🔴 条目还挂着、但库里已经收成 completed：守卫必须挡住，不许反写成失败', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await startCronRun('blog-weekly')
    expect(state.rows[0].status).toBe('running')
    // 模拟「这一轮其实已经在别处收成了 completed」，而本进程的登记表还没来得及摘
    state.rows[0].status = 'completed'
    state.rows[0].finished_at = '2026-09-22T03:04:00.000Z'

    const closed = await closeInFlightCronRuns('SIGTERM')

    expect(closed).toBe(0)
    expect(state.rows[0].status).toBe('completed')       // 没被反写
    expect(state.rows[0].summary).toBeNull()             // 也没被盖上「被掐断」的标记
  })

  it('🔴 登记表里躺太久的，不许说成「被部署掐的」—— 那是编造原因', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const nowSpy = vi.spyOn(Date, 'now')

    const t0 = new Date('2026-09-22T03:00:00.000Z').getTime()
    nowSpy.mockReturnValue(t0)
    await startCronRun('blog-weekly')

    // 路由抛了异常、finish() 永远没跑，条目一直留到下一次部署（远超 ABANDONED_AFTER_MS）
    nowSpy.mockReturnValue(t0 + ABANDONED_AFTER_MS + 60_000)
    await closeInFlightCronRuns('SIGTERM')

    expect(state.rows[0].status).toBe('failed')
    expect(state.rows[0].summary).toMatchObject({ [INTERRUPTED_BY_KEY]: INTERRUPTED_BY_PROCESS_GONE })
    expect(String(state.rows[0].error_message)).toContain('死因不明')
    nowSpy.mockRestore()
  })
})

/**
 * 事后清扫 —— 「断了必定有人知道」靠的是这条，不是 SIGTERM。
 * SIGKILL / OOM / 进程直接崩，一个信号都不会有；就算有 SIGTERM，Next 的
 * `server.close(() => process.exit(0))` 也可能在异步写库落地之前就退了。
 */
describe('reapAbandonedCronRuns', () => {
  /** 直接往假表里塞一行「停在 running」的旧记录。 */
  function seedRunning(jobName: string, startedAt: string) {
    state.rows.push({
      id: `seed-${state.rows.length}`,
      job_name: jobName,
      status: 'running',
      started_at: startedAt,
      finished_at: null,
      duration_ms: null,
      processed: 0,
      completed_count: 0,
      failed_count: 0,
      summary: null,
      error_message: null,
    })
  }

  const NOW = new Date('2026-09-23T04:00:00.000Z')

  it('🔴 停在 running 太久的收成 failed，并标上「死因不明」', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    seedRunning('blog-weekly', '2026-09-22T03:01:04.084272+00:00')

    expect(await reapAbandonedCronRuns(NOW)).toBe(1)
    expect(state.rows[0].status).toBe('failed')
    expect(state.rows[0].summary).toMatchObject({ [INTERRUPTED_BY_KEY]: INTERRUPTED_BY_PROCESS_GONE })
    expect(state.rows[0].finished_at).toEqual(expect.any(String))
  })

  it('🔴 还没到点的不许碰 —— 收早了会把正在好好跑的一轮判成失败', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const justStarted = new Date(NOW.getTime() - 60_000).toISOString()
    seedRunning('blog-weekly', justStarted)

    expect(await reapAbandonedCronRuns(NOW)).toBe(0)
    expect(state.rows[0].status).toBe('running')
  })

  it('🔴 Inngest 调度的任务一概不碰 —— 它们一轮可以合法地跑很久', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    seedRunning('messenger-brief-hourly', '2026-09-20T00:00:00.000000+00:00')

    expect(await reapAbandonedCronRuns(NOW)).toBe(0)
    expect(state.rows[0].status).toBe('running')
  })

  it('🔴 已经收尾的不许重新打开', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    state.rows.push({
      id: 'done-1', job_name: 'blog-weekly', status: 'completed',
      started_at: '2026-09-15T03:01:00.349Z', finished_at: '2026-09-15T03:04:02.387Z',
      duration_ms: 182038, processed: 2, completed_count: 2, failed_count: 0,
      summary: null, error_message: null,
    })
    expect(await reapAbandonedCronRuns(NOW)).toBe(0)
    expect(state.rows[0].status).toBe('completed')
  })

  it('🔴 清扫写不进去必须喊出来，不许静默', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    seedRunning('blog-weekly', '2026-09-22T03:01:04.084272+00:00')
    state.failUpdate = { message: 'permission denied for table cron_run_logs', code: '42501' }

    expect(await reapAbandonedCronRuns(NOW)).toBe(0)
    expect(said(spy)).toContain('permission denied for table cron_run_logs')
  })
})
