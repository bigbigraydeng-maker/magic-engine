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
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
interface PgError { message: string; code?: string; details?: string | null; hint?: string | null }

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  failInsert: null as PgError | null,
  failUpdate: null as PgError | null,
  failUpsert: null as PgError | null,
  /** 这些 status 一律被 CHECK 拒绝（模拟迁移还没应用）。 */
  rejectStatuses: [] as string[],
  insertAttempts: 0,
  updateAttempts: 0,
  upsertAttempts: 0,
  seq: 0,
}))

vi.mock('@/lib/supabase', () => {
  const STATUSES = ['running', 'completed', 'partial', 'failed', 'abandoned']

  function from(table: string) {
    if (table !== 'cron_run_logs') throw new Error(`假件只建模了 cron_run_logs，收到 ${table}`)
    let mode: 'select' | 'insert' | 'update' | 'upsert' = 'select'
    let payload: Row = {}
    const eqs: Array<[string, unknown]> = []
    const ltes: Array<[string, string]> = []
    const hits = () =>
      state.rows.filter(
        (r) => eqs.every(([c, v]) => r[c] === v) && ltes.every(([c, v]) => String(r[c] ?? '') <= v),
      )
    // 真表上的两条约束 —— 少写 job_name 或写错 status，库里是会拒的。insert 和 upsert 都要过这一关。
    function checkConstraints(row: Row): PgError | null {
      if (!row.job_name) return { message: 'null value in column "job_name"', code: '23502' }
      if (!STATUSES.includes(String(row.status)) || state.rejectStatuses.includes(String(row.status))) {
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
  cronRunIdFromInngestRun,
  startCronRunWithId,
  finishCronRunIfOpen,
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
  state.rejectStatuses = []
  state.insertAttempts = 0
  state.updateAttempts = 0
  state.upsertAttempts = 0
  state.seq = 0
  vi.restoreAllMocks()
})

describe('startCronRun', () => {
  it('一切正常：一行记录从 running 变成 completed，并且一声不吭', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const run = await startCronRun('demo-job')
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0].job_name).toBe('demo-job')       // 锚点：假件确实被打中了
    expect(state.rows[0].status).toBe('running')

    await run.finish({ processed: 3, completed: 3, failed: 0 })

    expect(state.rows).toHaveLength(1)                     // 收尾是 update，不是再插一行
    expect(state.rows[0].status).toBe('completed')
    expect(state.rows[0].processed).toBe(3)
    expect(state.rows[0].completed_count).toBe(3)
    expect(state.rows[0].failed_count).toBe(0)
    expect(state.rows[0].finished_at).toEqual(expect.any(String))
    expect(spy).not.toHaveBeenCalled()                     // 顺路的时候不许刷屏
  })

  it('部分条目失败：failed_count 照记，状态是 partial，不能再写成 completed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const run = await startCronRun('demo-job')
    await run.finish({ processed: 3, completed: 2, failed: 1 })
    expect(state.rows[0].status).toBe('partial')
    expect(state.rows[0].failed_count).toBe(1)
    expect(state.rows[0].completed_count).toBe(2)
  })

  it('条目全失败、调用方没另传 error：状态是 failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const run = await startCronRun('demo-job')
    await run.finish({ processed: 2, completed: 0, failed: 2 })
    expect(state.rows[0].status).toBe('failed')
    expect(state.rows[0].failed_count).toBe(2)
  })

  it('有的成了有的没成，同时又带了 error 原文：仍是 partial，原文留在 error_message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const run = await startCronRun('demo-job')
    await run.finish({ completed: 1, failed: 1, error: 'page A: boom' })
    expect(state.rows[0].status).toBe('partial')
    expect(state.rows[0].error_message).toBe('page A: boom')
  })

  it('约束还不接受 partial：改写成 failed，不能把这一行留在 running', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.rejectStatuses = ['partial']
    const run = await startCronRun('demo-job')
    await run.finish({ processed: 3, completed: 2, failed: 1 })
    expect(state.rows[0].status).toBe('failed')
    expect(String(state.rows[0].error_message)).toContain('partial:')
    expect(state.rows[0].failed_count).toBe(1)
    expect(said(spy)).toContain('还不接受 status=partial')
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

describe('cronRunIdFromInngestRun（Inngest run id → 固定运行记录 id）', () => {
  it('同一个 run id 永远算出同一个 id，形状是 UUID；不同 run id 不同', () => {
    const a = cronRunIdFromInngestRun('01J8Z5K2M3N4P5Q6R7S8T9V0W1')
    expect(a).toBe(cronRunIdFromInngestRun('01J8Z5K2M3N4P5Q6R7S8T9V0W1'))
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(cronRunIdFromInngestRun('01J8Z5K2M3N4P5Q6R7S8T9V0W2')).not.toBe(a)
  })

  it('就是 sha256(runId) 的前 32 个十六进制字符（onFailure 那边按同一个公式算，必须对得上）', () => {
    const hex = createHash('sha256').update('run-1').digest('hex').slice(0, 32)
    expect(cronRunIdFromInngestRun('run-1').replace(/-/g, '')).toBe(hex)
  })
})

describe('startCronRunWithId（用指定 id 开一行）', () => {
  it('用给定的 id 插一行 running', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await startCronRunWithId('gsc-page-daily-pull', 'fixed-id-1')
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0]).toMatchObject({ id: 'fixed-id-1', job_name: 'gsc-page-daily-pull', status: 'running' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('🔴 重试撞主键（23505 = 上一次其实已经插成）→ 静默返回，不喊、不抛', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.failInsert = { message: 'duplicate key value violates unique constraint "cron_run_logs_pkey"', code: '23505' }
    await expect(startCronRunWithId('gsc-page-daily-pull', 'fixed-id-1')).resolves.toBeUndefined()
    expect(state.insertAttempts).toBe(1)
    expect(spy).not.toHaveBeenCalled()
  })

  it('其他写失败 → 喊出来（带任务名和 id），不抛', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.failInsert = { message: 'permission denied for table cron_run_logs', code: '42501' }
    await expect(startCronRunWithId('gsc-page-daily-pull', 'fixed-id-1')).resolves.toBeUndefined()
    const text = said(spy)
    expect(text).toContain('gsc-page-daily-pull')
    expect(text).toContain('fixed-id-1')
    expect(text).toContain('42501')
  })
})

describe('finishCronRunIfOpen（onFailure 按 id 只收自己那一行）', () => {
  const T0 = '2026-09-26T18:31:00.000Z'
  function row(id: string, status: string, job = 'gsc-page-daily-pull'): Row {
    return { id, job_name: job, status, started_at: T0, finished_at: null, error_message: null }
  }

  it('🔴 只收这个 id 的那一行；同名、同样还在跑的别的单一行都不碰', async () => {
    state.rows.push(row('mine', 'running'), row('sibling', 'running'))
    const result = await finishCronRunIfOpen(
      'gsc-page-daily-pull',
      'mine',
      { processed: 1, failed: 1, error: 'retries exhausted: boom' },
      new Date('2026-09-26T19:00:00.000Z'),
    )
    expect(result).toBe('closed')
    const mine = state.rows.find((r) => r.id === 'mine')!
    expect(mine.status).toBe('failed')
    expect(mine.error_message).toBe('retries exhausted: boom')
    expect(mine.started_at).toBe(T0) // 开跑时刻沿用库里那行的，不改成失败时刻
    expect(state.rows.find((r) => r.id === 'sibling')!.status).toBe('running')
    expect(state.rows).toHaveLength(2)
  })

  it('这一行已经是终态 → 不覆盖', async () => {
    state.rows.push({ ...row('mine', 'completed'), error_message: null })
    const result = await finishCronRunIfOpen('gsc-page-daily-pull', 'mine', { failed: 1, error: 'x' }, new Date())
    expect(result).toBe('already_terminal')
    expect(state.rows[0].status).toBe('completed')
    expect(state.upsertAttempts).toBe(0)
  })

  it('开跑那步就没插成（没有这一行）→ 用同一个 id 落一条 failed，started_at 用兜底时刻', async () => {
    state.rows.push(row('sibling', 'running'))
    const result = await finishCronRunIfOpen(
      'gsc-page-daily-pull',
      'mine',
      { failed: 1, error: 'log-start 超时' },
      new Date('2026-09-26T19:00:00.000Z'),
    )
    expect(result).toBe('closed')
    const mine = state.rows.find((r) => r.id === 'mine')!
    expect(mine).toMatchObject({ job_name: 'gsc-page-daily-pull', status: 'failed', error_message: 'log-start 超时' })
    expect(mine.started_at).toBe('2026-09-26T19:00:00.000Z')
    expect(state.rows.find((r) => r.id === 'sibling')!.status).toBe('running')
  })
})
